-- Manual payouts: where the money is actually sent, and proof that it was.
--
-- Until RazorpayX (or any payout rail) is activated, an admin transfers the
-- money by hand through their own banking app and records it here. The ledger
-- work is identical either way - what changes is only who moves the money.

-- Where a provider wants to be paid.
--
-- Kept on the profile rather than in a separate table because a provider has
-- exactly one destination at a time. History is not kept here on purpose: the
-- payout row snapshots what it paid to, which is the record that matters.
ALTER TABLE provider_profiles
  ADD COLUMN payout_method       TEXT,
  ADD COLUMN payout_upi_id       TEXT,
  ADD COLUMN payout_account_name TEXT,
  ADD COLUMN payout_account_number TEXT,
  ADD COLUMN payout_ifsc         TEXT,
  ADD COLUMN payout_bank_name    TEXT,
  ADD COLUMN payout_updated_at   TIMESTAMPTZ;

ALTER TABLE provider_profiles
  ADD CONSTRAINT provider_payout_method_valid
    CHECK (payout_method IS NULL OR payout_method IN ('upi', 'bank'));

-- Whichever method is chosen has to be complete. A half-filled destination is
-- worse than none: it looks payable in the queue and fails at the bank.
ALTER TABLE provider_profiles
  ADD CONSTRAINT provider_payout_details_complete CHECK (
    payout_method IS NULL
    OR (payout_method = 'upi' AND payout_upi_id IS NOT NULL)
    OR (payout_method = 'bank'
        AND payout_account_name IS NOT NULL
        AND payout_account_number IS NOT NULL
        AND payout_ifsc IS NOT NULL)
  );

ALTER TABLE payouts
  -- How this one was sent. 'manual' means a human moved the money.
  ADD COLUMN method              TEXT NOT NULL DEFAULT 'manual',
  -- The UTR, UPI transaction id or NEFT reference the bank gave back. This is
  -- the only evidence the platform has that the transfer really happened.
  ADD COLUMN payment_reference   TEXT,
  ADD COLUMN paid_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  -- What the money was sent to, frozen at the moment of payment. A provider
  -- who later changes their bank details must not be able to rewrite where a
  -- past payout went - that is the first thing anyone checks in a dispute.
  ADD COLUMN destination         JSONB;

-- Everything that existed before this migration went through a gateway driver,
-- so it is labelled as such. Only rows created from here on default to manual.
UPDATE payouts SET method = 'gateway';

ALTER TABLE payouts
  ADD CONSTRAINT payout_method_valid CHECK (method IN ('manual', 'gateway'));

-- A paid manual payout has to say who paid it and what reference the bank
-- returned. Without that the row is an assertion, not a record.
ALTER TABLE payouts
  ADD CONSTRAINT payout_manual_paid_is_evidenced CHECK (
    NOT (method = 'manual' AND status = 'paid')
    OR (payment_reference IS NOT NULL AND paid_by IS NOT NULL)
  );

-- The admin queue reads pending manual payouts on every page load.
CREATE INDEX payouts_awaiting_transfer_idx ON payouts (created_at)
  WHERE status = 'pending' AND method = 'manual';

-- +down
DROP INDEX IF EXISTS payouts_awaiting_transfer_idx;

ALTER TABLE payouts
  DROP CONSTRAINT IF EXISTS payout_manual_paid_is_evidenced,
  DROP CONSTRAINT IF EXISTS payout_method_valid,
  DROP COLUMN IF EXISTS destination,
  DROP COLUMN IF EXISTS paid_by,
  DROP COLUMN IF EXISTS payment_reference,
  DROP COLUMN IF EXISTS method;

ALTER TABLE provider_profiles
  DROP CONSTRAINT IF EXISTS provider_payout_details_complete,
  DROP CONSTRAINT IF EXISTS provider_payout_method_valid,
  DROP COLUMN IF EXISTS payout_updated_at,
  DROP COLUMN IF EXISTS payout_bank_name,
  DROP COLUMN IF EXISTS payout_ifsc,
  DROP COLUMN IF EXISTS payout_account_number,
  DROP COLUMN IF EXISTS payout_account_name,
  DROP COLUMN IF EXISTS payout_upi_id,
  DROP COLUMN IF EXISTS payout_method;
