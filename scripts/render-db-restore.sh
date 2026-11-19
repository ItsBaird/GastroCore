#!/usr/bin/env bash
# Restaura en una base NUEVA de Render un respaldo hecho con render-db-backup.sh.
#
# Uso (desde tu PC, con Docker Desktop abierto; RENDER_ADMIN_URL ahora es la URL externa de la base NUEVA):
#   bash scripts/render-db-restore.sh backups/render-AAAAMMDD-HHMM
#
# Pasos: crea los 4 usuarios y las 4 bases vacias (render-db-init.sh con SOLO_BASES=1) y restaura cada respaldo como
# el usuario de su servicio (--role), asi las tablas vuelven a ser suyas. Se niega a restaurar sobre una base que ya
# tenga tablas (para no mezclar datos). Al final muestra las filas de cada tabla y comprueba los duenos.
#
# Despues: en el panel de Render cambia DATABASE_URL de cada servicio por la de la base nueva (las imprime el init) y
# borra la base vieja. Los QR de las mesas no cambian (el qr_token viene en el respaldo).
source "$(dirname "$0")/render-db-common.sh"

require_admin_url
DIR="${1:-}"
[ -n "$DIR" ] && [ -d "$DIR" ] || die "Uso: bash scripts/render-db-restore.sh <carpeta del respaldo>"
for svc in "${SERVICES[@]}"; do
  [ -s "$DIR/${svc}_db.dump" ] || die "Falta $DIR/${svc}_db.dump"
done

SOLO_BASES=1 bash "$ROOT/scripts/render-db-init.sh" | sed '/^Listo\./,$d'

for svc in "${SERVICES[@]}"; do
  db="${svc}_db"
  tables="$(admin_psql "$db" -At -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" </dev/null)"
  [ "$tables" = 0 ] || die "${db} ya tiene ${tables} tablas: restaura solo sobre una base nueva"
done

for svc in "${SERVICES[@]}"; do
  db="${svc}_db"
  echo "== ${db}"
  pg_client "$(with_ssl "$(url_with_db "$RENDER_ADMIN_URL" "$db")")" pg_restore \
    --no-owner --no-privileges --role="${svc}_user" --exit-on-error --single-transaction <"$DIR/${db}.dump"

  # Filas por tabla de la base restaurada (para cotejar con la vieja si hace falta)
  restored="$(admin_psql "$db" -At -F ' ' -c "
    SELECT format('%s %s', t.tablename,
           (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t.tablename), false, true, '')))[1])
      FROM pg_tables t WHERE t.schemaname = 'public' ORDER BY 1" </dev/null)"
  owners="$(admin_psql "$db" -At -c "SELECT string_agg(DISTINCT tableowner, ',') FROM pg_tables WHERE schemaname = 'public'" </dev/null)"
  echo "$restored" | sed 's/^/   /'
  [ "$owners" = "${svc}_user" ] || die "Las tablas de ${db} quedaron de '${owners}' y no de ${svc}_user"
done

echo
echo "Restauracion completa. Ahora cambia DATABASE_URL en los 4 servicios de Render (host de la base nueva):"
HOST="$(url_host "$RENDER_ADMIN_URL")"
case "$HOST" in *.render.com) HOST="${HOST%%.*}" ;; esac
for svc in "${SERVICES[@]}"; do
  upper="$(echo "$svc" | tr '[:lower:]' '[:upper:]')"
  echo "  gastrocore-${svc}: postgresql://${svc}_user:<${upper}_DB_PASSWORD>@${HOST}:5432/${svc}_db"
done
