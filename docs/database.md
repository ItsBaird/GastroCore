# Base de datos

Una instancia de PostgreSQL 16 con **4 bases lógicas** (database-per-service, R2/R3). Cada servicio tiene su propio usuario con permisos solo sobre su base y no existen llaves foráneas entre bases: la relación se mantiene por UUID.

| Servicio | Base | Usuario | Tablas |
|---|---|---|---|
| auth | `auth_db` | `auth_user` | `users`, `permissions`, `user_permissions`, `refresh_tokens` |
| staff | `staff_db` | `staff_user` | `employees`, `shifts` |
| catalog | `catalog_db` | `catalog_user` | `categories`, `products` |
| orders | `orders_db` | `orders_user` | `dining_tables`, `orders`, `payment_methods`, `payments`, `qr_requests`, `qr_request_items`, `rounds`, `items`, `service_calls`, `cash_closures`, `cash_closure_payment_breakdown`, `cash_closure_top_products`, `cash_closure_waiter_breakdown`, `audit_log` |

Total: 22 tablas. Convenciones (R5/R6): UUID v4 (salvo `audit_log`, BIGSERIAL), `timestamptz` en UTC, snake_case en la base y camelCase en el JSON, dinero en pesos colombianos enteros.

## Cómo se crea

- `db/init/01-init-databases.sh` crea los roles y las bases con las contraseñas del `.env` y carga `db/init/schema/<servicio>.sql` como el usuario dueño de la base.
- Solo corre cuando el volumen `pgdata` está vacío (primer arranque). Para recrear todo en local: `docker compose down -v && docker compose up -d --build` (**borra los datos**).
- **El SQL es la fuente de verdad.** Los `CHECK`, los triggers `set_updated_at` y los índices únicos parciales (`uix_orders_one_open_per_table`, `uix_service_calls_one_pending`) viven en `db/init/schema/*.sql`; Prisma no los modela.

## Prisma

Cada servicio tiene `prisma/schema.prisma` (modelos en PascalCase con `@@map` a la tabla y `@map` a la columna). Se generó a mano a partir del SQL y se verificó con `prisma migrate diff` contra la base real. La tabla `items` se modela como `OrderItem`. El servicio lee `DATABASE_URL`, que `docker-compose.yml` arma con la contraseña de su usuario, y el cliente se genera en el `Dockerfile`.

Si cambias el SQL, actualiza el `schema.prisma` del servicio y verifica con:

```bash
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

(sin diferencias salvo los índices parciales y los triggers).

## pgAdmin

Corre en la red interna (puerto 5050) y no se publica. Para usarlo en local:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Queda en `http://127.0.0.1:5050` con el servidor `GastroCore` ya registrado (usuario `postgres`, contraseña de `POSTGRES_PASSWORD`).
