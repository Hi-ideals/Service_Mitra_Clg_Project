/**
 * Clears the service catalogue so the admin can build it from scratch.
 *
 *   node src/db/clear-categories.js           # shows what would happen
 *   node src/db/clear-categories.js --apply   # does it
 *
 * Follows the same rule as the admin screen's delete button. A category no
 * provider offers and no booking used is deleted. One with history cannot be -
 * a booking's invoice still has to say what was booked - so it is switched off
 * instead: gone from the site and from new bookings, kept in the records.
 *
 * Subcategories go first, because a parent cannot be removed while it still
 * has children. Everything runs in one transaction, so a failure part way
 * leaves the catalogue exactly as it was.
 */
import { pathToFileURL } from 'node:url';
import { pool, withTransaction } from './pool.js';

export async function clearCategories({ apply = false } = {}) {
  return withTransaction(async (tx) => {
    const rows = await tx.many(
      `SELECT c.id, c.name, c.parent_id,
              (SELECT COUNT(*)::int FROM provider_categories WHERE category_id = c.id) AS providers,
              (SELECT COUNT(*)::int FROM bookings WHERE category_id = c.id) AS bookings
         FROM service_categories c
        WHERE c.deleted_at IS NULL
        ORDER BY (c.parent_id IS NULL), c.name`,
    );

    const removed = [];
    const deactivated = [];
    const keptParents = new Set();

    for (const row of rows) {
      const inUse = row.providers > 0 || row.bookings > 0 || keptParents.has(row.id);

      if (inUse) {
        deactivated.push(row);
        // A parent whose child survives must survive too, or the child would
        // point at a deleted row.
        if (row.parent_id) keptParents.add(row.parent_id);
        if (apply) {
          await tx.query('UPDATE service_categories SET is_active = FALSE WHERE id = $1', [row.id]);
        }
      } else {
        removed.push(row);
        if (apply) {
          await tx.query(
            `UPDATE service_categories
                SET deleted_at = NOW(), is_active = FALSE,
                    slug = slug || '--deleted-' || replace(id::text, '-', '')
              WHERE id = $1`,
            [row.id],
          );
        }
      }
    }

    return { removed, deactivated };
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes('--apply');

  clearCategories({ apply })
    .then(async ({ removed, deactivated }) => {
      console.log(apply ? '\n  Catalogue cleared' : '\n  Dry run - nothing was changed');
      console.log('  ------------------------------------------');
      console.log('  ' + (apply ? 'deleted' : 'would delete') + '     : ' + removed.length);
      console.log('  ' + (apply ? 'switched off' : 'would switch off') + ': ' + deactivated.length);
      for (const row of deactivated) {
        console.log(
          '    - ' + row.name + ' (' + row.providers + ' provider link(s), ' + row.bookings +
            ' booking(s))',
        );
      }
      if (!apply) console.log('\n  Run again with --apply to make these changes.');
      await pool.end();
    })
    .catch(async (err) => {
      console.error('Clearing categories failed:', err.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
