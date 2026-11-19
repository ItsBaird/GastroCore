#!/usr/bin/env bash
# Crea el primer administrador y, si se pide, los datos de demostracion en la base de Render, desde tu PC.
# Render gratis no tiene consola (shell) en los servicios: los seeds corren en local con la imagen de cada servicio
# (docker compose run, sin levantar el stack) y DATABASE_URL apuntando a la URL EXTERNA de la base de Render.
#
# Uso (Docker Desktop abierto, variables en .env.render, despues de render-db-init.sh):
#   bash scripts/render-seed.sh admin   # primer ADMIN con ADMIN_EMAIL y ADMIN_PASSWORD (min. 10 caracteres)
#   bash scripts/render-seed.sh demo    # OPCIONAL: meseros, cocinero, catalogo, mesas y una semana de ventas
#
# Ambos son idempotentes: repetirlos no duplica nada. El demo deja contrasenas conocidas (DEMO_PASSWORD) y datos
# falsos: solo para una demo publica; por eso se ejecuta con NODE_ENV=production y SEED_DEMO_FORCE=true a proposito.
source "$(dirname "$0")/render-db-common.sh"

require_admin_url
cd "$ROOT"

# La URL de la base de un servicio con su propio usuario (minimo privilegio, como el servicio en Render)
service_url() {
  with_ssl "$(url_with_user "$RENDER_ADMIN_URL" "${1}_user" "$(service_password "$1")" "${1}_db")"
}

# Corre un script npm en la imagen del servicio. -e VAR sin valor toma el de este proceso: la URL con la contrasena
# no aparece en la linea de comandos. --no-deps: no levanta postgres ni los demas servicios locales.
run_in_service() {
  local svc="$1" script="$2"
  DATABASE_URL="$(service_url "$svc")" docker compose run --rm --no-deps -T \
    -e DATABASE_URL -e NODE_ENV=production -e SEED_DEMO_FORCE=true \
    -e ADMIN_EMAIL -e ADMIN_PASSWORD -e DEMO_PASSWORD \
    "$svc" npm run --silent "$script"
}

case "${1:-}" in
  admin)
    [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ] || die "Faltan ADMIN_EMAIL y ADMIN_PASSWORD en .env.render"
    run_in_service auth seed:admin
    ;;
  demo)
    [ -n "${DEMO_PASSWORD:-}" ] || die "Falta DEMO_PASSWORD en .env.render (contrasena de los usuarios de demostracion)"
    for svc in "${SERVICES[@]}"; do
      echo "== $svc"
      run_in_service "$svc" seed:demo
    done
    echo
    echo "Datos de demostracion listos. Usuarios: mesero1, mesero2, mesero3 y cocinero1 @lapizzeta.com (DEMO_PASSWORD)."
    ;;
  *)
    die "Uso: bash scripts/render-seed.sh admin|demo"
    ;;
esac
