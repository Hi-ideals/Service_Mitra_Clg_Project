/**
 * Invoice reads and rendering.
 *
 * Invoices are generated as part of payment settlement, not here - this module
 * only presents them. A downloadable PDF is produced by a background worker in
 * Phase 12; until then the API serves the structured data a client can render.
 */
import ApiError from '../../utils/ApiError.js';
import { money } from '../../utils/helpers.js';
import * as repo from './payment.repository.js';

function present(i) {
  const lineItems = Array.isArray(i.line_items) ? i.line_items : [];

  return {
    id: i.id,
    invoiceNumber: i.invoice_number,
    issuedAt: i.issued_at,
    booking: {
      id: i.booking_id,
      reference: i.booking_reference,
      // Names every service on the visit; falls back to the headline category
      // for invoices raised before bookings could carry more than one.
      category: i.service_names || i.category_name,
      scheduledStart: i.scheduled_start,
      address: i.address_line
        ? {
            line: i.address_line,
            city: i.address_city,
            state: i.address_state,
            pincode: i.address_pincode,
          }
        : undefined,
    },
    customer: {
      id: i.customer_id,
      name: i.customer_name,
      email: i.customer_email,
      phone: i.customer_phone,
    },
    provider: {
      id: i.provider_id,
      name: i.provider_business_name || i.provider_name,
    },
    lineItems: lineItems.map((l) => ({
      description: l.description,
      amountMinor: l.amountMinor,
      amount: money.toMajor(l.amountMinor),
    })),
    totals: {
      serviceMinor: Number(i.service_amount_minor),
      visitChargeMinor: Number(i.visit_charge_minor),
      taxMinor: Number(i.tax_amount_minor),
      discountMinor: Number(i.discount_minor),
      totalMinor: Number(i.total_amount_minor),
      total: money.toMajor(i.total_amount_minor),
    },
    pdfAvailable: Boolean(i.pdf_storage_key),
  };
}

/**
 * A customer sees what they paid. A provider sees the same invoice plus the
 * commission split, because it is their earning statement too.
 */
function presentForRole(invoice, role) {
  const base = present(invoice);
  if (role === 'customer') return base;

  return {
    ...base,
    settlement: {
      commissionMinor: Number(invoice.commission_minor),
      commission: money.toMajor(invoice.commission_minor),
      providerEarningMinor: Number(invoice.provider_earning_minor),
      providerEarning: money.toMajor(invoice.provider_earning_minor),
    },
  };
}

export async function listInvoices(actor, { limit, offset }) {
  const scope =
    actor.type === 'customer'
      ? { customerId: actor.id }
      : actor.type === 'provider'
        ? { providerId: actor.providerId }
        : {};

  const { items, total } = await repo.listInvoices({ ...scope, limit, offset });
  return { items: items.map((i) => presentForRole(i, actor.type)), total };
}

export async function getInvoice(invoiceId, actor) {
  const invoice = await repo.findInvoice(invoiceId);
  if (!invoice) throw ApiError.notFound('Invoice not found');

  const allowed =
    actor.type === 'admin' ||
    (actor.type === 'customer' && invoice.customer_id === actor.id) ||
    (actor.type === 'provider' && invoice.provider_id === actor.providerId);

  if (!allowed) throw ApiError.forbidden('You do not have access to this invoice');

  return presentForRole(invoice, actor.type);
}

export default { listInvoices, getInvoice };
