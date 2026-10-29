import { Link } from 'react-router-dom';
import { Compass, Home, Search } from 'lucide-react';
import Button from '../components/ui/Button.jsx';
import useDocumentTitle from '../hooks/useDocumentTitle.js';

export default function NotFound() {
  useDocumentTitle('Page not found');

  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden px-4 text-center">
      {/* The glow and grid stop a dead end from also looking like a broken
          page - a bare 404 on white reads as the app having given up. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-hero-glow" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-grid bg-[length:2.5rem_2.5rem] opacity-40
                   [mask-image:radial-gradient(28rem_18rem_at_50%_40%,#000,transparent)]"
      />

      <div className="relative">
        <div className="relative mx-auto mb-6 w-fit">
          <span
            aria-hidden="true"
            className="absolute -inset-6 rounded-full bg-brand-500/15 blur-2xl"
          />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-card bg-gradient-to-b from-white to-ink-100 shadow-card ring-1 ring-inset ring-ink-200">
            <Compass aria-hidden="true" className="h-8 w-8 text-brand-600 motion-safe:animate-float" />
          </div>
        </div>

        <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">
          404
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-ink-900">We cannot find that page</h1>
        <p className="mx-auto mt-2.5 max-w-sm text-md text-ink-500">
          The link may be out of date, or the page may have moved.
        </p>

        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Button as={Link} to="/" icon={Home}>
            Go to the home page
          </Button>
          <Button as={Link} to="/search" variant="secondary" icon={Search}>
            Find a professional
          </Button>
        </div>
      </div>
    </div>
  );
}
