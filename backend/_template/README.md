# Plantilla de microservicio

Copia de referencia con el middleware estandar (helmet, cors, rate-limit, zod), el formato de
error comun y la estructura en capas. Los servicios `auth`, `staff`, `catalog` y `orders` parten de ella.

## Crear un servicio nuevo
1. Copia esta carpeta a `backend/<servicio>` y reemplaza `__SERVICE__` y `__PORT__` (nombre y puerto interno).
2. Define `prisma/schema.prisma` (el DDL vive en `db/init/schema/<servicio>.sql`).
3. Genera el `package-lock.json`:
   `npm install express helmet cors express-rate-limit zod @prisma/client prisma`.
4. Agrega el servicio a `docker-compose.yml` y la ruta a `gateway/nginx.conf` (ver `docs/gateway.md`).

## Piezas
- `src/config/env.js` valida las variables de entorno con zod.
- `src/middlewares/validate.js`: `validate({ body, params, query })`; datos validados en `req.valid`.
- `src/middlewares/rateLimiter.js`: `createRateLimiter({ windowMs, limit })` (global: 300/min por IP).
- `src/errors/AppError.js`: `throw new AppError({ status, code, message, details })`.
- `src/middlewares/errorHandler.js`: AppError -> su status/code; ZodError y JSON mal formado ->
  400 `VALIDATION_ERROR`; cualquier otro -> 500 `INTERNAL_ERROR` sin exponer el mensaje.
  El stack solo se incluye con `NODE_ENV=development`.
