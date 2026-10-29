import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, ChevronLeft, MapPin, CalendarDays, ClipboardList } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import SlotPicker from './SlotPicker.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Alert from '../../components/ui/Alert.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { money, duration, formatDateTime, pluralise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

const STEPS = [
  { key: 'service', label: 'Service', icon: ClipboardList },
  { key: 'slot', label: 'Date and time', icon: CalendarDays },
  { key: 'address', label: 'Address', icon: MapPin },
];

function Stepper({ current }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;

        return (
          <li key={step.key} className="flex flex-1 items-center gap-2">
            <span
              className={clsx(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                'transition-[background-color,box-shadow] duration-300',
                done && 'bg-brand-gradient text-white shadow-btn',
                // The step in progress carries a glow as well as a ring: on a
                // three-step flow "where am I" has to be answerable at a
                // glance, mid-form.
                active && 'bg-white text-brand-700 shadow-glow-brand ring-2 ring-brand-600',
                !done && !active && 'bg-ink-100 text-ink-400 ring-1 ring-inset ring-ink-200',
              )}
            >
              {done ? <Check aria-hidden="true" className="h-4 w-4" /> : index + 1}
            </span>
            <span
              className={clsx(
                'hidden text-sm font-medium sm:block',
                active ? 'text-ink-900' : 'text-ink-500',
              )}
            >
              {step.label}
            </span>
            {index < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={clsx(
                  'h-0.5 flex-1 rounded-pill transition-colors duration-300',
                  done ? 'bg-gradient-to-r from-brand-600 to-brand-400' : 'bg-ink-200',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The sentinel for "type a different address".
 *
 * A saved address is identified by its uuid, so any value that cannot be one
 * works - and a named constant beats an empty string, which already means
 * "nothing chosen yet".
 */
const NEW_ADDRESS = 'new';

export default function BookService() {
  useDocumentTitle('Book a service');
  const { providerId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  // A set, not a single id: one visit can cover several jobs. Order is kept
  // because the first service chosen becomes the booking's headline category.
  const [categoryIds, setCategoryIds] = useState(() => {
    const preset = searchParams.get('category');
    return preset ? [preset] : [];
  });
  const [slot, setSlot] = useState('');
  const [address, setAddress] = useState({
    line: '', city: 'Bidar', state: 'Karnataka', pincode: '', lat: null, lng: null,
  });
  const [description, setDescription] = useState('');
  const [submitError, setSubmitError] = useState(null);

  /**
   * Which saved address is selected, or the sentinel for typing a new one.
   *
   * Empty string means "no saved addresses yet or none chosen"; NEW_ADDRESS
   * means the customer deliberately wants to type a different one. The two
   * have to be distinguishable, because the first should preselect the default
   * once the list arrives and the second must never be overridden by it.
   */
  const [addressChoice, setAddressChoice] = useState('');
  const [saveAddress, setSaveAddress] = useState(true);

  const { data: provider, isLoading } = useQuery({
    queryKey: keys.providers.profile(providerId),
    queryFn: async () => (await api.get('/providers/' + providerId, { params: { days: 14 } })).data,
    retry: false,
  });

  const selected = (provider?.services ?? []).filter((s) => categoryIds.includes(s.categoryId));
  const totalMinutes = selected.reduce((sum, s) => sum + (s.estimatedMinutes || 60), 0);
  const totalPrice = selected.reduce((sum, s) => sum + (s.price || 0), 0);

  /**
   * Slots sized for the whole visit.
   *
   * The profile's default grid is built at the provider's *shortest* service,
   * so two jobs would be offered a slot too short to hold them and the booking
   * would be refused at the final step. Asking for the real total means every
   * time shown can actually be booked.
   */
  const { data: sized, isFetching: slotsLoading } = useQuery({
    queryKey: ['providers', providerId, 'slots', totalMinutes],
    queryFn: async () =>
      (await api.get('/providers/' + providerId, {
        params: { days: 14, minutes: totalMinutes },
      })).data,
    enabled: totalMinutes > 0,
    placeholderData: (previous) => previous,
  });

  // The customer's saved address is a sensible default; they can edit it.
  const { data: me } = useQuery({
    queryKey: keys.me,
    queryFn: async () => (await api.get('/auth/me')).data,
  });

  const { data: savedAddresses = [] } = useQuery({
    queryKey: keys.addresses,
    queryFn: async () => (await api.get('/addresses')).data,
  });

  /**
   * Preselect the default address, once.
   *
   * Guarded on `addressChoice` being empty so it fires only before the
   * customer has expressed a preference - otherwise a refetch would drag them
   * back off the new address they had started typing.
   */
  useEffect(() => {
    if (addressChoice || savedAddresses.length === 0) return;
    const preferred = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0];
    setAddressChoice(preferred.id);
    setAddress({
      line: preferred.line,
      city: preferred.city,
      state: preferred.state,
      pincode: preferred.pincode,
      lat: preferred.latitude ?? null,
      lng: preferred.longitude ?? null,
    });
  }, [savedAddresses, addressChoice]);

  function chooseSaved(saved) {
    setAddressChoice(saved.id);
    setAddress({
      line: saved.line,
      city: saved.city,
      state: saved.state,
      pincode: saved.pincode,
      lat: saved.latitude ?? null,
      lng: saved.longitude ?? null,
    });
  }

  function chooseNew() {
    setAddressChoice(NEW_ADDRESS);
    setAddress({ line: '', city: 'Bidar', state: 'Karnataka', pincode: '', lat: null, lng: null });
  }

  // A provider with exactly one service has nothing to choose, so it is
  // ticked for them.
  useEffect(() => {
    if (provider && categoryIds.length === 0 && provider.services.length === 1) {
      setCategoryIds([provider.services[0].categoryId]);
    }
  }, [provider, categoryIds.length]);

  const createBooking = useMutation({
    mutationFn: (payload) => api.post('/bookings', payload),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success('Request sent. The professional will confirm shortly.');
      navigate('/bookings/' + data.id, { replace: true });
    },
    onError: (error) => setSubmitError(error.message),
  });

  if (isLoading) return <PageLoader label="Loading availability" />;

  if (!provider) {
    return (
      <div className="page py-10">
        <Alert variant="error" title="This professional is not available">
          <Link to="/search" className="font-semibold underline">Find another professional</Link>
        </Alert>
      </div>
    );
  }

  const availability = sized?.availability ?? provider.availability;

  const canContinue = [
    categoryIds.length > 0,
    Boolean(slot),
    Boolean(address.line && address.pincode),
  ][step];

  function toggleService(id) {
    // Computed from the current value rather than inside a setState updater.
    // An updater has to be a pure function - React may call it more than once
    // for a single update, and calling setSlot from inside it made the second
    // run fight the first, which cleared the whole selection.
    const next = categoryIds.includes(id)
      ? categoryIds.filter((x) => x !== id)
      : [...categoryIds, id];

    setCategoryIds(next);
    // The chosen time was only valid for the duration it was picked for, so
    // changing the services clears it rather than carrying a slot that no
    // longer fits.
    setSlot('');
  }

  /**
   * Saves a newly typed address, if asked.
   *
   * Deliberately not allowed to block the booking: the address is a
   * convenience for next time, and failing to store it is no reason to refuse
   * a customer who has just chosen a slot. The booking carries its own
   * snapshot either way.
   */
  async function persistAddressIfWanted() {
    const isNew = savedAddresses.length === 0 || addressChoice === NEW_ADDRESS;
    if (!isNew || !saveAddress || !address.line || !address.pincode) return undefined;

    try {
      const { data } = await api.post('/addresses', {
        label: savedAddresses.length === 0 ? 'Home' : 'Other',
        line1: address.line,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        latitude: address.lat ?? undefined,
        longitude: address.lng ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: keys.addresses });
      return data.id;
    } catch {
      return undefined;
    }
  }

  async function submit() {
    setSubmitError(null);
    const newlySavedId = await persistAddressIfWanted();
    createBooking.mutate({
      providerId,
      categoryIds,
      scheduledStart: slot,
      // The snapshot always goes, saved address or not: a booking has to keep
      // what the address said on the day, even if the customer later edits or
      // deletes the saved one.
      addressId:
        addressChoice && addressChoice !== NEW_ADDRESS ? addressChoice : newlySavedId,
      address: {
        line: address.line,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        lat: address.lat ?? undefined,
        lng: address.lng ?? undefined,
      },
      description: description || undefined,
    });
  }

  return (
    <div className="page max-w-4xl py-5 sm:py-7">
      <Button
        as={Link}
        to={'/providers/' + providerId}
        variant="ghost"
        size="sm"
        icon={ChevronLeft}
        className="mb-3"
      >
        Back to profile
      </Button>

      <div className="flex items-center gap-3">
        <Avatar src={provider.avatarUrl} name={provider.name} size="md" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-ink-900">Book {provider.name}</h1>
          <p className="text-sm text-ink-500">{provider.headline}</p>
        </div>
      </div>

      <div className="mt-5">
        <Stepper current={step} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Card>
            <CardBody>
              {step === 0 && (
                <fieldset>
                  <legend className="font-semibold text-ink-900">What do you need done?</legend>
                  <p className="mb-3 mt-1 text-sm text-ink-500">
                    Pick as many as you need - one visit covers them all.
                  </p>

                  <div className="space-y-2">
                    {provider.services.map((option) => {
                      const checked = categoryIds.includes(option.categoryId);
                      return (
                        <label
                          key={option.categoryId}
                          className={clsx(
                            'flex cursor-pointer items-center gap-3 rounded-card p-3 ring-1 ring-inset',
                            'transition-[background-color,box-shadow] duration-200',
                            checked
                              ? 'bg-gradient-to-r from-brand-50 to-white shadow-card ring-2 ring-brand-600'
                              : 'bg-white shadow-xs ring-ink-200 hover:bg-ink-50 hover:ring-ink-300',
                          )}
                        >
                          <input
                            type="checkbox"
                            name="services"
                            value={option.categoryId}
                            checked={checked}
                            onChange={() => toggleService(option.categoryId)}
                            className="sr-only"
                          />

                          {/* A real tick box, drawn rather than native, so it
                              matches the rest of the form at every size. */}
                          <span
                            aria-hidden="true"
                            className={clsx(
                              'flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1 ring-inset',
                              'transition-colors duration-200',
                              checked
                                ? 'bg-brand-gradient text-white ring-brand-700'
                                : 'bg-white ring-ink-300',
                            )}
                          >
                            {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-ink-900">{option.categoryName}</span>
                            <span className="mt-0.5 block text-sm text-ink-500">
                              About {duration(option.estimatedMinutes)}
                            </span>
                          </span>

                          <span className="shrink-0 text-lg font-semibold text-ink-900">
                            {money(option.price)}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  {selected.length > 1 && (
                    <div className="panel-tint mt-3 flex items-center justify-between gap-3 p-3">
                      <span className="text-sm text-ink-600">
                        {pluralise(selected.length, 'service')} · about {duration(totalMinutes)} in total
                      </span>
                      <span className="figure text-lg">{money(totalPrice)}</span>
                    </div>
                  )}
                </fieldset>
              )}

              {step === 1 && (
                <>
                  <h2 className="font-semibold text-ink-900">When suits you?</h2>
                  <p className="mb-3 mt-1 text-sm text-ink-500">
                    {selected.length > 1
                      ? 'Showing times with room for all ' + selected.length +
                        ' jobs - about ' + duration(totalMinutes) + '.'
                      : 'Showing times with room for about ' + duration(totalMinutes) + '.'}
                  </p>
                  <SlotPicker
                    availability={availability}
                    value={slot}
                    onChange={setSlot}
                    loading={slotsLoading && !sized}
                  />
                </>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <h2 className="font-semibold text-ink-900">Where should they come?</h2>

                  <Alert variant="info">
                    The professional gets your address and phone number only once they accept.
                  </Alert>

                  {savedAddresses.length > 0 && (
                    <fieldset className="space-y-2">
                      {/* The heading above already asks the question; this
                          names the group for a screen reader without saying
                          the same sentence twice on screen. */}
                      <legend className="mb-1 text-sm font-medium text-ink-700">
                        Saved addresses
                      </legend>

                      {savedAddresses.map((saved) => (
                        <label
                          key={saved.id}
                          className={clsx(
                            'flex cursor-pointer items-start gap-3 rounded-field border p-3 transition',
                            addressChoice === saved.id
                              ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600'
                              : 'border-ink-200 hover:border-ink-300',
                          )}
                        >
                          <input
                            type="radio"
                            name="saved-address"
                            className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
                            checked={addressChoice === saved.id}
                            onChange={() => chooseSaved(saved)}
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="font-medium text-ink-900">{saved.label}</span>
                              {saved.isDefault && (
                                <Badge variant="info" size="sm">Default</Badge>
                              )}
                            </span>
                            <span className="mt-0.5 block text-sm text-ink-500">
                              {saved.line}, {saved.city} {saved.pincode}
                            </span>
                          </span>
                        </label>
                      ))}

                      <label
                        className={clsx(
                          'flex cursor-pointer items-center gap-3 rounded-field border p-3 transition',
                          addressChoice === NEW_ADDRESS
                            ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600'
                            : 'border-ink-200 hover:border-ink-300',
                        )}
                      >
                        <input
                          type="radio"
                          name="saved-address"
                          className="h-4 w-4 shrink-0 accent-brand-600"
                          checked={addressChoice === NEW_ADDRESS}
                          onChange={chooseNew}
                        />
                        <span className="font-medium text-ink-900">Use a different address</span>
                      </label>
                    </fieldset>
                  )}

                  {/* The fields stay visible when nothing is saved yet, and
                      when the customer has chosen to type a new one. Hiding
                      them behind the radio for a first-time customer would
                      leave the step looking empty. */}
                  {(savedAddresses.length === 0 || addressChoice === NEW_ADDRESS) && (
                  <>
                  <Input
                    label="Address"
                    placeholder="House number, street, landmark"
                    required
                    value={address.line}
                    onChange={(e) => setAddress({ ...address, line: e.target.value })}
                  />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="City"
                      required
                      value={address.city}
                      onChange={(e) => setAddress({ ...address, city: e.target.value })}
                    />
                    <Input
                      label="Pincode"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      placeholder="585401"
                      value={address.pincode}
                      onChange={(e) => setAddress({ ...address, pincode: e.target.value.replace(/\D/g, '') })}
                    />
                  </div>

                  <label className="flex cursor-pointer items-center gap-2.5 text-base text-ink-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600"
                      checked={saveAddress}
                      onChange={(e) => setSaveAddress(e.target.checked)}
                    />
                    Save this address for next time
                  </label>
                  </>
                  )}

                  <Textarea
                    label="Describe the problem"
                    rows={3}
                    maxLength={1000}
                    placeholder="The kitchen tap drips constantly and the handle is loose."
                    hint="Optional, but it helps them arrive with the right parts."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              )}

              {submitError && (
                <Alert variant="error" className="mt-4">
                  {submitError}
                </Alert>
              )}

              <div className="mt-5 flex gap-2">
                {step > 0 && (
                  <Button variant="secondary" onClick={() => setStep(step - 1)}>
                    Back
                  </Button>
                )}
                {step < STEPS.length - 1 ? (
                  <Button
                    disabled={!canContinue}
                    onClick={() => setStep(step + 1)}
                    className="flex-1 sm:flex-none"
                  >
                    Continue
                  </Button>
                ) : (
                  <Button
                    disabled={!canContinue}
                    loading={createBooking.isPending}
                    onClick={submit}
                    className="flex-1 sm:flex-none"
                  >
                    Send booking request
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0">
          <Card className="lg:sticky lg:top-24">
            <CardHeader title="Your booking" />
            <CardBody className="space-y-3 text-base">
              {/* Itemised, because the customer is agreeing to a total made
                  of parts and should be able to check each one. */}
              <div className="flex justify-between gap-3">
                <span className="shrink-0 text-ink-500">
                  {selected.length > 1 ? 'Services' : 'Service'}
                </span>
                <span className="min-w-0 text-right font-medium text-ink-900">
                  {selected.length === 0 ? (
                    'Not chosen yet'
                  ) : (
                    <span className="space-y-1">
                      {selected.map((item) => (
                        <span key={item.categoryId} className="flex items-baseline justify-end gap-2">
                          <span>{item.categoryName}</span>
                          <span className="shrink-0 tabular-nums text-ink-500">
                            {money(item.price)}
                          </span>
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </div>

              <div className="flex justify-between gap-3">
                <span className="text-ink-500">When</span>
                <span className="text-right font-medium text-ink-900">
                  {slot ? formatDateTime(slot) : 'Not chosen yet'}
                  {slot && totalMinutes > 0 && (
                    <span className="block text-xs font-normal text-ink-500">
                      about {duration(totalMinutes)}
                    </span>
                  )}
                </span>
              </div>

              <div className="flex justify-between gap-3">
                <span className="text-ink-500">Where</span>
                <span className="text-right font-medium text-ink-900">
                  {address.line ? address.line + ', ' + address.pincode : 'Not entered yet'}
                </span>
              </div>

              {selected.length > 0 && (
                <div className="flex items-baseline justify-between border-t border-ink-200 pt-3">
                  <span className="font-medium text-ink-700">Agreed price</span>
                  <span className="figure text-xl">{money(totalPrice)}</span>
                </div>
              )}

              <p className="text-xs text-ink-400">
                You pay after the job is done, not now. The final amount is confirmed with you
                before payment.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
