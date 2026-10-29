import { Link } from 'react-router-dom';
import { MapPin, Mail, ShieldCheck } from 'lucide-react';
import Logo from './Logo.jsx';

const COLUMNS = [
  {
    title: 'Services',
    links: [
      { label: 'Plumbing', to: '/search?category=plumbing' },
      { label: 'Electrical', to: '/search?category=electrical' },
      { label: 'AC repair', to: '/search?category=ac-repair-service' },
      { label: 'Carpentry', to: '/search?category=carpentry' },
    ],
  },
  {
    title: 'For providers',
    links: [
      { label: 'Join as a professional', to: '/register?role=provider' },
      { label: 'How verification works', to: '/for-providers' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Help and support', to: '/help' },
    ],
  },
];

export default function AppFooter() {
  return (
    <footer className="relative mt-auto overflow-hidden border-t border-ink-200 bg-white">
      {/* A faint wash at the top edge, so the footer reads as the end of the
          page rather than one more white panel stacked on it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-hero-glow opacity-60"
      />

      <div className="page relative grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo size="lg" />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-500">
            Verified local professionals for plumbing, electrical, carpentry, AC repair and more.
          </p>

          <p className="mt-4 inline-flex items-center gap-1.5 rounded-pill bg-gradient-to-b from-brand-50 to-brand-100 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
            Every professional is ID-checked
          </p>
        </div>

        {COLUMNS.map((column) => (
          <div key={column.title}>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              {column.title}
            </h4>
            <ul className="mt-3.5 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    to={link.to}
                    className="link-grow text-base text-ink-600 hover:text-brand-600"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="relative border-t border-ink-200/80">
        <div className="page flex flex-col items-center justify-between gap-2 py-4 text-sm text-ink-500 sm:flex-row">
          <p>© {new Date().getFullYear()} ServiceMitra. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <MapPin aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />
              Bidar, Karnataka
            </span>
            <Link to="/help" className="inline-flex items-center gap-1.5 hover:text-brand-600">
              <Mail aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />
              Contact
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
