import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, ShieldCheck, Clock, BadgeIndianRupee, Star, ArrowRight, Users, CalendarCheck, UserCheck, ReceiptIndianRupee, Sparkles,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import categoryIcon from '../../lib/categoryIcon.js';
import categoryImage, { IMAGES } from '../../lib/categoryImage.js';
import { money } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

const PROMISES = [
  {
    icon: ShieldCheck,
    title: 'Verified professionals',
    body: 'Every provider is ID-checked and approved before they can take a booking.',
  },
  {
    icon: Clock,
    title: 'Book a real time slot',
    body: 'Pick from the provider actual availability, not a vague four-hour window.',
  },
  {
    icon: BadgeIndianRupee,
    title: 'Price agreed upfront',
    body: 'You see the price before you book, and the final amount before you pay.',
  },
];

/**
 * One tile in the "What do you need done?" grid.
 *
 * A photograph of the work, not a glyph: someone deciding what they need is
 * recognising a situation ("that is my leaking sink"), and a photo does that
 * in a way a droplet outline cannot. The icon is kept as the fallback for a
 * category added later that has no artwork yet, so the grid never renders an
 * empty frame.
 */
function CategoryCard({ category }) {
  const image = categoryImage(category);
  const Icon = categoryIcon(category.icon);
  // The same figure the tile shows: a category nobody is approved to work in
  // is not bookable, which is what "Coming soon" on the photograph means.
  const available = category.providerCount > 0;

  return (
    <Link
      to={'/search?category=' + category.slug}
      className="tile sheen group flex flex-col overflow-hidden rounded-card bg-white shadow-card
                 ring-1 ring-ink-200/80"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-ink-100">
        {image ? (
          <img
            src={image.src}
            srcSet={image.small + ' 384w, ' + image.src + ' 640w'}
            sizes="(min-width: 1024px) 18rem, (min-width: 640px) 33vw, 50vw"
            alt={image.alt}
            loading="lazy"
            decoding="async"
            width="640"
            height="400"
            className="h-full w-full object-cover transition-transform duration-500 ease-out
                       group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100">
            <Icon aria-hidden="true" className="h-8 w-8 text-brand-600" />
          </div>
        )}

        {/* A scrim under the name only - a full overlay would grey out the
            photograph, which is the thing worth showing. */}
        <span aria-hidden="true" className="photo-wash" />

        <p className="absolute inset-x-0 bottom-0 px-3.5 pb-3 pt-6 font-display text-lg font-bold
                      leading-tight tracking-tight text-white drop-shadow sm:text-xl">
          {category.name}
        </p>

        {!available && (
          <span className="absolute right-2.5 top-2.5 rounded-pill bg-white/90 px-2.5 py-1
                           text-sm font-medium text-ink-600 shadow-xs backdrop-blur-sm">
            Coming soon
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-3.5 py-3">
        {/* Two tiles sit side by side at 375px, leaving roughly 170px for this
            row - not enough for "4 professionals" and a price together, which
            clipped to "4 profes...". Below `sm` the count collapses to an icon
            and a figure; the full phrase returns once there is room. */}
        <span className="flex shrink-0 items-center gap-1.5 text-base text-ink-500 sm:text-md">
          {available ? (
            <>
              <Users aria-hidden="true" className="h-4 w-4 text-ink-400 sm:hidden" />
              <span className="sm:hidden">{category.providerCount}</span>
              <span className="hidden sm:inline">
                {category.providerCount}
                {category.providerCount === 1 ? ' professional' : ' professionals'}
              </span>
              <span className="sr-only">
                {category.providerCount === 1
                  ? 'professional available'
                  : 'professionals available'}
              </span>
            </>
          ) : (
            // Hidden below `sm`. Two tiles share a 375px row, and at the
            // larger type "Not yet listed" plus "From ₹299" overflowed, which
            // clipped the price to "From ₹2". The "Coming soon" chip on the
            // photograph already says this, so nothing is lost by dropping it
            // on the narrowest screens - including for a screen reader, which
            // still reads that chip.
            <span className="hidden truncate sm:inline">Not yet listed</span>
          )}
        </span>

        {category.pricing && category.pricing.min > 0 && (
          <span className="stat-accent shrink-0 text-md sm:text-lg">
            From {money(category.pricing.min)}
          </span>
        )}
      </div>
    </Link>
  );
}

/**
 * The four steps, worded from what the app actually does.
 *
 * Every claim here is enforced somewhere in the product: prices are shown
 * before booking, slots come from published availability, contact details are
 * withheld until the provider accepts, and payment is taken only after the
 * job with a code the customer reads from their email. Nothing aspirational -
 * a landing page that promises a flow the software does not have is the
 * fastest way to lose the first customer.
 *
 * The tint walks from brand to accent so the row reads as a progression and
 * lands on the step that completes it.
 */
const STEPS = [
  {
    icon: Search,
    title: 'Find a professional',
    body: 'Browse verified plumbers, electricians, carpenters and more. Prices are shown before you book.',
    tint: 'from-brand-400 to-brand-600',
  },
  {
    icon: CalendarCheck,
    title: 'Pick a real time slot',
    body: 'Choose from the times they have actually published, not a vague four-hour window.',
    tint: 'from-brand-500 to-brand-700',
  },
  {
    icon: UserCheck,
    title: 'They accept and arrive',
    body: 'Once they accept you get their contact details, and they turn up at the time you chose.',
    tint: 'from-brand-600 to-brand-800',
  },
  {
    icon: ReceiptIndianRupee,
    title: 'Pay once it is done',
    body: 'Check the final amount, read out the code from your email, and keep the invoice.',
    tint: 'from-accent-400 to-accent-600',
  },
];

/**
 * The hero artwork.
 *
 * Three photographs of the actual trades, stacked and gently drifting out of
 * phase with one another. Out of phase matters: give every card the same
 * animation and the whole group pulses as one block, which reads as a glitch
 * rather than as depth.
 *
 * Decorative in full - it carries no information the copy does not already
 * state - so the whole thing is `aria-hidden` and the images have empty alt
 * text. It is hidden below `lg`, where showing it would push the search box,
 * the one thing a visitor came to use, below the fold.
 */
function HeroArt() {
  const cards = [
    {
      image: IMAGES.electrical,
      className: 'right-0 top-2 w-64 xl:w-72',
      rotate: '3deg',
      delay: '0ms',
    },
    {
      image: IMAGES.plumbing,
      className: 'left-0 top-28 w-56 xl:top-32 xl:w-64',
      rotate: '-4deg',
      delay: '900ms',
    },
    {
      image: IMAGES['ac-repair-service'],
      className: 'bottom-2 right-10 w-52 xl:w-60',
      rotate: '-2deg',
      delay: '1800ms',
    },
  ];

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative hidden h-[25rem] w-[23rem] shrink-0 lg:block xl:h-[28rem] xl:w-[28rem]"
    >
      {/* Two soft lights behind the stack, so the cards sit in something
          rather than floating on bare white. */}
      <span className="absolute -right-12 top-0 h-56 w-56 rounded-full bg-brand-400/30 blur-3xl" />
      <span className="absolute -bottom-8 left-0 h-52 w-52 rounded-full bg-accent-400/25 blur-3xl" />

      {/* Two nested elements per card, because both the tilt and the drift
          are transforms. On one element the `float` keyframe replaces the
          whole transform and the rotation silently disappears - the cards
          rendered perfectly square. The wrapper owns the angle, the figure
          owns the motion. */}
      {cards.map((card) => (
        <div
          key={card.image.src}
          style={{ transform: 'rotate(' + card.rotate + ')' }}
          className={'absolute ' + card.className}
        >
          <figure
            style={{ animationDelay: card.delay }}
            className="overflow-hidden rounded-card bg-white p-1.5 shadow-card-hover
                       ring-1 ring-ink-900/5 motion-safe:animate-float"
          >
            <img
              src={card.image.src}
              srcSet={card.image.small + ' 384w, ' + card.image.src + ' 640w'}
              sizes="18rem"
              alt=""
              width="640"
              height="400"
              decoding="async"
              className="aspect-[16/10] w-full rounded-[0.6rem] object-cover"
            />
          </figure>
        </div>
      ))}

      {/* Two claims the rest of the page actually backs up - no invented
          ratings or job counts. */}
      <span
        style={{ animationDelay: '450ms' }}
        className="absolute left-2 top-8 flex items-center gap-2 rounded-pill bg-white/95 px-3.5 py-2
                   text-sm font-semibold text-ink-800 shadow-pop ring-1 ring-ink-900/5
                   backdrop-blur-sm motion-safe:animate-float"
      >
        <ShieldCheck className="h-4 w-4 text-brand-600" />
        ID-checked
      </span>

      <span
        style={{ animationDelay: '1350ms' }}
        className="absolute bottom-16 left-6 flex items-center gap-2 rounded-pill bg-white/95 px-3.5 py-2
                   text-sm font-semibold text-ink-800 shadow-pop ring-1 ring-ink-900/5
                   backdrop-blur-sm motion-safe:animate-float xl:bottom-20"
      >
        <BadgeIndianRupee className="h-4 w-4 text-accent-500" />
        Price agreed upfront
      </span>
    </div>
  );
}

export default function Home() {
  useDocumentTitle('Book verified local professionals');
  const navigate = useNavigate();

  const { data: categories, isLoading } = useQuery({
    queryKey: keys.categories.tree,
    queryFn: async () => (await api.get('/categories/tree')).data,
    // The catalogue barely changes, so it is cached hard.
    staleTime: 10 * 60_000,
  });

  const { data: featured } = useQuery({
    queryKey: keys.providers.featured('Bidar'),
    queryFn: async () => (await api.get('/providers/featured', { params: { limit: 4 } })).data,
    staleTime: 5 * 60_000,
  });

  function onSearch(event) {
    event.preventDefault();
    const term = new FormData(event.currentTarget).get('q');
    const trimmed = term ? String(term).trim() : '';
    navigate(trimmed ? '/search?q=' + encodeURIComponent(trimmed) : '/search');
  }

  return (
    <>
      {/* The hero carries two soft radial lights instead of a single vertical
          ramp. A linear gradient reads as a band across the page; the radials
          read as light falling on it, and they survive being cropped on a
          phone because neither one has a hard edge. */}
      <section className="relative isolate overflow-hidden border-b border-brand-100 bg-brand-50">
        <div aria-hidden="true" className="aurora absolute inset-0 -z-10" />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-brand-300/60 to-transparent"
        />
        <div className="page py-12 sm:py-16 lg:py-20">
          <div className="flex items-center justify-between gap-8 xl:gap-14">
            <div className="max-w-2xl flex-1">
            <Badge variant="brand" dot className="mb-4">
              Serving Bidar, Karnataka
            </Badge>

            <h1 className="text-3xl font-bold leading-[1.08] tracking-tight text-ink-900 sm:text-4xl lg:text-5xl">
              Verified local professionals,{' '}
              <span className="text-gradient">booked in minutes</span>
            </h1>

            <p className="mt-3 max-w-prose text-md text-ink-600 sm:text-lg">
              Plumbers, electricians, carpenters and AC technicians near you. Real availability,
              agreed prices, and someone accountable if it goes wrong.
            </p>

            <form onSubmit={onSearch} role="search" className="mt-7 flex flex-col gap-2.5 sm:flex-row">
              <label htmlFor="home-search" className="sr-only">
                What do you need help with?
              </label>
              <div className="relative flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400"
                />
                <input
                  id="home-search"
                  name="q"
                  type="search"
                  placeholder="Try a leaking tap, or AC service"
                  className="h-13 w-full rounded-field border border-ink-300 bg-white pl-11 pr-4 text-base shadow-raised transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/15"
                />
              </div>
              <Button type="submit" size="lg" className="h-13 shrink-0 px-7 sm:w-auto">
                Find a professional
              </Button>
            </form>
            </div>

            <HeroArt />
          </div>
        </div>
      </section>

      <section className="band-cool dot-grid">
        <div className="page py-10 sm:py-12">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="heading-rule text-2xl font-semibold sm:text-3xl">What do you need done?</h2>
            <p className="mt-1.5 text-md text-ink-500">Browse by the kind of work.</p>
          </div>
          {/* `shrink-0` and no wrapping: at 375px the heading beside this takes
              almost the whole row, and a flex child with no shrink floor
              collapses to its narrowest - "See" over "all", with the arrow
              stranded on the second line. */}
          <Button
            as={Link}
            to="/search"
            variant="link"
            size="sm"
            iconRight={ArrowRight}
            className="shrink-0 whitespace-nowrap"
          >
            See all
          </Button>
        </div>

        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-3">
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-card bg-white shadow-card ring-1 ring-ink-200/80">
                  <Skeleton className="aspect-[16/10] w-full rounded-none" />
                  <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                </div>
              ))
            : (categories || []).map((category) => (
                <CategoryCard key={category.id} category={category} />
              ))}
        </div>
        </div>
      </section>

      <section className="band-warm">
        <div className="promise-row page grid gap-6 py-10 sm:grid-cols-3 sm:py-12">
          {PROMISES.map((promise) => (
            <div key={promise.title} className="flex gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-field ring-1 ring-inset shadow-inset-top">
                <promise.icon aria-hidden="true" className="h-5 w-5 text-brand-600" />
              </div>
              <div>
                <h3 className="text-md font-semibold text-ink-900">{promise.title}</h3>
                <p className="mt-1 text-md leading-relaxed text-ink-500">{promise.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="relative overflow-hidden border-y border-brand-100 bg-gradient-to-b from-brand-50 via-brand-100 to-brand-50">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-hero-glow opacity-70" />

        <div className="page relative py-12 sm:py-16">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-white px-3 py-1
                             text-xs font-semibold uppercase tracking-wider text-brand-700
                             shadow-xs ring-1 ring-inset ring-brand-200">
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              Four simple steps
            </span>

            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              How it <span className="text-gradient">works</span>
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-md text-ink-600 sm:text-lg">
              From a leaking tap to a paid invoice, without a single phone call to a stranger.
            </p>
          </div>

          <ol className="stagger relative mt-12 grid gap-y-10 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-4 lg:gap-x-6">
            {/* The rail that joins the steps. It sits behind the tiles, starts
                and ends an eighth of the way in so it does not run off into
                the margins, and only exists on `lg` where the four steps are
                genuinely in a row. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-8 hidden h-0.5
                         rounded-pill bg-gradient-to-r from-brand-200 via-brand-300 to-accent-200 lg:block"
            />

            {STEPS.map((step, index) => (
              <li key={step.title} className="relative flex flex-col items-center text-center">
                <div className="relative">
                  <div
                    className={
                      'flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ' +
                      'text-white shadow-raised ring-1 ring-inset ring-white/20 ' +
                      'transition-transform duration-300 ease-out hover:scale-105 ' +
                      step.tint
                    }
                  >
                    <step.icon aria-hidden="true" className="h-7 w-7" />
                  </div>

                  <span
                    className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center
                               rounded-full bg-white font-display text-sm font-bold text-ink-800
                               shadow-card ring-1 ring-ink-200"
                  >
                    {index + 1}
                  </span>
                </div>

                <h3 className="mt-5 text-lg font-semibold text-ink-900">{step.title}</h3>
                <p className="mt-2 max-w-xs text-md leading-relaxed text-ink-600">{step.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-12 flex justify-center">
            <Button as={Link} to="/search" size="xl" iconRight={ArrowRight}>
              Book your first service
            </Button>
          </div>
        </div>
      </section>

      {featured && featured.length > 0 && (
        <section className="band-mint">
          <div className="page py-10 sm:py-12">
          <h2 className="heading-rule text-2xl font-semibold sm:text-3xl">Top rated near you</h2>
          <p className="mt-1.5 text-md text-ink-500">Professionals customers keep coming back to.</p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((provider) => (
              <Card
                key={provider.id}
                interactive
                as={Link}
                to={'/providers/' + provider.id}
                className="block p-4"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={provider.name} src={provider.avatarUrl} size="md" className="h-11 w-11" />
                  <div className="min-w-0">
                    <p className="truncate text-md font-semibold text-ink-900">{provider.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-500">
                      <Star aria-hidden="true" className="h-3.5 w-3.5 fill-accent-400 text-accent-400" />
                      <span className="font-medium text-ink-700">{provider.rating.average}</span>
                      <span>({provider.rating.count})</span>
                    </p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-ink-500">{provider.headline}</p>
                <p className="stat-accent mt-3 text-md">From {money(provider.fromPrice)}</p>
              </Card>
            ))}
          </div>
          </div>
        </section>
      )}

      <section className="bg-ink-900">
        <div className="page flex flex-col items-start gap-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:py-12">
          <div>
            <h2 className="text-xl font-semibold text-white sm:text-2xl">Do this work for a living?</h2>
            <p className="mt-1.5 max-w-prose text-base text-ink-300">
              Get verified, set your own prices and hours, and get paid for every completed job.
            </p>
          </div>
          <Button as={Link} to="/register?role=provider" size="lg" className="shrink-0">
            Join as a professional
          </Button>
        </div>
      </section>
    </>
  );
}
