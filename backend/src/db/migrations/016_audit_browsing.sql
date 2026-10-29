-- An index for reading the audit log, rather than only for writing it.
--
-- The two indexes this table already has are keyed on who acted and on what
-- they acted upon, which suits "show me everything about this provider". The
-- screen that is about to exist asks a different question - "what happened
-- most recently" - and answers it by scanning every row and sorting them.
--
-- That costs nothing today and a great deal in a year. This table only ever
-- grows: nothing deletes from it, by design, because an audit trail that can
-- be edited is not one.

CREATE INDEX audit_recent_idx ON admin_audit_log (created_at DESC);

-- Filtering by what happened, newest first - the second thing the screen does.
CREATE INDEX audit_action_idx ON admin_audit_log (action, created_at DESC);

-- +down
DROP INDEX IF EXISTS audit_action_idx;
DROP INDEX IF EXISTS audit_recent_idx;
