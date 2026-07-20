/** @type {import('tailwindcss').Config} */
export default {
  content: ['./renderer/index.html', './renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Core backgrounds
        'bg-primary': '#0d0d0d',
        'bg-sidebar': '#1e1e20',
        'bg-input': '#2a2a2c',
        'bg-hover': '#2a2a2c',
        'bg-active': '#333336',
        
        // Text colors
        'text-primary': '#e4e4e7',
        'text-secondary': '#a1a1aa',
        'text-muted': '#71717a',
        
        // Accent colors
        'accent': '#ff9f00',
        'accent-blue': '#0ea5e9',
        
        // Border
        'border-custom': '#333336',
      }
    }
  },
  plugins: []
}
