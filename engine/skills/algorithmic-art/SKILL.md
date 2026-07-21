---
id: algorithmic-art
name: Algorithmic Art
---
# Algorithmic Art

Create original generative artwork with p5.js.

## Core Principles

- **Seeded randomness** — use a deterministic PRNG (e.g. mulberry32) seeded from a parameter so every render is reproducible and explorable.
- **Originality** — derive compositions from your own rule systems; never replicate a living artist's signature style.
- **Interactivity** — expose key parameters (seed, density, palette, speed) via sliders or URL params for live exploration.

## Workflow

1. Pick a generative concept: flow field, particle system, L-system, Voronoi, wave interference, recursive subdivision.
2. Implement a seeded PRNG; route ALL randomness through it.
3. Build the sketch in layers: background wash → structural geometry → detail pass → grain/texture.
4. Add interactive controls for at least: seed, palette, one structural parameter.
5. Export a high-resolution frame (e.g. 2048px) via `saveCanvas`.

## Quality Bar

- Balanced negative space; intentional palette (3–5 hues + neutrals).
- No visible grid artifacts unless intentional.
- Deterministic: same seed ⇒ identical output.
