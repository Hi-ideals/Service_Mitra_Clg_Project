-- Catalogue domain: what the platform sells and what it charges for it.
-- Owned by the Admin module; read by Discovery, Booking and Payments.

CREATE TABLE service_categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id         UUID REFERENCES service_categories(id) ON DELETE RESTRICT,
  name              TEXT        NOT NULL,
  slug              TEXT        NOT NULL UNIQUE,
  description       TEXT,
  icon              TEXT,
  image_url         TEXT,

  -- Pricing guidelines. Providers set their own price, but the admin defines
  -- the band it must fall inside. Stored in paise as integers, never floats.
  base_price_minor      BIGINT   NOT NULL DEFAULT 0 CHECK (base_price_minor >= 0),
  min_price_minor       BIGINT   NOT NULL DEFAULT 0 CHECK (min_price_minor >= 0),
  max_price_minor       BIGINT   CHECK (max_price_minor IS NULL OR max_price_minor >= 0),
  pricing_unit          TEXT     NOT NULL DEFAULT 'per_visit',
  estimated_minutes     INTEGER  NOT NULL DEFAULT 60 CHECK (estimated_minutes > 0),

  -- A category may override the platform commission rate.
  commission_percent    NUMERIC(5,2) CHECK (
    commission_percent IS NULL OR commission_percent BETWEEN 0 AND 100
  ),

  -- Categories that legally need a trade licence gate KYC harder.
  requires_certification BOOLEAN NOT NULL DEFAULT FALSE,

  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  display_order     INTEGER     NOT NULL DEFAULT 0,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT categories_price_band CHECK (
    max_price_minor IS NULL OR max_price_minor >= min_price_minor
  ),
  CONSTRAINT categories_not_own_parent CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT categories_pricing_unit CHECK (
    pricing_unit IN ('per_visit', 'per_hour', 'per_unit', 'quote_on_inspection')
  )
);

CREATE INDEX categories_parent_idx ON service_categories (parent_id) WHERE deleted_at IS NULL;
CREATE INDEX categories_active_idx ON service_categories (is_active, display_order)
  WHERE deleted_at IS NULL;
-- Trigram index behind keyword search across category names.
CREATE INDEX categories_name_trgm_idx ON service_categories USING GIN (name gin_trgm_ops);

SELECT attach_updated_at('service_categories');

-- Platform-wide configuration the admin controls at runtime: default
-- commission, payout schedule, cancellation policy, dispute window. Kept as
-- key/value so a new setting does not need a migration.
CREATE TABLE platform_settings (
  key           TEXT PRIMARY KEY,
  value         JSONB       NOT NULL,
  description   TEXT,
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- +down
DROP TABLE IF EXISTS platform_settings;
DROP TABLE IF EXISTS service_categories;
