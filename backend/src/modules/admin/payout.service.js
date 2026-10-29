/**
 * Provider payouts.
 *
 * A payout batches every earnings row that has come out of its dispute window
 * and has not been paid yet. The ledger rows are stamped with the payout id in
 * the same transaction that creates it, so a row can never land in two payouts
 * even if the run is triggered twice.
 */
import { withTransaction, queryOne, queryMany } from '../../db/pool.js';
import ApiError from '../../utils/ApiError.js';
import { reference, money } from '../../utils/helpers.js';
import { notifyAsync, notifyAllAsync } from '../../services/notification.service.js';
import { gateway } from '../../services/payment/gateway.js';
import settings from '../../services/settings.service.js';
import env from '../../config/env.js';
import logger from '../../config/logger.js';

/**
 * Where one provider's money should be sent.
 *
 * Returns null when they have not told us - which is the difference between
 * "ready to pay" and "owed but unpayable", and the admin queue has to show
 * that difference rather than silently listing someone who cannot be paid.
 */
export function destinationOf(row) {
  if (row.payout_method === 'upi' && row.payout_upi_id) {
    return { method: 'upi', upiId: row.payout_upi_id, accountName: row.payout_account_name ?? null };
  }

  if (row.payout_method === 'bank' && row.payout_account_number) {
    return {
      method: 'bank',
      accountName: row.payout_account_name,
      accountNumber: row.payout_account_number,
      ifsc: row.payout_ifsc,
      bankName: row.payout_bank_name ?? null,
    };
  }

  return null;
}

/**
 * The same destination with the account number reduced to its last four.
 *
 * Used everywhere the full number is not needed to act - payout history, the
 * provider's own screen. An admin about to make a transfer gets the full
 * thing, because they cannot type what they cannot see.
 */
export function maskDestination(destination) {
  if (!destination) return null;
  if (destination.method === 'upi') return destination;

  const number = String(destination.accountNumber ?? '');
  return {
    ...destination,
    accountNumber: number.length > 4 ? '*'.repeat(number.length - 4) + number.slice(-4) : number,
  };
}

/** Providers with money ready to be released. */
export function eligible(minimumMinor) {
  return queryMany(
    `SELECT e.provider_id,
            COALESCE(p.business_name, u.full_name) AS provider_name,
            p.user_id, p.payout_account_ref,
            p.payout_method, p.payout_upi_id, p.payout_account_name,
            p.payout_account_number, p.payout_ifsc, p.payout_bank_name,
            SUM(e.amount_minor)::bigint AS amount_minor,
            COUNT(DISTINCT e.booking_id)::int AS jobs,
            MIN(e.created_at) AS oldest_entry
       FROM provider_earnings e
       JOIN provider_profiles p ON p.id = e.provider_id
       JOIN users u ON u.id = p.user_id
      WHERE e.payout_id IS NULL
        AND (e.available_at IS NULL OR e.available_at <= NOW())
        AND p.deleted_at IS NULL
      GROUP BY e.provider_id, p.business_name, u.full_name, p.user_id, p.payout_account_ref,
               p.payout_method, p.payout_upi_id, p.payout_account_name,
               p.payout_account_number, p.payout_ifsc, p.payout_bank_name
     HAVING SUM(e.amount_minor) >= $1
      ORDER BY amount_minor DESC`,
    [minimumMinor],
  );
}

/**
 * Every provider who is owed anything, payable or not.
 *
 * `eligible` answers "who can be paid now" and is what the batch run uses.
 * This answers "who is owed money", which is what an admin wants to see: a
 * screen that shows nothing until a dispute window closes looks broken, and
 * gives no warning of what is about to come due.
 *
 * Held and available are summed separately, and the earliest `available_at`
 * still in the future is the moment the held part becomes payable - which is
 * what the countdown on the screen is counting to.
 */
