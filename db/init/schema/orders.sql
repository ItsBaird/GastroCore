-- GastroCore - esquema de orders_db (extraido de gastrocore schema.sql).
-- Lo ejecuta db/init/01-init-databases.sh como el usuario dueno de la base.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ──────────────── dining_tables ────────────────
-- Sin columna status: se deriva de orders (supuesto A4, justificación 3FN)
CREATE TABLE dining_tables (
  table_id      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number  INT           NOT NULL,
  qr_token      VARCHAR(255)  NOT NULL,          -- aleatorio ≥128 bits, no el table_id
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_tables_number UNIQUE (table_number),
  CONSTRAINT uq_tables_qr     UNIQUE (qr_token),
  CONSTRAINT chk_tables_number CHECK (table_number > 0)
);

CREATE TRIGGER trg_tables_updated_at
  BEFORE UPDATE ON dining_tables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ──────────────── orders ────────────────
CREATE TABLE orders (
  order_id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id             UUID          NOT NULL REFERENCES dining_tables(table_id) ON DELETE RESTRICT,
  opened_by            UUID          NOT NULL,    -- FK lógica → auth_db.users (atribución de ventas)
  waiter_id            UUID          NOT NULL,    -- FK lógica → auth_db.users (mesero asignado actual)
  status               VARCHAR(10)   NOT NULL DEFAULT 'ABIERTA',
  opened_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  closed_at            TIMESTAMPTZ,

  -- Descuento aplicado antes del pago (corrección del gap de persistencia)
  discount_amount      INT           NOT NULL DEFAULT 0,
  discount_applied_by  UUID,                      -- FK lógica → auth_db.users
  discount_applied_at  TIMESTAMPTZ,

  CONSTRAINT chk_orders_status CHECK (status IN ('ABIERTA', 'EN_COBRO', 'CERRADA')),

  -- CHECK #9: Descuento no negativo
  CONSTRAINT chk_orders_discount_amount CHECK (discount_amount >= 0),

  -- CHECK #10: Trío de descuento consistente
  CONSTRAINT chk_orders_discount_trio CHECK (
    (discount_amount = 0  AND discount_applied_by IS NULL AND discount_applied_at IS NULL)
    OR (discount_amount > 0 AND discount_applied_by IS NOT NULL AND discount_applied_at IS NOT NULL)
  )
);

-- Índice único parcial: como máximo una orden no cerrada por mesa
CREATE UNIQUE INDEX uix_orders_one_open_per_table
  ON orders (table_id)
  WHERE status <> 'CERRADA';


-- ──────────────── payment_methods ────────────────
CREATE TABLE payment_methods (
  payment_method_id  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name               VARCHAR(50)   NOT NULL,
  is_cash            BOOLEAN       NOT NULL DEFAULT false,
  is_active          BOOLEAN       NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_payment_methods_name UNIQUE (name)
);


-- ──────────────── payments ────────────────
CREATE TABLE payments (
  payment_id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID          NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
  payment_method_id   UUID          NOT NULL REFERENCES payment_methods(payment_method_id) ON DELETE RESTRICT,
  subtotal            INT           NOT NULL,
  discount_amount     INT           NOT NULL DEFAULT 0,   -- Snapshot desde orders (R3)
  total               INT           NOT NULL,
  amount_received     INT,                                -- Solo si es efectivo
  change_given        INT,                                -- Solo si es efectivo
  discount_applied_by UUID,                               -- Snapshot desde orders
  registered_by       UUID          NOT NULL,             -- FK lógica → auth_db.users
  paid_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- 1:1 con orders
  CONSTRAINT uq_payments_order UNIQUE (order_id),

  -- Montos positivos
  CONSTRAINT chk_payments_subtotal  CHECK (subtotal >= 0),
  CONSTRAINT chk_payments_discount  CHECK (discount_amount >= 0),
  CONSTRAINT chk_payments_total     CHECK (total >= 0),

  -- Total = subtotal - descuento
  CONSTRAINT chk_payments_total_calc CHECK (total = subtotal - discount_amount),

  -- CHECK #4: discount_applied_by ↔ discount_amount consistentes
  CONSTRAINT chk_payments_discount_by CHECK (
    (discount_amount > 0  AND discount_applied_by IS NOT NULL)
    OR (discount_amount = 0 AND discount_applied_by IS NULL)
  ),

  -- CHECK #5: change_given = amount_received - total (R4: backend calcula)
  CONSTRAINT chk_payments_change CHECK (
    change_given IS NULL OR change_given = amount_received - total
  ),

  -- CHECK #6: amount_received y change_given van juntos (atómicos)
  CONSTRAINT chk_payments_cash_pair CHECK (
    (amount_received IS NULL AND change_given IS NULL)
    OR (amount_received IS NOT NULL AND change_given IS NOT NULL)
  ),

  -- amount_received >= total cuando aplica
  CONSTRAINT chk_payments_received CHECK (
    amount_received IS NULL OR amount_received >= total
  )
);


