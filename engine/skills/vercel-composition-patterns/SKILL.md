---
id: vercel-composition-patterns
name: React Composition Patterns
---
# React Composition Patterns

Refactor toward composition that scales.

## Smell → Pattern

| Smell | Pattern |
|---|---|
| Boolean prop proliferation (`isX`, `withY`, `showZ`) | **Compound components** — expose parts, let callers compose |
| Deeply threaded config props | **Context** — only when state genuinely crosses levels |
| "Wrapper hell" around shared behavior | **Render props / children-as-function** or hooks |
| One giant component with 15 props | **Slots** — `header`, `content`, `footer` as ReactNode props |

## Compound Component Recipe

1. Parent owns shared state; exposes it via context (internal).
2. Children consume context; parent validates allowed children.
3. Public API = components, not props: `<Tabs><TabList><Tab/></TabList><TabPanel/></Tabs>`.

## React 19 Notes

- `forwardRef` unnecessary — ref is a regular prop.
- `use()` API for conditional context/Promise consumption.
- Actions (`useActionState`, `useFormStatus`) replace manual form state.

## Rules

- Composition is a means, not an end — don't compound a component with one use.
