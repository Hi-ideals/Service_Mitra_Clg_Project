/**
 * Admin reports.
 *
 * Two of them: every service booking, and every payout. Both answer the same
 * question in different currencies - where did the money come from, and where
 * did it go - so both carry totals computed over the whole filtered set rather
 * than the page on screen.
 */
import { money } from '../../utils/helpers.js';
import { maskDestination } from './payout.service.js';
import * as repo from './reports.repository.js';

/** Minor units to a plain rupee number, for JSON and for spreadsheets. */
const rupees = (minor) => money.toMajor(Number(minor ?? 0));

function describeDestination(destination) {
  const masked = maskDestination(destination);
  if (!masked) return '';
  return masked.method === 'upi'
    ? 'UPI ' + masked.upiId
    : masked.accountNumber + ' / ' + masked.ifsc;
}

export async function services(filters, { limit, offset }) {
  const [rows, totals, breakdown] = await Promise.all([
    repo.serviceRows(filters, { limit, offset }),
    repo.serviceTotals(filters),
    repo.serviceBreakdown(filters),
  ]);

  return {
    rows: rows.map((b) => ({
      id: b.id,
      reference: b.reference,
      status: b.status,
      // Every service on the booking. A row showing only the first would
      // misreport what a multi-service visit actually covered, and this feeds
      // the CSV export as well as the table.
      service: b.service_names || b.category_name,
      provider: b.provider_name,
      customer: b.customer_name,
      city: b.address_city,
      state: b.address_state,
      pincode: b.address_pincode,
      bookedAt: b.created_at,
      scheduledFor: b.scheduled_start,
      completedAt: b.completed_at,
      quotedMinor: Number(b.quoted_amount_minor),
      quoted: rupees(b.quoted_amount_minor),
      visitChargeMinor: Number(b.visit_charge_minor ?? 0),
      finalMinor: Number(b.final_amount_minor ?? 0),
      final: rupees(b.final_amount_minor),
      commissionPercent: Number(b.commission_percent),
      commissionMinor: Number(b.commission_amount_minor ?? 0),
      commission: rupees(b.commission_amount_minor),
      providerEarningMinor: Number(b.provider_earning_minor ?? 0),
      providerEarning: rupees(b.provider_earning_minor),
      paymentStatus: b.payment_status,
      paymentMethod: b.payment_method,
      paidAt: b.paid_at,
      rating: b.rating,
      // Whichever reason applies. A report that shows a cancelled booking with
      // no reason forces someone to open the record to learn anything.
      reason: b.cancellation_reason || b.rejection_reason || null,
      cancelledBy: b.cancelled_by,
    })),
    totals: {
      bookings: totals.bookings,
      completed: totals.completed,
      cancelled: totals.cancelled,
      rejected: totals.rejected,
      providers: totals.providers,
      customers: totals.customers,

      // Money actually received. Agrees with the provider ledger and the
      // payout queue, because all three are driven by a settled payment.
      collectedMinor: Number(totals.collected_minor),
      collected: rupees(totals.collected_minor),
      paidCount: totals.paid_count,
      commissionMinor: Number(totals.commission_minor),
      commission: rupees(totals.commission_minor),
      providerEarningMinor: Number(totals.provider_earning_minor),
      providerEarning: rupees(totals.provider_earning_minor),

      // Work delivered, paid or not, and the gap between the two.
      billedMinor: Number(totals.billed_minor),
      billed: rupees(totals.billed_minor),
      awaitingPaymentMinor: Number(totals.awaiting_payment_minor),
      awaitingPayment: rupees(totals.awaiting_payment_minor),
      unpaidCount: totals.unpaid_count,

      averageValue: rupees(totals.average_value_minor),
      // Of everything booked, how much turned into work. The single number an
      // operator actually acts on.
      completionRate: totals.bookings ? Math.round((totals.completed / totals.bookings) * 1000) / 10 : 0,
    },
    byService: breakdown.map((s) => ({
      service: s.category_name,
      bookings: s.bookings,
      completed: s.completed,
      lost: s.lost,
      collectedMinor: Number(s.collected_minor),
      collected: rupees(s.collected_minor),
      commission: rupees(s.commission_minor),
      awaitingPayment: rupees(s.awaiting_payment_minor),
    })),
    total: totals.bookings,
  };
}

