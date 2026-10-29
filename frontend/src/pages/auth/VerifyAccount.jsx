import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { getPendingSignup, clearPendingSignup } from '../../lib/pendingSignup.js';
import { useToast } from '../../context/ToastContext.jsx';
import { HOME_FOR_ROLE } from '../../routes/guards.jsx';
import AuthLayout from './AuthLayout.jsx';
import Button from '../../components/ui/Button.jsx';
import Alert from '../../components/ui/Alert.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

const LENGTH = 6;

/**
 * Six separate boxes rather than one field.
 *
 * It makes the expected length obvious, and pasting a code from an email fills
 * all six at once - which is how most people will actually enter it.
 */
function CodeInput({ value, onChange, disabled }) {
  const refs = useRef([]);

  function setDigit(index, digit) {
    const next = value.split('');
    next[index] = digit;
    onChange(next.join('').slice(0, LENGTH));
    if (digit && index < LENGTH - 1) refs.current[index + 1]?.focus();
  }

  function onKeyDown(index, event) {
    if (event.key === 'Backspace' && !value[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < LENGTH - 1) refs.current[index + 1]?.focus();
  }

  function onPaste(event) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
  }

  return (
    <div className="flex justify-between gap-2" onPaste={onPaste}>
      {Array.from({ length: LENGTH }).map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          value={value[index] || ''}
          onChange={(e) => setDigit(index, e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => onKeyDown(index, e)}
          aria-label={'Digit ' + (index + 1) + ' of ' + LENGTH}
          className="h-14 w-full rounded-field border border-ink-300 text-center text-xl font-semibold text-ink-900 transition-colors focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25 disabled:bg-ink-50"
        />
      ))}
    </div>
  );
}

export default function VerifyAccount() {
  useDocumentTitle('Confirm your account');

  // Read once, on the first render. A reload leaves this empty, which is what
  // sends somebody back to the registration form.
  const [state] = useState(getPendingSignup);
  const navigate = useNavigate();
  const { user, confirmAccount } = useAuth();
  const toast = useToast();

  /**
   * Two values, deliberately separate.
   *
   * `destination` is the key the code is filed under - always the email
   * address - and is posted back unchanged to confirm. `sentTo` is only ever
   * displayed: when WhatsApp carried the code it is a masked phone number,
   * which is not a usable key and must never be submitted.
   */
  const destination = state?.destination || user?.email;
  const sentTo = state?.sentTo || destination;
  const channel = state?.channel || 'email';
  const viaWhatsApp = channel === 'whatsapp';
  const [code, setCode] = useState(state?.devCode || '');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  /**
   * A refresh sends you back to the beginning.
   *
   * The details of a half-finished signup live in the navigation state and
   * nowhere else - not in the URL, not in storage - so a reload loses them by
   * design. There is nothing to resume: the account exists but has no session,
   * and registering again replaces it and sends a fresh code.
   *
   * `user` covers the other way in: somebody already signed in who is
   * confirming a changed address, who has an email to confirm without any
   * navigation state.
   */
  useEffect(() => {
    if (!destination) navigate('/register', { replace: true });
  }, [destination, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Nothing to show while the redirect above is on its way.
  if (!destination) return null;

  async function onSubmit(event) {
    event.preventDefault();
    if (code.length !== LENGTH) {
      setError('Enter all ' + LENGTH + ' digits');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      // This is the sign-in. Until it returns there is no session at all.
      const confirmed = await confirmAccount({ destination, code });
      clearPendingSignup();
      toast.success('Your account is confirmed');
      navigate(HOME_FOR_ROLE[confirmed?.role || state?.role] || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    try {
      const { data } = await api.post('/auth/otp/send', {
        destination,
        purpose: 'verify_email',
      });
      setCooldown(60);
      toast.success('A new code is on its way');
      if (data?.devCode) setCode(data.devCode);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <AuthLayout
      title="Confirm your account"
      subtitle={
        sentTo
          ? 'We sent a 6-digit code ' +
            (viaWhatsApp ? 'on WhatsApp to ' : 'by email to ') +
            sentTo + '. It may take a moment to arrive.'
          : 'Enter the code we sent you.'
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {error && <Alert variant="error">{error}</Alert>}

        {/*
          Only ever shown when the API told us nothing was really sent, which
          happens when no mail server or WhatsApp account is configured. With
          either live the API withholds the code, so this cannot appear.
        */}
        {state?.devCode && (
          <Alert variant="info" title="Nothing was actually sent">
            No delivery is configured, so the code is filled in for you. It is also printed in the
            API log.
          </Alert>
        )}

        <CodeInput value={code} onChange={setCode} disabled={submitting} />

        <Button type="submit" size="lg" fullWidth loading={submitting} disabled={code.length !== LENGTH}>
          Confirm my account
        </Button>

        <div className="text-center">
          <Button
            type="button"
            variant="link"
            size="sm"
            icon={Mail}
            disabled={cooldown > 0}
            onClick={resend}
          >
            {cooldown > 0 ? 'Resend in ' + cooldown + 's' : 'Email me a new code'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
