import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import Logo from './Logo.jsx';
import UserMenu from './UserMenu.jsx';

/**
 * The header.
 *
 * Sticky, because on a long search results page the way back to search is the
 * thing people reach for most. Desktop navigation lives here; on a phone it
 * moves to the bottom bar.
 */
export default function AppHeader({ navItems = [], menuLinks = [], children }) {
  /**
   * The header earns its shadow only once the page has moved.
   *
   * A bar that is already elevated at the top of the document looks detached
   * from a page it is actually resting on. Gaining depth on scroll is the cue
   * that content is now passing underneath it.
   */
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={clsx(
        'glass sticky top-0 z-30 transition-shadow duration-300',
        scrolled ? 'shadow-card' : 'shadow-none',
      )}
    >
      <div className="page flex h-14 items-center gap-2 sm:h-16 sm:gap-4">
        <Logo />

        {navItems.length > 0 && (
          <nav aria-label="Sections" className="hidden items-center gap-0.5 md:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'relative rounded-field px-3 py-2 text-base font-medium transition-colors duration-200',
                    isActive ? 'text-brand-700' : 'text-ink-600 hover:bg-ink-100/80 hover:text-ink-900',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* The marker is a separate element rather than a border so
                        it can grow in from the centre. A border would simply
                        appear, and the eye reads appearing as a jump. */}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-2.5 bottom-0.5 h-0.5 origin-center animate-grow-x
                                   rounded-pill bg-brand-gradient"
                      />
                    )}
                    {item.label}
                    {item.badge > 0 && (
                      <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-gradient-to-br from-danger-500 to-danger-700 px-1.5 text-xs font-bold text-white shadow-xs">
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="min-w-0 flex-1">{children}</div>

        <UserMenu links={menuLinks} />
      </div>
    </header>
  );
}
