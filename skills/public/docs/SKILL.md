---
name: docs
description: >-
  Use this skill when writing or updating developer docs, README sections,
  API docs, architecture notes, changelogs, inline usage examples, or migration
  guidance.

package:
  type: knowledge-only
---

# Documentation Skill

## Purpose

Document behavior and decisions so future engineers can use and maintain the
system without reading every implementation detail.

## Workflow

1. Identify the reader: user, integrator, maintainer, or reviewer.
2. Document contracts, commands, configuration, and failure modes.
3. Keep examples runnable and aligned with current code.
4. Avoid restating code line by line.
5. Update docs in the same change when behavior or APIs change.

## Review Checklist

- The doc answers what, when, and how.
- Commands include required working directory or environment assumptions.
- API docs match request/response schemas.
- Migration notes call out breaking changes.
- No stale screenshots or outdated file paths.
