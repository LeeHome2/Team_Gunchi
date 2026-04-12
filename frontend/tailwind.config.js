/** @type {import('tailwindcss').Config} */
module.exports = {
  // Light mode by default, dark mode activated by adding class="dark" on <html>.
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans KR', 'system-ui', 'sans-serif'],
        display: ['Inter', 'Noto Sans KR', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Foreground token. We override Tailwind's `white` so that
        // existing classes like `text-white`, `border-white/10`, `bg-white/5`
        // automatically flip between light and dark modes.
        white: 'rgb(var(--color-fg) / <alpha-value>)',

        // "navy" is the background scale. In light mode these CSS vars
        // resolve to whites/light greys; in dark mode to the original navys.
        navy: {
          400: 'rgb(var(--navy-400) / <alpha-value>)',
          500: 'rgb(var(--navy-500) / <alpha-value>)',
          600: 'rgb(var(--navy-600) / <alpha-value>)',
          700: 'rgb(var(--navy-700) / <alpha-value>)',
          800: 'rgb(var(--navy-800) / <alpha-value>)',
          850: 'rgb(var(--navy-850) / <alpha-value>)',
          900: 'rgb(var(--navy-900) / <alpha-value>)',
          950: 'rgb(var(--navy-950) / <alpha-value>)',
        },
        // Brand blue — CSS vars so it stays readable on whichever background
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
        // Cyan accents (wireframe) — these work in both modes
        cyan: {
          300: '#7FE8E4',
          400: '#4DD6D2',
          500: '#22BDB9',
          600: '#119B98',
        },
        // Yellow highlight
        accent: {
          300: '#FFE873',
          400: '#FFD93D',
          500: '#F5C518',
          600: '#D9A800',
        },
        ok: '#22C55E',
        warn: '#F59E0B',
        err: '#EF4444',
      },
      backgroundImage: {
        'grid-pattern': 'var(--blueprint-pattern)',
        'radial-glow': 'var(--radial-glow)',
        'hero-gradient': 'var(--hero-gradient)',
        'brand-gradient':
          'linear-gradient(135deg, #5288F5 0%, #77A2FF 100%)',
      },
      backgroundSize: {
        'grid-sm': '32px 32px',
        'grid-md': '56px 56px',
      },
      boxShadow: {
        glow: 'var(--shadow-glow)',
        'glow-sm': 'var(--shadow-glow-sm)',
        card: 'var(--shadow-card)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
