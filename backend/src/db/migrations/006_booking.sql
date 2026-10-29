-- Booking domain: the spine of the platform. Scheduling, job tracking,
-- payments, invoicing, reviews, disputes and payouts all hang off these rows.

-- btree_gist lets an exclusion constraint mix equality (provider_id) with
-- range overlap (the scheduled slot), which is what prevents double booking.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           TEXT NOT NULL UNIQUE,

  customer_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_id         UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  category_id         UUID NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT,

  status              booking_status NOT NULL DEFAULT 'requested',

  -- Scheduling
  scheduled_start     TIMESTAMPTZ NOT NULL,
  scheduled_end       TIMESTAMPTZ NOT NULL,
  scheduled_range     TSTZRANGE GENERATED ALWAYS AS
                        (tstzrange(scheduled_start, scheduled_end, '[)')) STORED,
  -- A request left unanswered past this point is auto-cancelled by a worker.
  respond_by          TIMESTAMPTZ,

  -- Job detail
  description         TEXT,
  customer_notes      TEXT,

  -- Address is snapshotted, not referenced: if the customer later edits or
  -- deletes the address, the record of where the job happened must not change.
  address_id          UUID REFERENCES addresses(id) ON DELETE SET NULL,
  address_line        TEXT NOT NULL,
  address_city        TEXT NOT NULL,
  address_state       TEXT NOT NULL,
  address_pincode     TEXT NOT NULL,
  address_lat         DOUBLE PRECISION,
  address_lng         DOUBLE PRECISION,

  -- Pricing snapshot, all in paise. Quoted at booking time; final_amount may
  -- differ after inspection, and is what the invoice charges.
  quoted_amount_minor     BIGINT NOT NULL CHECK (quoted_amount_minor >= 0),
  visit_charge_minor      BIGINT NOT NULL DEFAULT 0 CHECK (visit_charge_minor >= 0),
  final_amount_minor      BIGINT CHECK (final_amount_minor IS NULL OR final_amount_minor >= 0),
  -- Commission rate is frozen per booking, so a later settings change never
  -- retroactively alters what a provider already earned.
  commission_percent      NUMERIC(5,2) NOT NULL CHECK (commission_percent BETWEEN 0 AND 100),
  commission_amount_minor BIGINT CHECK (commission_amount_minor IS NULL OR commission_amount_minor >= 0),
  provider_earning_minor  BIGINT CHECK (provider_earning_minor IS NULL OR provider_earning_minor >= 0),

  -- Lifecycle timestamps
  accepted_at         TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancelled_by        actor_type,
  cancellation_reason TEXT,
  rejection_reason    TEXT,

  -- The customer reads this code to the provider to confirm the job is done,
  -- so completion cannot be claimed unilaterally.
  completion_otp_hash TEXT,
  completion_photos   TEXT[] NOT NULL DEFAULT '{}',

  -- Closes the window in which a dispute may be raised and a payout held.
  dispute_window_ends_at TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT booking_window_valid CHECK (scheduled_end > scheduled_start),
  -- A completed booking must know what it actually charged.
  CONSTRAINT booking_completed_has_amount CHECK (
    status <> 'completed' OR final_amount_minor IS NOT NULL
  )
);

-- One provider cannot be in two places at once. Only live bookings reserve the
-- slot; a rejected or cancelled booking releases it.
ALTER TABLE bookings ADD CONSTRAINT bookings_no_double_booking
  EXCLUDE USING GIST (
    provider_id WITH =,
    scheduled_range WITH &&
  ) WHERE (status IN ('requested', 'accepted', 'in_progress'));

CREATE INDEX bookings_customer_idx ON bookings (customer_id, created_at DESC);
CREATE INDEX bookings_provider_idx ON bookings (provider_id, created_at DESC);
CREATE INDEX bookings_status_idx ON bookings (status, scheduled_start);
CREATE INDEX bookings_category_idx ON bookings (category_id, created_at DESC);
-- Feeds the worker that auto-cancels unanswered requests.
CREATE INDEX bookings_respond_by_idx ON bookings (respond_by)
  WHERE status = 'requested';
-- Feeds the worker that releases payouts once the dispute window closes.
CREATE INDEX bookings_dispute_window_idx ON bookings (dispute_window_ends_at)
  WHERE status = 'completed';

SELECT attach_updated_at('bookings');

-- Append-only status history. Nothing overwrites a status without writing a
-- row here, so any booking can be reconstructed during a dispute.
CREATE TABLE booking_status_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status   booking_status,
  to_status     booking_status NOT NULL,
  actor_type    actor_type NOT NULL,
  actor_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  reason        TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX booking_history_booking_idx ON booking_status_history (booking_id, created_at);

-- +down
DROP TABLE IF EXISTS booking_status_history;
DROP TABLE IF EXISTS bookings;
