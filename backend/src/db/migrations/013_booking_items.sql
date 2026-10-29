-- Several services in one booking.
--
-- A customer who needs a socket repaired and a fan fitted was previously
-- forced to make two bookings, which meant two slots, two visits and two
-- invoices for one trip to one house. This lets one booking carry several
-- services, priced and timed as a set.
--
-- `bookings.category_id` deliberately stays. It holds the first service and
-- remains the booking's headline category, so discovery, the admin category
-- breakdown, the existing indexes and every report keep working unchanged.
-- `booking_items` is the authority on the full list; `category_id` is a
-- denormalised convenience that the service layer keeps in step with item 0.
--
-- The money rules, stated once here because they are enforced in the service
-- layer and nowhere else:
--
--   price     - the sum of the chosen services' published prices.
--   duration  - the sum of their estimates. Two jobs take longer than one, so
--               the reserved slot grows and the double-booking constraint
--               keeps protecting the provider's calendar.
--   visit fee - charged once, not once per service. One trip, one call-out.
--   commission- frozen per item at the rate of that item's category, so a
--               booking mixing a 10% and a 15% category settles each at its
--               own rate rather than averaging away the difference.

CREATE TABLE booking_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  -- RESTRICT, matching bookings.category_id: a category that has been booked
  -- is part of the record and cannot be deleted out from under it.
  category_id         UUID NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT,

  -- Snapshots, taken at booking time. The provider may re-price the service
  -- tomorrow; what this booking agreed must not move.
  price_minor         BIGINT NOT NULL CHECK (price_minor >= 0),
  estimated_minutes   INTEGER NOT NULL CHECK (estimated_minutes > 0),
  commission_percent  NUMERIC(5,2) NOT NULL CHECK (commission_percent BETWEEN 0 AND 100),

  position            SMALLINT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The same service twice in one booking is a mistake, not a quantity: the
  -- customer wants it done once. Two fans is one "Fan Installation" job the
  -- provider prices on arrival, not two line items.
  CONSTRAINT booking_items_unique_service UNIQUE (booking_id, category_id)
);

CREATE INDEX booking_items_booking_idx ON booking_items (booking_id, position);
CREATE INDEX booking_items_category_idx ON booking_items (category_id);

-- Every booking that already exists becomes a one-item booking, so nothing
-- downstream has to cope with a booking that has no items. The duration is
-- recovered from the slot that was actually reserved rather than from the
-- category's estimate, which may have been edited since.
INSERT INTO booking_items
  (booking_id, category_id, price_minor, estimated_minutes, commission_percent, position)
SELECT
  b.id,
  b.category_id,
  b.quoted_amount_minor,
  GREATEST(1, ROUND(EXTRACT(EPOCH FROM (b.scheduled_end - b.scheduled_start)) / 60)::int),
  b.commission_percent,
  0
FROM bookings b;

-- +down
DROP TABLE IF EXISTS booking_items;
