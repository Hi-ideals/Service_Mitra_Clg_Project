-- Governance domain: disputes, the admin audit trail and notifications.

CREATE TABLE disputes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         TEXT NOT NULL UNIQUE,
  booking_id        UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  raised_by         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  raised_by_type    actor_type NOT NULL,

  category          TEXT NOT NULL,
  subject           TEXT NOT NULL,
  description       TEXT NOT NULL,
  evidence          TEXT[] NOT NULL DEFAULT '{}',

  status            TEXT NOT NULL DEFAULT 'open',
  priority          TEXT NOT NULL DEFAULT 'normal',

  assigned_to       UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution        TEXT,
  resolution_type   TEXT,
  refund_amount_minor BIGINT CHECK (refund_amount_minor IS NULL OR refund_amount_minor >= 0),
  resolved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dispute_status_valid CHECK (
    status IN ('open', 'under_review', 'awaiting_response', 'resolved', 'rejected')
  ),
  CONSTRAINT dispute_priority_valid CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT dispute_resolution_type_valid CHECK (
    resolution_type IS NULL OR
    resolution_type IN ('full_refund', 'partial_refund', 'no_refund', 'rework', 'warning_issued')
  )
);

CREATE INDEX disputes_queue_idx ON disputes (status, priority, created_at);
CREATE INDEX disputes_booking_idx ON disputes (booking_id);
CREATE INDEX disputes_assigned_idx ON disputes (assigned_to) WHERE resolved_at IS NULL;

SELECT attach_updated_at('disputes');

CREATE TABLE dispute_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id    UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  author_type   actor_type NOT NULL,
  message       TEXT NOT NULL,
  attachments   TEXT[] NOT NULL DEFAULT '{}',
  is_internal   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX dispute_messages_idx ON dispute_messages (dispute_id, created_at);

-- Every consequential admin action, append-only. Admin endpoints skip the
-- ownership check, so this is what keeps them accountable instead.
CREATE TABLE admin_audit_log (
  id            BIGSERIAL PRIMARY KEY,
  admin_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  before_state  JSONB,
  after_state   JSONB,
  reason        TEXT,
  ip_address    INET,
  request_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_admin_idx ON admin_audit_log (admin_id, created_at DESC);
CREATE INDEX audit_entity_idx ON admin_audit_log (entity_type, entity_id, created_at DESC);

CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  data          JSONB,
  entity_type   TEXT,
  entity_id     UUID,
  status        TEXT NOT NULL DEFAULT 'pending',
  sent_at       TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  failure_reason TEXT,
  attempts      SMALLINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT notification_channel_valid CHECK (channel IN ('in_app', 'email', 'sms', 'push')),
  CONSTRAINT notification_status_valid CHECK (status IN ('pending', 'sent', 'failed', 'skipped'))
);

CREATE INDEX notifications_inbox_idx ON notifications (user_id, created_at DESC)
  WHERE channel = 'in_app';
CREATE INDEX notifications_unread_idx ON notifications (user_id)
  WHERE channel = 'in_app' AND read_at IS NULL;
CREATE INDEX notifications_pending_idx ON notifications (created_at) WHERE status = 'pending';

-- +down
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS admin_audit_log;
DROP TABLE IF EXISTS dispute_messages;
DROP TABLE IF EXISTS disputes;
