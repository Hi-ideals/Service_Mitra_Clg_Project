import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Receipt, ChevronLeft, Printer, FileText } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { money, formatDate, formatDateTime } from '../../lib/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

export function InvoiceList() {
  const { data, isLoading } = useQuery({
    queryKey: keys.invoices.list({}),
    queryFn: () => api.get('/invoices', { params: { limit: 20 } }),
  });

  if (isLoading) return <PageLoader />;

  const invoices = data?.data ?? [];

  return (
    <div className="page max-w-3xl py-5 sm:py-7">
      <PageHeader icon={FileText} title="Invoices" />

      {invoices.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoices yet"
          description="An invoice is generated once you pay for a completed job."
          className="mt-4"
        />
      ) : (
        <div className="mt-5 space-y-3">
          {invoices.map((invoice) => (
            <Card key={invoice.id} interactive>
              <Link to={'/invoices/' + invoice.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900">{invoice.invoiceNumber}</p>
                  <p className="mt-0.5 truncate text-sm text-ink-500">
                    {invoice.booking.category} · {formatDate(invoice.issuedAt)}
                  </p>
                </div>
                <p className="shrink-0 text-lg font-semibold text-ink-900">
                  {money(invoice.totals.total)}
                </p>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function InvoiceDetail() {
  const { id } = useParams();

  const { data: invoice, isLoading } = useQuery({
    queryKey: keys.invoices.detail(id),
    queryFn: async () => (await api.get('/invoices/' + id)).data,
  });

  if (isLoading) return <PageLoader />;
  if (!invoice) return null;

  return (
    <div className="page max-w-2xl py-5 sm:py-7">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Button as={Link} to="/invoices" variant="ghost" size="sm" icon={ChevronLeft}>
          All invoices
        </Button>
        <Button variant="secondary" size="sm" icon={Printer} onClick={() => window.print()}>
          Print
        </Button>
      </div>

      {/*
        A printed invoice loses the site header, which is where the branding
        lived. A document that does not say who issued it is not much of a
        document, so print gets its own letterhead.
      */}
      <div className="hidden print:mb-6 print:block">
        <div className="flex items-baseline justify-between border-b border-ink-300 pb-3">
          <span className="text-xl font-bold text-ink-900">
            Service<span className="text-accent-600">Mitra</span>
          </span>
          <span className="text-sm text-ink-500">Bidar, Karnataka</span>
        </div>
      </div>

      <Card className="printable mt-3 print:mt-0 print:border-ink-300">
        <CardHeader
          title={invoice.invoiceNumber}
          subtitle={'Issued ' + formatDate(invoice.issuedAt)}
        />

        <CardBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-ink-500">Billed to</p>
              <p className="mt-1 font-medium text-ink-900">{invoice.customer.name}</p>
              {invoice.customer.phone && <p className="text-sm text-ink-500">{invoice.customer.phone}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-sm font-medium text-ink-500">Service by</p>
              <p className="mt-1 font-medium text-ink-900">{invoice.provider.name}</p>
            </div>
          </div>

          <div className="panel-tint rounded-field p-3 text-sm">
            <p className="font-medium text-ink-700">{invoice.booking.category}</p>
            <p className="mt-0.5 text-ink-500">
              Booking {invoice.booking.reference} · {formatDateTime(invoice.booking.scheduledStart)}
            </p>
            {invoice.booking.address && (
              <p className="mt-0.5 text-ink-500">
                {invoice.booking.address.line}, {invoice.booking.address.city} {invoice.booking.address.pincode}
              </p>
            )}
          </div>

          <table className="w-full text-base">
            <caption className="sr-only">Invoice line items</caption>
            <tbody className="divide-y divide-ink-200">
              {invoice.lineItems.map((item, index) => (
                <tr key={index}>
                  <td className="py-2 text-ink-700">{item.description}</td>
                  <td className="py-2 text-right font-medium text-ink-900">{money(item.amount)}</td>
                </tr>
              ))}

              {invoice.totals.taxMinor > 0 && (
                <tr>
                  <td className="py-2 text-ink-500">Tax</td>
                  <td className="py-2 text-right text-ink-700">{money(invoice.totals.taxMinor / 100)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-300">
                <td className="pt-3 font-semibold text-ink-900">Total paid</td>
                <td className="figure pt-3 text-right text-2xl">
                  {money(invoice.totals.total)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Print-only: a paper invoice has no URL bar to show provenance. */}
          <p className="hidden pt-2 text-xs text-ink-400 print:block">
            This is a computer-generated invoice for a service booked through ServiceMitra.
            Booking reference {invoice.booking.reference}.
          </p>

          {invoice.settlement && (
            <div className="panel-tint rounded-field p-3 text-sm">
              <p className="font-medium text-ink-700">Your settlement</p>
              <div className="mt-1.5 flex justify-between text-ink-600">
                <span>Platform commission</span>
                <span>-{money(invoice.settlement.commission)}</span>
              </div>
              <div className="mt-1 flex justify-between font-semibold text-ink-900">
                <span>You earn</span>
                <span>{money(invoice.settlement.providerEarning)}</span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default InvoiceList;
