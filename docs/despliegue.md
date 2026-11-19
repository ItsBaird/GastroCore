# Despliegue en Vercel + Render (plan gratuito)

Guía paso a paso para publicar GastroCore. Cualquiera del equipo puede seguirla de principio a fin.

| Pieza | Dónde | Archivo que la define |
|---|---|---|
| Frontend (React) | Vercel | `frontend/vercel.json` |
| Auth, Staff, Catalog, Orders | Render, 4 servicios web Docker | `render.yaml` (Blueprint) |
| PostgreSQL 16 (las 4 bases) | Render, una instancia | `scripts/render-db-*.sh` |

```
navegador ──https──> Vercel (gastrocore.vercel.app)
   │                   ├─ /            -> index.html y assets/ (la app)
   │                   └─ /api/<svc>/* -> https://gastrocore-<svc>.onrender.com/api/<svc>/*
   └──wss (socket)──> gastrocore-orders.onrender.com   (Vercel no reenvía websockets)

Staff -> Auth, Orders     │  por la URL pública de Render + cabecera X-Service-Token
Orders -> Staff, Catalog  │  (un servicio gratis no recibe tráfico de la red privada)
los 4 -> PostgreSQL       │  por la URL interna de la base (misma región)
```

Las peticiones `/api` van al mismo dominio que la app y Vercel las reenvía. Por eso no hay CORS en la API y la cookie de sesión (`SameSite=Strict`, `Path=/api/auth`) funciona igual que en local con nginx.

## Límites del plan gratuito que importan

