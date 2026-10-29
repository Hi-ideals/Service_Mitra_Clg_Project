import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { User, Lock, LogOut, ShieldCheck, Phone, Mail } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Alert from '../../components/ui/Alert.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import TwoFactorCard from '../../components/account/TwoFactorCard.jsx';
import MailServerCard from '../../components/account/MailServerCard.jsx';

export default function Account() {
  useDocumentTitle('My account');
  const { user, reloadUser, signOut, isAdmin } = useAuth();
  const toast = useToast();
  const [passwordError, setPasswordError] = useState(null);

  const profileForm = useForm({ defaultValues: { fullName: user?.fullName || '' } });
  const passwordForm = useForm({ defaultValues: { currentPassword: '', newPassword: '' } });

  async function saveProfile(values) {
    try {
      await api.patch('/auth/me', values);
      await reloadUser();
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function changePassword(values) {
    setPasswordError(null);
    try {
      await api.post('/auth/password/change', values);
      passwordForm.reset();
      // The API revokes every other session on a password change, including
      // this one, so the honest thing is to send them back to sign in.
      toast.success('Password changed. Please sign in again.');
      await signOut();
    } catch (err) {
      setPasswordError(err.message);
    }
  }

  if (!user) return null;

  return (
    <div className="page max-w-3xl py-6 sm:py-8">
      <PageHeader icon={User} title="My account" />

      <div className="mt-5 space-y-4">
        <Card>
          <CardBody className="flex items-center gap-4">
            <Avatar src={user.avatarUrl} name={user.fullName} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-ink-900">{user.fullName}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
                {user.phone && (
                  <span className="flex items-center gap-1">
                    <Phone aria-hidden="true" className="h-3.5 w-3.5" />
                    {user.phone}
                    {user.phoneVerified && <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-success-600" />}
                  </span>
                )}
                {user.email && (
                  <span className="flex items-center gap-1">
                    <Mail aria-hidden="true" className="h-3.5 w-3.5" />
                    {user.email}
                  </span>
                )}
              </div>
            </div>
            <Badge variant="brand" className="hidden sm:inline-flex">
              {user.role === 'provider' ? 'Professional' : user.role === 'admin' ? 'Admin' : 'Customer'}
            </Badge>
          </CardBody>
        </Card>

        {!user.phoneVerified && !user.emailVerified && (
          <Alert variant="warning" title="Your contact details are not confirmed">
            Confirm your phone number so you receive booking updates.
          </Alert>
        )}

        <Card>
          <CardHeader title="Your details" />
          <CardBody>
            <form onSubmit={profileForm.handleSubmit(saveProfile)} className="space-y-4">
              <Input
                label="Full name"
                icon={User}
                error={profileForm.formState.errors.fullName?.message}
                {...profileForm.register('fullName', { required: 'Enter your full name' })}
              />
              <Button type="submit" loading={profileForm.formState.isSubmitting}>
                Save changes
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Password"
            subtitle="Changing your password signs you out of every device."
          />
          <CardBody>
            <form onSubmit={passwordForm.handleSubmit(changePassword)} className="space-y-4">
              {passwordError && <Alert variant="error">{passwordError}</Alert>}

              <Input
                label="Current password"
                type="password"
                icon={Lock}
                autoComplete="current-password"
                error={passwordForm.formState.errors.currentPassword?.message}
                {...passwordForm.register('currentPassword', { required: 'Enter your current password' })}
              />

              <Input
                label="New password"
                type="password"
                icon={Lock}
                autoComplete="new-password"
                hint="At least 8 characters, with an uppercase letter, a lowercase letter and a number."
                error={passwordForm.formState.errors.newPassword?.message}
                {...passwordForm.register('newPassword', {
                  required: 'Choose a new password',
                  minLength: { value: 8, message: 'At least 8 characters' },
                  validate: (value) =>
                    (/[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value)) ||
                    'Include an uppercase letter, a lowercase letter and a number',
                })}
              />

              <Button type="submit" variant="secondary" loading={passwordForm.formState.isSubmitting}>
                Change password
              </Button>
            </form>
          </CardBody>
        </Card>

        {/* Admins only, for now. An admin account can read every customer's
            details and download the whole database, so it is the one worth
            protecting with a second factor first. */}
        {isAdmin && <TwoFactorCard />}

        {/* Below two-factor, deliberately: both are about how the platform is
            secured, and whoever can send mail from this domain can send
            password resets. */}
        {isAdmin && <MailServerCard />}

        <Card>
          <CardBody>
            <Button variant="ghost" icon={LogOut} onClick={signOut} className="text-danger-600 hover:bg-danger-50">
              Sign out
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
