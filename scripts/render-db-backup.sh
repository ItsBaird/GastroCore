#!/usr/bin/env bash
# Respalda las 4 bases de la instancia de Render en tu PC (formato custom de pg_dump, uno por base).
#
# Uso (desde tu PC, con Docker Desktop abierto y las variables de .env.render):
#   bash scripts/render-db-backup.sh            # -> backups/render-AAAAMMDD-HHMM/<base>.dump
#   bash scripts/render-db-backup.sh <carpeta>
#
# Para que sirve: la base gratuita de Render vence a los 30 dias. Antes de eso: respaldo -> crear una base nueva en
# Render -> render-db-restore.sh (ver docs/despliegue.md). Se guardan TODOS los datos, incluidos los qr_token de las
# mesas: los QR impresos siguen funcionando con la base nueva.
#
# Lo hace el administrador de Render, que puede leer las bases porque render-db-init.sh le concedio el rol de cada
# usuario. Sin duenos ni permisos en el respaldo (--no-owner --no-privileges): la base nueva tendra otro
# administrador y al restaurar todo queda otra vez a nombre del usuario de cada servicio.
# Los respaldos tienen datos reales (usuarios, ventas): backups/ esta fuera de git. No los compartas.
source "$(dirname "$0")/render-db-common.sh"

require_admin_url
OUT="${1:-$ROOT/backups/render-$(date +%Y%m%d-%H%M)}"
mkdir -p "$OUT"

for svc in "${SERVICES[@]}"; do
  db="${svc}_db"
  echo "== ${db}"
  pg_client "$(with_ssl "$(url_with_db "$RENDER_ADMIN_URL" "$db")")" pg_dump \
    --format=custom --no-owner --no-privileges </dev/null >"$OUT/${db}.dump"
  [ -s "$OUT/${db}.dump" ] || die "El respaldo de ${db} quedo vacio"
  # Lista de lo que contiene (sirve para comprobar el archivo sin restaurarlo)
  docker run --rm -i "$PG_IMAGE" pg_restore --list <"$OUT/${db}.dump" | grep -c "TABLE DATA" |
    xargs -I{} echo "   $(wc -c <"$OUT/${db}.dump" | tr -d ' ') bytes, {} tablas con datos"
done

echo
echo "Respaldo completo en: $OUT"
