/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand Rodziny
        rodziny: {
          900: '#1a2e0a',
          800: '#2D5016',
          700: '#3d6b1e',
          600: '#4f8828',
          500: '#65a832',
          400: '#82c44e',
          100: '#e8f5d9',
          50:  '#f4fbe8',
        },
        sidebar: {
          bg:          '#0f1117',
          border:      '#1e2330',
          hover:       '#1a1f2e',
          active:      '#1e2a14',
          text:        '#8b9bb4',
          'text-active': '#ffffff',
        },
        surface: {
          bg:     '#f8f9fa',
          card:   '#ffffff',
          border: '#e5e7eb',
          hover:  '#f3f4f6',
        },
        status: {
          green:  '#22c55e',
          yellow: '#f59e0b',
          red:    '#ef4444',
          blue:   '#3b82f6',
        },
      },
      fontFamily: {
        display: ['DM Sans', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
