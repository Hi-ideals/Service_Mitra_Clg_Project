import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Mail, Lock, KeyRound } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import AuthLayout from './AuthLayout.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import Alert from '../../components/ui/Alert.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

/**
 * Two steps in one screen: request a code, then use it.
 *
 * The request step never says whether the account exists - the API is
 * deliberately vague there, and echoing "no such account" in the UI would
 * undo that.
 */
export default function ForgotPassword() {
  useDocumentTitle('Reset your password');
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState('request');
  const [destination, setDestination] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [error, setError] = useState(null);

  const requestForm = useForm({ defaultValues: { destination: '' } });
  const resetForm = useForm({ defaultValues: { code: '', newPassword: '' } });

  async function onRequest(values) {
    setError(null);
    try {
      const { data } = await api.post('/auth/otp/send', {
        destination: values.destination,
        purpose: 'reset_password',
      });
      // The API replies with the address it actually sent to, which may
      // differ from the phone number the user typed in.
      setDestination(data?.destination || values.destination);
      setDevCode(data?.devCode ?? null);
      if (data?.devCode) resetForm.setValue('code', data.devCode);
      setStep('reset');
    } catch (err) {
      setError(err.message);
    }
  }

  async function onReset(values) {
    setError(null);
    try {
      await api.post('/auth/password/reset', {
        destination,
        code: values.code,
        newPassword: values.newPassword,
      });
      toast.success('Password reset. Sign in with your new password.');
      navigate('/signin', { replace: true });
    } catch (err) {
      const fields = err.fieldErrors || {};
      if (Object.keys(fields).length) {
        Object.entries(fields).forEach(([name, message]) => resetForm.setError(name, { message }));
      } else {
        setError(err.message);
      }
    }
  }

  if (step === 'request') {
    return (
      <AuthLayout
        title="Reset your password"
        subtitle="We will email a code to the address on your account."
        footer={
          <Link to="/signin" className="font-semibold text-brand-600 hover:text-brand-700">
            Back to sign in
          </Link>
        }
      >
        <form onSubmit={requestForm.handleSubmit(onRequest)} noValidate className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}

          <Input
            label="Email or phone number"
            icon={Mail}
            autoComplete="username"
            placeholder="you@example.com or 9876543210"
            required
            error={requestForm.formState.errors.destination?.message}
            {...requestForm.register('destination', { required: 'Enter your email address or phone number' })}
          />

          <Button type="submit" size="lg" fullWidth loading={requestForm.formState.isSubmitting}>
            Send me a code
          </Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle={'Enter the code we emailed to ' + destination + '.'}
      footer={
        <button type="button" onClick={() => setStep('request')} className="font-semibold text-brand-600 hover:text-brand-700">
          Use a different account
        </button>
      }
    >
      <form onSubmit={resetForm.handleSubmit(onReset)} noValidate className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}

        {devCode && (
          <Alert variant="info" title="No mail server configured">
            Nothing was emailed, so the code is filled in for you.
          </Alert>
        )}

        <Input
          label="Verification code"
          icon={KeyRound}
          inputMode="numeric"
          maxLength={6}
          placeholder="6-digit code"
          required
          error={resetForm.formState.errors.code?.message}
          {...resetForm.register('code', {
            required: 'Enter the code we sent you',
            pattern: { value: /^[0-9]{6}$/, message: 'The code is 6 digits' },
          })}
        />

        <Input
          label="New password"
          type="password"
          icon={Lock}
          autoComplete="new-password"
          required
          hint="At least 8 characters, with an uppercase letter, a lowercase letter and a number."
          error={resetForm.formState.errors.newPassword?.message}
          {...resetForm.register('newPassword', {
            required: 'Choose a new password',
            minLength: { value: 8, message: 'At least 8 characters' },
            validate: (value) =>
              (/[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value)) ||
              'Include an uppercase letter, a lowercase letter and a number',
          })}
        />

        <Button type="submit" size="lg" fullWidth loading={resetForm.formState.isSubmitting}>
          Reset my password
        </Button>
      </form>
    </AuthLayout>
  );
}
