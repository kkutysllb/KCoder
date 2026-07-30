---
name: systematic-debugging
description: >-
  Use this skill for bugs, crashes, failing tests, unexpected behavior, slow
  flows, integration failures, or frontend/backend errors that need root-cause
  analysis before fixing.

package:
  type: knowledge-only
---

# Systematic Debugging Skill

## Purpose

Find the root cause before changing code.

## Workflow

1. Read the full error message, stack trace, logs, and failing request.
2. Reproduce the issue or identify what data is missing to reproduce it.
3. Trace the failing value or request across component boundaries.
4. Compare against a similar working path in the codebase.
5. Form one hypothesis and test it with the smallest useful check.
6. Fix the root cause and add a regression test when possible.

## Review Checklist

- The fix addresses where the bad state originates.
- No broad refactor is mixed into the bug fix.
- Logs added for diagnosis are either removed or converted to useful structured
  diagnostics.
- The final response states the verified cause, not just the symptom.