-- ──────────────── qr_requests ────────────────
CREATE TABLE qr_requests (
  qr_request_id  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID          NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
  status          VARCHAR(10)   NOT NULL DEFAULT 'pendiente',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID,                           -- FK lógica → auth_db.users

  CONSTRAINT chk_qr_requests_status CHECK (status IN ('pendiente', 'confirmada', 'rechazada')),

  -- CHECK #7: Consistencia resolved_by/resolved_at ↔ estado
  CONSTRAINT chk_qr_requests_resolution CHECK (
    (status = 'pendiente'   AND resolved_by IS NULL AND resolved_at IS NULL)
    OR (status IN ('confirmada', 'rechazada') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
  )
);


-- ──────────────── qr_request_items ────────────────
CREATE TABLE qr_request_items (
  qr_request_item_id  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_request_id       UUID          NOT NULL REFERENCES qr_requests(qr_request_id) ON DELETE CASCADE,
  product_id           UUID          NOT NULL,    -- FK lógica → catalog_db.products
  quantity             INT           NOT NULL,
  note                 VARCHAR(255),

  CONSTRAINT chk_qr_items_quantity CHECK (quantity > 0)
);


-- ──────────────── rounds ────────────────
CREATE TABLE rounds (
  round_id        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID          NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
  source          VARCHAR(6)    NOT NULL,
  created_by      UUID          NOT NULL,         -- FK lógica → auth_db.users
  qr_request_id   UUID          REFERENCES qr_requests(qr_request_id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_rounds_source CHECK (source IN ('WAITER', 'QR')),

  -- 1:1 entre solicitud QR y ronda
  CONSTRAINT uq_rounds_qr_request UNIQUE (qr_request_id),

  -- Si source = 'QR', qr_request_id es obligatorio; si 'WAITER', debe ser NULL
  CONSTRAINT chk_rounds_source_qr CHECK (
    (source = 'QR'     AND qr_request_id IS NOT NULL)
    OR (source = 'WAITER' AND qr_request_id IS NULL)
  )
);


-- ──────────────── items ────────────────
CREATE TABLE items (
  item_id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id                UUID          NOT NULL REFERENCES rounds(round_id) ON DELETE RESTRICT,
  product_id              UUID          NOT NULL,    -- FK lógica → catalog_db.products
  product_name_snapshot   VARCHAR(120)  NOT NULL,    -- R3: snapshot al crear
  unit_price_snapshot     INT           NOT NULL,    -- R3: snapshot al crear (COP entero, R5)
  quantity                INT           NOT NULL,
  note                    VARCHAR(255),
  status                  VARCHAR(15)   NOT NULL DEFAULT 'pendiente',
  preparation_started_at  TIMESTAMPTZ,               -- pendiente → en_preparacion
  ready_at                TIMESTAMPTZ,               -- en_preparacion → listo
  delivered_at            TIMESTAMPTZ,               -- listo → entregado
  cancelled_reason        VARCHAR(255),
  cancelled_by            UUID,                      -- FK lógica → auth_db.users
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Valores válidos de la máquina de estados
  CONSTRAINT chk_items_status CHECK (
    status IN ('pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado')
  ),

  CONSTRAINT chk_items_quantity CHECK (quantity > 0),
  CONSTRAINT chk_items_price    CHECK (unit_price_snapshot >= 0),

  -- CHECK #3: Timestamps de ciclo de vida ↔ estado
  CONSTRAINT chk_items_lifecycle CHECK (
    (status = 'pendiente'       AND preparation_started_at IS NULL     AND ready_at IS NULL AND delivered_at IS NULL)
    OR (status = 'en_preparacion' AND preparation_started_at IS NOT NULL AND ready_at IS NULL AND delivered_at IS NULL)
    OR (status = 'listo'          AND preparation_started_at IS NOT NULL AND ready_at IS NOT NULL AND delivered_at IS NULL)
    OR (status = 'entregado'      AND preparation_started_at IS NOT NULL AND ready_at IS NOT NULL AND delivered_at IS NOT NULL)
    OR (status = 'cancelado')
  ),

  -- Cancelación coherente
  CONSTRAINT chk_items_cancel CHECK (
    (status = 'cancelado' AND cancelled_by IS NOT NULL)
    OR (status <> 'cancelado' AND cancelled_by IS NULL AND cancelled_reason IS NULL)
  )
);

CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ──────────────── service_calls ────────────────
CREATE TABLE service_calls (
  service_call_id  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id         UUID          NOT NULL REFERENCES dining_tables(table_id) ON DELETE RESTRICT,
  type             VARCHAR(15)   NOT NULL,
  status           VARCHAR(10)   NOT NULL DEFAULT 'pendiente',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  attended_at      TIMESTAMPTZ,
  attended_by      UUID,                          -- FK lógica → auth_db.users

  CONSTRAINT chk_service_calls_type   CHECK (type IN ('call_waiter', 'request_bill')),
  CONSTRAINT chk_service_calls_status CHECK (status IN ('pendiente', 'atendido')),

  -- CHECK #8: Consistencia attended_by/attended_at ↔ estado
  CONSTRAINT chk_service_calls_resolution CHECK (
    (status = 'pendiente' AND attended_by IS NULL AND attended_at IS NULL)
    OR (status = 'atendido' AND attended_by IS NOT NULL AND attended_at IS NOT NULL)
  )
);

-- Índice único parcial: máximo un llamado pendiente por tipo por mesa
CREATE UNIQUE INDEX uix_service_calls_one_pending
  ON service_calls (table_id, type)
  WHERE status = 'pendiente';


-- ──────────────── cash_closures ────────────────
-- Denormalización deliberada (supuesto A5): snapshot inmutable del cierre diario
CREATE TABLE cash_closures (
  closure_id      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_date    DATE          NOT NULL,
  total_sales     INT           NOT NULL,        -- COP entero (R5)
  tables_served   INT           NOT NULL,
  average_ticket  INT           NOT NULL,        -- COP entero (R5)
  confirmed_by    UUID          NOT NULL,        -- FK lógica → auth_db.users (ADMIN)
  confirmed_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_closures_date       UNIQUE (closure_date),
  CONSTRAINT chk_closures_sales     CHECK (total_sales >= 0),
  CONSTRAINT chk_closures_tables    CHECK (tables_served >= 0),
  CONSTRAINT chk_closures_ticket    CHECK (average_ticket >= 0)
);


-- ──────────────── cash_closure_payment_breakdown ────────────────
CREATE TABLE cash_closure_payment_breakdown (
  closure_id         UUID  NOT NULL REFERENCES cash_closures(closure_id) ON DELETE CASCADE,
  payment_method_id  UUID  NOT NULL REFERENCES payment_methods(payment_method_id) ON DELETE RESTRICT,
  total_amount       INT   NOT NULL,
  payment_count      INT   NOT NULL,

  PRIMARY KEY (closure_id, payment_method_id),

  CONSTRAINT chk_ccpb_amount CHECK (total_amount >= 0),
  CONSTRAINT chk_ccpb_count  CHECK (payment_count >= 0)
);


-- ──────────────── cash_closure_top_products ────────────────
CREATE TABLE cash_closure_top_products (
  closure_id              UUID          NOT NULL REFERENCES cash_closures(closure_id) ON DELETE CASCADE,
  rank                    SMALLINT      NOT NULL,
  product_id              UUID          NOT NULL,    -- FK lógica → catalog_db.products
  product_name_snapshot   VARCHAR(120)  NOT NULL,    -- R3: nombre al momento del cierre
  quantity_sold           INT           NOT NULL,

  PRIMARY KEY (closure_id, rank),

  CONSTRAINT chk_cctp_rank     CHECK (rank BETWEEN 1 AND 5),
  CONSTRAINT chk_cctp_quantity CHECK (quantity_sold > 0)
);


-- ──────────────── cash_closure_waiter_breakdown ────────────────
CREATE TABLE cash_closure_waiter_breakdown (
  closure_id    UUID  NOT NULL REFERENCES cash_closures(closure_id) ON DELETE CASCADE,
  waiter_id     UUID  NOT NULL,                  -- FK lógica → auth_db.users
  total_amount  INT   NOT NULL,

  PRIMARY KEY (closure_id, waiter_id),

  CONSTRAINT chk_ccwb_amount CHECK (total_amount >= 0)
);


-- ──────────────── audit_log ────────────────
-- BIGSERIAL: log de alto volumen, append-only, nunca expuesto como ID de negocio (supuesto A6)
CREATE TABLE audit_log (
  audit_id      BIGSERIAL     PRIMARY KEY,
  action_type   VARCHAR(40)   NOT NULL,          -- ej. DISCOUNT_APPLIED, ITEM_CANCELLED, PAYMENT_REGISTERED
  entity_type   VARCHAR(30)   NOT NULL,          -- ej. order, item, payment, cash_closure
  entity_id     UUID          NOT NULL,          -- ID de la entidad afectada
  performed_by  UUID          NOT NULL,          -- FK lógica → auth_db.users
  performed_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  details       JSONB,                           -- "cuánto": monto, motivo, valores anteriores/nuevos

  CONSTRAINT chk_audit_action CHECK (action_type <> ''),
  CONSTRAINT chk_audit_entity CHECK (entity_type <> '')
);

-- Índice para consultas por entidad (ej. "historial de auditoría de la orden X")
CREATE INDEX idx_audit_entity
  ON audit_log (entity_type, entity_id);

-- Índice para consultas por fecha
CREATE INDEX idx_audit_performed_at
  ON audit_log (performed_at);
