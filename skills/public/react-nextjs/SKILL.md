---
name: react-nextjs
description: >-
  Use this skill for React and Next.js coding: client/server component
  boundaries, hooks, hydration, routing, data fetching, query invalidation,
  layouts, and component composition.

package:
  type: knowledge-only
---

# React Next.js Skill

## Purpose

Build React/Next.js changes that respect rendering boundaries and existing app
patterns.

## Workflow

1. Identify whether the component is server or client.
2. Keep hooks inside client components and required providers.
3. Use existing data-fetching and query invalidation helpers.
4. Handle loading, empty, error, and stale mutation states.
5. Run typecheck and focused component/API tests.

## Review Checklist

- No hook is used outside its provider.
- Hydration-safe DOM structure is maintained.
- Mutations invalidate affected data.
- Layout changes do not unmount long-running agent/task panels accidentally.
