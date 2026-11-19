-- GastroCore - catalog_db: tabla product_photos en una base que YA existe (local o de un companero).
-- Las bases nuevas no lo necesitan: db/init/schema/catalog.sql ya crea la tabla.
-- Es idempotente: se puede ejecutar mas de una vez.
--
-- Uso, con el stack levantado (como catalog_user, el dueno de la base):
--   docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d catalog_db -c "SET ROLE catalog_user" -f -' < db/migrations/2026-11-19_catalog_product_photos.sql
-- Despues, para pasar a la tabla las fotos que ya estaban en el volumen de Docker:
--   docker compose up -d --build catalog
--   docker compose exec -T catalog npm run --silent photos:import

CREATE TABLE IF NOT EXISTS product_photos (
  filename    VARCHAR(80)   PRIMARY KEY,
  mime_type   VARCHAR(30)   NOT NULL,
  content     BYTEA         NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_product_photos_mime CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/svg+xml')),
  CONSTRAINT chk_product_photos_size CHECK (octet_length(content) BETWEEN 1 AND 2097152)
);
