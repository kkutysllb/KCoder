---
id: web-design-guidelines
name: Web Design Guidelines
---
# Web Design Guidelines Review

Audit UI code against established interface guidelines.

## Audit Dimensions

1. **Accessibility (WCAG 2.1 AA)**
   - Contrast ≥ 4.5:1 text, 3:1 large text/UI parts
   - Keyboard operability + visible focus; logical tab order
   - ARIA only when semantics fall short; labels on all inputs
2. **Semantics** — landmarks, heading hierarchy, button vs link, form labels.
3. **Interaction** — hit targets ≥ 44px, disabled state communication, loading/error/empty states.
4. **Responsive** — fluid layouts, no horizontal scroll, touch vs pointer adaptations.
5. **Platform conventions** — native-feeling controls, motion ≤ 300ms, reduced-motion support.

## Output Format

Per finding: severity (blocker/major/minor) → location → guideline violated → concrete fix.

## Rules

- Run automated checks (axe/lighthouse) AND manual keyboard pass.
- Never dismiss "minor" contrast issues — they compound.
