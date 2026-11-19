#!/usr/bin/env bash
# Genera el par de claves RSA para firmar (auth) y validar (todos los servicios) los JWT RS256.
# Quedan fuera de git (RNF-03), separadas en dos carpetas para montar cada una donde corresponde:
#   keys/private/jwt_private.pem -> solo el servicio auth
#   keys/public/jwt_public.pem   -> todos los servicios (solo lectura)
# Solo para desarrollo local: en produccion se generan en el servidor (volumen rsa_keys).
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/keys"
PRIVATE="$DIR/private/jwt_private.pem"
PUBLIC="$DIR/public/jwt_public.pem"
mkdir -p "$DIR/private" "$DIR/public"

# Migra la disposicion anterior (keys/jwt_*.pem) sin regenerar las claves
if [ -f "$DIR/jwt_private.pem" ] && [ ! -f "$PRIVATE" ]; then
  mv "$DIR/jwt_private.pem" "$PRIVATE"
  mv "$DIR/jwt_public.pem" "$PUBLIC"
  echo "Claves existentes movidas a keys/private y keys/public."
fi

if [ -f "$PRIVATE" ] && [ -f "$PUBLIC" ]; then
  echo "Las claves ya existen en $DIR; no se sobrescriben."
  exit 0
fi

openssl genrsa -out "$PRIVATE" 2048 2>/dev/null
openssl rsa -in "$PRIVATE" -pubout -out "$PUBLIC" 2>/dev/null
# Legibles por el usuario 'node' del contenedor (uid distinto al del anfitrion)
chmod 644 "$PRIVATE" "$PUBLIC"
echo "Claves JWT generadas en $DIR"
