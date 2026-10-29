/**
 * Seeds the database with the service catalogue, platform settings and a set
 * of demo accounts covering all three roles.
 *
 * Idempotent: running it twice leaves the same data, so it is safe to re-run
 * after adding a category.
 */
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from './pool.js';
import env from '../config/env.js';
import categories from './seeds/categories.js';
import demoProviders from './seeds/providers.js';

const DEMO_PASSWORD = 'Password@123';

async function seedSettings(tx) {
  const settings = [
    ['commission', { defaultPercent: env.PLATFORM_COMMISSION_PERCENT }, 'Default platform commission applied when a category does not override it'],
    ['payout', { schedule: 'weekly', dayOfWeek: 1, minimumAmountMinor: 50000 }, 'When provider payouts are batched and the minimum balance to release one'],
    ['cancellation', { freeWindowHours: 12, lateFeePercent: 20, noShowFeePercent: 50 }, 'Cancellation policy applied to customer-initiated cancellations'],
    ['booking', { acceptWindowMinutes: env.BOOKING_ACCEPT_WINDOW_MINUTES, disputeWindowHours: env.DISPUTE_WINDOW_HOURS, maxAdvanceDays: 30 }, 'Booking lifecycle timings'],
    ['tax', { gstPercent: 18, inclusive: false }, 'Tax applied on invoices'],
  ];

  for (const [key, value, description] of settings) {
    await tx.query(
      `INSERT INTO platform_settings (key, value, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
      [key, JSON.stringify(value), description],
    );
  }
  return settings.length;
}

async function seedCategories(tx) {
  let count = 0;

  const insert = async (c, parentId, order) => {
    const row = await tx.one(
      `INSERT INTO service_categories
         (parent_id, name, slug, description, icon, base_price_minor, min_price_minor,
          max_price_minor, pricing_unit, estimated_minutes, requires_certification, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         base_price_minor = EXCLUDED.base_price_minor,
         min_price_minor = EXCLUDED.min_price_minor,
         max_price_minor = EXCLUDED.max_price_minor,
         estimated_minutes = EXCLUDED.estimated_minutes
       RETURNING id`,
      [
        parentId,
        c.name,
        c.slug,
        c.description ?? null,
        c.icon ?? null,
        c.base,
        c.min,
        c.max,
        c.unit ?? 'per_visit',
        c.minutes,
        c.certification ?? false,
        order,
      ],
    );
    count += 1;
    return row.id;
  };

  for (const [i, parent] of categories.entries()) {
    const parentId = await insert(parent, null, i);
    for (const [j, child] of (parent.children ?? []).entries()) {
      await insert(child, parentId, j);
    }
  }

  return count;
}

async function upsertUser(tx, { role, fullName, email, phone, passwordHash, verified = true }) {
  return tx.one(
    `INSERT INTO users (role, full_name, email, phone, password_hash, email_verified_at, phone_verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (email) WHERE deleted_at IS NULL AND email IS NOT NULL
     DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id, role, email`,
    [role, fullName, email, phone, passwordHash, verified ? new Date() : null],
  );
}


/**
 * Demo providers, seeded fully approved and online so that discovery, booking
 * and payments have realistic data to work against from the next phase.
 */
async function seedProviders(tx, passwordHash, adminId) {
  let count = 0;

  for (const p of demoProviders) {
    const user = await tx.one(
      `INSERT INTO users (role, full_name, email, phone, password_hash, email_verified_at, phone_verified_at)
       VALUES ('provider',$1,$2,$3,$4,NOW(),NOW())
       ON CONFLICT (email) WHERE deleted_at IS NULL AND email IS NOT NULL
       DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [p.fullName, p.email, p.phone, passwordHash],
    );

    const profile = await tx.one(
      `INSERT INTO provider_profiles
         (user_id, business_name, headline, bio, experience_years, languages, skills,
          verification_status, verified_at, verified_by, is_accepting_bookings,
          rating_average, rating_count, jobs_completed, acceptance_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',NOW(),$8,TRUE,$9,$10,$11,92)
       ON CONFLICT (user_id) DO UPDATE SET
         business_name = EXCLUDED.business_name,
         headline = EXCLUDED.headline,
         verification_status = 'approved',
         is_accepting_bookings = TRUE
       RETURNING id`,
      [user.id, p.businessName, p.headline, p.bio, p.experienceYears, p.languages, p.skills,
       adminId, p.rating.average, p.rating.count, p.rating.completed],
    );

    for (const svc of p.services) {
      const category = await tx.one('SELECT id, pricing_unit FROM service_categories WHERE slug = $1', [svc.slug]);
      if (!category) continue;
      await tx.query(
        `INSERT INTO provider_categories
           (provider_id, category_id, price_minor, pricing_unit, visit_charge_minor)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (provider_id, category_id) DO UPDATE SET price_minor = EXCLUDED.price_minor`,
        [profile.id, category.id, svc.priceMinor, category.pricing_unit, svc.visitChargeMinor ?? 0],
      );
    }

    await tx.query('DELETE FROM provider_service_areas WHERE provider_id = $1', [profile.id]);
    for (const a of p.areas) {
      await tx.query(
        `INSERT INTO provider_service_areas
           (provider_id, city, state, pincodes, center_lat, center_lng, radius_km)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [profile.id, a.city, a.state, a.pincodes, a.centerLat, a.centerLng, a.radiusKm],
      );
    }

    await tx.query('DELETE FROM provider_availability WHERE provider_id = $1', [profile.id]);
    for (const w of p.availability) {
      await tx.query(
        `INSERT INTO provider_availability (provider_id, day_of_week, start_time, end_time)
         VALUES ($1,$2,$3,$4)`,
        [profile.id, w.dayOfWeek, w.startTime, w.endTime],
      );
    }

    count += 1;
  }

  return count;
}

export async function seed() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_ROUNDS);

  const result = await withTransaction(async (tx) => {
    const settings = await seedSettings(tx);
    const categoryCount = await seedCategories(tx);

    const admin = await upsertUser(tx, {
      role: 'admin',
      fullName: 'Platform Admin',
      email: 'admin@servicesetu.in',
      phone: '9000000001',
      passwordHash,
    });

    const customer = await upsertUser(tx, {
      role: 'customer',
      fullName: 'Ravi Kumar',
      email: 'customer@servicesetu.in',
      phone: '9000000002',
      passwordHash,
    });

    await tx.query(
      `INSERT INTO addresses (user_id, label, line1, city, state, pincode, latitude, longitude, is_default)
       VALUES ($1,'Home','12 MG Road, Near City Park','Bidar','Karnataka','585401',17.9104,77.5199,TRUE)
       ON CONFLICT DO NOTHING`,
      [customer.id],
    );

    const providerCount = await seedProviders(tx, passwordHash, admin.id);

    return { settings, categoryCount, providerCount, adminId: admin.id, customerId: customer.id };
  });

  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed()
    .then(async (r) => {
      console.log('\n  Seed complete');
      console.log('  ------------------------------------------');
      console.log('  platform settings : ' + r.settings);
      console.log('  service categories: ' + r.categoryCount);
      console.log('  demo providers    : ' + r.providerCount);
      console.log('\n  Demo accounts (password: ' + DEMO_PASSWORD + ')');
      console.log('    admin    : admin@servicesetu.in');
      console.log('    customer : customer@servicesetu.in');
      console.log('    providers: plumber@ / electrician@ / acrepair@ / carpenter@servicesetu.in');
      await pool.end();
    })
    .catch(async (err) => {
      console.error('Seed failed:', err.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