export async function payouts(filters, { limit, offset }) {
  const [rows, totals, outstanding] = await Promise.all([
    repo.payoutRows(filters, { limit, offset }),
    repo.payoutTotals(filters),
    repo.outstandingLiability(),
  ]);

  return {
    rows: rows.map((p) => ({
      id: p.id,
      reference: p.reference,
      provider: p.provider_name,
      providerEmail: p.provider_email,
      status: p.status,
      method: p.method,
      amountMinor: Number(p.amount_minor),
      amount: rupees(p.amount_minor),
      jobs: p.jobs,
      // Masked everywhere in reporting: a report is read, filed and forwarded,
      // and none of that needs a full account number.
      destination: describeDestination(p.destination),
      paymentReference: p.payment_reference,
      recordedBy: p.recorded_by,
      preparedAt: p.created_at,
      settledAt: p.processed_at,
      failureReason: p.failure_reason,
    })),
    totals: {
      payouts: totals.payouts,
      providers: totals.providers,
      totalMinor: Number(totals.total_minor),
      total: rupees(totals.total_minor),
      paid: rupees(totals.paid_minor),
      paidCount: totals.paid_count,
      awaiting: rupees(totals.awaiting_minor),
      awaitingCount: totals.awaiting_count,
      failed: rupees(totals.failed_minor),
      failedCount: totals.failed_count,
    },
    outstanding: outstanding.map((o) => ({
      provider: o.provider_name,
      owed: rupees(o.owed_minor),
      owedMinor: Number(o.owed_minor),
      payableNow: rupees(o.payable_now_minor ?? 0),
      nextRelease: o.next_release,
      hasDestination: o.has_destination,
    })),
    outstandingTotal: rupees(outstanding.reduce((sum, o) => sum + Number(o.owed_minor), 0)),
    total: totals.payouts,
  };
}

/**
 * Escapes one CSV cell.
 *
 * A leading =, +, - or @ is prefixed with a quote. Spreadsheets treat those as
 * formulas, and a provider who names their business "=cmd|..." should not get
 * to run anything when an admin opens the export.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';

  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;

  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/** Turns rows into CSV against an explicit column list, so column order is stable. */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];

  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  }

  // CRLF and a UTF-8 BOM: Excel misreads a plain UTF-8 CSV as the local
  // codepage, which turns a rupee sign into mojibake on every line.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export const SERVICE_COLUMNS = [
  { header: 'Booking', value: (r) => r.reference },
  { header: 'Status', value: (r) => r.status },
  { header: 'Service', value: (r) => r.service },
  { header: 'Provider', value: (r) => r.provider },
  { header: 'Customer', value: (r) => r.customer },
  { header: 'City', value: (r) => r.city },
  { header: 'Pincode', value: (r) => r.pincode },
  { header: 'Booked at', value: (r) => r.bookedAt },
  { header: 'Scheduled for', value: (r) => r.scheduledFor },
  { header: 'Completed at', value: (r) => r.completedAt },
  { header: 'Quoted', value: (r) => r.quoted },
  { header: 'Final amount', value: (r) => r.final },
  { header: 'Commission %', value: (r) => r.commissionPercent },
  { header: 'Commission', value: (r) => r.commission },
  { header: 'Provider earning', value: (r) => r.providerEarning },
  { header: 'Payment status', value: (r) => r.paymentStatus },
  { header: 'Paid at', value: (r) => r.paidAt },
  { header: 'Rating', value: (r) => r.rating },
  { header: 'Reason', value: (r) => r.reason },
];

export const PAYOUT_COLUMNS = [
  { header: 'Payout', value: (r) => r.reference },
  { header: 'Provider', value: (r) => r.provider },
  { header: 'Status', value: (r) => r.status },
  { header: 'Method', value: (r) => r.method },
  { header: 'Amount', value: (r) => r.amount },
  { header: 'Jobs', value: (r) => r.jobs },
  { header: 'Sent to', value: (r) => r.destination },
  { header: 'Bank reference', value: (r) => r.paymentReference },
  { header: 'Prepared at', value: (r) => r.preparedAt },
  { header: 'Settled at', value: (r) => r.settledAt },
  { header: 'Recorded by', value: (r) => r.recordedBy },
  { header: 'Failure reason', value: (r) => r.failureReason },
];

export default { services, payouts, toCsv, SERVICE_COLUMNS, PAYOUT_COLUMNS };
