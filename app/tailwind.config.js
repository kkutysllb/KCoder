/** @type {import('tailwindcss').Config} */
export default {
  content: ['./renderer/index.html', './renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Core backgrounds (theme-aware via CSS variables, RGB 三元组以保留透明度修饰)
        'bg-primary': 'rgb(var(--color-bg-primary) / <alpha-value>)',
        'bg-sidebar': 'rgb(var(--color-bg-sidebar) / <alpha-value>)',
        'bg-surface': 'rgb(var(--color-bg-surface) / <alpha-value>)',
        'bg-input': 'rgb(var(--color-bg-input) / <alpha-value>)',
        'bg-hover': 'rgb(var(--color-bg-hover) / <alpha-value>)',
        'bg-active': 'rgb(var(--color-bg-active) / <alpha-value>)',
        
        // Text colors
        'text-primary': 'rgb(var(--color-text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--color-text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--color-text-muted) / <alpha-value>)',
        
        // Accent colors
        'accent': 'rgb(var(--color-accent) / <alpha-value>)',
        'accent-blue': 'rgb(var(--color-accent-blue) / <alpha-value>)',
        
        // Semantic status / accent colors (theme-aware via CSS variables).
        // RGB-triplet + <alpha-value> 形式以保留 /15 等透明度修饰。
        'info': 'rgb(var(--color-info) / <alpha-value>)',
        'danger': 'rgb(var(--color-error) / <alpha-value>)',
        'error': 'rgb(var(--color-error) / <alpha-value>)',
        'success': 'rgb(var(--color-success) / <alpha-value>)',
        'warning': 'rgb(var(--color-warning) / <alpha-value>)',
        'amber': 'rgb(var(--color-amber) / <alpha-value>)',
        'teal': 'rgb(var(--color-teal) / <alpha-value>)',
        'muted-icon': 'rgb(var(--color-muted-icon) / <alpha-value>)',
        'diff-add-text': 'rgb(var(--color-diff-add-text) / <alpha-value>)',
        'diff-del-text': 'rgb(var(--color-diff-del-text) / <alpha-value>)',
        'diff-hunk-text': 'rgb(var(--color-diff-hunk-text) / <alpha-value>)',

        // Floating panels / drawers (theme-aware)
        'float-bg': 'var(--color-float-bg)',
        'float-border': 'var(--color-float-border)',
        
        // Borders
        'border-custom': 'rgb(var(--color-border) / <alpha-value>)',
        'border-subtle': 'rgb(var(--color-border-subtle) / <alpha-value>)',
        'border-strong': 'rgb(var(--color-border-strong) / <alpha-value>)',
      }
    }
  },
  plugins: []
}
