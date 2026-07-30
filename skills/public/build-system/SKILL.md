---
name: build-system
description: >-
  Use this skill for build tooling, package scripts, monorepo workspaces,
  bundlers, TypeScript compilation, Python packaging, task runners, and build
  failures.

package:
  type: knowledge-only
---

# Build System Skill

## Purpose

Keep build commands predictable, fast, and aligned with project structure.

## Workflow

1. Identify the canonical package manager and build runner.
2. Keep scripts explicit and composable.
3. Avoid hidden global dependencies.
4. Make workspace/package boundaries clear.
5. Verify build, typecheck, and test commands after changes.

## Review Checklist

- Lockfiles match package metadata.
- Scripts fail on errors and do not mask command output.
- Build artifacts are ignored or committed intentionally.
- CI and local commands stay aligned.
