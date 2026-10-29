-- Reputation domain: the signal that makes discovery meaningful and gives
-- providers a reason to perform.

CREATE TABLE reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One review per booking, enforced by the primary key of the relationship
  -- rather than by application logic.
  booking_id        UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id       UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,

  rating            SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title             TEXT,
  comment           TEXT,

  -- Optional sub-scores, so a provider can see what specifically went wrong.
  punctuality_rating SMALLINT CHECK (punctuality_rating IS NULL OR punctuality_rating BETWEEN 1 AND 5),
  quality_rating     SMALLINT CHECK (quality_rating IS NULL OR quality_rating BETWEEN 1 AND 5),
  behaviour_rating   SMALLINT CHECK (behaviour_rating IS NULL OR behaviour_rating BETWEEN 1 AND 5),

  photos            TEXT[] NOT NULL DEFAULT '{}',

  -- Provider right of reply.
  provider_reply      TEXT,
  provider_replied_at TIMESTAMPTZ,

  -- Moderation. A review is visible until an admin says otherwise.
  status            TEXT NOT NULL DEFAULT 'published',
  moderated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  moderated_at      TIMESTAMPTZ,
  moderation_reason TEXT,
  report_count      INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT review_status_valid CHECK (status IN ('published', 'flagged', 'hidden', 'removed'))
);

-- The read path behind a provider profile page.
CREATE INDEX reviews_provider_idx ON reviews (provider_id, created_at DESC)
  WHERE status = 'published';
CREATE INDEX reviews_customer_idx ON reviews (customer_id, created_at DESC);
CREATE INDEX reviews_moderation_queue_idx ON reviews (status, report_count DESC)
  WHERE status IN ('flagged', 'hidden');

SELECT attach_updated_at('reviews');

-- Customer or provider reports of an abusive or fake review, feeding the
-- admin moderation queue.
CREATE TABLE review_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id     UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  reported_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,
  details       TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (review_id, reported_by)
);

CREATE INDEX review_reports_open_idx ON review_reports (created_at) WHERE resolved_at IS NULL;

-- +down
DROP TABLE IF EXISTS review_reports;
DROP TABLE IF EXISTS reviews;
