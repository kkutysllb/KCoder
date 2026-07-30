---
name: api-design
description: >-
  Use this skill when adding or changing HTTP APIs, RPC endpoints, request and
  response schemas, pagination, validation, status codes, or backwards-compatible
  API behavior.

package:
  type: knowledge-only
---

# API Design Skill

## Purpose

Design APIs with stable contracts, predictable errors, and clear validation.

## Workflow

1. Define the request and response schema before implementation.
2. Validate input at the API boundary and return actionable errors.
3. Use consistent status codes and error shapes from the existing project.
4. Preserve backwards compatibility unless the user explicitly wants a breaking
   change.
5. Add route-level tests for success, validation failure, and important errors.

## Review Checklist

- Field names match existing API conventions.
- Optional fields have documented defaults.
- Large lists are paginated or bounded.
- Sensitive fields are never returned by default.
- Route handlers delegate business logic to services when the project follows
  that pattern.
