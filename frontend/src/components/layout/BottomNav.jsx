import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

/**
 * Phone navigation.
 *
 * A bottom bar rather than a hamburger: the primary destinations are reachable
 * with a thumb, and nothing important hides behind a menu the user has to
 * discover. Hidden from `md` up, where the header takes over.
 */
export default function BottomNav({ items }) {
  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-0 bottom-0 z-30 border-b-0 border-t border-ink-200/70 shadow-nav pb-safe md:hidden"
    >
      <ul className="flex items-stretch">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'group flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium',
                  'transition-colors duration-200 active:scale-95',
                  isActive ? 'text-brand-700' : 'text-ink-500 hover:text-ink-700',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={clsx(
                      // The selected tab gets a pill behind its icon. On a
                      // phone that reads faster than a colour change alone.
                      'relative flex h-7 w-12 items-center justify-center rounded-pill',
                      'transition-[background-color,transform] duration-200 ease-out',
                      isActive
                        ? 'bg-gradient-to-b from-brand-50 to-brand-100 shadow-inset-top'
                        : 'group-active:bg-ink-100',
                    )}
                  >
                    <item.icon
                      aria-hidden="true"
                      className={clsx(
                        'h-5 w-5 transition-transform duration-200',
                        isActive && '-translate-y-px stroke-[2.4]',
                      )}
                    />
                    {item.badge > 0 && (
                      <span className="absolute right-1 top-0 flex h-4 min-w-4 items-center justify-center rounded-pill bg-gradient-to-br from-danger-500 to-danger-700 px-1 text-[0.625rem] font-bold text-white ring-2 ring-white">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    )}
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
