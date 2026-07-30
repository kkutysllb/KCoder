---
name: typescript
description: >-
  Use this skill for TypeScript typing, strictness errors, generics, React prop
  types, API contracts, discriminated unions, and type-safe refactors.

package:
  type: knowledge-only
---

# TypeScript Skill

## Purpose

Use TypeScript to encode real contracts without making code harder to read.

## Workflow

1. Start from the runtime data shape and define the smallest useful type.
2. Prefer discriminated unions for variant states.
3. Keep API request/response types aligned with backend schemas.
4. Avoid `any`; use `unknown` at boundaries and narrow it.
5. Run typecheck after changes.

## Review Checklist

- Optional fields are handled before property access.
- Mutation results invalidate the correct typed query keys.
- Component props reflect actual nullable and loading states.
- Type assertions are isolated to trusted parse boundaries.
- Shared types do not leak UI-only concerns into backend contracts.