export function balances() {
  return queryMany(
    `SELECT e.provider_id,
            COALESCE(p.business_name, u.full_name) AS provider_name,
            p.user_id, p.payout_account_ref,
            p.payout_method, p.payout_upi_id, p.payout_account_name,
            p.payout_account_number, p.payout_ifsc, p.payout_bank_name,
            SUM(e.amount_minor) FILTER (
              WHERE e.available_at IS NULL OR e.available_at <= NOW()
            )::bigint AS available_minor,
            SUM(e.amount_minor) FILTER (WHERE e.available_at > NOW())::bigint AS held_minor,
            MIN(e.available_at) FILTER (WHERE e.available_at > NOW()) AS next_available_at,
            COUNT(DISTINCT e.booking_id)::int AS jobs,
            MIN(e.created_at) AS oldest_entry
       FROM provider_earnings e
       JOIN provider_profiles p ON p.id = e.provider_id
       JOIN users u ON u.id = p.user_id
      WHERE e.payout_id IS NULL
        AND p.deleted_at IS NULL
      GROUP BY e.provider_id, p.business_name, u.full_name, p.user_id, p.payout_account_ref,
               p.payout_method, p.payout_upi_id, p.payout_account_name,
               p.payout_account_number, p.payout_ifsc, p.payout_bank_name
     HAVING SUM(e.amount_minor) > 0
      ORDER BY SUM(e.amount_minor) DESC`,
  );
}

export async function preview() {
  const config = await settings.get('payout');
  const minimum = Number(config.minimumAmountMinor ?? 0);
  const rows = await balances();

  return {
    policy: {
      schedule: config.schedule,
      minimumAmountMinor: config.minimumAmountMinor,
      minimumAmount: money.toMajor(config.minimumAmountMinor ?? 0),
    },
    mode: env.PAYOUT_MODE,
    providers: rows.map((r) => {
      const destination = destinationOf(r);
      const availableMinor = Number(r.available_minor ?? 0);
      const heldMinor = Number(r.held_minor ?? 0);

      return {
        providerId: r.provider_id,
        providerName: r.provider_name,

        // What could be sent today, and what is still inside a dispute window.
        amountMinor: availableMinor,
        amount: money.toMajor(availableMinor),
        heldMinor,
        held: money.toMajor(heldMinor),
        totalOwedMinor: availableMinor + heldMinor,
        totalOwed: money.toMajor(availableMinor + heldMinor),

        // When the held part becomes payable. Null when nothing is held.
        availableFrom: r.next_available_at,

        jobs: r.jobs,
        oldestEntry: r.oldest_entry,
        // Full details, not masked: this is the screen an admin pays from.
        destination,
        hasPayoutAccount: Boolean(r.payout_account_ref),

        /**
         * Three separate reasons a transfer cannot be prepared, reported
         * separately because they need different things from the admin: chase
         * the provider for a destination, wait for the window, or wait for the
         * balance to reach the minimum.
         */
        canPay: Boolean(destination) && availableMinor >= minimum && availableMinor > 0,
        blockedBy: !destination
          ? 'no_destination'
          : availableMinor <= 0
            ? 'dispute_window'
            : availableMinor < minimum
              ? 'below_minimum'
              : null,
      };
    }),

    // The totals keep the same meaning they had: what can be sent now.
    totalMinor: rows.reduce((sum, r) => sum + Number(r.available_minor ?? 0), 0),
    heldTotalMinor: rows.reduce((sum, r) => sum + Number(r.held_minor ?? 0), 0),
    count: rows.filter((r) => Number(r.available_minor ?? 0) >= minimum && Number(r.available_minor ?? 0) > 0).length,
  };
}

/**
 * Creates and sends one provider's payout.
 *
 * The ledger stamp is what makes this safe to retry: a second run finds no
 * unstamped rows and produces nothing.
 */
