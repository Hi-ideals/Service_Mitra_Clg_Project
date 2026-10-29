/**
 * Category photography.
 *
 * Imported rather than referenced by a string path so Vite fingerprints each
 * file, serves it with a long cache lifetime, and fails the build if one is
 * ever deleted - a broken `/images/plumbing.webp` would otherwise only show
 * up as a gap on the live home page.
 *
 * Two widths per category: the browser picks via `srcSet`, so a phone does
 * not download a 640px image to paint it at 170px.
 */
import plumbing from '../assets/categories/plumbing.webp';
import plumbingSm from '../assets/categories/plumbing@sm.webp';
import electrical from '../assets/categories/electrical.webp';
import electricalSm from '../assets/categories/electrical@sm.webp';
import carpentry from '../assets/categories/carpentry.webp';
import carpentrySm from '../assets/categories/carpentry@sm.webp';
import acRepair from '../assets/categories/ac-repair-service.webp';
import acRepairSm from '../assets/categories/ac-repair-service@sm.webp';
import appliance from '../assets/categories/appliance-repair.webp';
import applianceSm from '../assets/categories/appliance-repair@sm.webp';
import cctv from '../assets/categories/cc-tv-security.webp';
import cctvSm from '../assets/categories/cc-tv-security@sm.webp';

const IMAGES = {
  plumbing: { src: plumbing, small: plumbingSm, alt: 'A plumber fitting a pipe under a sink' },
  electrical: { src: electrical, small: electricalSm, alt: 'An electrician working on a consumer unit' },
  carpentry: { src: carpentry, small: carpentrySm, alt: 'A carpenter fitting a cabinet hinge' },
  'ac-repair-service': { src: acRepair, small: acRepairSm, alt: 'A technician servicing a wall-mounted air conditioner' },
  'appliance-repair': { src: appliance, small: applianceSm, alt: 'A technician repairing a washing machine' },
  'cc-tv-security': { src: cctv, small: cctvSm, alt: 'A technician installing a CCTV camera' },
};

/**
 * Returns the artwork for a category, or null when there is none.
 *
 * A category added later has no photo until one is added here, and the caller
 * is expected to fall back to the icon rather than render an empty frame.
 * `category.imageUrl` from the API wins when it is set, so artwork can be
 * changed without a deploy.
 */
export default function categoryImage(category) {
  if (!category) return null;

  if (category.imageUrl) {
    return { src: category.imageUrl, small: category.imageUrl, alt: category.name };
  }

  return IMAGES[category.slug] ?? null;
}

export { IMAGES };
