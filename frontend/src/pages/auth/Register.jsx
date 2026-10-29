import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import clsx from 'clsx';
import { User, Phone, Mail, Lock, Wrench, Check, Building2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import AuthLayout from './AuthLayout.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import Alert from '../../components/ui/Alert.jsx';
import { phoneDigits } from '../../lib/inputFilters.js';
import { setPendingSignup } from '../../lib/pendingSignup.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

/**
 * Stacked, not a three-column grid.
 *
 * The form column is `max-w-sm` - 384px - so three cards left roughly 115px
 * each and every title broke onto four lines. One full-width row per role
 * reads instantly and leaves room for a real sentence.
 */
const ROLES = [
  {
    value: 'customer',
    icon: User,
    title: 'Book a service',
    body: 'Find verified professionals near you.',
  },
  {
    value: 'provider',
    icon: Wrench,
    title: 'Offer my services',
    body: 'Set your prices and take bookings.',
  },
  {
    value: 'agency',
    icon: Building2,
    title: 'Register an agency',
    body: 'Manage a team in one place.',
  },
];

const PASSWORD_RULES = [
  { label: 'at least 8 characters', test: (v) => (v || '').length >= 8 },
  { label: 'a lowercase letter', test: (v) => /[a-z]/.test(v || '') },
  { label: 'an uppercase letter', test: (v) => /[A-Z]/.test(v || '') },
  { label: 'a number', test: (v) => /[0-9]/.test(v || '') },
];

/** Mirrors the API rule, so the user is told before the request is sent. */
function passwordProblems(value) {
  return PASSWORD_RULES.filter((rule) => !rule.test(value)).map((rule) => rule.label);
}

export default function Register() {
  useDocumentTitle('Create an account');
  const { register: createAccount } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [formError, setFormError] = useState(null);

  const [role, setRole] = useState(
    ['provider', 'agency'].includes(searchParams.get('role'))
      ? searchParams.get('role')
      : 'customer',
  );

  const { register, handleSubmit, setError, watch, formState } = useForm({
    defaultValues: { fullName: '', phone: '', email: '', password: '' },
  });

  const password = watch('password');

  async function onSubmit(values) {
    setFormError(null);
    try {
      const result = await createAccount({
        role,
        fullName: values.fullName,
        phone: values.phone,
        email: values.email || undefined,
        password: values.password,
        // Only meaningful for an agency; the API rejects it as missing when
        // the role needs it, so it is never silently dropped.
        agencyName: role === 'agency' ? values.agencyName : undefined,
      });

      /**
       * Held in memory, not in the navigation state.
       *
       * Router state is stored in `history.state` and the browser restores it
       * on reload, which would let a half-finished signup resume. A module
       * variable dies with the page, so a refresh lands back on this form -
       * which is the intended behaviour, not a side effect.
       */
      setPendingSignup({
        destination: result.verification && result.verification.destination,
        // What to show the customer, which is a masked number when the code
        // went over WhatsApp. Kept apart from `destination`, which is the
        // key posted back to confirm.
        sentTo: result.verification && result.verification.sentTo,
        channel: result.verification && result.verification.channel,
        devCode: result.verification && result.verification.devCode,
        role,
      });

      navigate('/verify', {
        replace: true,
      });
    } catch (error) {
      const fields = error.fieldErrors || {};
      if (Object.keys(fields).length) {
        Object.entries(fields).forEach(([name, message]) => setError(name, { message }));
      } else {
        setFormError(error.message);
      }
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="It takes about a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/signin" className="link-grow font-semibold text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </>
      }
    >
      <fieldset className="mb-5">
        <legend className="mb-2.5 text-sm font-medium text-ink-700">How will you use ServiceMitra?</legend>
        <div className="space-y-2">
          {ROLES.map((option) => (
            <label
              key={option.value}
              className={clsx(
                'group relative flex cursor-pointer items-center gap-3 rounded-card px-3.5 py-3',
                'ring-1 ring-inset transition-[background-color,box-shadow] duration-200 ease-out',
                role === option.value
                  ? 'bg-gradient-to-r from-brand-50 to-white shadow-card ring-2 ring-brand-600'
                  : 'bg-white shadow-xs ring-ink-200 hover:bg-ink-50 hover:shadow-card hover:ring-ink-300',
              )}
            >
              <input
                type="radio"
                name="role"
                value={option.value}
                checked={role === option.value}
                onChange={() => setRole(option.value)}
                className="sr-only"
              />
              <span
                className={clsx(
                  'icon-chip h-9 w-9 shrink-0',
                  role === option.value ? 'icon-chip-brand' : 'icon-chip-neutral',
                )}
              >
                <option.icon aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-ink-900">{option.title}</span>
                <span className="mt-0.5 block text-sm text-ink-500">{option.body}</span>
              </span>

              {/* A tick on the chosen row. The ring alone carries the state,
                  but at a glance down three rows a positive mark is quicker
                  to find than a border that is two pixels thicker. */}
              <Check
                aria-hidden="true"
                className={clsx(
                  'h-4 w-4 shrink-0 transition-opacity duration-200',
                  role === option.value ? 'text-brand-600 opacity-100' : 'opacity-0',
                )}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        {/* An agency is listed to customers under its business name, so it is
            asked for first - before the name of the person signing up. */}
        {role === 'agency' && (
          <Input
            label="Agency name"
            icon={Building2}
            placeholder="Sharma Electricals"
            required
            hint="Customers see this next to every person you add."
            error={formState.errors.agencyName?.message}
            {...register('agencyName', {
              required: role === 'agency' ? 'Enter your agency name' : false,
              minLength: { value: 2, message: 'Enter your agency name' },
            })}
          />
        )}

        <Input
          label={role === 'agency' ? 'Your name' : 'Full name'}
          icon={User}
          autoComplete="name"
          placeholder="Ravi Kumar"
          required
          error={formState.errors.fullName?.message}
          {...register('fullName', {
            required: 'Enter your full name',
            minLength: { value: 2, message: 'Enter your full name' },
          })}
        />

        <Input
          label="Email address"
          icon={Mail}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          hint="We send your confirmation code and invoices here."
          error={formState.errors.email?.message}
          {...register('email', {
            required: 'Enter your email address',
            pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' },
          })}
        />

        <Input
          label="Phone number"
          icon={Phone}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="9876543210"
          required
          hint="The professional calls this number when they arrive."
          error={formState.errors.phone?.message}
          {...phoneDigits(
            register('phone', {
              required: 'Enter your phone number',
              pattern: { value: /^[0-9]{10,15}$/, message: 'Enter a valid phone number' },
            }),
            10,
          )}
        />

        <div>
          <Input
            label="Password"
            type="password"
            revealable
            icon={Lock}
            autoComplete="new-password"
            placeholder="Choose a strong password"
            required
            error={formState.errors.password?.message}
            {...register('password', {
              required: 'Choose a password',
              validate: (value) => {
                const problems = passwordProblems(value);
                return problems.length === 0 || 'Your password needs ' + problems.join(', ');
              },
            })}
          />

          {/* The checklist appears once they start typing, so an empty field
              is not greeted with four red crosses. */}
          {password && (
            <ul className="mt-2 space-y-1">
              {PASSWORD_RULES.map((rule) => {
                const met = rule.test(password);
                return (
                  <li
                    key={rule.label}
                    className={clsx(
                      'flex items-center gap-1.5 text-xs',
                      met ? 'text-success-600' : 'text-ink-500',
                    )}
                  >
                    <Check aria-hidden="true" className={clsx('h-3.5 w-3.5', !met && 'opacity-30')} />
                    {rule.label}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Button type="submit" size="lg" fullWidth loading={formState.isSubmitting}>
          {role === 'provider'
            ? 'Create professional account'
            : role === 'agency'
              ? 'Create agency account'
              : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
