---
id: vercel-react-best-practices
name: React & Next.js Best Practices
---
# React & Next.js Performance Best Practices

Guidelines from Vercel Engineering for fast React apps.

## Data Fetching

- Server-first: fetch in Server Components / route handlers; stream with Suspense.
- Cache deliberately: `fetch` cache options + `revalidateTag/Path` on mutations.
- Never fetch in effects when a loader/server component can own it.

## Rendering

- Push interactivity to the leaves; keep server-renderable trees large.
- `useMemo`/`useCallback` only after profiling shows a cost — not by default.
- Stable keys in lists; never index keys for mutable lists.
- Split heavy subtrees with `next/dynamic` / `React.lazy` + Suspense.

## Bundle

- Import icons/lodash per-item; audit with `@next/bundle-analyzer`.
- `next/image`, `next/font` by default.

## Measure First

- Profile with React DevTools Profiler / Lighthouse before optimizing.
- Set a performance budget; verify in CI.
