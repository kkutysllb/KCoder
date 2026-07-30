---
name: migration
description: >-
  Use this skill for code migrations, framework upgrades, API transitions,
  data/schema migrations, file layout moves, and compatibility shims.

package:
  type: knowledge-only
---

# Migration Skill

## Purpose

Move systems from old behavior to new behavior without breaking existing users.

## Workflow

1. Inventory old entry points and consumers.
2. Decide whether compatibility shims are needed.
3. Migrate in small steps with tests at each boundary.
4. Keep data migrations restart-safe and reversible when possible.
5. Remove dead compatibility code only after callers have moved.

## Review Checklist

- Old and new paths are both understood.
- Breaking changes are explicit.
- Migration order prevents half-migrated states.
- Tests cover both upgraded behavior and important legacy compatibility.
