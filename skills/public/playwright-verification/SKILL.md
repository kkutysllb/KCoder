---
name: playwright-verification
description: >-
  Use this skill when verifying frontend changes with Playwright-style browser
  automation, screenshots, console logs, network requests, interactions, and
  responsive viewport checks.

package:
  type: knowledge-only
---

# Playwright Verification Skill

## Purpose

Verify user-facing frontend behavior through real browser interactions.

## Workflow

1. Identify the route, state, and viewport to test.
2. Open the page and wait for meaningful content, not only network idle.
3. Exercise the actual control or workflow the user cares about.
4. Inspect console errors and failed network requests.
5. Capture screenshots when layout or visual state is relevant.

## Review Checklist

- The tested URL matches the running dev environment.
- Interactions cover collapsed/expanded, tab, modal, or drag/drop states when
  those were changed.
- Console and network failures are reported with exact messages.
- Browser verification complements, not replaces, unit/type tests.
