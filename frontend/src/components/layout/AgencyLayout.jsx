import { Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, CalendarRange, ShieldCheck, Building2 } from 'lucide-react';
import AppHeader from './AppHeader.jsx';
import BottomNav from './BottomNav.jsx';

/**
 * The agency console.
 *
 * Four destinations, so it keeps the phone bottom bar rather than the admin
 * sidebar: an agency owner is far more likely to be standing in a workshop
 * than sitting at a desk.
 */
const NAV = [
  { to: '/agency', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/agency/team', label: 'My team', icon: Users },
  { to: '/agency/jobs', label: 'Jobs', icon: CalendarRange },
  { to: '/agency/verification', label: 'Verification', icon: ShieldCheck },
];

const MENU = [
  { to: '/agency/profile', label: 'Agency profile', icon: Building2 },
];

export default function AgencyLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-50">
      <a href="#main" className="skip-link">Skip to content</a>
      <AppHeader navItems={NAV} menuLinks={MENU} />

      <main id="main" className="page page-enter flex-1 py-5 pb-safe-bottom sm:py-7 md:pb-7">
        <Outlet />
      </main>

      <BottomNav items={NAV} />
    </div>
  );
}
