#!/usr/bin/env bash
# Datos de demostracion de La Pizzeta: usuarios (meseros y cocinero), empleados y turnos, catalogo (categorias y
# productos con foto de relleno), mesas, metodos de pago y ordenes (una semana de ventas, mas ordenes abiertas en
# cada estado, una solicitud QR y llamados pendientes).
#
# Uso (con el stack levantado y el primer admin creado):
#   bash scripts/seed-demo.sh
#
# Es IDEMPOTENTE: repetirlo no duplica nada y lo que ya existe (por ejemplo, mesas o productos creados a mano) no se
# toca. Cada dia nuevo agrega las ventas de los dias que falten. La contrasena de los usuarios de demostracion es
# DEMO_PASSWORD del .env (ver .env.example). NO se ejecuta con NODE_ENV=production salvo que se defina
# SEED_DEMO_FORCE=true: deja contrasenas conocidas y datos falsos.
set -euo pipefail
cd "$(dirname "$0")/.."

# Cada servicio lee DEMO_PASSWORD y NODE_ENV de su propio entorno (compose); aqui solo se ejecutan en orden.
# Las claves entre servicios son ids deterministas (seedUuid), asi que ningun seed depende de que otro haya corrido.
for service in auth staff catalog orders; do
  echo "== $service"
  docker compose exec -T "$service" npm run --silent seed:demo
done

echo
echo "Datos de demostracion listos."
echo "Usuarios: mesero1, mesero2, mesero3 y cocinero1 @lapizzeta.com (contrasena: DEMO_PASSWORD del .env)."
