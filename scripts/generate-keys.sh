#!/usr/bin/env bash
# Genera el par de claves RSA para firmar (auth) y validar (todos los servicios) los JWT RS256.
# Las claves quedan en ./keys, fuera de git (RNF-03). Solo para desarrollo local:
# en produccion se generan en el servidor y viven en el volumen rsa_keys.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/keys"
mkdir -p "$DIR"

if [ -f "$DIR/jwt_private.pem" ]; then
  echo "Las claves ya existen en $DIR; no se sobrescriben."
  exit 0
fi

openssl genrsa -out "$DIR/jwt_private.pem" 2048 2>/dev/null
openssl rsa -in "$DIR/jwt_private.pem" -pubout -out "$DIR/jwt_public.pem" 2>/dev/null
# Legibles por el usuario 'node' del contenedor (uid distinto al del anfitrion)
chmod 644 "$DIR/jwt_private.pem" "$DIR/jwt_public.pem"
echo "Claves JWT generadas en $DIR"
