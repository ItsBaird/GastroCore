#!/usr/bin/env bash
# Verificaciones del gateway. Requiere el stack levantado (docker compose up -d --build).
# Nota: el rate limit de login es por IP y dura 1 minuto; si repites el script,
# espera ~60 s entre ejecuciones.
BASE="${BASE_URL:-http://localhost}"
[ -f .env ] && set -a && . ./.env && set +a
FAILS=0

check() { # nombre, condicion(0=ok)
  if [ "$2" -eq 0 ]; then echo "OK   $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi
}
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
is_error_json() { # $1 body, $2 code
  echo "$1" | grep -q "\"code\":\"$2\""
}

# Esperar a que el gateway responda
for _ in $(seq 1 30); do [ "$(status "$BASE/")" = "200" ] && break; sleep 1; done

# 1. health de los 4 servicios
for s in auth staff orders catalog; do
  body=$(curl -s "$BASE/api/$s/health"); code=$(status "$BASE/api/$s/health")
  [ "$code" = "200" ] && echo "$body" | grep -q "\"service\":\"$s\""
  check "GET /api/$s/health -> 200 service=$s" $?
done

# 2. /internal bloqueado
body=$(curl -s "$BASE/internal/health"); code=$(status "$BASE/internal/health")
[ "$code" = "404" ] && is_error_json "$body" NOT_FOUND
check "GET /internal/health -> 404 JSON" $?

# 3. /api/noexiste/x -> 404 JSON del gateway
body=$(curl -s "$BASE/api/noexiste/x"); code=$(status "$BASE/api/noexiste/x")
[ "$code" = "404" ] && is_error_json "$body" NOT_FOUND
check "GET /api/noexiste/x -> 404 JSON" $?

# 4. 404 generado por el servicio auth (cabecera X-Powered-By ausente en nginx; Express+helmet la quita,
#    asi que se distingue por el Content-Type con charset que pone Express)
hdr=$(curl -si "$BASE/api/auth/noexiste")
echo "$hdr" | head -1 | grep -q " 404" && echo "$hdr" | grep -qi 'content-type: application/json; charset=utf-8' \
  && echo "$hdr" | grep -q '"code":"NOT_FOUND"'
check "GET /api/auth/noexiste -> 404 JSON del servicio auth" $?

# 4b. Login: primero se asegura el admin (idempotente), luego login real por el gateway
docker compose exec -T auth npm run seed:admin >/dev/null 2>&1
login_resp=$(curl -si -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL:-admin@lapizzeta.com}\",\"password\":\"${ADMIN_PASSWORD}\"}" | tr -d '\r')
cookie_line=$(echo "$login_resp" | grep -i '^set-cookie: refreshToken=')
echo "$login_resp" | head -1 | grep -q " 200" \
  && echo "$cookie_line" | grep -qi 'HttpOnly' \
  && echo "$cookie_line" | grep -qi 'Secure' \
  && echo "$cookie_line" | grep -qi 'SameSite=Strict'
check "POST /api/auth/login -> 200 con cookie refreshToken (HttpOnly, Secure, SameSite=Strict)" $?
access=$(echo "$login_resp" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
[ -n "$access" ] && [ "$(status "$BASE/api/auth/users" -H "Authorization: Bearer $access")" = "200" ]
check "el access token del login abre GET /api/auth/users (200)" $?
body=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"nadie@lapizzeta.com","password":"incorrecta-123"}')
echo "$body" | grep -q '"code":"UNAUTHENTICATED"'
check "login con email inexistente -> 401 UNAUTHENTICATED" $?