export async function payProvider(providerId) {
  const manual = env.PAYOUT_MODE === 'manual';

  const profile = await queryOne(
    `SELECT user_id, payout_account_ref, payout_method, payout_upi_id, payout_account_name,
            payout_account_number, payout_ifsc, payout_bank_name
       FROM provider_profiles WHERE id = $1`,
    [providerId],
  );

  if (!profile) throw ApiError.notFound('Provider not found');

  const destination = destinationOf(profile);

  const result = await withTransaction(async (tx) => {
    // Locked, so a concurrent run cannot claim the same rows.
    const rows = await tx.many(
      `SELECT id, amount_minor FROM provider_earnings
        WHERE provider_id = $1 AND payout_id IS NULL
          AND (available_at IS NULL OR available_at <= NOW())
        FOR UPDATE`,
      [providerId],
    );

    if (!rows.length) {
      throw ApiError.conflict('This provider has no earnings ready to be paid out');
    }

    const amountMinor = rows.reduce((sum, r) => sum + Number(r.amount_minor), 0);

    if (amountMinor <= 0) {
      throw ApiError.conflict('This provider has no positive balance to pay out');
    }

    // Checked here rather than before the transaction so that "nothing to pay"
    // is reported ahead of "nowhere to send it" - a provider who is owed
    // nothing does not need to be chased for bank details. Throwing inside the
    // transaction rolls back the FOR UPDATE, so nothing is claimed either way.
    if (manual && !destination) {
      throw ApiError.conflict(
        'This provider has not added a UPI id or bank account yet, so there is nowhere to send the money.',
      );
    }

    // 'pending' for manual - the money has not moved, it is only owed and
    // claimed. 'processing' for gateway, which is about to send it.
    const payout = await tx.one(
      `INSERT INTO payouts
         (reference, provider_id, amount_minor, status, method, destination,
          period_start, period_end, notes)
       VALUES ($1,$2,$3,$4::payout_status,$5,$6, CURRENT_DATE - 7, CURRENT_DATE, $7)
       RETURNING id, reference, amount_minor, status, method`,
      [
        reference('PO'),
        providerId,
        amountMinor,
        manual ? 'pending' : 'processing',
        manual ? 'manual' : 'gateway',
        destination ? JSON.stringify(destination) : null,
        manual ? 'Awaiting manual transfer' : 'Batch run by admin',
      ],
    );

    await tx.query(
      'UPDATE provider_earnings SET payout_id = $2 WHERE id = ANY($1::uuid[])',
      [rows.map((r) => r.id), payout.id],
    );

    // The balancing debit, so the ledger nets to zero once paid.
    await tx.query(
      `INSERT INTO provider_earnings
         (provider_id, entry_type, amount_minor, description, payout_id, available_at)
       VALUES ($1, 'payout', $2, $3, $4, NOW())`,
      [providerId, -amountMinor, 'Payout ' + payout.reference, payout.id],
    );

    return { payout, entryCount: rows.length };
  });

  // Manual stops here: the record exists, the earnings are claimed, and an
  // admin now moves the money and comes back to mark it paid. Nothing is
  // reported as paid until somebody says it was.
  if (manual) {
    notifyAllAsync({
      userId: profile.user_id,
      eventType: 'payout.scheduled',
      title: 'Your payout is being processed',
      body:
        money.format(result.payout.amount_minor) + ' (' + result.payout.reference +
        ') is being transferred to you. We will confirm once it has been sent.',
      actionLabel: 'View your earnings',
      actionPath: '/provider/earnings',
      entityType: 'payout',
      entityId: result.payout.id,
    });

    return {
      id: result.payout.id,
      reference: result.payout.reference,
      amountMinor: Number(result.payout.amount_minor),
      amount: money.toMajor(result.payout.amount_minor),
      entriesIncluded: result.entryCount,
      status: 'pending',
      method: 'manual',
      destination,
    };
  }

  try {
    const sent = await gateway().payout({
      providerRef: profile.payout_account_ref,
      amountMinor: Number(result.payout.amount_minor),
      reference: result.payout.reference,
    });

    await withTransaction((tx) =>
      tx.query(
        `UPDATE payouts SET status = 'paid', processed_at = NOW(), gateway_payout_id = $2 WHERE id = $1`,
        [result.payout.id, sent.payoutId],
      ),
    );

    notifyAsync({
      userId: profile.user_id,
      eventType: 'payout.sent',
      title: 'Your payout is on its way',
      body:
        money.format(result.payout.amount_minor) + ' has been sent to your account (' +
        result.payout.reference + '). It usually arrives within 2 working days.',
      entityType: 'payout',
      entityId: result.payout.id,
    });

    return {
      id: result.payout.id,
      reference: result.payout.reference,
      amountMinor: Number(result.payout.amount_minor),
      amount: money.toMajor(result.payout.amount_minor),
      entriesIncluded: result.entryCount,
      status: 'paid',
    };
  } catch (err) {
    // The batch stays claimed and the payout is marked failed rather than
    // silently unwinding, so an operator sees exactly one thing to retry.
    logger.error({ err, payoutId: result.payout.id }, 'Payout failed at the gateway');

    await withTransaction((tx) =>
      tx.query('UPDATE payouts SET status = $2, failure_reason = $3 WHERE id = $1',
        [result.payout.id, 'failed', err.message]),
    );

    throw ApiError.internal('The payout could not be sent. It is recorded as failed for retry.');
  }
}

