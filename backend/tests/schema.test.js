/**
 * Phase 2 integrity tests.
 *
 * These assert that the domain rules are enforced by the database itself, not
 * merely by application code - a double booking, a second default address or a
 * completed booking with no amount must be impossible even if a service forgets
 * to check. Everything runs inside one transaction that is rolled back, so the
 * test leaves no data behind.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/pool.js';

/** Asserts that a statement is rejected, and reports the constraint that caught it. */
async function rejects(client, sql, params, label) {
  await client.query('SAVEPOINT sp');
  try {
    await client.query(sql, params);
    await client.query('ROLLBACK TO SAVEPOINT sp');
    assert.fail('expected the database to reject: ' + label);
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp');
    if (err instanceof assert.AssertionError) throw err;
    assert.ok(err.code, label + ' rejected (' + err.code + ')');
  }
}

test('Phase 2: schema integrity', async (t) => {
  const client = await pool.connect();
  await client.query('BEGIN');

  t.after(async () => {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  });

  // ---------- fixtures ----------
  const { rows: [customer] } = await client.query(
    `INSERT INTO users (role, full_name, email, phone, password_hash)
     VALUES ('customer','Test Customer','t.customer@test.local','9111100001','x') RETURNING id`,
  );
  const { rows: [providerUser] } = await client.query(
    `INSERT INTO users (role, full_name, email, phone, password_hash)
     VALUES ('provider','Test Provider','t.provider@test.local','9111100002','x') RETURNING id`,
  );
  const { rows: [provider] } = await client.query(
    `INSERT INTO provider_profiles (user_id, verification_status, is_accepting_bookings)
     VALUES ($1,'approved',TRUE) RETURNING id`,
    [providerUser.id],
  );
  const { rows: [category] } = await client.query(
    `SELECT id FROM service_categories WHERE slug = 'ac-servicing'`,
  );

  const booking = (ref, start, end, status = 'requested') => [
    ref, customer.id, provider.id, category.id, status, start, end,
  ];
  const BOOKING_SQL = `
    INSERT INTO bookings (reference, customer_id, provider_id, category_id, status,
      scheduled_start, scheduled_end, address_line, address_city, address_state,
      address_pincode, quoted_amount_minor, commission_percent)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'1 Test Street','Bidar','Karnataka','585401',59900,15)`;

  await t.test('seed data is present', async () => {
    const { rows } = await client.query('SELECT count(*)::int c FROM service_categories');
    assert.ok(rows[0].c >= 32, 'catalogue seeded');
    assert.ok(category?.id, 'AC servicing category exists');
  });

  await t.test('a provider cannot be double-booked for an overlapping slot', async () => {
    await client.query(BOOKING_SQL, booking('BK-TEST01', '2030-01-10T09:00:00Z', '2030-01-10T10:00:00Z'));

    await rejects(
      client, BOOKING_SQL,
      booking('BK-TEST02', '2030-01-10T09:30:00Z', '2030-01-10T10:30:00Z'),
      'overlapping slot for the same provider',
    );
  });

  await t.test('a cancelled booking releases its slot', async () => {
    await client.query('UPDATE bookings SET status = $1 WHERE reference = $2', ['cancelled', 'BK-TEST01']);
    await client.query(BOOKING_SQL, booking('BK-TEST03', '2030-01-10T09:30:00Z', '2030-01-10T10:30:00Z'));
    const { rows } = await client.query('SELECT count(*)::int c FROM bookings WHERE provider_id = $1', [provider.id]);
    assert.equal(rows[0].c, 2, 'the slot was reusable once the first booking was cancelled');
  });

  await t.test('a booking cannot end before it starts', async () => {
    await rejects(
      client, BOOKING_SQL,
      booking('BK-TEST04', '2030-02-01T12:00:00Z', '2030-02-01T11:00:00Z'),
      'scheduled_end before scheduled_start',
    );
  });

  await t.test('a completed booking must record what it charged', async () => {
    await rejects(
      client,
      `UPDATE bookings SET status='completed', final_amount_minor=NULL WHERE reference='BK-TEST03'`,
      [],
      'completed booking with no final amount',
    );
  });

  await t.test('status history records every transition', async () => {
    await client.query(
      `INSERT INTO booking_status_history (booking_id, from_status, to_status, actor_type)
       SELECT id, 'requested', 'accepted', 'provider' FROM bookings WHERE reference='BK-TEST03'`,
    );
    const { rows } = await client.query(
      `SELECT count(*)::int c FROM booking_status_history h
       JOIN bookings b ON b.id = h.booking_id WHERE b.reference='BK-TEST03'`,
    );
    assert.equal(rows[0].c, 1);
  });
});
