---
id: web-artifacts-builder
name: Web Artifacts Builder
---
# Web Artifacts Builder

Build elaborate multi-component web artifacts with modern tooling.

## Stack

- **React** — component decomposition, hooks for state
- **Tailwind CSS** — utility-first styling, design tokens via config
- **shadcn/ui** — accessible primitives (Dialog, Tabs, Table, Command...)

## When to Use

- Artifacts needing state management across components
- Multi-view artifacts (routing/tabs with real navigation)
- Anything requiring shadcn/ui component quality

## NOT For

- Simple single-file HTML/JSX artifacts — keep those simple.

## Workflow

1. Decompose UI into a component tree; identify shared state owners.
2. Scaffold (Vite + React + Tailwind + shadcn init).
3. Build leaf components first, compose upward.
4. Wire state at the lowest common ancestor; lift only when needed.
5. Polish: keyboard nav, focus states, responsive breakpoints.
