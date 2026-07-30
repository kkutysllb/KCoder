---
name: error-handling
description: >-
  Use this skill when improving exceptions, API error responses, retries,
  timeout handling, stale-state errors, user-facing failure messages, or
  recoverability.

package:
  type: knowledge-only
---

# Error Handling Skill

## Purpose

Make failures explicit, actionable, and safe.

## Workflow

1. Classify the failure: validation, permission, stale state, unavailable
   dependency, timeout, conflict, or internal bug.
2. Handle errors at system boundaries with consistent response shapes.
3. Preserve root-cause details in logs while keeping user messages concise.
4. Avoid swallowing exceptions silently.
5. Test important failure paths.

## Review Checklist

- Error messages tell the caller what can be done next.
- Sensitive details are not exposed to users.
- Retries are bounded and only used for transient failures.
- Frontend mutation errors are visible in the relevant panel.
