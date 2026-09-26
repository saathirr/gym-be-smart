/** @type {import('tailwindcss').Config} */

// Every surface and foreground colour is a CSS variable so that `index.css` can
// swap the whole palette per theme. The `rgb(var(--x) / <alpha-value>)` form is
// required: the codebase uses opacity modifiers such as `bg-gym-900/90` and
// `border-gym-800/80`, which only work when the variable holds bare RGB
// channels rather than a finished colour.
//
// Dark values reproduce the previous hard-coded palette exactly, so the dark
// dashboard is unchanged. Light values invert the ramps while preserving the
// meaning of each step: gym-* stays surface/bordered, slate-* stays foreground
// with a higher step meaning more prominent text.
const rgb = (token) => `rgb(var(${token}) / <alpha-value>)`;

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        gym: {
          50: rgb('--gym-50'),
          100: rgb('--gym-100'),
          200: rgb('--gym-200'),
          300: rgb('--gym-300'),
          400: rgb('--gym-400'),
          500: rgb('--gym-500'),
          600: rgb('--gym-600'),
          700: rgb('--gym-700'),
          800: rgb('--gym-800'),
          850: rgb('--gym-850'),
          900: rgb('--gym-900'),
          950: rgb('--gym-950'),
        },

        // Table row separators only. Cards deliberately have no border token:
        // they are separated by the shadow-card elevation in light mode and by
        // the surface luminance step in dark mode.
        hairline: rgb('--hairline'),

        // Foreground ramp only - the app never uses slate as a surface.
        slate: {
          100: rgb('--slate-100'),
          200: rgb('--slate-200'),
          300: rgb('--slate-300'),
          400: rgb('--slate-400'),
          500: rgb('--slate-500'),
        },

        // Only the 300/400 steps are variable. The 500 steps stay pinned to
        // Tailwind's defaults because they are used as button fills, where
        // white text needs to keep working against the vivid brand colour.
        rose: { 300: rgb('--rose-300'), 400: rgb('--rose-400') },
        emerald: { 300: rgb('--emerald-300'), 400: rgb('--emerald-400') },
        amber: { 300: rgb('--amber-300'), 400: rgb('--amber-400') },
        sky: { 300: rgb('--sky-300'), 400: rgb('--sky-400') },
        violet: { 300: rgb('--violet-300'), 400: rgb('--violet-400') },

        // Sampled from public/logo.jpg. `gold` is the logo colour for fills
        // and accents; `gold-strong` and `gold-deep` are the text-safe steps,
        // because the raw logo gold is only 2.17:1 on white.
        brand: {
          gold: rgb('--brand-gold'),
          'gold-strong': rgb('--brand-gold-strong'),
          'gold-deep': rgb('--brand-gold-deep'),
          ink: rgb('--brand-ink'),
          cyan: rgb('--brand-cyan'),
          emerald: rgb('--brand-emerald'),
          violet: rgb('--brand-violet'),
          amber: rgb('--brand-amber'),
          rose: rgb('--brand-rose'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Elevation stands in for the removed card borders. In dark mode these
        // resolve to no shadow at all, because a drop shadow cannot separate a
        // surface from a near-black page.
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        pop: 'var(--shadow-pop)',
        'glow-gold': '0 0 20px -3px rgba(211, 172, 17, 0.4)',
      }
    },
  },
  plugins: [],
}
