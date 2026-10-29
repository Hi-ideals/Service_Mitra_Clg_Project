-- Identity domain: accounts, sessions, one-time passwords and addresses.
-- Owned by the Auth module.

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role                user_role      NOT NULL,
  full_name           TEXT           NOT NULL,
  email               CITEXT,
  phone               TEXT,
  password_hash       TEXT           NOT NULL,
  avatar_url          TEXT,
  status              account_status NOT NULL DEFAULT 'active',
  email_verified_at   TIMESTAMPTZ,
  phone_verified_at   TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  -- Soft delete: dispute resolution and accounting need the history to survive.
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- An account must be reachable by at least one channel.
  CONSTRAINT users_contact_present CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT users_phone_format CHECK (phone IS NULL OR phone ~ '^[0-9]{10,15}$')
);

-- Uniqueness ignores soft-deleted rows, so a released email can be reused.
CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE UNIQUE INDEX users_phone_unique ON users (phone) WHERE deleted_at IS NULL AND phone IS NOT NULL;
CREATE INDEX users_role_status_idx ON users (role, status) WHERE deleted_at IS NULL;

SELECT attach_updated_at('users');

-- Refresh tokens are stored hashed and revocable, which is what makes logout,
-- password change and admin suspension take effect immediately.
CREATE TABLE refresh_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL UNIQUE,
  user_agent    TEXT,
  ip_address    INET,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  revoked_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;

-- One-time passwords for registration confirmation, password reset and job
-- completion. Stored hashed; attempt counter blocks brute force.
CREATE TABLE otp_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES users(id) ON DELETE CASCADE,
  destination   TEXT        NOT NULL,
  purpose       TEXT        NOT NULL,
  code_hash     TEXT        NOT NULL,
  attempts      SMALLINT    NOT NULL DEFAULT 0,
  max_attempts  SMALLINT    NOT NULL DEFAULT 5,
  consumed_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX otp_codes_lookup_idx ON otp_codes (destination, purpose, consumed_at);
CREATE INDEX otp_codes_expiry_idx ON otp_codes (expires_at);

-- Service addresses. A customer books at one of these; a provider's own
-- coverage is modelled separately in provider_service_areas.
CREATE TABLE addresses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT        NOT NULL DEFAULT 'Home',
  line1         TEXT        NOT NULL,
  line2         TEXT,
  landmark      TEXT,
  city          TEXT        NOT NULL,
  state         TEXT        NOT NULL,
  pincode       TEXT        NOT NULL,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  is_default    BOOLEAN     NOT NULL DEFAULT FALSE,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT addresses_pincode_format CHECK (pincode ~ '^[0-9]{6}$'),
  CONSTRAINT addresses_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT addresses_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE INDEX addresses_user_idx ON addresses (user_id) WHERE deleted_at IS NULL;
CREATE INDEX addresses_geo_idx ON addresses (latitude, longitude) WHERE deleted_at IS NULL;
-- Exactly one default address per user.
CREATE UNIQUE INDEX addresses_one_default ON addresses (user_id)
  WHERE is_default AND deleted_at IS NULL;

SELECT attach_updated_at('addresses');

-- +down
DROP TABLE IF EXISTS addresses;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
