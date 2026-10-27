-- GastroCore - esquema de staff_db (extraido de gastrocore schema.sql).
-- Lo ejecuta db/init/01-init-databases.sh como el usuario dueno de la base.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ──────────────── employees ────────────────
CREATE TABLE employees (
  user_id          UUID          PRIMARY KEY,   -- FK lógica → auth_db.users.user_id (R2)
  full_name        VARCHAR(150)  NOT NULL,
  phone            VARCHAR(30),
  document_number  VARCHAR(30)   NOT NULL,
  position         VARCHAR(50)   NOT NULL,
  hire_date        DATE          NOT NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_employees_document UNIQUE (document_number)
);

CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ──────────────── shifts ────────────────
CREATE TABLE shifts (
  shift_id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID          NOT NULL REFERENCES employees(user_id) ON DELETE RESTRICT,
  scheduled_start  TIMESTAMPTZ   NOT NULL,
  scheduled_end    TIMESTAMPTZ   NOT NULL,
  actual_start     TIMESTAMPTZ,
  actual_end       TIMESTAMPTZ,
  status           VARCHAR(12)   NOT NULL DEFAULT 'programado',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Rango horario válido
  CONSTRAINT chk_shifts_scheduled_range CHECK (scheduled_end > scheduled_start),

  -- Máquina de estados: solo valores permitidos
  CONSTRAINT chk_shifts_status CHECK (status IN ('programado', 'activo', 'finalizado')),

  -- CHECK #1: Consistencia timestamps ↔ estado
  CONSTRAINT chk_shifts_status_timestamps CHECK (
    (status = 'programado'  AND actual_start IS NULL AND actual_end IS NULL)
    OR (status = 'activo'   AND actual_start IS NOT NULL AND actual_end IS NULL)
    OR (status = 'finalizado' AND actual_start IS NOT NULL AND actual_end IS NOT NULL)
  ),

  -- CHECK #2: El fin real debe ser posterior al inicio real
  CONSTRAINT chk_shifts_actual_range CHECK (
    actual_end IS NULL OR actual_end > actual_start
  )
);

CREATE TRIGGER trg_shifts_updated_at
  BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
