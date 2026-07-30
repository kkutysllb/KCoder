---
name: vertical-slice-development
description: >-
  Use this skill when implementing a feature end-to-end through UI, API,
  service, persistence, tests, and documentation in small reviewable slices.

package:
  type: knowledge-only
---

# Vertical Slice Development Skill

## Purpose

Deliver usable increments instead of disconnected layers.

## Workflow

1. Pick one user-visible scenario.
2. Implement the thinnest path through frontend, backend, and storage needed
   for that scenario.
3. Add tests at the most valuable boundaries.
4. Verify the slice before expanding scope.
5. Repeat with the next scenario.

## Review Checklist

- Each slice can be demonstrated.
- Data contracts are exercised end-to-end.
- UI states and backend errors are both handled.
- The diff is small enough to review.
