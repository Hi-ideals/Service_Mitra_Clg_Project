-- Two-factor authentication.
--
-- Kept in tables of their own rather than as columns on `users`, for two
-- reasons. The secret is a different kind of thing from a profile field - it
-- is a credential, and it belongs with the other credentials, not beside the
-- display name. And a row that exists only for the few accounts that use 2FA
-- is cheaper than two columns that are NULL for every customer on the
-- platform.

CREATE TABLE user_totp (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Encrypted, not plain.
  --
  -- A TOTP secret is a shared secret: whoever holds it can generate valid
  -- codes forever. Stored in plain text it would travel in every database
  -- backup, so one stolen dump would defeat the second factor it exists to
  -- provide. Encrypted with a key that lives in the environment and not in
  -- the database, a dump alone is not enough.
  secret_encrypted TEXT        NOT NULL,

  -- NULL while setup is half-done: a secret is written when the QR code is
  -- shown, and only confirming a code from the app turns 2FA on. Without this
  -- split, scanning the QR and then closing the page would lock the account
  -- behind an authenticator nobody finished configuring.
  confirmed_at     TIMESTAMPTZ,

  -- The last time-step that was accepted, so a code cannot be replayed inside
  -- the thirty seconds it stays valid. Someone who reads a code over your
  -- shoulder, or out of a proxy log, gets one use of it at most - and only if
  -- they beat you to it.
  last_step        BIGINT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT attach_updated_at('user_totp');

-- The way back in when the phone is lost.
--
-- Without these, an admin who drops their phone in a river is locked out of
-- the console that unlocks accounts, and the only remedy is someone with SQL
-- access to production at an awkward moment. Hashed like refresh tokens:
-- these are high-entropy random strings, so a single SHA-256 is enough, and
-- what is stored cannot be read back out and used.
CREATE TABLE totp_recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT        NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The same code cannot exist twice for one account.
  CONSTRAINT totp_recovery_unique UNIQUE (user_id, code_hash)
);

-- Only the unused ones are ever looked up, and only by account.
CREATE INDEX totp_recovery_unused_idx ON totp_recovery_codes (user_id) WHERE used_at IS NULL;

-- +down
DROP TABLE IF EXISTS totp_recovery_codes;
DROP TABLE IF EXISTS user_totp;
