#!/usr/bin/env bash
# Prepara la base de Render como db/init/01-init-databases.sh prepara la local: por cada microservicio un usuario y
# una base exclusiva (database-per-service, minimo privilegio), con pgcrypto y su esquema (db/init/schema/*.sql).
#
# Uso (desde tu PC, con Docker Desktop abierto y las variables de .env.render):
#   bash scripts/render-db-init.sh
#   SOLO_BASES=1 bash scripts/render-db-init.sh   # usuarios y bases vacias, sin esquema (lo usa render-db-restore.sh)
#
# En Render no hay superusuario: el administrador puede crear roles y bases, pero en PostgreSQL 16 solo puede crear
# una base "OWNER auth_user" si puede actuar como auth_user. Por eso, al crear cada usuario, el administrador se
# concede su rol (GRANT auth_user TO <admin> WITH INHERIT TRUE, SET TRUE): asi crea la base a su nombre, carga el
# esquema como ese usuario (las tablas quedan suyas, igual que en local) y luego puede respaldarla.
#
# Se puede repetir: lo que ya existe no se vuelve a crear (solo se actualiza la contrasena del usuario) y el esquema
# solo se carga en una base sin tablas.
source "$(dirname "$0")/render-db-common.sh"

require_admin_url
ADMIN_DB="$(admin_db)"
ADMIN_USER="$(admin_user)"
[ -n "$ADMIN_DB" ] || die "RENDER_ADMIN_URL no trae el nombre de la base (…/<base> al final)"

# Valor de una consulta de una sola celda en la base del administrador
query() {
  admin_psql "$ADMIN_DB" -At "$@"
}

init_service() {
  local svc="$1" pass user db
  pass="$(service_password "$svc")"
  user="${svc}_user"
  db="${svc}_db"

  echo "== ${svc}"
  if [ "$(query -c "SELECT count(*) FROM pg_roles WHERE rolname = '${user}'" </dev/null)" = 0 ]; then
    admin_psql "$ADMIN_DB" -v pass="$pass" <<SQL
CREATE ROLE ${user} LOGIN PASSWORD :'pass';
SQL
    echo "   usuario ${user} creado"
  else
    admin_psql "$ADMIN_DB" -v pass="$pass" <<SQL
ALTER ROLE ${user} PASSWORD :'pass';
SQL
    echo "   usuario ${user} ya existia (contrasena actualizada)"
  fi
  # El administrador puede actuar como el usuario del servicio (ver arriba)
  admin_psql "$ADMIN_DB" <<SQL
GRANT ${user} TO "${ADMIN_USER}" WITH INHERIT TRUE, SET TRUE;
SQL

  if [ "$(query -c "SELECT count(*) FROM pg_database WHERE datname = '${db}'" </dev/null)" = 0 ]; then
    # CREATE DATABASE no puede ir en una transaccion: cada sentencia por separado
    admin_psql "$ADMIN_DB" -c "CREATE DATABASE ${db} OWNER ${user}" -c "REVOKE ALL ON DATABASE ${db} FROM PUBLIC" </dev/null
    echo "   base ${db} creada"
  else
    echo "   base ${db} ya existia"
  fi

  if [ "${SOLO_BASES:-0}" = 1 ]; then
    return
  fi
  local tables
  tables="$(admin_psql "$db" -At -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" </dev/null)"
  if [ "$tables" != 0 ]; then
    echo "   ${db} ya tiene ${tables} tablas: no se carga el esquema"
    return
  fi
  # pgcrypto es una extension "confiable": la puede crear el dueno de la base, sin superusuario
  {
    echo "SET ROLE ${user};"
    echo "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
    cat "$ROOT/db/init/schema/${svc}.sql"
  } | admin_psql "$db"
  echo "   esquema cargado ($(admin_psql "$db" -At -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" </dev/null) tablas, duenas de ${user})"
}

for svc in "${SERVICES[@]}"; do
  init_service "$svc"
done

# Lo que va en DATABASE_URL de cada servicio en el panel de Render: la URL INTERNA (mismo host sin el dominio).
# Las contrasenas no se imprimen: se reemplaza el marcador por la de .env.render.
HOST="$(url_host "$RENDER_ADMIN_URL")"
INTERNAL_HOST="$HOST"
case "$HOST" in *.render.com) INTERNAL_HOST="${HOST%%.*}" ;; esac
echo
echo "Listo. DATABASE_URL de cada servicio en Render (cambia <...> por la contrasena de .env.render):"
for svc in "${SERVICES[@]}"; do
  upper="$(echo "$svc" | tr '[:lower:]' '[:upper:]')"
  echo "  gastrocore-${svc}: postgresql://${svc}_user:<${upper}_DB_PASSWORD>@${INTERNAL_HOST}:5432/${svc}_db"
done