# 4c. Refresh con rotacion y logout (se envia la cookie a mano: es Secure y el gateway va por http)
cookie_of() { sed -n 's/^[Ss]et-[Cc]ookie: refreshToken=//p' | cut -d';' -f1; }
cookie_a=$(echo "$cookie_line" | cookie_of)
refresh_resp=$(curl -si -X POST "$BASE/api/auth/refresh" -H "Cookie: refreshToken=$cookie_a" | tr -d '\r')
cookie_b=$(echo "$refresh_resp" | grep -i '^set-cookie: refreshToken=' | cookie_of)
echo "$refresh_resp" | head -1 | grep -q " 200" && [ -n "$cookie_b" ] && [ "$cookie_b" != "$cookie_a" ] \
  && echo "$refresh_resp" | grep -q '"accessToken"'
check "POST /api/auth/refresh -> 200, access token nuevo y refresh token rotado" $?
[ "$(status -X POST "$BASE/api/auth/refresh")" = "401" ]
check "refresh sin cookie -> 401" $?
[ "$(status -X POST "$BASE/api/auth/logout" -H "Cookie: refreshToken=$cookie_b")" = "204" ]
check "POST /api/auth/logout -> 204" $?
[ "$(status -X POST "$BASE/api/auth/refresh" -H "Cookie: refreshToken=$cookie_b")" = "401" ]
check "refresh con el token ya cerrado -> 401" $?
[ "$(status -X POST "$BASE/api/auth/refresh" -H "Cookie: refreshToken=$cookie_a")" = "401" ]
check "refresh con el token ya rotado (reutilizado) -> 401" $?

# 5. Rate limit login: 5 pasan, el sexto 429
last=""
for _ in 1 2 3 4 5 6; do last=$(status -X POST "$BASE/api/auth/login"); done
body=$(curl -s -X POST "$BASE/api/auth/login")
[ "$last" = "429" ] && is_error_json "$body" RATE_LIMITED
check "6 POST /api/auth/login seguidos -> 429 JSON" $?

# 6. Servicio caido: catalog
docker compose stop catalog >/dev/null 2>&1
sleep 2
body=$(curl -s "$BASE/api/catalog/health"); code=$(status "$BASE/api/catalog/health")
[ "$code" = "502" ] && is_error_json "$body" SERVICE_UNAVAILABLE
check "catalog detenido -> 502 JSON" $?
[ "$(status "$BASE/api/auth/health")" = "200" ]
check "catalog detenido: auth sigue respondiendo" $?
docker compose start catalog >/dev/null 2>&1
ok=1
for _ in $(seq 1 30); do [ "$(status "$BASE/api/catalog/health")" = "200" ] && ok=0 && break; sleep 1; done
check "catalog reiniciado -> vuelve a responder 200" $ok

# 7. Socket.io (handshake de polling + paquete de conexion "40")
resp=$(curl -s "$BASE/socket.io/?EIO=4&transport=polling")
sid=$(echo "$resp" | sed -n 's/.*"sid":"\([^"]*\)".*/\1/p')
if [ -n "$sid" ]; then
  curl -s -X POST -d '40' "$BASE/socket.io/?EIO=4&transport=polling&sid=$sid" >/dev/null
  sleep 1
  docker compose logs orders 2>/dev/null | grep -q 'conectado'
  check "Socket.io: conexion registrada en logs de orders" $?
else
  check "Socket.io: conexion registrada en logs de orders" 1
fi

# 7b. Upgrade real a WebSocket (101 Switching Protocols)
ws=$(curl -s -o /dev/null -m 3 -w '%{http_code}' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "$BASE/socket.io/?EIO=4&transport=websocket")
[ "$ws" = "101" ]
check "WebSocket: upgrade en /socket.io/ -> 101 Switching Protocols" $?

# 8. Cabeceras de seguridad en /
hdr=$(curl -sI "$BASE/")
echo "$hdr" | head -1 | grep -q " 200" \
  && echo "$hdr" | grep -qi '^x-content-type-options: nosniff' \
  && echo "$hdr" | grep -qi '^x-frame-options: DENY' \
  && echo "$hdr" | grep -qi '^referrer-policy: strict-origin-when-cross-origin' \
  && ! echo "$hdr" | grep -qi '^server: nginx/'
