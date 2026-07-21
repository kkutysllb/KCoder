---
id: brand-guidelines
name: Brand Guidelines
---
# Brand Guidelines

Apply the project's official brand system to any visual artifact.

## Workflow

1. **Locate the brand source** — look for design tokens, style guides, or brand docs in the repo (`design/`, `docs/brand*`, `tokens.json`, CSS variables).
2. **Extract the system**:
   - Primary / secondary / accent palette (exact hex values)
   - Typography: heading + body families, weights, scale ratios
   - Spacing unit, border radii, elevation rules
3. **Apply consistently** — every color, font, and spacing value in the artifact must come from the brand system; no ad-hoc values.
4. **Fallbacks** — if no brand source exists, ask the user for the palette/fonts before inventing values.

## Rules

- Never substitute a brand color with a "close enough" hex.
- Preserve contrast ratios: check text on brand backgrounds meets WCAG AA.
- Logos: use provided assets only; never redraw or recolor a logo.
