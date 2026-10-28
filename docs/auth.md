# Autenticación y sesiones

Auth es el único servicio que emite tokens; los demás solo los validan (SAD, R1).

## Tokens

| | Access token | Refresh token |
|---|---|---|
| Formato | JWT RS256 | Valor aleatorio de 256 bits (opaco) |
| Vida | 15 min | 7 días |
| Dónde viaja | Cuerpo de la respuesta; el frontend lo guarda **en memoria** (nunca en `localStorage`) | Cookie `refreshToken`: `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` |
| En la base | No se guarda | Solo su SHA-256 (`refresh_tokens.token_hash`) |

Payload del access token: `sub` (userId), `role` (`ADMIN`, `WAITER`, `COOK`), `permissions` (por ejemplo `discount:apply`), `iat`, `exp`.

El refresh token es opaco porque siempre se consulta en la base (rotación, revocación y detección de reutilización); un JWT no aportaría nada ahí.

## Endpoints

| Endpoint | Qué hace |
|---|---|
| `POST /api/auth/login` | Verifica email y contraseña (argon2id) y emite ambos tokens. 5 intentos fallidos bloquean la cuenta 15 min (`423 ACCOUNT_LOCKED`). El gateway limita a 5 por minuto por IP. |
| `POST /api/auth/refresh` | Usa la cookie, **rota** el refresh token (el anterior queda revocado y encadenado con `replaced_by`) y emite un access token nuevo, junto con `user` para restaurar la sesión. |
| `POST /api/auth/logout` | Revoca el refresh token de la cookie y la limpia. No necesita access token y es idempotente (204). Solo cierra esa sesión. |

`refresh` y `logout` se identifican por la cookie, no por el access token, porque este puede estar vencido justo cuando se necesitan.

### Reutilización de un refresh token
Si llega un refresh token que ya fue rotado, alguien lo está reutilizando (posible robo): se responde 401 y se **revocan todas las sesiones del usuario**. Lo mismo ocurre si dos peticiones simultáneas usan el mismo token (solo una gana). Por eso el frontend debe hacer **un solo refresh a la vez** (una cola o un candado compartido entre pestañas).

Un usuario desactivado no puede renovar y sus refresh tokens se revocan al desactivarlo. Su access token sigue valiendo hasta que expire (máximo 15 min), porque los servicios validan solo la firma.

## Claves RSA

`bash scripts/generate-keys.sh` genera el par en `./keys` (fuera de git):

- `keys/private/jwt_private.pem` solo se monta en **auth**.
- `keys/public/jwt_public.pem` se monta de solo lectura en **todos** los servicios (`/run/keys/public/jwt_public.pem`).

Si falta la clave, el servicio sigue sano y solo fallan las peticiones protegidas (500, con un mensaje en los logs).

## Proteger rutas en un servicio

Todos los servicios traen `src/middlewares/authenticate.js`:

```js
import { authenticate, requireRole, requirePermission } from '../middlewares/authenticate.js';

// Cualquier usuario con sesión
router.get('/tables', authenticate, listTables);

// Solo ciertos roles. Donde la documentación dice WAITER, el ADMIN también puede: se pasa explícito
router.post('/tables/:id/open', authenticate, requireRole('WAITER', 'ADMIN'), openTable);

// Permiso fino que viaja en el token
router.post('/:orderId/discount', authenticate, requirePermission('discount:apply'), applyDiscount);
```

- Sin token, token vencido, mal firmado o de otro algoritmo: `401 UNAUTHENTICATED`.
- Rol o permiso insuficiente: `403 FORBIDDEN`.
- El usuario queda en `req.user = { userId, role, permissions }`.

Esto solo comprueba **quién es** el usuario y su rol. Reglas como "mesero asignado a la mesa" (dueño de la mesa o ADMIN) se validan en el servicio de negocio.
