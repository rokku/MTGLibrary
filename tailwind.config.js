/** @type {import('tailwindcss').Config} */

// App colours are CSS variables holding "R G B" triplets (see globals.css), so
// themes and the user's accent swap at runtime without touching components.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (name, steps) => Object.fromEntries(steps.map((s) => [s, v(`${name}-${s}`)]));

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // MTG mana colours for pips
        mana: {
          w: '#f8f6d8',
          u: '#0e68ab',
          b: '#5c5350',
          r: '#d3202a',
          g: '#00733e',
          c: '#a7a29e',
        },
        // App surfaces, darkest first (cave theme)
        surface: scale('surface', [0, 1, 2, 3]),
        // Text greys, tinted toward the theme rather than flat grey
        neutral: scale('neutral', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        accent: v('accent'),
        'on-accent': v('on-accent'),
      },
      fontFamily: {
        sans: ['"Figtree Variable"', 'Figtree', 'system-ui', '-apple-system', 'sans-serif'],
      },
      minHeight: {
        tap: '44px',
      },
      minWidth: {
        tap: '44px',
      },
    },
  },
  plugins: [],
};
