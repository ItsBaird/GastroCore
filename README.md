# GastroCore

## Cómo levantar el proyecto

### Requisitos
- Docker y Docker Compose v2
- `bash` y `curl` (para el smoke test)
- Node.js 20+ solo si vas a usar ESLint y Prettier en local

### Pasos
```bash
cp .env.example .env      # ajusta los valores si hace falta
bash scripts/generate-keys.sh   # par RSA para los JWT, queda en ./keys (fuera de git)
docker compose up -d --build
docker compose ps         # todos deben quedar "healthy"
```
La aplicación queda en `http://localhost` (solo el gateway publica puerto). Contenedores: `gateway` (nginx), `auth`, `staff`, `catalog`, `orders`, `postgres` y `pgadmin`.

La primera vez, Postgres crea las 4 bases y las 22 tablas desde `db/init`. Para recrearlas desde cero en local: `docker compose down -v` (borra los datos) y vuelve a levantar. Detalle en [docs/database.md](docs/database.md).

### Primer administrador
Nadie puede crear usuarios sin un ADMIN, asi que el primero se crea con un script que lee `ADMIN_EMAIL` y `ADMIN_PASSWORD` del `.env` (la contrasena debe tener al menos 10 caracteres). Es idempotente:
```bash
docker compose exec auth npm run seed:admin
```
Despues, el ADMIN crea al resto con `POST /api/auth/register`. Para iniciar sesion: `POST /api/auth/login` con `{ "email", "password" }`. Devuelve el access token (15 min) en el cuerpo y el refresh token (7 dias) en la cookie `refreshToken` (`HttpOnly; Secure; SameSite=Strict`). Tras 5 intentos fallidos la cuenta se bloquea 15 minutos (`423 ACCOUNT_LOCKED`). El flujo de sesion (refresh con rotacion, logout) y como proteger rutas en cada servicio estan en [docs/auth.md](docs/auth.md).

### pgAdmin (solo desarrollo)
pgAdmin corre en la red interna y no publica puerto. Para abrirlo en `http://127.0.0.1:5050`:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Smoke test
```bash
bash scripts/smoke-gateway.sh
```
Imprime OK/FAIL por verificación (gateway, errores, CORS, base de datos y Prisma). Detiene y reinicia `catalog` durante la prueba y el límite de login es por minuto: espera ~60 s entre ejecuciones. Más detalle en [docs/gateway.md](docs/gateway.md).

## Frontend
SPA en React + Vite dentro de `frontend/`. Para verla en local, con el stack levantado y el admin creado:
```bash
cd frontend && npm install && npm run dev    # http://localhost:5173
```
Detalle de la estructura, la sesión y las rutas en [frontend/README.md](frontend/README.md).

## Estructura

```
frontend/           SPA React (login y gestion de usuarios)
backend/_template   plantilla de microservicio (helmet, cors, rate-limit, zod, errores comunes)
backend/<servicio>  auth (3001), staff (3002), catalog (3003), orders (3004)
db/init             creación de roles, bases y esquema (SQL = fuente de verdad)
docs/               gateway, base de datos y openapi-spec.yaml (contrato de la API)
gateway/            nginx.conf y página estática de prueba
scripts/            smoke-gateway.sh
```

## Calidad de código
ESLint y Prettier son compartidos para todo el monorepo (configuración en la raíz):
```bash
npm install
npm run lint
npm run format:check   # o npm run format para corregir
```

## Contrato de la API
`docs/openapi-spec.yaml` es la fuente de verdad de los endpoints (RNF-10): un cambio de contrato requiere su propio PR antes de implementarlo.
