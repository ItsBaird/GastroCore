-- GastroCore - esquema de catalog_db (extraido de gastrocore schema.sql).
-- Lo ejecuta db/init/01-init-databases.sh como el usuario dueno de la base.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ──────────────── categories ────────────────
CREATE TABLE categories (
  category_id    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(80)   NOT NULL,
  display_order  INT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_categories_name UNIQUE (name)
);


-- ──────────────── products ────────────────
CREATE TABLE products (
  product_id    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID          NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
  name          VARCHAR(120)  NOT NULL,
  description   TEXT,
  price         INT           NOT NULL,          -- COP entero (R5), impuestos incluidos
  photo_url     VARCHAR(255)  NOT NULL,          -- Se sube con el producto (multipart)
  is_available  BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_products_price CHECK (price >= 0),
  CONSTRAINT uq_products_category_name UNIQUE (category_id, name)
);

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
