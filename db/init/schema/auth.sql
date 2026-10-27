-- GastroCore - esquema de auth_db (extraido de gastrocore schema.sql).
-- Lo ejecuta db/init/01-init-databases.sh como el usuario dueno de la base.
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- Trigger reutilizable para updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ──────────────── users ────────────────
CREATE TABLE users (
  user_id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 VARCHAR(255)  NOT NULL,
  password_hash         VARCHAR(255)  NOT NULL,
  role                  VARCHAR(10)   NOT NULL,
  is_active             BOOLEAN       NOT NULL DEFAULT true,
  failed_login_attempts INT           NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_users_email            UNIQUE (email),
  CONSTRAINT chk_users_role            CHECK (role IN ('ADMIN', 'WAITER', 'COOK')),
  CONSTRAINT chk_users_failed_attempts CHECK (failed_login_attempts >= 0)
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ──────────────── permissions ────────────────
CREATE TABLE permissions (
  permission_id  UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(50)  NOT NULL,
  description    TEXT,

  CONSTRAINT uq_permissions_code UNIQUE (code)
);


-- ──────────────── user_permissions (N:M) ────────────────
CREATE TABLE user_permissions (
  user_id        UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  permission_id  UUID         NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  granted_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, permission_id)
);


-- ──────────────── refresh_tokens ────────────────
CREATE TABLE refresh_tokens (
  refresh_token_id  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash        VARCHAR(255)  NOT NULL,
  issued_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ   NOT NULL,
  revoked_at        TIMESTAMPTZ,
  replaced_by       UUID          REFERENCES refresh_tokens(refresh_token_id),

  CONSTRAINT uq_refresh_tokens_hash        UNIQUE (token_hash),
  CONSTRAINT uq_refresh_tokens_replaced_by UNIQUE (replaced_by),  -- 1:1 cadena de rotación
  CONSTRAINT chk_refresh_tokens_expires     CHECK (expires_at > issued_at)
);
