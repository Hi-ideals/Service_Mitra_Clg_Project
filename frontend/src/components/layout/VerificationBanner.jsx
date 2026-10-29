import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, ShieldCheck, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * The provider's standing, stated plainly at the top of every screen.
 *
 * An unverified provider can build a profile but cannot go live, and the
 * single most frustrating version of that is not being told why. Each state
 * says what is true and what to do next.
 */
const STATES = {
  unsubmitted: {
    icon: AlertTriangle,
    className: 'border-warning-500/25 bg-gradient-to-r from-warning-50 via-warning-50 to-white text-warning-700',
    chip: 'icon-chip-warning',
    title: 'Your account is not verified yet',
    body: 'Submit your ID and address proof to start accepting bookings.',
    action: { label: 'Start verification', to: '/provider/verification' },
  },
  pending: {
    icon: Clock,
    className: 'border-info-500/25 bg-gradient-to-r from-info-50 via-info-50 to-white text-info-700',
    chip: 'icon-chip-info',
    title: 'Verification under review',
    body: 'Our team is checking your documents. You can finish setting up your profile while you wait.',
    action: { label: 'View status', to: '/provider/verification' },
  },
  info_requested: {
    icon: AlertTriangle,
    className: 'border-warning-500/25 bg-gradient-to-r from-warning-50 via-warning-50 to-white text-warning-700',
    chip: 'icon-chip-warning',
    title: 'We need more information',
    body: 'Our team has asked for something before they can approve your account.',
    action: { label: 'See what is needed', to: '/provider/verification' },
  },
  rejected: {
    icon: XCircle,
    className: 'border-danger-500/25 bg-gradient-to-r from-danger-50 via-danger-50 to-white text-danger-700',
    chip: 'icon-chip-danger',
    title: 'Verification was not approved',
    body: 'Check the reason given, correct your details and submit again.',
    action: { label: 'Re-submit', to: '/provider/verification' },
  },
  suspended: {
    icon: XCircle,
    className: 'border-danger-500/25 bg-gradient-to-r from-danger-50 via-danger-50 to-white text-danger-700',
    chip: 'icon-chip-danger',
    title: 'Your account is suspended',
    body: 'You cannot accept bookings. Contact ServiceMitra support for details.',
    action: { label: 'Contact support', to: '/help' },
  },
};

export default function VerificationBanner() {
  const { user, isProvider } = useAuth();

  if (!isProvider) return null;

  const status = user?.verificationStatus;
  if (!status || status === 'approved') return null;

  const state = STATES[status];
  if (!state) return null;

  const Icon = state.icon;

  return (
    <div className={clsx('border-b', state.className)}>
      <div className="page flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:gap-3">
        <span className={clsx('icon-chip h-9 w-9', state.chip)}>
          <Icon aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">{state.title}</p>
          <p className="text-sm opacity-90">{state.body}</p>
        </div>
        <Link
          to={state.action.to}
          className="shrink-0 rounded-field bg-white px-3.5 py-2 text-sm font-semibold shadow-xs
                     ring-1 ring-inset ring-ink-900/10 transition-[background-color,box-shadow]
                     duration-200 hover:shadow-card"
        >
          {state.action.label}
        </Link>
      </div>
    </div>
  );
}

export { ShieldCheck };
