#!/bin/sh
# Crea, por cada microservicio, un usuario PostgreSQL y una base exclusiva
# (database-per-service, minimo privilegio) y carga su esquema desde schema/<servicio>.sql.
# Solo corre en el primer arranque, cuando el volumen pgdata esta vacio.
set -e

SCHEMA_DIR="$(dirname "$0")/schema"

init_service() {
  svc="$1"; pass="$2"
  db="${svc}_db"; user="${svc}_user"
  if [ -z "$pass" ]; then
    echo "Falta la contrasena de ${user} (variable $(echo "$svc" | tr 'a-z' 'A-Z')_DB_PASSWORD)" >&2
    exit 1
  fi

  psql -v ON_ERROR_STOP=1 -v pass="$pass" --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE ${user} LOGIN PASSWORD :'pass';
CREATE DATABASE ${db} OWNER ${user};
REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
SQL

  # La extension se crea como superusuario; el esquema, como dueno de la base
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" \
    -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" \
    -c "SET ROLE ${user}" \
    -f "${SCHEMA_DIR}/${svc}.sql"

  echo "Base ${db} lista (usuario ${user})"
}

init_service auth    "$AUTH_DB_PASSWORD"
init_service staff   "$STAFF_DB_PASSWORD"
init_service catalog "$CATALOG_DB_PASSWORD"
init_service orders  "$ORDERS_DB_PASSWORD"
