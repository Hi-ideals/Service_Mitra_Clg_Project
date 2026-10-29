import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Phone, MapPin, Check, X, Play, KeyRound, Navigation, CheckCircle2,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import BookingStatusTimeline from '../../components/BookingStatusTimeline.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Badge, { BOOKING_STATUS_VARIANT } from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Input from '../../components/ui/Input.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Alert from '../../components/ui/Alert.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { money, formatDateTime, timeAgo, duration } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import DisputePanel from '../../components/booking/DisputePanel.jsx';

/**
 * The states where a payment can exist at all.
 *
 * Mirrors the server's own rule: a customer may settle as soon as the job is
 * accepted, so paid is not only an after-completion answer.
 */
const PAYABLE = ['accepted', 'in_progress', 'completed'];

export default function JobDetail() {
  useDocumentTitle('Job detail');
  const { id } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [otp, setOtp] = useState('');
  const [finalAmount, setFinalAmount] = useState('');

  const [codeSent, setCodeSent] = useState(false);

  const { data: booking, isLoading } = useQuery({
    queryKey: keys.bookings.detail(id),
    queryFn: async () => (await api.get('/bookings/' + id)).data,
  });

  /**
   * What the customer actually agreed to pay: the quoted services plus the
   * visit charge. `pricing.quoted` is the services alone, so showing it here
   * invited the provider to type a figure the server then refused for being
   * below the quote.
   */
  const agreedTotal =
    (booking?.pricing?.quoted ?? 0) + ((booking?.pricing?.visitChargeMinor ?? 0) / 100);

  const { data: tracking } = useQuery({
    queryKey: keys.bookings.tracking(id),
    queryFn: async () => (await api.get('/bookings/' + id + '/tracking')).data,
    enabled: Boolean(booking),
  });

  /**
   * Whether the customer has actually paid.
   *
   * The booking carries no payment status of its own - `pricing` is a
   * calculation, and it reads identically whether the money arrived or never
   * will. Without this the earnings card tells a provider who has just
   * finished a job that they have earned something, with nothing anywhere on
   * the screen to say it is still unpaid.
   *
   * Only asked for once there is something to pay. The API refuses to open an
   * order on a booking that is still requested, rejected or cancelled, so
   * asking then would be a guaranteed empty answer.
   */
  const { data: payment } = useQuery({
    queryKey: keys.payments.forBooking(id),
    queryFn: async () => (await api.get('/payments/bookings/' + id)).data,
    enabled: Boolean(booking) && PAYABLE.includes(booking.status),
    /**
     * Settlement does not announce itself on the booking stream, so nothing
     * pushes this. A provider who has just handed the phone back would
     * otherwise have to reload to see the payment land. Polled only while it
     * is still unpaid, which is the only window where the answer can change.
     */
    refetchInterval: (query) => (query.state.data?.isPaid ? false : 30_000),
  });

  // A booking can carry an abandoned order or two alongside the real one, so
  // the time comes from the attempt that actually succeeded.
  const paidAt = payment?.payments?.find((p) => p.status === 'paid')?.paidAt ?? null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
    queryClient.invalidateQueries({ queryKey: keys.providers.me });
  };

  const act = (path, body) => api.post('/bookings/' + id + path, body ?? {});

  const accept = useMutation({
    mutationFn: () => act('/accept'),
    onSuccess: () => {
      refresh();
      toast.success('Accepted. The customer has your contact details now.');
    },
    onError: (e) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: (reason) => act('/reject', { reason }),
    onSuccess: () => {
      refresh();
      setRejectOpen(false);
      toast.success('Declined. The customer can book someone else.');
    },
    onError: (e) => toast.error(e.message),
  });

  const start = useMutation({
    mutationFn: () => act('/start'),
    onSuccess: () => {
      refresh();
      toast.success('Job started');
    },
    onError: (e) => toast.error(e.message),
  });

  const requestCode = useMutation({
    mutationFn: () =>
      act('/completion-code', finalAmount ? { finalAmountMinor: Math.round(Number(finalAmount) * 100) } : {}),
    onSuccess: ({ data }) => {
      setCodeSent(true);
      // Only present when no mail server is configured and nothing was really
      // sent. With email live the provider must ask the customer for it, which
      // is the entire point of the code.
      if (data.devCode) setOtp(data.devCode);
      toast.success('Code emailed to the customer');
    },
    onError: (e) => toast.error(e.message),
  });

  const complete = useMutation({
    mutationFn: () =>
      act('/complete', {
        otp,
        finalAmountMinor: finalAmount ? Math.round(Number(finalAmount) * 100) : undefined,
      }),
    onSuccess: () => {
      refresh();
      setCompleteOpen(false);
      toast.success('Job completed. Your earning is on its way.');
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <PageLoader label="Loading the job" />;
  if (!booking) return null;

  const can = (to) => booking.availableActions.some((a) => a.to === to);
  const mapsHref =
    'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent(booking.address.line + ', ' + booking.address.city + ' ' + booking.address.pincode);

  return (
    <div className="page max-w-4xl py-5 sm:py-7">
      <Button as={Link} to="/provider/requests" variant="ghost" size="sm" icon={ChevronLeft} className="mb-3">
        All jobs
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

      {booking.status === 'requested' && booking.schedule.respondBy && (
        <Alert variant="warning" title="Respond soon" className="mt-4">
          This request expires {timeAgo(booking.schedule.respondBy)}. Unanswered requests are
          cancelled automatically and count against your acceptance rate.
        </Alert>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="The job" />
            <CardBody className="space-y-3 text-base">
              {/* What the provider is actually turning up to do. On a
                  multi-service job this is the first thing they need - the
                  price matters later, the van loadout matters now. */}
              {(booking.services?.length ?? 0) > 1 && (
                <div>
                  <p className="text-sm text-ink-500">
                    {booking.services.length} services booked
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {booking.services.map((item) => (
                      <li key={item.id} className="flex items-baseline justify-between gap-3">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <CheckCircle2
                            aria-hidden="true"
                            className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-brand-600"
                          />
                          <span className="truncate font-medium text-ink-900">{item.name}</span>
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-ink-500">
                          {duration(item.estimatedMinutes)} · {money(item.price)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-between gap-3">
                <span className="text-ink-500">When</span>
                <span className="text-right font-medium text-ink-900">
                  {formatDateTime(booking.schedule.start)}
                </span>
              </div>

              <div>
                <p className="text-sm text-ink-500">Address</p>
                {booking.address.line && booking.provider.phone !== undefined && booking.status !== 'requested' ? (
                  <a
                    href={mapsHref}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 flex items-start gap-1.5 font-medium text-brand-600 hover:text-brand-700"
                  >
                    <Navigation aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {booking.address.line}, {booking.address.city} {booking.address.pincode}
                    </span>
                  </a>
                ) : (
                  <p className="mt-0.5 flex items-start gap-1.5 font-medium text-ink-900">
                    <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                    <span>
                      {booking.address.city} {booking.address.pincode}
                      {booking.status === 'requested' && (
                        <span className="block text-sm font-normal text-ink-500">
                          The full address appears once you accept.
                        </span>
                      )}
                    </span>
                  </p>
                )}
              </div>

              {booking.description && (
                <div>
                  <p className="text-sm text-ink-500">What the customer described</p>
                  <p className="mt-0.5 text-ink-700">{booking.description}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Progress" />
            <CardBody>
              {tracking && (
                <BookingStatusTimeline steps={tracking.steps} branchedTo={tracking.branchedTo} />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Customer" />
            <CardBody>
              <div className="flex items-center gap-3">
                <Avatar src={booking.customer.avatarUrl} name={booking.customer.name} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink-900">{booking.customer.name}</p>
                  {booking.customer.phone ? (
                    <a
                      href={'tel:' + booking.customer.phone}
                      className="mt-0.5 flex items-center gap-1.5 text-base text-brand-600 hover:text-brand-700"
                    >
                      <Phone aria-hidden="true" className="h-4 w-4" />
                      {booking.customer.phone}
                    </a>
                  ) : (
                    <p className="mt-0.5 text-sm text-ink-500">Shared once you accept</p>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="You will earn" />
            <CardBody className="space-y-2 text-base">
              <div className="flex justify-between">
                <span className="text-ink-500">Job value</span>
                <span className="font-medium text-ink-900">
                  {money(booking.pricing.final ?? booking.pricing.quoted)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-500">Platform commission</span>
                <span className="text-ink-600">{booking.pricing.commissionPercent}%</span>
              </div>
              {booking.pricing.providerEarningMinor != null && (
                <div className="flex justify-between border-t border-ink-200 pt-2">
                  <span className="font-medium text-ink-700">Your earning</span>
                  <span className="text-lg font-semibold text-ink-900">
                    {money(booking.pricing.providerEarningMinor / 100)}
                  </span>
                </div>
              )}

              {/*
                Said plainly, because the figure above it is a calculation and
                nothing else on this screen distinguishes money owed from money
                received. A provider standing in someone's kitchen needs to
                know which one they are looking at.
              */}
              {payment && (
                <div className="border-t border-ink-200 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-500">Customer payment</span>
                    {payment.isPaid ? (
                      <Badge variant="success" dot>Paid</Badge>
                    ) : (
                      <Badge variant="warning" dot>Not paid yet</Badge>
                    )}
                  </div>

                  {payment.isPaid ? (
                    <p className="mt-1 text-sm text-ink-500">
                      {paidAt ? 'Received ' + timeAgo(paidAt) + '. ' : ''}
                      Your earning is on your balance and becomes payable once the
                      dispute window closes.
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-ink-500">
                      {booking.status === 'completed'
                        ? 'Nothing has reached us yet. Your earning is credited only once ' +
                          'the customer pays.'
                        : 'The customer can pay any time from now until the job is done.'}
                    </p>
                  )}

                  {payment.refunds?.length > 0 && (
                    <div className="mt-2 border-t border-ink-200 pt-2">
                      {payment.refunds.map((refund) => (
                        <div key={refund.id} className="flex justify-between text-sm">
                          <span className="text-ink-500">Refunded to the customer</span>
                          <span className="font-medium text-ink-700">{money(refund.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2">
              {can('accepted') && (
                <Button icon={Check} fullWidth loading={accept.isPending} onClick={() => accept.mutate()}>
                  Accept this job
                </Button>
              )}
              {can('rejected') && (
                <Button variant="secondary" icon={X} fullWidth onClick={() => setRejectOpen(true)}>
                  Decline
                </Button>
              )}
              {can('in_progress') && (
                <Button icon={Play} fullWidth loading={start.isPending} onClick={() => start.mutate()}>
                  Start the job
                </Button>
              )}
              {can('completed') && (
                <Button icon={KeyRound} fullWidth onClick={() => setCompleteOpen(true)}>
                  Complete the job
                </Button>
              )}
              {booking.availableActions.length === 0 && (
                <p className="text-center text-sm text-ink-500">No actions available.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* The provider cannot raise a dispute, but their payout is the thing
          being held - so they see it and can put their side. */}
      <DisputePanel booking={booking} viewer="provider" onChanged={refresh} />

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Decline this job?"
        description="Declining affects your acceptance rate, which affects where you rank in search."
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setRejectOpen(false)} className="flex-1">
              Keep it
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={reject.isPending}
              disabled={rejectReason.trim().length < 5}
              onClick={() => reject.mutate(rejectReason)}
            >
              Decline
            </Button>
          </div>
        }
      >
        <Textarea
          label="Why can you not take this job?"
          rows={3}
          maxLength={300}
          required
          placeholder="Already committed to another job in that area."
          hint="The customer sees this, so keep it useful."
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>

      <Modal
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        title="Complete the job"
        description="The customer receives a code by email. Ask them to read it out."
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCompleteOpen(false)} className="flex-1">
              Not yet
            </Button>
            <Button
              className="flex-1"
              loading={complete.isPending}
              disabled={otp.length !== 6}
              onClick={() => complete.mutate()}
            >
              Mark complete
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Final amount"
            type="number"
            inputMode="decimal"
            placeholder={String(agreedTotal)}
            min={agreedTotal}
            suffix="rupees"
            value={finalAmount}
            onChange={(e) => setFinalAmount(e.target.value)}
            hint={
              'Leave blank to charge the agreed ' + money(agreedTotal) +
              '. You can charge more if the job grew, up to the category ceiling, but not less. ' +
              'The customer sees this amount in the email with their code, before they read it out.'
            }
          />

          <Button
            variant="secondary"
            fullWidth
            loading={requestCode.isPending}
            onClick={() => requestCode.mutate()}
          >
            {codeSent ? 'Send the code again' : 'Send the code to the customer'}
          </Button>

          {codeSent && (
            <Input
              label="Completion code"
              inputMode="numeric"
              maxLength={6}
              placeholder="6 digits"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              hint="Ask the customer to read out the code from their email."
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
