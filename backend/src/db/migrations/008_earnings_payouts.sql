-- Financial domain, part 2: the provider earnings ledger and payout batches.

-- Append-only ledger. One row per financial movement affecting a provider, so
-- a balance is always the sum of its history rather than a field someone edited.
CREATE TABLE provider_earnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
  payout_id       UUID,
  entry_type      TEXT NOT NULL,
  -- Positive credits the provider, negative debits them.
  amount_minor    BIGINT NOT NULL,
  description     TEXT,
  -- Earnings only become payable once the dispute window has closed.
  available_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT earning_type_valid CHECK (
    entry_type IN ('job_earning', 'commission', 'refund_reversal', 'adjustment', 'payout', 'penalty')
  )
);

CREATE INDEX earnings_provider_idx ON provider_earnings (provider_id, created_at DESC);
CREATE INDEX earnings_unpaid_idx ON provider_earnings (provider_id, available_at)
  WHERE payout_id IS NULL;
CREATE INDEX earnings_booking_idx ON provider_earnings (booking_id);

CREATE TABLE payouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         TEXT NOT NULL UNIQUE,
  provider_id       UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  status            payout_status NOT NULL DEFAULT 'pending',
  amount_minor      BIGINT NOT NULL CHECK (amount_minor > 0),
  period_start      DATE,
  period_end        DATE,
  gateway_payout_id TEXT,
  processed_at      TIMESTAMPTZ,
  failure_reason    TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX payouts_provider_idx ON payouts (provider_id, created_at DESC);
CREATE INDEX payouts_status_idx ON payouts (status, created_at);

SELECT attach_updated_at('payouts');

ALTER TABLE provider_earnings
  ADD CONSTRAINT earnings_payout_fk
  FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE SET NULL;

-- +down
ALTER TABLE provider_earnings DROP CONSTRAINT IF EXISTS earnings_payout_fk;
DROP TABLE IF EXISTS payouts;
DROP TABLE IF EXISTS provider_earnings;
