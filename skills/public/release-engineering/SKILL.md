---
name: release-engineering
description: >-
  Use this skill for versioning, changelogs, release notes, packaging,
  deployment readiness, rollback planning, and release risk checks.

package:
  type: knowledge-only
---

# Release Engineering Skill

## Purpose

Prepare changes for shipping with clear version impact, verification, and
rollback awareness.

## Workflow

1. Identify user-visible changes and compatibility risks.
2. Verify build, tests, packaging, and runtime configuration.
3. Update changelog or release notes when the project uses them.
4. Check migrations and feature flags before release.
5. Define rollback or mitigation steps for risky changes.

## Review Checklist

- Version and changelog entries match the change type.
- Build artifacts are generated from current source.
- Release commands are reproducible.
- Config defaults are safe for existing installations.
- Known limitations are documented before shipping.