/** One payout with everything an admin needs to act on it. */
async function loadPayout(payoutId) {
  const row = await queryOne(
    `SELECT po.*, COALESCE(p.business_name, u.full_name) AS provider_name, p.user_id
       FROM payouts po
       JOIN provider_profiles p ON p.id = po.provider_id
       JOIN users u ON u.id = p.user_id
      WHERE po.id = $1`,
    [payoutId],
  );

  if (!row) throw ApiError.notFound('Payout not found');
  return row;
}

/**
 * Records that an admin has transferred the money by hand.
 *
 * The bank reference is required, not decorative: it is the only evidence the
 * platform holds that the transfer happened, and the only thing anyone can
 * trace if the provider says it never arrived.
 */
export async function markPaid(payoutId, adminId, { paymentReference, notes }) {
  const payout = await loadPayout(payoutId);

  if (payout.status === 'paid') {
    throw ApiError.conflict('This payout is already marked as paid.');
  }
  if (payout.method !== 'manual') {
    throw ApiError.conflict('This payout was sent through the gateway and cannot be marked by hand.');
  }
  if (payout.status !== 'pending') {
    throw ApiError.conflict('A ' + payout.status + ' payout cannot be marked as paid.');
  }

  const updated = await queryOne(
    `UPDATE payouts
        SET status = 'paid', processed_at = NOW(), paid_by = $2,
            payment_reference = $3, failure_reason = NULL,
            notes = COALESCE($4, notes)
      WHERE id = $1
      RETURNING id, reference, amount_minor, processed_at, payment_reference`,
    [payoutId, adminId, paymentReference, notes ?? null],
  );

  notifyAllAsync({
    userId: payout.user_id,
    eventType: 'payout.sent',
    title: 'Your payout has been sent',
    body:
      money.format(updated.amount_minor) + ' has been transferred to you (' + updated.reference +
      '). Bank reference: ' + updated.payment_reference +
      '. It usually arrives within 2 working days.',
    actionLabel: 'View your earnings',
    actionPath: '/provider/earnings',
    entityType: 'payout',
    entityId: payoutId,
  });

  return {
    id: updated.id,
    reference: updated.reference,
    amountMinor: Number(updated.amount_minor),
    amount: money.toMajor(updated.amount_minor),
    status: 'paid',
    paymentReference: updated.payment_reference,
    processedAt: updated.processed_at,
  };
}

/**
 * Records that the transfer did not go through, and gives the money back.
 *
 * The earnings are released from the payout rather than left claimed. A failed
 * transfer means the provider is still owed, and money that stays stamped to a
 * dead payout is money that silently never gets paid again.
 */
