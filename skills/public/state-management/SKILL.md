---
name: state-management
description: >-
  Use this skill for frontend or backend state design, query caches, mutation
  invalidation, session state, optimistic updates, task state, and stale data.

package:
  type: knowledge-only
---

# State Management Skill

## Purpose

Keep state ownership, updates, and invalidation predictable.

## Workflow

1. Identify the source of truth.
2. Separate local UI state, remote query state, session state, and persisted
   state.
3. Define mutation success and failure behavior.
4. Invalidate or refresh every view affected by a mutation.
5. Handle stale and empty state explicitly.

## Review Checklist

- No component reads state outside its provider.
- Query keys are stable and scoped correctly.
- Failed mutations leave the UI understandable.
- Session/task state is isolated by thread or project where needed.
