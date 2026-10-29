import { Outlet } from 'react-router-dom';
import { Home, Search, CalendarCheck, User, Star, FileText } from 'lucide-react';
import AppHeader from './AppHeader.jsx';
import AppFooter from './AppFooter.jsx';
import BottomNav from './BottomNav.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { HOME_FOR_ROLE } from '../../routes/guards.jsx';
import { ROLE_MENUS } from './roleMenus.js';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/bookings', label: 'Bookings', icon: CalendarCheck },
  { to: '/account', label: 'Account', icon: User },
];

const MENU = [
  { to: '/account', label: 'My account', icon: User },
  { to: '/bookings', label: 'My bookings', icon: CalendarCheck },
  { to: '/invoices', label: 'Invoices', icon: FileText },
  { to: '/reviews', label: 'My reviews', icon: Star },
];


/**
 * What a professional or an agency is offered on these pages.
 *
 * They reach this layout for one reason: the account page, which is shared
 * by every role. Showing them Home, Find a professional and My bookings
 * there offers a customer's journey to somebody who cannot take it - the
 * booking screens refuse them, because those are the customer's.
 *
 * So they get the way back to their own side of the application instead.
 */
function visitorNav(role) {
  const home = HOME_FOR_ROLE[role];
  if (!home || home === '/') return null;
  return [{ to: home, label: 'Back to my dashboard', end: true }];
}

export default function CustomerLayout() {
  const { isAuthenticated, isCustomer, role } = useAuth();

  // A guest is treated as a customer-in-waiting: they are browsing to book.
  const shopping = !isAuthenticated || isCustomer;
  const elsewhere = isAuthenticated && !isCustomer ? visitorNav(role) : null;

  const navItems = isAuthenticated
    ? NAV
    : NAV.filter((n) => n.to !== '/bookings' && n.to !== '/account');

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">Skip to content</a>

      <AppHeader
        navItems={
          elsewhere ?? [
            { to: '/', label: 'Home', end: true },
            { to: '/search', label: 'Find a professional' },
            ...(isAuthenticated ? [{ to: '/bookings', label: 'My bookings' }] : []),
          ]
        }
        menuLinks={shopping ? MENU : ROLE_MENUS[role] ?? []}
      />

      {/* The bottom padding clears the phone navigation bar. */}
      <main id="main" className="page-enter flex-1 pb-safe-bottom md:pb-0">
        <Outlet />
      </main>

      <AppFooter />

      {shopping && isAuthenticated && <BottomNav items={navItems} />}
    </div>
  );
}
