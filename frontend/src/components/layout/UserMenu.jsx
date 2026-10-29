import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, User } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../context/AuthContext.jsx';
import Button from '../ui/Button.jsx';
import Avatar from '../ui/Avatar.jsx';
import Badge from '../ui/Badge.jsx';

/**
 * Which side of the platform this account is on.
 *
 * Worth saying out loud: the same person often holds more than one account
 * here - a plumber who also books an electrician for his own house - and the
 * screens look similar enough that it is easy to forget which one you are
 * signed into.
 *
 * Customer is grey where the others are coloured. The coloured three mark
 * privilege - taking money, adding people, seeing everything - and a customer
 * has none of it. Grey still answers the question, without implying rank.
 *
 * It is spelled out rather than left blank because the question is symmetric:
 * somebody needs to know they are in the account that spends just as much as
 * the one that earns, and an absent badge is a weak signal that reads like a
 * page still loading.
 */
const ROLE_BADGE = {
  customer: { label: 'Customer', variant: 'neutral' },
  provider: { label: 'Professional', variant: 'success' },
  agency: { label: 'Agency', variant: 'warning' },
  admin: { label: 'Administrator', variant: 'brand' },
};

export default function UserMenu({ links = [] }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) {
    return (
      /*
       * `shrink-0` and no wrapping on both, because this sits beside a logo
       * that is 140px wide on a phone. Flex children with no shrink floor give
       * up their width to the logo first and then wrap their own label - which
       * is how "Sign in" became two lines and "Get started" became two more on
       * a 360px handset.
       *
       * The gap tightens below `sm` as well: those eight pixels are the
       * difference between fitting and not on the narrowest phones still in
       * common use.
       */
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <Button
          as={Link}
          to="/signin"
          variant="ghost"
          size="sm"
          className="shrink-0 whitespace-nowrap px-2 sm:px-3"
        >
          Sign in
        </Button>
        <Button
          as={Link}
          to="/register"
          size="sm"
          className="shrink-0 whitespace-nowrap px-3 sm:px-4"
        >
          Get started
        </Button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={clsx(
          'flex items-center gap-2 rounded-pill p-1 pr-2 transition-[background-color,box-shadow] duration-200',
          'hover:bg-ink-100 hover:shadow-xs',
          open && 'bg-ink-100 shadow-xs',
        )}
      >
        <Avatar src={user.avatarUrl} name={user.fullName} size="sm" />
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-ink-700 sm:block">
          {user.fullName}
        </span>
        <ChevronDown aria-hidden="true" className={clsx('h-4 w-4 text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-60 origin-top-right animate-scale-in overflow-hidden
                     rounded-card bg-white py-1 shadow-pop ring-1 ring-ink-200/80"
        >
          <div className="flex items-center gap-2.5 border-b border-ink-200/80 bg-gradient-to-b from-ink-50/80 to-white px-3 py-3">
            <Avatar src={user.avatarUrl} name={user.fullName} size="md" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-ink-900">{user.fullName}</p>
                {ROLE_BADGE[user.role] && (
                  <Badge variant={ROLE_BADGE[user.role].variant} size="sm">
                    {ROLE_BADGE[user.role].label}
                  </Badge>
                )}
              </div>
              <p className="truncate text-xs text-ink-500">{user.email || user.phone}</p>
            </div>
          </div>

          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="group flex items-center gap-2.5 px-3 py-2 text-base text-ink-700 transition-colors hover:bg-brand-50/60 hover:text-brand-700"
            >
              {link.icon && (
                <link.icon
                  aria-hidden="true"
                  className="h-4 w-4 text-ink-400 transition-colors group-hover:text-brand-600"
                />
              )}
              {link.label}
            </Link>
          ))}

          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await signOut();
              navigate('/');
            }}
            className="mt-1 flex w-full items-center gap-2.5 border-t border-ink-200/80 px-3 py-2.5 text-base font-medium text-danger-600 transition-colors hover:bg-danger-50"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export { User };
