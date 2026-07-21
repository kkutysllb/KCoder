---
id: vercel-react-view-transitions
name: React View Transitions
---
# React View Transitions

Native-feeling animations via the View Transition API — no animation libraries.

## Core Mechanics

1. Wrap the state update: `document.startViewTransition(() => setState(...))`.
2. Or use React's `<ViewTransition>` component + `addTransitionType` for declarative usage.
3. Shared elements: assign matching `view-transition-name` on old/new elements.
4. Style via pseudo-elements: `::view-transition-old(name)` / `::view-transition-new(name)`.

## Recipes

- **Page transition**: cross-fade + slide by transition type (forward/back).
- **Shared element**: same `view-transition-name` across screens; browser interpolates geometry.
- **List reorder**: names per item; FLIP-style automatic movement.
- **Enter/exit**: keyframe animations on the old/new pseudo-elements.

## Rules

- Unique `view-transition-name` per element (duplicates break the snapshot).
- Respect `prefers-reduced-motion` — fall back to instant swap.
- Feature-detect: `'startViewTransition' in document`.
