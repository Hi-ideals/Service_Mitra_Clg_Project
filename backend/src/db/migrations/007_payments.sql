-- Financial domain, part 1: payments, webhook events and invoices.
-- Every amount is an integer in paise - never a float.

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           TEXT NOT NULL UNIQUE,
  booking_id          UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  customer_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  status              payment_status NOT NULL DEFAULT 'pending',
  amount_minor        BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency            CHAR(3) NOT NULL DEFAULT 'INR',
  method              TEXT,

  -- Gateway identifiers. We create the order; the payment id and signature
  -- come back from the gateway and are verified before we trust them.
  gateway             TEXT NOT NULL DEFAULT 'mock',
  gateway_order_id    TEXT,
  gateway_payment_id  TEXT,
  gateway_signature   TEXT,

  failure_code        TEXT,
  failure_reason      TEXT,

  authorized_at       TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A booking may be retried after a failure, but only one payment may be live.
CREATE UNIQUE INDEX payments_one_live_per_booking ON payments (booking_id)
  WHERE status IN ('pending', 'authorized', 'paid');
CREATE INDEX payments_customer_idx ON payments (customer_id, created_at DESC);
CREATE INDEX payments_status_idx ON payments (status, created_at);
CREATE UNIQUE INDEX payments_gateway_payment_unique ON payments (gateway, gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

SELECT attach_updated_at('payments');

-- Raw webhook deliveries, recorded before they are acted on and keyed by the
-- gateway event id, so a retried delivery cannot double-credit a booking.
CREATE TABLE payment_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id        UUID REFERENCES payments(id) ON DELETE SET NULL,
  gateway           TEXT NOT NULL,
  gateway_event_id  TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  signature_valid   BOOLEAN NOT NULL DEFAULT FALSE,
  payload           JSONB NOT NULL,
  processed_at      TIMESTAMPTZ,
  processing_error  TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (gateway, gateway_event_id)
);

CREATE INDEX payment_events_unprocessed_idx ON payment_events (received_at)
  WHERE processed_at IS NULL;

CREATE TABLE invoices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number        TEXT NOT NULL UNIQUE,
  booking_id            UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  customer_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_id           UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  payment_id            UUID REFERENCES payments(id) ON DELETE SET NULL,

  -- Line-item breakdown, snapshotted at issue time.
  service_amount_minor   BIGINT NOT NULL CHECK (service_amount_minor >= 0),
  visit_charge_minor     BIGINT NOT NULL DEFAULT 0 CHECK (visit_charge_minor >= 0),
  tax_amount_minor       BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount_minor >= 0),
  discount_minor         BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  total_amount_minor     BIGINT NOT NULL CHECK (total_amount_minor >= 0),
  commission_minor       BIGINT NOT NULL DEFAULT 0 CHECK (commission_minor >= 0),
  provider_earning_minor BIGINT NOT NULL DEFAULT 0 CHECK (provider_earning_minor >= 0),

  line_items            JSONB NOT NULL DEFAULT '[]',
  pdf_storage_key       TEXT,
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX invoices_customer_idx ON invoices (customer_id, issued_at DESC);
CREATE INDEX invoices_provider_idx ON invoices (provider_id, issued_at DESC);

SELECT attach_updated_at('invoices');

CREATE TABLE refunds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         TEXT NOT NULL UNIQUE,
  payment_id        UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  booking_id        UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  amount_minor      BIGINT NOT NULL CHECK (amount_minor > 0),
  reason            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  -- Who authorised it: an automatic cancellation policy, or a named admin.
  initiated_by      actor_type NOT NULL,
  admin_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  gateway_refund_id TEXT,
  processed_at      TIMESTAMPTZ,
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT refund_status_valid CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX refunds_payment_idx ON refunds (payment_id);
CREATE INDEX refunds_booking_idx ON refunds (booking_id);

SELECT attach_updated_at('refunds');

-- +down
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS payment_events;
DROP TABLE IF EXISTS payments;
