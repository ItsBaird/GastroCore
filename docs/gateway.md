# Gateway (Nginx)

Único punto de entrada del sistema (puerto 80; el 443 con Let's Encrypt llega en la fase de despliegue). Configuración en `gateway/nginx.conf`.

## Rutas

| Ruta | Destino |
|---|---|
| `/api/auth/` | `auth:3001` |
| `/api/staff/` | `staff:3002` |
| `/api/catalog/` | `catalog:3003` |
| `/api/orders/` | `orders:3004` |
| `/socket.io/` | `orders:3004` (WebSocket, `proxy_read_timeout 3600s`) |
| `/internal/` | 404 JSON (bloqueado) |
| cualquier otra `/api/...` | 404 JSON |
| `/` | estáticos desde `/usr/share/nginx/html` (`try_files ... /index.html`) |

Los puertos 3001–3004 son internos de la red de Docker y siguen el SAD (Auth 3001, Staff 3002, Catalog 3003, Orders 3004).

## Decisiones

- **Sin recorte de prefijo.** `/api/auth/login` llega a auth como `/api/auth/login`; cada servicio monta su router en `/api/<servicio>`. Por eso `proxy_pass` usa una variable **sin URI**: nginx reenvía la URI original completa.
- **Resolver DNS de Docker** (`resolver 127.0.0.11 valid=10s ipv6=off`) más variables en `proxy_pass`: nginx resuelve el nombre en cada petición, así que arranca aunque un servicio esté caído y se recupera solo cuando vuelve (devuelve 502 mientras tanto).
- **Formato de error común**: `{"error":{"code","message","details"}}`. Códigos del gateway: `NOT_FOUND` (404), `RATE_LIMITED` (429), `SERVICE_UNAVAILABLE` (502/503/504). Los errores generados por los servicios pasan sin modificar (`proxy_intercept_errors off`).
- **Rate limiting por IP** (`limit_req_zone`):
  - `POST /api/auth/login`: `rate=5r/m` con `burst=4 nodelay`. **Por qué burst:** nginx implementa `5r/m` como 1 petición cada 12 s. Sin burst, la segunda petición inmediata ya se rechazaría. Con `burst=4 nodelay` se permiten 5 intentos seguidos y el sexto recibe 429. Un `map` sobre `$request_method` deja la llave vacía para métodos distintos de POST, que así no se limitan.
  - Endpoints públicos del canal QR (`/api/orders/qr/` y `/api/catalog/public/`): `rate=30r/m`, `burst=10 nodelay`, compartido por IP (RNF-07).
  - Cada servicio aplica además un límite general de 300 peticiones por minuto por IP (middleware `express-rate-limit`).
- **Seguridad**: `server_tokens off`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `client_max_body_size 3m` (las fotos de producto pesan hasta 2 MB). CORS lo aplica cada servicio, restringido a `CORS_ORIGIN`.
- **Timeouts** hacia servicios: connect 5 s, read/send 30 s (WebSocket: 3600 s).
- **Logs** en JSON a stdout.

## Agregar una ruta nueva

1. Si es de un servicio existente bajo `/api/<servicio>/`, no hay que tocar nginx.
2. Para un servicio nuevo: agrégalo a `docker-compose.yml` (puerto interno propio, sin publicar) y en `gateway/nginx.conf` añade:
   ```nginx
   location /api/nuevo/ {
       set $nuevo_up http://nuevo:3005;
       proxy_pass $nuevo_up;
   }
   ```
3. Para un límite propio: define un `limit_req_zone` en `http {}` y usa `limit_req` dentro del `location` (nginx elige el prefijo más largo).
4. Recarga: `docker compose exec gateway nginx -s reload` y ejecuta `scripts/smoke-gateway.sh`.
