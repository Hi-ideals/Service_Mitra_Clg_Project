import { forwardRef } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

/**
 * Variants.
 *
 * The primary action is a gradient rather than a flat fill, and its shadow is
 * tinted with its own hue - a grey shadow under a teal button reads as dirt,
 * a teal one reads as the button glowing. `group` is set on the element so the
 * sheen overlay below can react to hover.
 */
const VARIANTS = {
  primary:
    'bg-brand-gradient bg-[length:180%_100%] bg-left text-white shadow-btn ' +
    'ring-1 ring-inset ring-black/15 ' +
    'hover:bg-right hover:shadow-glow-brand active:bg-brand-800 active:bg-none',
  secondary:
    'bg-white text-ink-800 ring-1 ring-inset ring-ink-300 shadow-xs ' +
    'hover:bg-ink-50 hover:ring-ink-400 hover:shadow-card active:bg-ink-100',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200',
  /**
   * The second brand colour, for the one action on a blue page.
   *
   * The gradient slides rather than lightens on hover, the same trick the
   * primary button uses: the fill is 180% wide and the background position
   * moves from left to right, so the colour shifts without any stop going
   * pale. Every stop clears 4.5:1 against white, which a flat accent-500
   * does not - it is about 3:1, and that is unreadable on a phone held in
   * Bidar sunshine.
   */
  accent:
    'bg-sunset-gradient bg-[length:180%_100%] bg-left text-white shadow-btn ' +
    'ring-1 ring-inset ring-black/15 ' +
    'hover:bg-right hover:shadow-glow-accent active:brightness-95',
  danger:
    'bg-gradient-to-br from-danger-500 to-danger-700 text-white shadow-btn ' +
    'ring-1 ring-inset ring-black/15 ' +
    'hover:shadow-glow-danger active:from-danger-700 active:to-danger-700',
  subtle:
    'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 ' +
    'hover:bg-brand-100 hover:ring-brand-200 active:bg-brand-200',
  link: 'text-brand-600 hover:text-brand-700 underline underline-offset-4 hover:no-underline',
};

/** Variants that sit flat in the text flow and must not move when pressed. */
const FLAT = new Set(['ghost', 'link']);

/** Variants solid enough to carry the travelling highlight. */
const SHEEN = new Set(['primary', 'danger']);

const SIZES = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-field',
  md: 'h-10 px-4 text-base gap-2 rounded-field',
  lg: 'h-12 px-6 text-md gap-2 rounded-field',
  xl: 'h-13 px-8 text-md gap-2.5 rounded-field',
  icon: 'h-10 w-10 rounded-field',
  'icon-sm': 'h-8 w-8 rounded-field',
};

const ICON_SIZE = {
  sm: 'h-4 w-4',
  md: 'h-[1.125rem] w-[1.125rem]',
  lg: 'h-[1.125rem] w-[1.125rem]',
  xl: 'h-5 w-5',
  icon: 'h-[1.125rem] w-[1.125rem]',
  'icon-sm': 'h-4 w-4',
};

/**
 * The button.
 *
 * `loading` keeps the label in place and swaps the icon, so the button does
 * not change width mid-click and shift everything around it.
 */
const Button = forwardRef(function Button(
  {
    as: Component = 'button',
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    fullWidth = false,
    icon: Icon,
    iconRight: IconRight,
    className,
    children,
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const iconClass = ICON_SIZE[size] ?? ICON_SIZE.md;

  return (
    <Component
      ref={ref}
      disabled={Component === 'button' ? isDisabled : undefined}
      aria-busy={loading || undefined}
      aria-disabled={isDisabled || undefined}
      className={clsx(
        'group relative inline-flex select-none items-center justify-center overflow-hidden font-medium',
        'transition-[background-position,box-shadow,transform,color,background-color] duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none',
        // A press that moves is the cheapest way to make a button feel real.
        // Suppressed while disabled, so a dead button never pretends to respond.
        !FLAT.has(variant) && !isDisabled && 'active:translate-y-px active:duration-75',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {/* The travelling highlight.
          It sweeps across the whole face, label included - that is what a
          gloss actually does, and masking it to the background only would read
          as a seam moving behind the text. Pointer-events are off so it can
          never intercept the click, and it is absent entirely when the user
          has asked for reduced motion. */}
      {SHEEN.has(variant) && !isDisabled && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden bg-sheen opacity-0
                     group-hover:animate-sheen-sweep group-hover:opacity-100
                     motion-safe:block"
        />
      )}

      {loading ? (
        <Loader2 aria-hidden="true" className={clsx('animate-spin', iconClass)} />
      ) : (
        Icon && <Icon aria-hidden="true" className={iconClass} />
      )}
      {children}
      {IconRight && !loading && (
        <IconRight
          aria-hidden="true"
          className={clsx(iconClass, 'transition-transform duration-200 group-hover:translate-x-0.5')}
        />
      )}
    </Component>
  );
});

export default Button;
