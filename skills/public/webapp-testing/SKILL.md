---
name: webapp-testing
description: >-
  Use this skill when verifying local web applications, frontend interactions,
  browser console errors, layout regressions, hydration errors, route behavior,
  and end-to-end UI workflows.

package:
  type: knowledge-only
---

# Webapp Testing Skill

## Purpose

Verify frontend behavior in a browser-like environment instead of relying only
on static code inspection.

## Workflow

1. Identify the local dev server URL and the user flow to test.
2. Reproduce the interaction with browser automation when available.
3. Check console errors, network failures, hydration warnings, and visible UI
   state.
4. Capture screenshots for layout-sensitive changes.
5. Pair browser verification with unit/type tests for the touched code.

## Review Checklist

- The tested route matches the user's environment.
- Network failures identify the failing URL and status when possible.
- Layout checks include relevant collapsed/expanded or tab states.
- Canvas or media-heavy screens are checked for nonblank rendering.
- The final report separates browser-observed behavior from code assumptions.
