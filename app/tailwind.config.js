/** @type {import('tailwindcss').Config} */
export default {
  content: ['./renderer/index.html', './renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Core backgrounds (theme-aware via CSS variables)
        'bg-primary': 'var(--color-bg-primary)',
        'bg-sidebar': 'var(--color-bg-sidebar)',
        'bg-surface': 'var(--color-bg-surface)',
        'bg-input': 'var(--color-bg-input)',
        'bg-hover': 'var(--color-bg-hover)',
        'bg-active': 'var(--color-bg-active)',
        
        // Text colors
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        
        // Accent colors
        'accent': 'var(--color-accent)',
        'accent-blue': 'var(--color-accent-blue)',
        
        // Borders
        'border-custom': 'var(--color-border)',
        'border-subtle': 'var(--color-border-subtle)',
        'border-strong': 'var(--color-border-strong)',
      }
    }
  },
  plugins: []
}
