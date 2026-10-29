-- Provider profile domain: who the provider is, what they do, where they do
-- it, when they are free and how much they charge.

CREATE TABLE provider_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  business_name         TEXT,
  headline              TEXT,
  bio                   TEXT,
  experience_years      SMALLINT NOT NULL DEFAULT 0 CHECK (experience_years BETWEEN 0 AND 70),
  languages             TEXT[]   NOT NULL DEFAULT '{}',
  skills                TEXT[]   NOT NULL DEFAULT '{}',

  -- The verification gate. A provider is invisible to customers and cannot
  -- receive bookings until this reads 'approved'. Discovery, Booking and
  -- Payouts all read this same field - it is the one switch that makes a
  -- provider commercially live.
  verification_status   verification_status NOT NULL DEFAULT 'unsubmitted',
  verified_at           TIMESTAMPTZ,
  verified_by           UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Provider-controlled switch, separate from admin verification. A verified
  -- provider can still go offline while on holiday.
  is_accepting_bookings BOOLEAN NOT NULL DEFAULT FALSE,

  -- Denormalised reputation, maintained by the Reviews module and read by
  -- Discovery on every search - too hot to compute per query.
  rating_average        NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (rating_average BETWEEN 0 AND 5),
  rating_count          INTEGER  NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  jobs_completed        INTEGER  NOT NULL DEFAULT 0 CHECK (jobs_completed >= 0),
  jobs_cancelled        INTEGER  NOT NULL DEFAULT 0 CHECK (jobs_cancelled >= 0),
  acceptance_rate       NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (acceptance_rate BETWEEN 0 AND 100),
  avg_response_minutes  INTEGER,

  -- Buffer between consecutive jobs, so back-to-back slots stay realistic.
  slot_buffer_minutes   SMALLINT NOT NULL DEFAULT 30 CHECK (slot_buffer_minutes >= 0),

  payout_account_ref    TEXT,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The index that every customer-facing search starts from.
CREATE INDEX provider_profiles_discoverable_idx
  ON provider_profiles (verification_status, is_accepting_bookings, rating_average DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX provider_profiles_skills_idx ON provider_profiles USING GIN (skills);

SELECT attach_updated_at('provider_profiles');

-- Which categories a provider serves, and their price inside the admin band.
CREATE TABLE provider_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  category_id     UUID NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT,
  price_minor     BIGINT   NOT NULL CHECK (price_minor >= 0),
  pricing_unit    TEXT     NOT NULL DEFAULT 'per_visit',
  visit_charge_minor BIGINT NOT NULL DEFAULT 0 CHECK (visit_charge_minor >= 0),
  is_active       BOOLEAN  NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (provider_id, category_id)
);

CREATE INDEX provider_categories_category_idx ON provider_categories (category_id, is_active);
CREATE INDEX provider_categories_provider_idx ON provider_categories (provider_id);

SELECT attach_updated_at('provider_categories');

-- Where a provider will travel. A customer's address must fall inside one of
-- these for the provider to appear in their search results.
CREATE TABLE provider_service_areas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  city          TEXT NOT NULL,
  state         TEXT NOT NULL,
  pincodes      TEXT[] NOT NULL DEFAULT '{}',
  center_lat    DOUBLE PRECISION,
  center_lng    DOUBLE PRECISION,
  radius_km     NUMERIC(6,2) NOT NULL DEFAULT 10 CHECK (radius_km > 0 AND radius_km <= 200),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT service_area_lat_range CHECK (center_lat IS NULL OR center_lat BETWEEN -90 AND 90),
  CONSTRAINT service_area_lng_range CHECK (center_lng IS NULL OR center_lng BETWEEN -180 AND 180)
);

CREATE INDEX service_areas_provider_idx ON provider_service_areas (provider_id) WHERE is_active;
CREATE INDEX service_areas_city_idx ON provider_service_areas (city) WHERE is_active;
CREATE INDEX service_areas_pincodes_idx ON provider_service_areas USING GIN (pincodes);
CREATE INDEX service_areas_geo_idx ON provider_service_areas (center_lat, center_lng) WHERE is_active;

SELECT attach_updated_at('provider_service_areas');

-- The provider's recurring weekly working hours. 0 = Sunday.
CREATE TABLE provider_availability (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT availability_window_valid CHECK (end_time > start_time),
  UNIQUE (provider_id, day_of_week, start_time)
);

CREATE INDEX availability_provider_day_idx ON provider_availability (provider_id, day_of_week)
  WHERE is_active;

SELECT attach_updated_at('provider_availability');

-- One-off deviations: a holiday, a half day, or extra hours on a given date.
-- An exception always wins over the weekly rule.
CREATE TABLE availability_exceptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  is_available  BOOLEAN NOT NULL DEFAULT FALSE,
  start_time    TIME,
  end_time      TIME,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT exception_window_valid CHECK (
    (is_available = FALSE) OR (start_time IS NOT NULL AND end_time > start_time)
  ),
  UNIQUE (provider_id, exception_date)
);

CREATE INDEX availability_exceptions_lookup_idx
  ON availability_exceptions (provider_id, exception_date);

-- +down
DROP TABLE IF EXISTS availability_exceptions;
DROP TABLE IF EXISTS provider_availability;
DROP TABLE IF EXISTS provider_service_areas;
DROP TABLE IF EXISTS provider_categories;
DROP TABLE IF EXISTS provider_profiles;
