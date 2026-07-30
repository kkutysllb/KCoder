---
name: observability
description: >-
  Use this skill for logging, metrics, tracing, diagnostics, runtime events,
  telemetry, audit trails, and debugging visibility.

package:
  type: knowledge-only
---

# Observability Skill

## Purpose

Add enough runtime visibility to diagnose failures without leaking sensitive
data or producing noisy logs.

## Workflow

1. Identify the component boundary where visibility is missing.
2. Log structured facts: operation, identifiers, counts, duration, outcome.
3. Avoid logging secrets, tokens, large payloads, or full user data.
4. Emit events where the existing runtime has an event stream.
5. Add tests for event contracts when consumers depend on them.

## Review Checklist

- Logs identify request/session/task context when available.
- Error logs include enough detail to act on.
- High-volume paths avoid per-item noise.
- Telemetry fields are stable and documented when used by UI.
- Diagnostic code is not left as ad hoc console spam.
