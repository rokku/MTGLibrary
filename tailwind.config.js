/** @type {import('tailwindcss').Config} */
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
        // App surfaces — dark, high contrast (cave theme)
        surface: {
          0: '#0a0a0a',
          1: '#141414',
          2: '#1f1f1f',
          3: '#2b2b2b',
        },
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
