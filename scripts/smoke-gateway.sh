#!/usr/bin/env bash
# Verificaciones del gateway. Requiere el stack levantado (docker compose up -d --build).
# Nota: el rate limit de login es por IP y dura 1 minuto; si repites el script,
# espera ~60 s entre ejecuciones.
BASE="${BASE_URL:-http://localhost}"
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
