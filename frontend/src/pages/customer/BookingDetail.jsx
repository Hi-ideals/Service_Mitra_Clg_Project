import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Phone, MapPin, Receipt, Star, XCircle, CreditCard,
} from 'lucide-react';
import { api, openStream } from '../../lib/api.js';
import { openCheckout } from '../../lib/razorpay.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import BookingStatusTimeline from '../../components/BookingStatusTimeline.jsx';
import ReviewDialog from './ReviewDialog.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Badge, { BOOKING_STATUS_VARIANT } from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Alert from '../../components/ui/Alert.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { money, formatDateTime } from '../../lib/format.js';
import DisputePanel from '../../components/booking/DisputePanel.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

export default function BookingDetail() {
  useDocumentTitle('Booking detail');
  const { id } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);

  const { user } = useAuth();

  const { data: booking, isLoading } = useQuery({
    queryKey: keys.bookings.detail(id),
    queryFn: async () => (await api.get('/bookings/' + id)).data,
  });

  const { data: tracking } = useQuery({
    queryKey: keys.bookings.tracking(id),
    queryFn: async () => (await api.get('/bookings/' + id + '/tracking')).data,
    enabled: Boolean(booking),
  });

  const { data: payment } = useQuery({
    queryKey: keys.payments.forBooking(id),
    queryFn: async () => (await api.get('/payments/bookings/' + id)).data,
    enabled: Boolean(booking),
  });

  /**
   * Live updates while the job is active.
   *
   * The stream is only opened for a live booking - holding a connection open
   * on a booking that finished last week costs both sides for nothing.
   */
  useEffect(() => {
    if (!booking?.isLive) return undefined;

    const close = openStream('/bookings/' + id + '/stream', {
      onEvent: (type) => {
        if (type === 'connected') return;
        queryClient.invalidateQueries({ queryKey: keys.bookings.detail(id) });
        queryClient.invalidateQueries({ queryKey: keys.bookings.tracking(id) });
        if (type === 'booking.completed') {
          queryClient.invalidateQueries({ queryKey: keys.payments.forBooking(id) });
          toast.success('The job has been marked complete');
        }
      },
    });

    return close;
  }, [booking?.isLive, id, queryClient, toast]);

  const cancel = useMutation({
    mutationFn: (reason) => api.post('/bookings/' + id + '/cancel', { reason }),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setCancelOpen(false);
      /**
       * No mention of a fee, in either direction.
       *
       * The quote names a percentage the platform does not collect: nothing
       * charges it and no refund is issued against it. Telling a customer they
       * have been charged when they have not is worse than saying nothing, and
       * "at no charge" implies a charge was possible.
       */
      toast.success('Booking cancelled');
    },
    onError: (error) => toast.error(error.message),
  });

  /**
   * Pay.
   *
   * Three steps, and the browser is the messenger in all of them: our API
   * creates the order, Razorpay collects the card details on its own window,
   * and our API verifies the result against the gateway before anything is
   * marked paid. Card numbers never touch ServiceMitra.
   */
  const startPayment = useMutation({
    mutationFn: async () => {
      const { data: order } = await api.post('/payments/orders', { bookingId: id });

      /**
       * The gateway was already holding this payment.
       *
       * It happens when the money moved but nothing told us - the tab closed
       * on the success screen, or the webhook never arrived. The API notices
       * when it reopens the order, settles it, and sends this back instead of
       * a checkout. Reopening the gateway here would only produce "the order
       * is already paid", which is what the customer saw before.
       */
      if (order.alreadySettled) {
        return { alreadySettled: true };
      }

      // The mock driver has no checkout window; the webhook settles it.
      if (!order.checkout?.orderId) {
        return { mocked: true };
      }

      const handshake = await openCheckout({ checkout: order.checkout, customer: user });

      return api.post('/payments/verify', { bookingId: id, ...handshake });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: keys.payments.forBooking(id) });
      queryClient.invalidateQueries({ queryKey: keys.bookings.detail(id) });

      if (result?.alreadySettled) {
        toast.success('That payment had already gone through. Your invoice is ready.');
      } else if (result?.mocked) {
        toast.info('Payment order created. Complete it in the gateway checkout.');
      } else {
        toast.success('Payment received. Your invoice is ready.');
      }
    },
    onError: (error) => {
      // Closing the window is a decision, not a failure.
      if (error.dismissed) return;
      toast.error(error.message);
    },
  });

  if (isLoading) return <PageLoader label="Loading your booking" />;
  if (!booking) return null;

  const canCancel = booking.availableActions.some((a) => a.to === 'cancelled');
  const canReview = booking.status === 'completed';
  const owes = booking.status === 'completed' && payment && !payment.isPaid;

  return (
    <div className="page max-w-4xl py-5 sm:py-7">
      <Button as={Link} to="/bookings" variant="ghost" size="sm" icon={ChevronLeft} className="mb-3">
        All bookings
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink-900">
            {booking.category.name}
            {(booking.services?.length ?? 1) > 1 && (
              <span className="font-normal text-ink-500">
                {' '}+{booking.services.length - 1} more
              </span>
            )}
          </h1>
          <p className="mt-1 font-mono text-sm text-ink-400">{booking.reference}</p>
        </div>
        <Badge variant={BOOKING_STATUS_VARIANT[booking.status]} dot>
          {booking.statusLabel}
        </Badge>
      </div>

      {owes && (
        <Alert
          variant="warning"
          title="Payment due"
          className="mt-4"
          action={
            <Button size="sm" icon={CreditCard} loading={startPayment.isPending} onClick={() => startPayment.mutate()}>
              Pay {money(booking.pricing.final)}
            </Button>
          }
        >
          The job is complete. Settle the bill to close it off.
        </Alert>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Progress"
              subtitle={booking.isLive ? 'Updates appear here automatically.' : undefined}
            />
            <CardBody>
              {tracking && (
                <BookingStatusTimeline steps={tracking.steps} branchedTo={tracking.branchedTo} />
              )}

              {booking.cancellation && (
                <div className="mt-4 panel-tint rounded-field p-3">
                  <p className="text-sm font-medium text-ink-700">
                    Cancelled by the {booking.cancellation.by}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-500">{booking.cancellation.reason}</p>
                </div>
              )}

              {booking.rejectionReason && (
                <div className="mt-4 panel-tint rounded-field p-3">
                  <p className="text-sm font-medium text-ink-700">Reason given</p>
                  <p className="mt-0.5 text-sm text-ink-500">{booking.rejectionReason}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="The professional" />
            <CardBody>
              <div className="flex items-center gap-3">
                <Avatar src={booking.provider.avatarUrl} name={booking.provider.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <Link
                    to={'/providers/' + booking.provider.id}
                    className="font-semibold text-ink-900 hover:text-brand-700"
                  >
                    {booking.provider.name}
                  </Link>
                  {booking.provider.phone ? (
                    <a
                      href={'tel:' + booking.provider.phone}
                      className="mt-1 flex items-center gap-1.5 text-base text-brand-600 hover:text-brand-700"
                    >
                      <Phone aria-hidden="true" className="h-4 w-4" />
                      {booking.provider.phone}
                    </a>
                  ) : (
                    <p className="mt-1 text-sm text-ink-500">
                      Their phone number appears once they accept.
                    </p>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" />
            <CardBody>
              <ul className="space-y-3">
                {booking.history.map((entry, index) => (
                  <li key={index} className="flex gap-3 text-base">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-300" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-ink-800">
                        <span className="font-medium capitalize">{entry.label}</span>
                        <span className="text-ink-500"> · by the {entry.actorType}</span>
                      </p>
                      {entry.reason && <p className="mt-0.5 text-sm text-ink-500">{entry.reason}</p>}
                      <p className="mt-0.5 text-xs text-ink-400">{formatDateTime(entry.at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-3 text-base">
              <div>
                <p className="text-sm text-ink-500">When</p>
                <p className="mt-0.5 font-medium text-ink-900">
                  {formatDateTime(booking.schedule.start)}
                </p>
              </div>

              <div>
                <p className="text-sm text-ink-500">Where</p>
                <p className="mt-0.5 flex gap-1.5 font-medium text-ink-900">
                  <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <span>
                    {booking.address.line}
                    <br />
                    {booking.address.city} {booking.address.pincode}
                  </span>
                </p>
              </div>

              {booking.description && (
                <div>
                  <p className="text-sm text-ink-500">What you described</p>
                  <p className="mt-0.5 text-ink-700">{booking.description}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payment" />
            <CardBody className="space-y-2 text-base">
              {/* The quote is a total made of parts, so the parts are shown.
                  A customer querying a bill should not have to ask what the
                  figure was made of. */}
              {(booking.services?.length ?? 0) > 1 && (
                <div className="space-y-1.5 border-b border-ink-200 pb-2 text-sm">
                  {booking.services.map((item) => (
                    <div key={item.id} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate text-ink-600">{item.name}</span>
                      <span className="shrink-0 tabular-nums text-ink-700">{money(item.price)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-ink-500">Quoted</span>
                <span className="font-medium text-ink-900">{money(booking.pricing.quoted)}</span>
              </div>

              {booking.pricing.final !== null && booking.pricing.final !== undefined && (
                <div className="flex justify-between border-t border-ink-200 pt-2">
                  <span className="font-medium text-ink-700">Final amount</span>
                  <span className="text-lg font-semibold text-ink-900">{money(booking.pricing.final)}</span>
                </div>
              )}

              {payment?.isPaid && (
                <Badge variant="success" size="sm" className="mt-1">Paid</Badge>
              )}

              {payment?.refunds?.length > 0 && (
                <div className="border-t border-ink-200 pt-2">
                  {payment.refunds.map((refund) => (
                    <div key={refund.id} className="flex justify-between text-sm">
                      <span className="text-ink-500">Refunded</span>
                      <span className="font-medium text-success-700">{money(refund.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {payment?.invoiceId && (
                <Button
                  as={Link}
                  to={'/invoices/' + payment.invoiceId}
                  variant="secondary"
                  size="sm"
                  icon={Receipt}
                  fullWidth
                  className="mt-2"
                >
                  View invoice
                </Button>
              )}
            </CardBody>
          </Card>

          {(canReview || canCancel) && (
            <Card>
              <CardBody className="space-y-2">
                {canReview && (
                  <Button icon={Star} fullWidth onClick={() => setReviewOpen(true)}>
                    Rate this professional
                  </Button>
                )}

                {canCancel && (
                  <>
                    <Button
                      variant="secondary"
                      icon={XCircle}
                      fullWidth
                      onClick={() => setCancelOpen(true)}
                    >
                      Cancel booking
                    </Button>
                  </>
                )}
              </CardBody>
            </Card>
          )}

          {/* Raising a problem, and the whole exchange once one exists. Replaces
              a sentence that told customers they could report something and
              then gave them no way to do it. */}
          <DisputePanel booking={booking} viewer="customer" onChanged={() => queryClient.invalidateQueries({ queryKey: keys.bookings.detail(id) })} />
        </div>
      </div>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this booking?"
        description="The professional will be told you have cancelled."
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCancelOpen(false)} className="flex-1">
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              disabled={cancelReason.trim().length < 5}
              onClick={() => cancel.mutate(cancelReason)}
              className="flex-1"
            >
              Cancel booking
            </Button>
          </div>
        }
      >
        <Textarea
          label="Why are you cancelling?"
          rows={3}
          maxLength={300}
          required
          placeholder="Let the professional know so they can plan their day."
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          hint="At least 5 characters."
        />
      </Modal>

      {reviewOpen && (
        <ReviewDialog open={reviewOpen} onClose={() => setReviewOpen(false)} booking={booking} />
      )}
    </div>
  );
}
