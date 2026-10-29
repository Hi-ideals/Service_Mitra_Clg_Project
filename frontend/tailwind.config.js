/**
 * Design tokens.
 *
 * The palette is taken from the ServiceMitra logo rather than chosen beside it:
 * the hues below were sampled from the artwork itself, so the brand blue here
 * is the same blue as the wordmark, and the accent is the orange-to-red of
 * "Mitra". Semantic names are used everywhere in components (`bg-brand-600`),
 * never raw hex, which is what made this rebrand a change to one file.
 *
 * Sampled anchors: #0C3E90 primary blue, #122057 deep navy, #1C90E9 highlight,
 * #F7AA3C gold, #EA7228 orange, #DD3313 red.
 *
 * The light end of the brand ramp is mixed from the highlight blue, not from
 * the primary. Tinting a dark navy toward white drains its chroma and the 50
 * and 100 steps come out grey, which reads as a dirty background rather than a
 * brand one.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F1F8FE',
          100: '#E1F1FC',
          200: '#C4E2F9',
          300: '#99CDF5',
          400: '#60B1F0',
          500: '#1363B8',
          600: '#0C3E90',
          700: '#0E3279',
          800: '#102867',
          900: '#122057',
        },
        ink: {
          50: '#F6F8FA',
          100: '#EEF2F6',
          200: '#DDE4EC',
          300: '#C9D4DE',
          400: '#94A3B4',
          500: '#5A6672',
          600: '#3F4A56',
          700: '#2B3743',
          800: '#1C2733',
          900: '#14293F',
        },
        /**
         * The "Mitra" gradient, kept in order: gold, orange, red.
         *
         * White on accent-500 is 3.03:1, which is enough for a large label or
         * an icon but not for body text. Accent carries badges, prices and
         * highlights; anything small and white sits on accent-600 (4.61:1).
         */
        accent: {
          50: '#FEF5F0',
          100: '#FCE8DD',
          400: '#F7AA3C',
          500: '#EA7228',
          600: '#DD3313',
        },
        success: { 50: '#ECFDF5', 100: '#D1FAE5', 500: '#10B981', 600: '#059669', 700: '#047857' },
        warning: { 50: '#FFFBEB', 100: '#FEF3C7', 500: '#F59E0B', 600: '#D97706', 700: '#B45309' },
        danger: { 50: '#FEF2F2', 100: '#FEE2E2', 500: '#EF4444', 600: '#DC2626', 700: '#B91C1C' },
        info: { 50: '#EFF6FF', 100: '#DBEAFE', 500: '#3B82F6', 600: '#2563EB', 700: '#1D4ED8' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        /**
         * Headings get their own face.
         *
         * Inter is a superb UI typeface and a merely adequate display one - at
         * 30px and above its even widths read as flat. Plus Jakarta Sans has
         * more personality in the caps and a tighter, warmer feel, which is
         * what makes a hero look designed rather than defaulted. Body copy
         * stays Inter, where legibility beats character.
         */
        display: ['Plus Jakarta Sans', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // A tighter scale than the default: marketplace UI is dense, and the
        // default 16/18/20 jumps waste vertical space on a phone.
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        md: ['0.9375rem', { lineHeight: '1.5rem' }],
        lg: ['1.0625rem', { lineHeight: '1.625rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
        '5xl': ['3rem', { lineHeight: '1.1' }],
      },
      borderRadius: {
        card: '1rem',
        field: '0.75rem',
        pill: '9999px',
      },
      /**
       * Layered shadows rather than single blurs.
       *
       * A real object casts a tight contact shadow and a wide soft one. One
       * blur reads as a grey smudge; two read as height, which is what makes
       * a card feel liftable rather than printed on.
       */
      boxShadow: {
        xs: '0 1px 2px rgba(20, 41, 63, 0.05)',
        card: '0 1px 2px rgba(20, 41, 63, 0.04), 0 2px 8px -2px rgba(20, 41, 63, 0.06)',
        'card-hover':
          '0 2px 4px rgba(20, 41, 63, 0.05), 0 12px 28px -6px rgba(20, 41, 63, 0.12), 0 24px 48px -12px rgba(20, 41, 63, 0.10)',
        raised:
          '0 1px 2px rgba(20, 41, 63, 0.06), 0 8px 20px -6px rgba(20, 41, 63, 0.10)',
        sheet: '0 -4px 24px rgba(20, 41, 63, 0.12)',
        pop: '0 4px 12px -2px rgba(20, 41, 63, 0.10), 0 16px 40px -8px rgba(20, 41, 63, 0.16)',
        focus: '0 0 0 3px rgba(12, 62, 144, 0.22)',
        /* An inner highlight along the top edge, which is what makes a solid
           button look lit rather than painted. */
        btn: 'inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 1px 2px rgba(18, 32, 87, 0.28)',
        'btn-hover': 'inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 4px 12px -2px rgba(18, 32, 87, 0.36)',
        /**
         * Coloured light, not grey.
         *
         * A neutral shadow under a brand-coloured element reads as dirt. A
         * shadow tinted with the element's own hue reads as the thing glowing,
         * which is what makes a primary action feel alive on hover.
         */
        'glow-brand': '0 1px 2px rgba(18, 32, 87, 0.22), 0 8px 24px -6px rgba(28, 144, 233, 0.45)',
        'glow-brand-lg': '0 2px 4px rgba(18, 32, 87, 0.20), 0 16px 40px -8px rgba(28, 144, 233, 0.50)',
        'glow-danger': '0 1px 2px rgba(185, 28, 28, 0.20), 0 8px 24px -6px rgba(239, 68, 68, 0.42)',
        'glow-accent': '0 1px 2px rgba(221, 51, 19, 0.22), 0 8px 24px -6px rgba(234, 114, 40, 0.42)',
        /* The bar a phone's thumb reaches for: lifted off the content, not
           floating away from it. */
        nav: '0 -1px 0 rgba(20, 41, 63, 0.06), 0 -8px 24px -12px rgba(20, 41, 63, 0.14)',
        /* A single lit top edge, for tinted surfaces that should look convex. */
        'inset-top': 'inset 0 1px 0 rgba(255, 255, 255, 0.70)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #122057 0%, #0C3E90 55%, #1363B8 100%)',
        /**
         * The warm counterpart to brand-gradient, for the one action on a
         * page that is otherwise blue.
         *
         * Burnt orange through the brand orange into a deep rose. Every stop
         * clears 4.5:1 against white - 5.18, 4.61 and 5.87 - so the label
         * stays readable wherever the gradient happens to sit behind it,
         * including while it slides on hover.
         */
        'sunset-gradient': 'linear-gradient(135deg, #C2410C 0%, #DD3313 50%, #C2185B 100%)',
        'brand-sheen': 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 60%)',
        'hero-glow':
          'radial-gradient(60rem 30rem at 12% -10%, rgba(28, 144, 233, 0.18) 0%, transparent 60%), radial-gradient(45rem 26rem at 95% 0%, rgba(234, 114, 40, 0.14) 0%, transparent 62%)',
        /**
         * Three overlapping soft lights instead of one flat tint.
         *
         * Layered radials never resolve into a visible band the way a linear
         * gradient does, so a large area of brand colour stays interesting at
         * full-screen size. Used behind the auth panel and the hero.
         */
        aurora:
          'radial-gradient(40rem 32rem at 8% 8%, rgba(28, 144, 233, 0.30) 0%, transparent 60%), radial-gradient(34rem 28rem at 92% 14%, rgba(247, 170, 60, 0.22) 0%, transparent 62%), radial-gradient(44rem 34rem at 55% 100%, rgba(12, 62, 144, 0.45) 0%, transparent 65%)',
        /* A faint engineering grid: structure without decoration. */
        grid: 'linear-gradient(rgba(221, 228, 236, 0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(221, 228, 236, 0.55) 1px, transparent 1px)',
        /* The travelling highlight on a skeleton or a hovered button. */
        sheen: 'linear-gradient(105deg, transparent 35%, rgba(255, 255, 255, 0.45) 50%, transparent 65%)',
        /* Top-edge light for glass surfaces. */
        'glass-edge': 'linear-gradient(180deg, rgba(255, 255, 255, 0.60), rgba(255, 255, 255, 0) 40%)',
      },
      backgroundSize: {
        grid: '2rem 2rem',
      },
      height: {
        /* Between h-12 and h-14: the hero search needs to outrank an ordinary
           field without becoming a banner. */
        13: '3.25rem',
      },
      spacing: {
        // Bottom navigation height plus the iOS home indicator, so content
        // scrolled to the end is never hidden behind the bar.
        'safe-bottom': 'calc(4rem + env(safe-area-inset-bottom))',
      },
      maxWidth: {
        content: '78rem',
        prose: '42rem',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pop-in': {
          from: { transform: 'scale(0.96)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        /* Content arriving: a short rise with the fade, which reads as the
           page settling rather than blinking into place. */
        'rise-in': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'scale-in': {
          from: { transform: 'scale(0.97)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
        /* An expanding ring, for a live indicator that should not blink. */
        'pulse-ring': {
          '0%': { transform: 'scale(0.85)', opacity: '0.7' },
          '70%, 100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        /* Slides a wide gradient across its own box. The background has to be
           oversized for this to move rather than just recolour. */
        'gradient-pan': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'sheen-sweep': {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(120%)' },
        },
        /* The marker under a selected tab, growing from its centre. */
        'grow-x': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s infinite',
        'pop-in': 'pop-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        float: 'float 5s ease-in-out infinite',
        'rise-in': 'rise-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in': 'scale-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.24, 0, 0.38, 1) infinite',
        'gradient-pan': 'gradient-pan 6s ease infinite',
        'sheen-sweep': 'sheen-sweep 1.1s ease-out',
        'grow-x': 'grow-x 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionTimingFunction: {
        /* Decelerating, so movement arrives rather than stops dead. */
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
