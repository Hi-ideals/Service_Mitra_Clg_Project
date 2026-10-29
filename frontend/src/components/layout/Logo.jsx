import { Link } from 'react-router-dom';
import clsx from 'clsx';

import lockup from '../../assets/logo/servicemitra-lockup.webp';
import mark from '../../assets/logo/servicemitra-mark.webp';

/**
 * The ServiceMitra logo.
 *
 * The artwork is a single image rather than the drawn mark and separate
 * wordmark this used to be: the lockup has a mascot, a gradient wordmark and a
 * tagline, none of which survive being rebuilt in SVG by hand.
 *
 * Both files are keyed to transparency, so they sit on the tinted headers and
 * the footer glow without a white rectangle around them. Intrinsic dimensions
 * are declared so the header does not reflow as the image decodes - the logo is
 * the first thing on the page, and a shifting header is the most visible layout
 * jump there is.
 */

/**
 * Heights, not widths.
 *
 * The lockup is three and a half times as wide as it is tall, so every step up
 * in height costs three and a half times as much width. `md` is capped by the
 * header it lives in: that bar is 56px on a phone and 64px above it, and a
 * logo taller than `h-11` leaves no breathing room above and below.
 *
 * The phone step is `h-9`, not `h-10`. At 40px the lockup is 140px wide, which
 * fits a 375px viewport and does not fit a 360px one - the sign-in and
 * get-started labels wrapped to two lines each on a real handset.
 *
 * Below 360px it drops again to `h-8`. At 36px the lockup is 126px, and on a
 * 320px screen that left the get-started button sitting flush against the
 * right edge with the page one pixel wider than the viewport.
 *
 * `lg` is for the footer and the sign-in page, which have the room to let the
 * tagline actually be legible.
 */
const SIZES = {
  sm: 'h-8 sm:h-9',
  md: 'h-8 min-[360px]:h-9 sm:h-11',
  lg: 'h-12 sm:h-14 lg:h-16',
};

const MARK_SIZES = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-14 w-14',
};

export default function Logo({ to = '/', className, showWordmark = true, size = 'md' }) {
  const src = showWordmark ? lockup : mark;

  return (
    <Link
      to={to}
      className={clsx(
        'inline-flex shrink-0 items-center rounded-field',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
        className,
      )}
      aria-label="ServiceMitra home"
    >
      <img
        src={src}
        alt="ServiceMitra"
        width={showWordmark ? 900 : 258}
        height={258}
        className={clsx(
          'w-auto object-contain',
          showWordmark ? SIZES[size] : MARK_SIZES[size],
        )}
      />
    </Link>
  );
}
