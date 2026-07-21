---
id: slidev
name: Slidev
---
# Slidev

Web-based slide decks for developers, written in Markdown.

## Setup

```bash
npm init slidev@latest   # scaffold slides.md + deps
npm run dev              # live preview with HMR
```

## Authoring Rules

- One `---` separator per slide; keep ≤ 6 content lines per slide.
- Frontmatter: `theme`, `title`, `transition`, `highlighter`.
- Code blocks: language tag + line highlighting (`{2-4}` after the fence info).
- Speaker notes below `<!--` on each slide.
- Use `<v-click>` for progressive reveal; layouts (`two-cols`, `image-right`) for structure.

## Presenting

- `npm run dev` → presenter mode (`/presenter`) with notes + next-slide preview.
- Export: `npm run export` (PDF) or `build` for static hosting.

## Quality Bar

- Consistent theme; code samples must compile.
- Animations serve pacing — never decorative-only.
