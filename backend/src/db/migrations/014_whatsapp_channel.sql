-- WhatsApp as a notification channel.
--
-- The channel column is a free-text column guarded by a CHECK, so adding a
-- value is a constraint swap rather than an enum rebuild. Postgres validates
-- the new constraint against existing rows as it is added, which is what we
-- want: it proves nothing already holds a value the new list would reject.

ALTER TABLE notifications DROP CONSTRAINT notification_channel_valid;

ALTER TABLE notifications ADD CONSTRAINT notification_channel_valid
  CHECK (channel IN ('in_app', 'email', 'sms', 'whatsapp', 'push'));

-- +down
-- Anything already delivered over WhatsApp would violate the narrower list, so
-- those rows are reassigned rather than deleted. They are a delivery record,
-- not business data, and losing them to a rollback would be worse than losing
-- the precision of which channel carried them.
UPDATE notifications SET channel = 'sms' WHERE channel = 'whatsapp';

ALTER TABLE notifications DROP CONSTRAINT notification_channel_valid;

ALTER TABLE notifications ADD CONSTRAINT notification_channel_valid
  CHECK (channel IN ('in_app', 'email', 'sms', 'push'));
