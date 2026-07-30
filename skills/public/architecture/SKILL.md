---
name: architecture
description: >-
  Use this skill for module design, boundaries, dependency direction, service
  extraction, core engine design, plugin systems, and cross-cutting technical
  decisions.

package:
  type: knowledge-only
---

# Architecture Skill

## Purpose

Shape code so each component has a clear responsibility, stable contract, and
controlled dependency direction.

## Workflow

1. Map the current ownership boundaries and call flow.
2. Identify which layer owns the behavior: UI, API, service, domain, storage,
   runtime, or integration.
3. Define contracts before implementation: input, output, failure modes, and
   persistence format.
4. Keep the first version narrow and testable.
5. Document any boundary that future work will depend on.

## Review Checklist

- The new abstraction removes real complexity or protects an actual boundary.
- Core logic is not coupled to UI state or transport details.
- Storage and runtime paths are explicit and do not pollute user projects.
- Existing extension mechanisms are reused before inventing new ones.
- Tests cover contracts across important boundaries.
