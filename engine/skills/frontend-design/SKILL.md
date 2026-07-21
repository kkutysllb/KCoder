---
id: frontend-design
name: Frontend Design
---
# Frontend Design

Create distinctive, production-grade frontend interfaces with high design quality.

## Design Principles

### 1. Respect the Existing System
- Read the project's design tokens (CSS variables, Tailwind config, theme files) first
- Follow established component patterns — don't invent parallel conventions
- Match the existing spacing scale, border radii, and typography hierarchy

### 2. Visual Hierarchy
- One primary action per view; everything else is secondary
- Use size, weight, and contrast — not color alone — to establish hierarchy
- Group related elements with proximity; separate unrelated ones with space

### 3. Spacing Rhythm
- Use consistent spacing multiples (4px/8px grid)
- Section padding > card padding > element gaps (decreasing inward)
- Never leave awkward gaps: every margin should be intentional

### 4. Micro-interactions
- Hover/focus/active states on all interactive elements
- Transitions 150-250ms for color/opacity, 200-350ms for transform
- Loading states for anything async; skeleton screens for content areas

### 5. Responsive Behavior
- Design for the actual container, not just viewport breakpoints
- Test mental model: what happens at 320px, 768px, 1440px?
- Prefer flexible layouts (grid/flex) over fixed widths

## Anti-patterns to Avoid

- ❌ Generic gradient hero sections with centered text
- ❌ Cards with no clear purpose or hierarchy
- ❌ More than 2 font families or 5 font sizes in one view
- ❌ Decorative elements that add noise without aiding comprehension
- ❌ Ignoring empty states, error states, and loading states

## Output Quality Bar

Every UI you produce should look like it was designed by a senior product designer: intentional, polished, and coherent with the surrounding application.
