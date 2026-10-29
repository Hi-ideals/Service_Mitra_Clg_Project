-- Verification and KYC domain.
-- Establishes that a provider is a real, identifiable, qualified person before
-- any customer lets them into their home.

CREATE TABLE kyc_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  status            verification_status NOT NULL DEFAULT 'pending',

  full_legal_name   TEXT NOT NULL,
  date_of_birth     DATE,
  id_proof_type     TEXT NOT NULL,
  -- Only the last four digits are kept in the clear; the full number lives in
  -- the uploaded document, which is private and signed-URL only.
  id_proof_last4    TEXT CHECK (id_proof_last4 IS NULL OR id_proof_last4 ~ '^[0-9]{4}$'),

  address_line      TEXT,
  city              TEXT,
  state             TEXT,
  pincode           TEXT CHECK (pincode IS NULL OR pincode ~ '^[0-9]{6}$'),

  -- Result of the optional automated check against an external KYC API.
  auto_check_status TEXT,
  auto_check_ref    TEXT,
  auto_check_payload JSONB,

  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  review_notes      TEXT,
  rejection_reason  TEXT,
  -- Trade licences expire; an expired document sends a provider back to review.
  expires_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT kyc_id_proof_type CHECK (
    id_proof_type IN ('aadhaar', 'pan', 'voter_id', 'passport', 'driving_licence')
  )
);

-- A provider may only have one submission awaiting a decision at a time.
CREATE UNIQUE INDEX kyc_one_open_submission ON kyc_submissions (provider_id)
  WHERE status IN ('pending', 'info_requested');
CREATE INDEX kyc_review_queue_idx ON kyc_submissions (status, submitted_at);
CREATE INDEX kyc_provider_idx ON kyc_submissions (provider_id, submitted_at DESC);

SELECT attach_updated_at('kyc_submissions');

-- Uploaded documents. The database holds only a storage reference; the file
-- itself is private in object storage and delivered by short-lived signed URL.
CREATE TABLE kyc_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES kyc_submissions(id) ON DELETE CASCADE,
  doc_type        TEXT NOT NULL,
  storage_key     TEXT NOT NULL,
  original_name   TEXT,
  mime_type       TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL CHECK (size_bytes > 0),
  checksum        TEXT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT kyc_doc_type_valid CHECK (
    doc_type IN ('identity', 'address', 'trade_certificate', 'photo', 'other')
  )
);

CREATE INDEX kyc_documents_submission_idx ON kyc_documents (submission_id);

-- Every decision an admin makes on a submission, kept append-only. This is the
-- evidence trail if a provider disputes a rejection or a customer disputes a
-- job done by someone who should not have been approved.
CREATE TABLE kyc_review_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES kyc_submissions(id) ON DELETE CASCADE,
  admin_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  from_status     verification_status,
  to_status       verification_status NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX kyc_review_events_submission_idx ON kyc_review_events (submission_id, created_at);

-- +down
DROP TABLE IF EXISTS kyc_review_events;
DROP TABLE IF EXISTS kyc_documents;
DROP TABLE IF EXISTS kyc_submissions;