check "HEAD / -> 200 con cabeceras de seguridad y sin version de nginx" $?

# 8b. Errores estandar: JSON mal formado -> 400 VALIDATION_ERROR
body=$(curl -s -X POST -H 'Content-Type: application/json' -d '{bad' "$BASE/api/auth/x")
code=$(status -X POST -H 'Content-Type: application/json' -d '{bad' "$BASE/api/auth/x")
[ "$code" = "400" ] && is_error_json "$body" VALIDATION_ERROR
check "JSON mal formado -> 400 VALIDATION_ERROR" $?

# 8b2. Solo un ADMIN autenticado puede crear usuarios
body=$(curl -s -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/auth/register")
code=$(status -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/auth/register")
[ "$code" = "401" ] && is_error_json "$body" UNAUTHENTICATED
check "POST /api/auth/register sin token -> 401 UNAUTHENTICATED" $?

# 8b3. Listar y administrar usuarios tambien exige ADMIN
code=$(status "$BASE/api/auth/users")
[ "$code" = "401" ]
check "GET /api/auth/users sin token -> 401" $?

# 8c. CORS restringido: el origen permitido es siempre el del sistema (el navegador bloquea los demas)
acao_ok=$(curl -si -H 'Origin: http://localhost' "$BASE/api/auth/health" | tr -d '\r' | sed -n 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin: //p')
acao_evil=$(curl -si -H 'Origin: http://evil.example' "$BASE/api/auth/health" | tr -d '\r' | sed -n 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin: //p')
[ "$acao_ok" = "${CORS_ORIGIN:-http://localhost}" ] && [ "$acao_evil" != "http://evil.example" ]
check "CORS: Access-Control-Allow-Origin solo permite el origen del sistema" $?

# 8d. Base de datos: 4 bases, 22 tablas, un usuario por base
tables=0
for d in auth staff catalog orders; do
  n=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-postgres}" -d "${d}_db" -Atc \
    "select count(*) from pg_tables where schemaname='public' and tableowner='${d}_user'" 2>/dev/null | tr -d '\r')
  tables=$((tables + ${n:-0}))
done
[ "$tables" -eq 22 ]
check "PostgreSQL: 4 bases con 22 tablas, cada una de su usuario" $?

# 8e. Aislamiento: auth_user no puede conectarse a staff_db
docker compose exec -T -e PGPASSWORD="$AUTH_DB_PASSWORD" postgres \
  psql -h 127.0.0.1 -U auth_user -d staff_db -c 'select 1' >/dev/null 2>&1
[ $? -ne 0 ]
check "Aislamiento: auth_user no puede conectarse a staff_db" $?

# 8f. Cada servicio llega a su base mediante Prisma
for s in auth staff catalog orders; do
  docker compose exec -T "$s" node --input-type=module -e \
    'import { prisma } from "./src/config/prisma.js"; await prisma.$queryRaw`SELECT 1`; await prisma.$disconnect();' >/dev/null 2>&1
  check "Prisma: $s se conecta a ${s}_db" $?
done

# 9. Solo el puerto 80 publicado
pub=$(docker compose ps --format '{{.Publishers}}' | grep -oE ' [1-9][0-9]* tcp}' | sort -u | tr -d '\n')
[ "$pub" = " 80 tcp}" ]
check "solo el puerto 80 publicado" $?

# 10. Todos healthy (con espera por el reinicio de catalog)
unhealthy=1
for _ in $(seq 1 30); do
  unhealthy=$(docker compose ps --format '{{.Name}} {{.Health}}' | tr -d '\r' | grep -vc ' healthy$')
  [ "$unhealthy" -eq 0 ] && break
  sleep 1
done
check "docker compose ps: todos healthy" "$unhealthy"

echo
[ "$FAILS" -eq 0 ] && echo "TODO OK" || echo "$FAILS verificacion(es) fallaron"
exit "$FAILS"
