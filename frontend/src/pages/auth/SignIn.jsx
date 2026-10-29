import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import QRCode from 'qrcode';
import { Mail, Lock, ShieldCheck, ArrowLeft, Copy, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { HOME_FOR_ROLE } from '../../routes/guards.jsx';
import AuthLayout from './AuthLayout.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import Alert from '../../components/ui/Alert.jsx';
import RecoveryCodes from '../../components/account/RecoveryCodes.jsx';
import { digitsOnlyIfNumeric } from '../../lib/inputFilters.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

export default function SignIn() {
  useDocumentTitle('Sign in');
  const { signIn, completeSignIn, enrolAndSignIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState(null);

  // Set when the password was right but the account also wants a code. Holding
  // it here rather than in a route means the half-finished attempt cannot be
  // bookmarked, shared or reloaded into existence.
  const [challenge, setChallenge] = useState(null);

  // An admin who must enrol before they are let in: { setupToken, secret, uri }.
  const [enrolment, setEnrolment] = useState(null);
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);
  const [codes, setCodes] = useState(null);
  const [pendingUser, setPendingUser] = useState(null);

  const { register, handleSubmit, setError, formState } = useForm({
    defaultValues: { identifier: '', password: '' },
  });

  const codeForm = useForm({ defaultValues: { code: '' } });

  const go = (user) => {
    // Back to wherever they were headed before the guard intervened.
    const intended = location.state?.from?.pathname;
    navigate(intended || HOME_FOR_ROLE[user.role] || '/', { replace: true });
  };

  // Shown instead of a bare error when the account exists but was never
  // confirmed. The way out is to register again, which replaces the
  // unconfirmed record and sends a fresh code, so the message points there.
  const [unconfirmed, setUnconfirmed] = useState(false);

  const report = (error, form) => {
    const fields = error.fieldErrors ?? {};
    if (Object.keys(fields).length) {
      Object.entries(fields).forEach(([name, message]) => form(name, { message }));
    } else {
      setFormError(error.message);
    }
  };

  async function onSubmit(values) {
    setFormError(null);
    setUnconfirmed(false);
    try {
      const result = await signIn(values);

      if (result.twoFactorSetupRequired) {
        setEnrolment(result);
        return;
      }

      if (result.twoFactorRequired) {
        setChallenge(result.challengeToken);
        return;
      }

      go(result.user);
    } catch (error) {
      if (error.code === 'ACCOUNT_UNVERIFIED') {
        setUnconfirmed(true);
        return;
      }
      report(error, setError);
    }
  }

  async function onCode(values) {
    setFormError(null);
    try {
      const result = await completeSignIn({ challengeToken: challenge, code: values.code });
      go(result.user);
    } catch (error) {
      // The challenge expires after five minutes, and a dead token cannot be
      // retried into life - send them back to the password rather than leaving
      // them typing codes at something that will never accept one.
      if (/expired/i.test(error.message)) {
        setChallenge(null);
        codeForm.reset();
      }
      report(error, codeForm.setError);
    }
  }

  // Rendered here in the browser. Sending the secret to a QR service on the
  // internet would hand the second factor to a third party.
  useEffect(() => {
    if (!enrolment?.otpauthUri) { setQr(null); return; }

    let cancelled = false;
    QRCode.toDataURL(enrolment.otpauthUri, { width: 200, margin: 1 })
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => { if (!cancelled) setQr(null); });

    return () => { cancelled = true; };
  }, [enrolment]);

  async function onEnrol(values) {
    setFormError(null);
    try {
      const result = await enrolAndSignIn({
        setupToken: enrolment.setupToken,
        code: values.code,
      });

      // The session already exists at this point, but the codes are shown
      // before going anywhere: this is the only time they are readable, and
      // somebody dropped straight into the console will never come back
      // for them.
      setCodes(result.recoveryCodes);
      setPendingUser(result.user);
    } catch (error) {
      if (/expired/i.test(error.message)) {
        setEnrolment(null);
        codeForm.reset();
      }
      report(error, codeForm.setError);
    }
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(enrolment.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFormError('Could not copy. Type the key in by hand.');
    }
  }

  if (codes) {
    return (
      <>
        <AuthLayout title="Almost there" subtitle="Save these before you continue.">
          <p className="text-sm text-ink-600">
            Two-factor authentication is on for your account.
          </p>
        </AuthLayout>
        <RecoveryCodes
          codes={codes}
          intro="Each code signs you in once if you lose your phone. You are the only administrator, so these are your only way back in - print them and keep them somewhere physical."
          onClose={() => go(pendingUser)}
        />
      </>
    );
  }

  if (enrolment) {
    return (
      <AuthLayout
        title="Set up two-factor authentication"
        subtitle="Admin accounts need a code from your phone as well as a password."
        footer={
          <button
            type="button"
            onClick={() => { setEnrolment(null); setFormError(null); codeForm.reset(); }}
            className="link-grow inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:text-brand-700"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to sign in
          </button>
        }
      >
        <form onSubmit={codeForm.handleSubmit(onEnrol)} noValidate className="space-y-4">
          {formError && <Alert variant="error">{formError}</Alert>}

          <ol className="space-y-1 text-sm text-ink-600">
            <li>1. Install Google Authenticator, Authy or any TOTP app.</li>
            <li>2. Scan this code with it.</li>
            <li>3. Type the six digits it shows.</li>
          </ol>

          {qr && (
            <img
              src={qr}
              alt="QR code for your authenticator app"
              className="mx-auto rounded-card ring-1 ring-ink-200"
              width={200}
              height={200}
            />
          )}

          <div>
            <p className="text-sm font-medium text-ink-700">Or type this key in by hand</p>
            <p className="mt-1 break-all rounded-field bg-ink-50 px-3 py-2 font-mono text-sm tracking-wider text-ink-900">
              {enrolment.secret}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1"
              icon={copied ? Check : Copy}
              onClick={copySecret}
            >
              {copied ? 'Copied' : 'Copy key'}
            </Button>
          </div>

          <Input
            label="Code from your app"
            icon={ShieldCheck}
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="123456"
            error={codeForm.formState.errors.code?.message}
            {...codeForm.register('code', { required: 'Enter the code from your app' })}
          />

          <Button type="submit" size="lg" fullWidth loading={codeForm.formState.isSubmitting}>
            Turn it on and sign in
          </Button>
        </form>
      </AuthLayout>
    );
  }

  if (challenge) {
    return (
      <AuthLayout
        title="Enter your code"
        subtitle="Open your authenticator app and type the six-digit code it shows."
        footer={
          <button
            type="button"
            onClick={() => { setChallenge(null); setFormError(null); codeForm.reset(); }}
            className="link-grow inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:text-brand-700"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to sign in
          </button>
        }
      >
        <form onSubmit={codeForm.handleSubmit(onCode)} noValidate className="space-y-4">
          {formError && <Alert variant="error">{formError}</Alert>}

          <Input
            label="Six-digit code"
            icon={ShieldCheck}
            // `one-time-code` lets a password manager and the phone keyboard
            // do the right thing; inputMode brings up digits on a phone.
            autoComplete="one-time-code"
            inputMode="numeric"
            autoFocus
            placeholder="123456"
            error={codeForm.formState.errors.code?.message}
            {...codeForm.register('code', { required: 'Enter the code from your app' })}
          />

          <Button type="submit" size="lg" fullWidth loading={codeForm.formState.isSubmitting}>
            Verify and sign in
          </Button>

          <p className="text-center text-sm text-ink-500">
            Lost your phone? Enter one of your recovery codes instead.
          </p>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to manage your bookings."
      footer={
        <>
          New to ServiceMitra?{' '}
          <Link to="/register" className="link-grow font-semibold text-brand-600 hover:text-brand-700">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        {unconfirmed && (
          <Alert variant="warning" title="This account was never confirmed">
            We sent a code when it was created and it was never entered, so the account was never
            finished.{' '}
            <Link to="/register" className="font-semibold underline">
              Create your account again
            </Link>{' '}
            to get a new code.
          </Alert>
        )}

        <Input
          label="Email or phone number"
          icon={Mail}
          autoComplete="username"
          placeholder="you@example.com or 9876543210"
          error={formState.errors.identifier?.message}
          {...digitsOnlyIfNumeric(
            register('identifier', { required: 'Enter your email address or phone number' }),
            10,
          )}
        />

        <div>
          <Input
            label="Password"
            type="password"
            revealable
            icon={Lock}
            autoComplete="current-password"
            placeholder="Your password"
            error={formState.errors.password?.message}
            {...register('password', { required: 'Enter your password' })}
          />
          <div className="mt-1.5 text-right">
            <Link to="/forgot-password" className="link-grow text-sm font-medium text-brand-600 hover:text-brand-700">
              Forgot your password?
            </Link>
          </div>
        </div>

        <Button type="submit" size="lg" fullWidth loading={formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