- **Los servicios se duermen** tras 15 min sin peticiones y tardan ~50 s en despertar. Al abrir la app, el frontend despierta en segundo plano los servicios que va a usar (`frontend/src/utils/wakeServices.js`). Entre servicios se espera hasta 60 s (`INTERNAL_TIMEOUT_MS`).
- **750 horas al mes por cuenta**, compartidas por los 4 servicios. Alcanzan porque se duermen. **No** uses "pingers" que los mantengan despiertos: 4 servicios despiertos todo el mes gastan ~2900 h y Render los suspende hasta el mes siguiente.
- **La base gratis vence a los 30 días** (después hay 14 días de gracia sin acceso y luego se borra). Solo se permite **una** base gratis por cuenta. Ver [Renovar la base](#renovar-la-base-cada-30-días).
- **Sin consola ni disco persistente.** Los seeds se corren desde tu PC. Las fotos de productos están en la base (`product_photos`), no en disco.

## 1. Requisitos en tu PC

- Git Bash (Windows) con `openssl`, que ya viene incluido.
- Docker Desktop abierto. Los scripts usan la imagen `postgres:16-alpine` y las imágenes de los servicios, así que no hace falta instalar `psql`.
- El repo actualizado y `develop` ya mezclado en `main`: Render y Vercel despliegan `main`.
- Cuentas en Render y Vercel conectadas al repo de GitHub.

## 2. Generar los secretos de producción

Nunca reutilices las claves ni las contraseñas de local. Todo lo que se genera aquí queda **fuera del repo**.

### Claves JWT (RS256)

En Git Bash, en una carpeta fuera del repo:

```bash
mkdir -p ~/gastrocore-prod-keys && cd ~/gastrocore-prod-keys
openssl genrsa -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
```

Los nombres deben ser exactamente `jwt_private.pem` y `jwt_public.pem`: Render monta cada Secret File en `/etc/secrets/<nombre>` y las variables apuntan ahí. La privada solo se sube a Auth (paso 5).

Guárdalas en un lugar seguro, como un gestor de contraseñas. Si se pierden, se generan otras y todas las sesiones se cierran, pero no se pierde ningún dato.

### Contraseñas de la base y del administrador

```bash
cp .env.render.example .env.render     # en la raíz del repo; .env.render está en .gitignore
openssl rand -hex 24                   # una por cada *_DB_PASSWORD (solo letras y números)
```

Llena en `.env.render`:

- `AUTH_DB_PASSWORD`, `STAFF_DB_PASSWORD`, `CATALOG_DB_PASSWORD` y `ORDERS_DB_PASSWORD`.
- `ADMIN_EMAIL` y `ADMIN_PASSWORD` (mínimo 10 caracteres).
- `DEMO_PASSWORD`, solo si vas a cargar los datos de demostración.

`RENDER_ADMIN_URL` se llena en el paso 3.

### SERVICE_TOKEN

No se genera a mano: lo genera Render al crear el Blueprint (`generateValue: true`) y lo comparten los 4 servicios.

## 3. Crear la base en Render

1. En Render: **New > Postgres**.
2. Configúrala así:
   - Name: `gastrocore-db`
   - Database: `gastrocore`
   - Region: **Virginia**. Debe ser la misma de `render.yaml`; si no, los servicios no llegan a la URL interna.
   - PostgreSQL Version: **16**
   - Plan: **Free**
3. Anota la fecha de creación: vence a los 30 días.
4. Cuando esté *Available*, ve a **Connect > External Database URL**, cópiala en `RENDER_ADMIN_URL` de `.env.render` y no la compartas.
5. Crea los usuarios, las bases y los esquemas:

   ```bash
   bash scripts/render-db-init.sh
   ```

   Al final imprime la `DATABASE_URL` **interna** de cada servicio, con un marcador `<..._DB_PASSWORD>` en lugar de la contraseña. Guárdala para el paso 4.

   El administrador de Render no es superusuario. El script se concede el rol de cada usuario para crear su base a nombre de ese usuario y poder respaldarla después. Puedes repetirlo sin riesgo: no duplica nada.

## 4. Crear los servicios (Blueprint)

1. En Render: **New > Blueprint**, elige el repo y la rama `main`. Render lee `render.yaml`.
2. Revisa que los nombres sean exactamente `gastrocore-auth`, `gastrocore-staff`, `gastrocore-catalog` y `gastrocore-orders`. Esos nombres fijan las URL `https://<nombre>.onrender.com`, que también están escritas en `frontend/vercel.json` y en `render.yaml`.
3. Render pide la `DATABASE_URL` de cada servicio, porque está marcada `sync: false`. Pega la URL interna del paso 3 y cambia el marcador por la contraseña real de `.env.render`. **Solo la pide esta vez.**
4. Aplica el Blueprint. Se crean los 4 servicios y el grupo de variables `gastrocore-compartido`.

Si Render asigna una URL distinta, por ejemplo `gastrocore-auth-x1y2.onrender.com`, porque el nombre ya está tomado:

1. Corrige la URL en `frontend/vercel.json` (reenvíos y `connect-src` de la CSP).
2. Corrígela en `render.yaml` (`AUTH_URL`, `ORDERS_URL`, `CATALOG_SERVICE_URL` y `STAFF_SERVICE_URL`).
3. Corrígela en `VITE_WS_URL` (paso 7).
4. Corrige también el test `frontend/src/vercelConfig.test.js`.
5. Haz commit a `main`.

## 5. Subir las claves JWT (Secret Files)

`render.yaml` no puede declarar archivos secretos: se suben en el panel.

| Dónde | Environment > Secret Files | Contenido |
|---|---|---|
| Grupo **gastrocore-compartido** (Environment Groups) | `jwt_public.pem` | La clave pública (la leen los 4 servicios) |
| Servicio **gastrocore-auth** | `jwt_private.pem` | La clave privada (**solo aquí**: Auth es el único que firma) |

Después de guardar, haz **Manual Deploy > Deploy latest commit** en los 4 servicios para que monten los archivos. Sin las claves, los servicios arrancan "sanos", pero el login y las rutas protegidas responden 500.

Comprueba que los 4 respondan. La primera petición puede tardar ~50 s mientras despiertan:

```bash
for s in auth staff catalog orders; do curl -s https://gastrocore-$s.onrender.com/api/$s/health; echo; done
```

## 6. Crear el administrador (y la demo, opcional)

Desde tu PC, con `.env.render` lleno:

```bash
bash scripts/render-seed.sh admin   # primer ADMIN (ADMIN_EMAIL / ADMIN_PASSWORD)
bash scripts/render-seed.sh demo    # OPCIONAL: meseros, cocinero, catálogo, 10 mesas y una semana de ventas
```

Corren en tu PC con la imagen de cada servicio (`docker compose run`, sin levantar el stack local) contra la URL externa de la base. Usan el usuario de cada servicio, no el administrador. Ambos se pueden repetir sin duplicar nada.

La demo deja contraseñas conocidas (`DEMO_PASSWORD`) y datos falsos: úsala solo para presentaciones.

## 7. Crear el frontend en Vercel

1. En Vercel: **Add New > Project**, importa el repo y configúralo así:
   - **Root Directory: `frontend`**
   - Framework: Vite (lo fija `vercel.json`)
   - Production Branch: `main`
2. En **Environment Variables**, para Production, agrega `VITE_WS_URL = https://gastrocore-orders.onrender.com`. Se lee **al construir**: si la cambias, vuelve a desplegar.
3. Despliega. Si el dominio no queda `https://gastrocore.vercel.app`, cambia `CORS_ORIGIN` en `render.yaml` por el dominio real, sin `/` al final, y haz commit a `main`. Render sincroniza el grupo y vuelve a desplegar.

   Cambiarlo solo en el panel no sirve: la siguiente sincronización del Blueprint vuelve a poner el valor del archivo.

Abre el dominio de producción y entra con el admin. Los dominios *preview* de Vercel (`gastrocore-git-...vercel.app`) no están en `CORS_ORIGIN`: ahí el tiempo real no funciona.

## Variables de cada servicio

**C** = grupo `gastrocore-compartido` · **B** = valor en `render.yaml` · **P** = se carga en el panel (secreto) · **S** = Secret File

| Variable | Auth | Staff | Catalog | Orders | Valor | Origen |
|---|:-:|:-:|:-:|:-:|---|:-:|
| `NODE_ENV` | ✓ | ✓ | ✓ | ✓ | `production` | B |
| `PORT` | 3001 | 3002 | 3003 | 3004 | El mismo `EXPOSE` del Dockerfile | B |
| `SERVICE_NAME` | ✓ | ✓ | ✓ | ✓ | `auth`, `staff`, `catalog`, `orders` | B |
| `DATABASE_URL` | ✓ | ✓ | ✓ | ✓ | `postgresql://<svc>_user:<pass>@<host interno>:5432/<svc>_db` | P |
| `CORS_ORIGIN` | ✓ | ✓ | ✓ | ✓ | `https://gastrocore.vercel.app` (el dominio real de Vercel) | C |
| `TRUST_PROXY` | ✓ | ✓ | ✓ | ✓ | `2` (Vercel + Render; ver [429](#todos-reciben-429-demasiados-intentos)) | C |
| `INTERNAL_TIMEOUT_MS` | – | ✓ | – | ✓ | `60000` (un servicio dormido tarda ~50 s) | C |
| `SERVICE_TOKEN` | – | ✓ | ✓ | ✓ | Lo genera Render | C |
| `JWT_PUBLIC_KEY_PATH` | ✓ | ✓ | ✓ | ✓ | `/etc/secrets/jwt_public.pem` | C + S |
| `JWT_PRIVATE_KEY_PATH` | ✓ | – | – | – | `/etc/secrets/jwt_private.pem` | B + S |
| `LOGIN_RATE_LIMIT` | ✓ | – | – | – | `5` intentos de login por IP y minuto | B |
| `PUBLIC_RATE_LIMIT` | – | – | ✓ | ✓ | `30` peticiones por IP y minuto al menú y al QR públicos | B |
| `AUTH_URL` / `ORDERS_URL` | – | ✓ | – | – | `https://gastrocore-auth.onrender.com` / `...-orders...` | B |
| `CATALOG_SERVICE_URL` / `STAFF_SERVICE_URL` | – | – | – | ✓ | `https://gastrocore-catalog.onrender.com` / `...-staff...` | B |
| `CATALOG_CLIENT_MOCK` | – | – | – | ✓ | `false` (con `production` no se permite `true`) | B |

En el grupo, los servicios que no usan una variable simplemente la ignoran. En Vercel la única variable es `VITE_WS_URL`. Todo lo que empieza por `VITE_` queda público dentro del build: nunca pongas secretos ahí.

## Renovar la base (cada 30 días)

Hazlo **antes del día 30**: después la base queda sin acceso y ya no se puede respaldar. Como solo se permite una base gratis, hay que borrar la vieja antes de crear la nueva. Por eso el respaldo se comprueba **antes** de borrar.

1. Avisa al equipo. Durante ~10 min la app no tendrá base.
2. Haz el respaldo y revisa que las 4 bases tengan tablas con datos:

   ```bash
   bash scripts/render-db-backup.sh   # -> backups/render-AAAAMMDD-HHMM/ (fuera de git; tiene datos reales)
   ```

3. En Render, borra `gastrocore-db` y crea otra igual (paso 3: Virginia, PostgreSQL 16, Free). Pon su nueva **External Database URL** en `RENDER_ADMIN_URL`. Deja las mismas `*_DB_PASSWORD`.
4. Restaura:

   ```bash
   bash scripts/render-db-restore.sh backups/render-AAAAMMDD-HHMM
   ```

   Crea los usuarios y las bases, restaura todo a nombre del usuario de cada servicio, muestra las filas por tabla y se niega a restaurar sobre una base con tablas.
5. En cada uno de los 4 servicios, edita `DATABASE_URL` en Environment con el **host interno nuevo** que imprime el script. Al guardar, el servicio se vuelve a desplegar.
6. Comprueba que el login funcione, que aparezcan las órdenes y que un QR impreso abra su mesa.

Se conserva todo: usuarios, ventas, cierres de caja, fotos y el `qr_token` de cada mesa, así que los QR impresos siguen sirviendo. Las sesiones abiertas también siguen, porque los refresh tokens están en la base.

## Solución de problemas

Lo primero siempre: **Logs** del servicio en Render y la consola del navegador (F12 > Console / Network).

### 504 o "The page could not be loaded" en `/api/...`
- **Un servicio dormido.** La primera petición tras 15 min despierta el servicio (~50 s). Espera y reintenta. La app lo hace sola al cargar; si alguien deja la pantalla abierta mucho tiempo, basta con recargar.
- **Un servicio que no arranca.** En los logs de Render aparece `Variables de entorno invalidas: ...`. Falta una variable o tiene un formato inválido, por ejemplo `TRUST_PROXY=true` o un `DATABASE_URL` vacío. Corrígela y vuelve a desplegar.
- **La URL del reenvío no coincide** con la del servicio en Render: revisa `frontend/vercel.json` (paso 4).

### 503 `DEPENDENCY_UNAVAILABLE`
Un servicio llamó a otro y no respondió dentro de `INTERNAL_TIMEOUT_MS`. Por ejemplo, Orders consulta a Catalog los precios y Catalog estaba dormido. Reintenta en unos segundos.

Si pasa siempre, revisa:
- Que las URL `*_URL` / `*_SERVICE_URL` de `render.yaml` sean las reales.
- Que `SERVICE_TOKEN` venga del grupo en los 4 servicios. Si no coincide, la respuesta es 401 en `/internal/*` y lo verás en los logs del servicio llamado.

### Error de CORS en la consola
Solo puede pasar con el socket, porque la API va por el mismo dominio. Revisa:
- Que `CORS_ORIGIN` sea **exactamente** el dominio donde abriste la app: `https://`, sin `/` al final, sin `www` si no lo usas.
- Que estés en el dominio de producción y no en uno *preview*.

### La sesión se pierde al recargar (401 en `/api/auth/refresh`)
- Abre la app **siempre por el dominio de Vercel**, nunca por `*.onrender.com`. La cookie `refreshToken` es del dominio de Vercel, con `Path=/api/auth` y `Secure`, así que solo sirve por https.
- En Network, la respuesta de `POST /api/auth/login` debe traer `Set-Cookie: refreshToken=...`. Si no la trae, revisa que el reenvío `/api/auth/:path*` de `vercel.json` esté activo.
- Si el login funciona pero todo lo demás responde 401: la clave pública no es pareja de la privada. Vuelve a subir las dos del mismo par (paso 5).
- Si el login responde 500 y los logs hablan de la clave: falta el Secret File, el nombre está mal o no se volvió a desplegar después de subirlo.
- Si los logs dicen `permission denied` en `/etc/secrets/...`: el contenedor corre con el usuario `node` (uid/gid 1000), que según Render debe poder leer los Secret Files. Si no puede, avísale al equipo: hay que ajustar el Dockerfile.

### No llegan las actualizaciones en tiempo real (cocina, mesero, QR)
- En la consola aparece `Refused to connect ... Content Security Policy`: `VITE_WS_URL` no coincide con el `connect-src` de `vercel.json`. Deben ser la misma URL de Orders.
- En Network no hay peticiones a `gastrocore-orders.onrender.com/socket.io`: `VITE_WS_URL` no estaba definida al construir. Agrégala en Vercel y vuelve a desplegar.
- Si aparece un error de CORS, ver arriba.
- Orders estaba dormido: el socket se reconecta solo cuando despierta (~50 s).

### Todos reciben 429 "Demasiados intentos"
Los límites son por IP. Si con 5 logins fallidos en total, de cualquier persona, ya se bloquea a todos, los servicios están viendo la IP de Vercel en lugar de la del cliente: sube `TRUST_PROXY` (por ejemplo a `3`) en `render.yaml` y haz commit.

Ojo: en una demostración, quienes comparten la misma red (wifi del salón) comparten la IP pública y el límite. Para ese día se puede subir `LOGIN_RATE_LIMIT` o `PUBLIC_RATE_LIMIT` en `render.yaml`.

### El servicio no conecta a la base
- La base y los servicios deben estar en la **misma región** (Virginia).
- `DATABASE_URL` debe usar el host **interno** (sin `.virginia-postgres.render.com`) y la contraseña de `.env.render`.
- Si se renovó la base, actualiza la `DATABASE_URL` de los 4 servicios.

### Los scripts de la base fallan desde mi PC
- Docker Desktop debe estar abierto.
- `RENDER_ADMIN_URL` debe ser la URL **externa** (con `.virginia-postgres.render.com`). Los scripts le agregan `sslmode=require` solos.
- `permission denied to create role` o `to create database`: el usuario de la URL no es el administrador que Render creó con la base.
