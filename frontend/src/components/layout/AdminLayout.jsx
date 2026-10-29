import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, ShieldCheck, Layers, CalendarRange,
  MessageSquareWarning, Star, Wallet, Settings, FileText, Users, DatabaseBackup, ScrollText,
} from 'lucide-react';
import AppHeader from './AppHeader.jsx';

const SECTIONS = [
  {
    title: 'Overview',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/admin/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/admin/people', label: 'Directory', icon: Users },
    ],
  },
  {
    title: 'Marketplace',
    items: [
      { to: '/admin/verification', label: 'Verification', icon: ShieldCheck },
      { to: '/admin/categories', label: 'Categories', icon: Layers },
      { to: '/admin/bookings', label: 'Bookings', icon: CalendarRange },
    ],
  },
  {
    title: 'Trust and money',
    items: [
      { to: '/admin/disputes', label: 'Disputes', icon: MessageSquareWarning },
      { to: '/admin/reviews', label: 'Reviews', icon: Star },
      { to: '/admin/payouts', label: 'Payouts', icon: Wallet },
      { to: '/admin/backup', label: 'Backup', icon: DatabaseBackup },
      { to: '/admin/audit', label: 'Audit Logs', icon: ScrollText },
      { to: '/admin/settings', label: 'Settings', icon: Settings },
    ],
  },
];

/**
 * The admin console.
 *
 * A persistent sidebar on desktop, because admins move between sections
 * constantly. Below `lg` it collapses to a horizontal scroller rather than a
 * bottom bar - there are too many destinations for five thumb-sized tabs.
 */
export default function AdminLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-50">
      <a href="#main" className="skip-link">Skip to content</a>
      <AppHeader />

      <div className="flex flex-1 items-start">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 overflow-y-auto border-r border-ink-200 bg-white px-3 py-5 lg:block">
          {SECTIONS.map((section) => (
            <div key={section.title} className="mb-6">
              <p className="px-3 pb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-400">
                {section.title}
              </p>
              <nav className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      clsx(
                        'group relative flex items-center gap-2.5 rounded-field px-3 py-2 text-base font-medium',
                        'transition-[background-color,color,box-shadow] duration-200',
                        isActive
                          ? 'bg-gradient-to-r from-brand-50 to-brand-50/40 text-brand-700 shadow-xs'
                          : 'text-ink-600 hover:bg-ink-100/80 hover:text-ink-900',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {/* A marker on the rail rather than a filled block:
                            the active row keeps the same weight as the others,
                            so the list still reads as a list. */}
                        {isActive && (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-1.5 -left-3 w-1 rounded-r-pill bg-brand-gradient"
                          />
                        )}
                        <item.icon
                          aria-hidden="true"
                          className={clsx(
                            'h-[1.125rem] w-[1.125rem] shrink-0 transition-colors',
                            isActive ? 'text-brand-600' : 'text-ink-400 group-hover:text-ink-600',
                          )}
                        />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>
            </div>
          ))}
        </aside>

        <div className="min-w-0 flex-1">
          <nav
            aria-label="Admin sections"
            className="no-scrollbar glass sticky top-14 z-20 flex gap-1.5 overflow-x-auto px-3 py-2.5 sm:top-16 lg:hidden"
          >
            {SECTIONS.flatMap((s) => s.items).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm font-medium',
                    'transition-[background-color,box-shadow,color] duration-200',
                    isActive
                      ? 'bg-brand-gradient text-white shadow-glow-brand'
                      : 'bg-white text-ink-600 shadow-xs ring-1 ring-inset ring-ink-200 hover:bg-ink-50',
                  )
                }
              >
                <item.icon aria-hidden="true" className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <main id="main" className="page-enter px-4 py-5 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
