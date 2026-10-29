-- Foundation: shared extensions, enums, helper functions and triggers.
-- Every later migration builds on the vocabulary defined here, which mirrors
-- src/config/constants.js exactly.

-- citext  : case-insensitive email comparison without LOWER() on every query
-- pg_trgm : trigram indexes behind provider and category keyword search
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_role AS ENUM ('customer', 'provider', 'admin');

CREATE TYPE account_status AS ENUM ('active', 'suspended', 'deactivated');

CREATE TYPE verification_status AS ENUM (
  'unsubmitted', 'pending', 'info_requested', 'approved', 'rejected', 'suspended'
);

-- The booking lifecycle spine. requested -> accepted -> in_progress -> completed,
-- with rejected / cancelled / disputed / refunded branching off it.
CREATE TYPE booking_status AS ENUM (
  'requested', 'accepted', 'in_progress', 'completed',
  'rejected', 'cancelled', 'disputed', 'refunded'
);

CREATE TYPE payment_status AS ENUM (
  'pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded'
);

CREATE TYPE payout_status AS ENUM ('pending', 'processing', 'paid', 'failed', 'on_hold');

CREATE TYPE actor_type AS ENUM ('customer', 'provider', 'admin', 'system');

-- Keeps updated_at honest without the application having to remember.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Applies the updated_at trigger to a table in one line.
CREATE OR REPLACE FUNCTION attach_updated_at(target regclass)
RETURNS void AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s
     FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
    replace(target::text, '.', '_'), target
  );
END;
$$ LANGUAGE plpgsql;

-- +down
DROP FUNCTION IF EXISTS attach_updated_at(regclass);
DROP FUNCTION IF EXISTS set_updated_at();
DROP TYPE IF EXISTS actor_type;
DROP TYPE IF EXISTS payout_status;
DROP TYPE IF EXISTS payment_status;
DROP TYPE IF EXISTS booking_status;
DROP TYPE IF EXISTS verification_status;
DROP TYPE IF EXISTS account_status;
DROP TYPE IF EXISTS user_role;
