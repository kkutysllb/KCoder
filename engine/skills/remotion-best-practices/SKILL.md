---
id: remotion-best-practices
name: Remotion Best Practices
---
# Remotion Best Practices

Video creation in React with Remotion.

## Core Patterns

- **Everything is a function of frame** — derive all animation state from `useCurrentFrame()`; no imperative timelines.
- **Compositions** — one `<Composition>` per video variant; keep `durationInFrames`, `fps`, dimensions explicit.
- **Motion** — prefer `interpolate()` with easing and `interpolateColors()`; clamp inputs.
- **Sequencing** — use `<Sequence>` for timeline layout; `spring()` for physics-feel entrances.
- **Assets** — `staticFile()` for media; `<Audio>`/`<Video>` components with `startFrom`/`endAt`.

## Rendering

- Preview with `npx remotion studio`; render with `npx remotion render`.
- Choose codec deliberately (h264 for compatibility, prores for grading).
- Render at composition fps; never fake timing with CSS animations.

## Pitfalls

- Time-based (`Date.now`) logic breaks deterministic rendering — forbidden.
- Heavy per-frame computation → precompute outside the component.
