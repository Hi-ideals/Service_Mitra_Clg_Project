import { Link } from 'react-router-dom';
import { ShieldCheck, Clock, BadgeIndianRupee, Star } from 'lucide-react';
import Logo from '../../components/layout/Logo.jsx';

const POINTS = [
  { icon: ShieldCheck, text: 'Every professional is ID-checked before they can take a booking' },
  { icon: Clock, text: 'Book a real slot from their actual availability' },
  { icon: BadgeIndianRupee, text: 'Agreed prices, with an invoice for every job' },
];

/**
 * The shell around every auth screen.
 *
 * On a phone it is just the form - the marketing panel would push the fields
 * below the fold, and someone signing in wants the fields.
 */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-dvh">
      <div className="relative flex w-full flex-col px-4 py-6 sm:px-6 lg:w-[52%] lg:px-12">
        {/* A whisper of brand light at the top of the form side, so the two
            halves read as one page rather than a white panel bolted to a
            dark one. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-hero-glow"
        />

        <div className="relative">
          <Logo size="lg" />
        </div>

        <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="mt-2 text-md text-ink-500">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-center text-base text-ink-500">{footer}</div>}
        </div>

        <p className="relative mx-auto w-full max-w-sm text-center text-xs text-ink-400">
          By continuing you agree to the{' '}
          <Link to="/about" className="link-grow underline-offset-2 hover:text-ink-600">
            terms of service
          </Link>
          .
        </p>
      </div>

      <div className="relative hidden overflow-hidden bg-ink-900 lg:flex lg:w-[48%]">
        {/* Three overlapping lights rather than one linear fade. A single
            gradient over this much area resolves into a visible band; layered
            radials never do. */}
        <div aria-hidden="true" className="absolute inset-0 bg-aurora" />
        {/* A faint grid gives the light something to fall on. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-grid bg-[length:2.5rem_2.5rem] opacity-[0.07]"
        />

        <div className="relative flex flex-col justify-center px-12">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-pill bg-white/10 px-3 py-1 text-xs font-medium text-brand-200 ring-1 ring-inset ring-white/15 backdrop-blur-sm">
            <Star aria-hidden="true" className="h-3.5 w-3.5 fill-accent-400 text-accent-400" />
            Trusted across Bidar
          </span>

          <h2 className="mt-5 font-display text-4xl font-bold leading-tight tracking-tight text-white">
            Local work,
            <br />
            done properly.
          </h2>
          <p className="mt-4 max-w-md text-md leading-relaxed text-ink-300">
            ServiceMitra connects you with verified plumbers, electricians, carpenters and AC
            technicians in Bidar.
          </p>

          <ul className="mt-9 space-y-4">
            {POINTS.map((point) => (
              <li key={point.text} className="flex gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-field bg-white/10 ring-1 ring-inset ring-white/15 backdrop-blur-sm">
                  <point.icon aria-hidden="true" className="h-[1.125rem] w-[1.125rem] text-brand-300" />
                </span>
                <span className="pt-1.5 text-base leading-relaxed text-ink-200">{point.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
