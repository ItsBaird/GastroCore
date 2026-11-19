#!/usr/bin/env bash
# Funciones comunes de los scripts render-db-*.sh y render-seed.sh (se cargan con "source"; no se ejecuta solo).
#
# Se corren desde tu PC (Git Bash en Windows) contra la base de Render por su URL EXTERNA. psql, pg_dump y
# pg_restore se ejecutan dentro de la imagen postgres:16-alpine (no hace falta instalarlos) y las URL con
# contrasena se le pasan al contenedor por variable de entorno, nunca como argumento visible.
#
# Variables (en .env.render, ver .env.render.example, o exportadas en la terminal):
#   RENDER_ADMIN_URL   URL externa de la base de Render (panel > la base > Connect > External Database URL).
#                      Es el usuario administrador que Render crea: puede crear roles y bases, pero NO es superusuario.
#   AUTH_DB_PASSWORD, STAFF_DB_PASSWORD, CATALOG_DB_PASSWORD, ORDERS_DB_PASSWORD
#                      Contrasena del usuario de cada servicio (solo letras y numeros: va dentro de DATABASE_URL).
set -euo pipefail

# Git Bash convierte los argumentos que empiezan por / en rutas de Windows; aqui no debe tocar nada
export MSYS_NO_PATHCONV=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICES=(auth staff catalog orders)
PG_IMAGE="postgres:16-alpine"

if [ -f "$ROOT/.env.render" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env.render"
  set +a
fi

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_admin_url() {
  [ -n "${RENDER_ADMIN_URL:-}" ] || die "Falta RENDER_ADMIN_URL (URL externa de la base de Render). Ver .env.render.example"
  case "$RENDER_ADMIN_URL" in
    postgres://* | postgresql://*) ;;
    *) die "RENDER_ADMIN_URL debe empezar por postgresql://" ;;
  esac
}

# Contrasena del usuario de un servicio: auth -> AUTH_DB_PASSWORD
service_password() {
  local var
  var="$(echo "$1" | tr '[:lower:]' '[:upper:]')_DB_PASSWORD"
  local pass="${!var:-}"
  [ -n "$pass" ] || die "Falta $var (contrasena de ${1}_user)"
  [[ "$pass" =~ ^[A-Za-z0-9]+$ ]] || die "$var debe tener solo letras y numeros (va dentro de DATABASE_URL)"
  echo "$pass"
}

# La misma URL con otra base: postgresql://u:p@host:5432/x?sslmode=require -> .../<db>?sslmode=require
url_with_db() {
  echo "$1" | sed -E "s#^(postgres(ql)?://[^/]+)(/[^?]*)?#\1/$2#"
}

# La misma URL con otro usuario y contrasena (y otra base)
url_with_user() {
  local url="$1" user="$2" pass="$3" db="$4"
  url="$(echo "$url" | sed -E "s#^(postgres(ql)?://)[^@]*@#\1${user}:${pass}@#")"
  url_with_db "$url" "$db"
}

# Host de la URL (sin usuario, puerto ni base)
url_host() {
  echo "$1" | sed -E 's#^postgres(ql)?://[^@]*@([^:/?]+).*#\2#'
}

# Las URL externas de Render exigen TLS; a las locales de prueba no se les agrega
with_ssl() {
  local url="$1"
  case "$(url_host "$url")" in
    *.render.com)
      case "$url" in
        *sslmode=*) echo "$url" ;;
        *\?*) echo "${url}&sslmode=require" ;;
        *) echo "${url}?sslmode=require" ;;
      esac
      ;;
    *) echo "$url" ;;
  esac
}

# Ejecuta un cliente de PostgreSQL (psql, pg_dump, pg_restore) contra DBURL. El resto de argumentos van al cliente;
# la entrada estandar pasa al contenedor (para enviar SQL o un respaldo).
#   pg_client <url> psql -v ON_ERROR_STOP=1 -c "select 1"
pg_client() {
  local url="$1"
  shift
  # Sin avisos (NOTICE) de "ya existe": solo advertencias y errores
  DBURL="$url" docker run --rm -i -e DBURL -e "PGOPTIONS=-c client_min_messages=warning" "$PG_IMAGE" \
    sh -c 'tool="$1"; shift; exec "$tool" --dbname "$DBURL" "$@"' sh "$@"
}

admin_psql() {
  pg_client "$(with_ssl "$(url_with_db "$RENDER_ADMIN_URL" "${1}")")" psql -v ON_ERROR_STOP=1 -X -q "${@:2}"
}

# Nombre del administrador de Render (el usuario de RENDER_ADMIN_URL)
admin_user() {
  echo "$RENDER_ADMIN_URL" | sed -E 's#^postgres(ql)?://([^:@]+).*#\2#'
}

# Base por defecto del administrador (la que crea Render, la de RENDER_ADMIN_URL)
admin_db() {
  echo "$RENDER_ADMIN_URL" | sed -E 's#^postgres(ql)?://[^/]+/([^?]*).*#\2#'
}
