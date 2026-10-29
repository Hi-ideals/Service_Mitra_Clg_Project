import { Outlet } from 'react-router-dom';
import { LayoutDashboard, Inbox, Calendar, Wallet, UserCog, Star } from 'lucide-react';
import AppHeader from './AppHeader.jsx';
import BottomNav from './BottomNav.jsx';
import VerificationBanner from './VerificationBanner.jsx';
import { ROLE_MENUS } from './roleMenus.js';

const NAV = [
  { to: '/provider', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/provider/requests', label: 'Requests', icon: Inbox },
  { to: '/provider/schedule', label: 'Schedule', icon: Calendar },
  { to: '/provider/earnings', label: 'Earnings', icon: Wallet },
  { to: '/provider/reviews', label: 'Reviews', icon: Star },
  { to: '/provider/profile', label: 'Profile', icon: UserCog },
];

export default function ProviderLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-50">
      <a href="#main" className="skip-link">Skip to content</a>

      <AppHeader
        navItems={NAV.map(({ to, label, end }) => ({ to, label, end }))}
        /*
          The same short menu they get on the shared account page, so the
          menu under their name does not change shape as they move around.
          Every screen is already in the navigation above; this is the jump
          list, plus the account page, which the navigation does not carry.
        */
        menuLinks={ROLE_MENUS.provider}
      />

      {/* Tells an unverified provider exactly what is still standing between
          them and their first booking. */}
      <VerificationBanner />

      <main id="main" className="page-enter flex-1 pb-safe-bottom md:pb-8">
        <Outlet />
      </main>

      <BottomNav items={NAV} />
    </div>
  );
}
