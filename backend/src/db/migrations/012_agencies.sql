-- Agencies: a business that employs several service providers.
--
-- A labour created by an agency is an ordinary provider_profile with an owner.
-- That is deliberate: it means discovery, booking, the state machine, earnings
-- and payouts all keep working untouched, and money still reaches the person
-- who did the work. The agency manages and watches; it never sits between the
-- provider and their money.
--
-- What the agency does own is trust. It submits KYC once, and its providers
-- inherit that approval - so the agency carries responsibility for the people
-- it puts in front of customers.

-- ---------------------------------------------------------------- the role
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, and every
-- migration here runs in one. Rebuilding the type works transactionally and
-- is safe because exactly one column uses it.
ALTER TYPE user_role RENAME TO user_role_old;

CREATE TYPE user_role AS ENUM ('customer', 'provider', 'admin', 'agency');

ALTER TABLE users
  ALTER COLUMN role TYPE user_role USING role::text::user_role;

DROP TYPE user_role_old;

-- ------------------------------------------------------------- the agency
CREATE TABLE agencies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  name                  TEXT NOT NULL,
  headline              TEXT,
  about                 TEXT,
  -- Shown to customers on a provider's profile, so they know who stands
  -- behind the person arriving at their door.
  registration_no       TEXT,

  address_line          TEXT,
  city                  TEXT,
  state                 TEXT,
  pincode               TEXT CHECK (pincode IS NULL OR pincode ~ '^[0-9]{6}$'),

  -- The same gate a provider has. An unapproved agency can sign in and add
  -- people, but none of them are bookable until the agency is approved.
  verification_status   verification_status NOT NULL DEFAULT 'unsubmitted',
  verified_at           TIMESTAMPTZ,
  verified_by           UUID REFERENCES users(id) ON DELETE SET NULL,

  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agencies_verification_idx ON agencies (verification_status)
  WHERE deleted_at IS NULL;

SELECT attach_updated_at('agencies');

-- -------------------------------------------------- providers under agencies
--
-- RESTRICT rather than CASCADE: deleting an agency must never silently delete
-- the providers under it, because each of those rows owns bookings, an
-- earnings ledger and money that has not been paid out yet.
ALTER TABLE provider_profiles
  ADD COLUMN agency_id UUID REFERENCES agencies(id) ON DELETE RESTRICT;

CREATE INDEX provider_profiles_agency_idx ON provider_profiles (agency_id)
  WHERE agency_id IS NOT NULL AND deleted_at IS NULL;

-- ------------------------------------------------------------- agency KYC
--
-- One review queue, two kinds of subject. Admins already have a verification
-- screen; splitting agencies into a second queue would mean two places to
-- look and two ways to forget.
ALTER TABLE kyc_submissions
  ALTER COLUMN provider_id DROP NOT NULL,
  ADD COLUMN agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE;

ALTER TABLE kyc_submissions
  ADD CONSTRAINT kyc_subject_is_exactly_one CHECK (
    (provider_id IS NOT NULL AND agency_id IS NULL)
    OR (provider_id IS NULL AND agency_id IS NOT NULL)
  );

-- The provider version of this index already exists; agencies need their own
-- so one agency cannot have two open submissions either.
CREATE UNIQUE INDEX kyc_one_open_agency_submission ON kyc_submissions (agency_id)
  WHERE agency_id IS NOT NULL
    AND status IN ('pending', 'info_requested');

CREATE INDEX kyc_agency_idx ON kyc_submissions (agency_id, submitted_at DESC)
  WHERE agency_id IS NOT NULL;

-- +down
DROP INDEX IF EXISTS kyc_agency_idx;
DROP INDEX IF EXISTS kyc_one_open_agency_submission;

ALTER TABLE kyc_submissions
  DROP CONSTRAINT IF EXISTS kyc_subject_is_exactly_one,
  DROP COLUMN IF EXISTS agency_id;

-- Rows with no provider cannot survive the column becoming NOT NULL again.
DELETE FROM kyc_submissions WHERE provider_id IS NULL;

ALTER TABLE kyc_submissions
  ALTER COLUMN provider_id SET NOT NULL;

DROP INDEX IF EXISTS provider_profiles_agency_idx;

ALTER TABLE provider_profiles
  DROP COLUMN IF EXISTS agency_id;

DROP TABLE IF EXISTS agencies;

-- Any account on the role being removed would violate the rebuilt type.
DELETE FROM users WHERE role = 'agency';

ALTER TYPE user_role RENAME TO user_role_new;
CREATE TYPE user_role AS ENUM ('customer', 'provider', 'admin');
ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::text::user_role;
DROP TYPE user_role_new;