export async function markFailed(payoutId, adminId, { reason }) {
  const payout = await loadPayout(payoutId);

  if (payout.status === 'paid') {
    throw ApiError.conflict('This payout is already paid. Reverse it with a refund, not a failure.');
  }
  if (payout.method !== 'manual') {
    throw ApiError.conflict('This payout was sent through the gateway and cannot be marked by hand.');
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE payouts SET status = 'failed', failure_reason = $2, paid_by = $3 WHERE id = $1`,
      [payoutId, reason, adminId],
    );

    // The balancing debit goes first: it only exists to net off a payout that
    // happened, and this one did not.
    await tx.query(
      `DELETE FROM provider_earnings WHERE payout_id = $1 AND entry_type = 'payout'`,
      [payoutId],
    );

    await tx.query(
      'UPDATE provider_earnings SET payout_id = NULL WHERE payout_id = $1',
      [payoutId],
    );
  });

  notifyAllAsync({
    userId: payout.user_id,
    eventType: 'payout.failed',
    title: 'Your payout could not be sent',
    body:
      money.format(payout.amount_minor) + ' (' + payout.reference + ') could not be transferred. ' +
      reason + ' Your balance is unchanged and we will try again - check your payout details are correct.',
    actionLabel: 'Check your payout details',
    actionPath: '/provider/earnings',
    entityType: 'payout',
    entityId: payoutId,
  });

  return { id: payoutId, reference: payout.reference, status: 'failed', releasedToBalance: true };
}

/** Pays everyone eligible, reporting per-provider outcomes rather than failing the run. */
export async function runBatch() {
  const { providers } = await preview();
  const results = [];

  for (const provider of providers) {
    try {
      const paid = await payProvider(provider.providerId);
      results.push({ providerId: provider.providerId, providerName: provider.providerName, ...paid });
    } catch (err) {
      results.push({
        providerId: provider.providerId,
        providerName: provider.providerName,
        status: 'failed',
        error: err.message,
      });
    }
  }

  // In manual mode a successful run produces payouts that are *owed*, not
  // sent. Counting those as paid would report money out of the door that is
  // still sitting in the platform's account.
  const succeeded = results.filter((r) => r.status === 'paid' || r.status === 'pending');

  return {
    mode: env.PAYOUT_MODE,
    attempted: results.length,
    prepared: succeeded.length,
    paid: results.filter((r) => r.status === 'paid').length,
    awaitingTransfer: results.filter((r) => r.status === 'pending').length,
    failed: results.length - succeeded.length,
    totalMinor: succeeded.reduce((sum, r) => sum + (r.amountMinor ?? 0), 0),
    results,
  };
}

export async function listPayouts({ providerId, status, limit, offset }) {
  const where = [];
  const params = [];
  const push = (v) => {
    params.push(v);
    return '$' + params.length;
  };

  if (providerId) where.push(`po.provider_id = ${push(providerId)}`);
  if (status) where.push(`po.status = ${push(status)}::payout_status`);
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const totalRow = await queryOne(`SELECT COUNT(*)::int AS total FROM payouts po ${clause}`, params);

  params.push(limit, offset);
  const items = await queryMany(
    `SELECT po.id, po.reference, po.status, po.amount_minor, po.processed_at,
            po.failure_reason, po.created_at, po.method, po.payment_reference,
            po.destination, po.paid_by,
            COALESCE(p.business_name, u.full_name) AS provider_name
       FROM payouts po
       JOIN provider_profiles p ON p.id = po.provider_id
       JOIN users u ON u.id = p.user_id
       ${clause}
       ORDER BY po.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    items: items.map((p) => ({
      id: p.id,
      reference: p.reference,
      providerName: p.provider_name,
      status: p.status,
      amountMinor: Number(p.amount_minor),
      amount: money.toMajor(p.amount_minor),
      processedAt: p.processed_at,
      failureReason: p.failure_reason,
      createdAt: p.created_at,
      method: p.method,
      paymentReference: p.payment_reference,
      // Masked once the payout is settled, full while it is still waiting to
      // be sent. An admin cannot type an account number they cannot see, and
      // a finished payout does not need one to be readable over a shoulder.
      destination:
        p.status === 'pending' ? p.destination : maskDestination(p.destination),
    })),
    total: totalRow.total,
  };
}

/**
 * The export of a payout history.
 *
 * The bank reference is the point of it: that column is the only evidence tying
 * a row here to money that actually moved, and it is what an accountant
 * reconciles against a statement.
 */
export const PAYOUT_HISTORY_COLUMNS = [
  { header: 'Reference', value: (p) => p.reference },
  { header: 'Provider', value: (p) => p.providerName },
  { header: 'Status', value: (p) => p.status },
  { header: 'Amount', value: (p) => p.amount },
  { header: 'Method', value: (p) => p.method ?? '' },
  { header: 'Bank reference', value: (p) => p.paymentReference ?? '' },
  { header: 'Prepared', value: (p) => (p.createdAt ? new Date(p.createdAt).toISOString() : '') },
  { header: 'Settled', value: (p) => (p.processedAt ? new Date(p.processedAt).toISOString() : '') },
  { header: 'Failure reason', value: (p) => p.failureReason ?? '' },
];

export default {
  preview, payProvider, runBatch, listPayouts, eligible, balances, PAYOUT_HISTORY_COLUMNS,
  markPaid, markFailed, destinationOf, maskDestination,
};
