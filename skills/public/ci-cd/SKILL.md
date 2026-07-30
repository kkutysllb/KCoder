---
name: ci-cd
description: >-
  Use this skill for CI pipelines, build scripts, test workflows, lint/typecheck
  gates, release jobs, caching, artifacts, and environment setup.

package:
  type: knowledge-only
---

# CI/CD Skill

## Purpose

Keep automated checks reliable, fast, and aligned with local developer commands.

## Workflow

1. Find the canonical local commands for test, lint, typecheck, and build.
2. Mirror those commands in CI instead of inventing divergent scripts.
3. Cache dependencies only with stable lockfile keys.
4. Separate quick PR checks from heavier release jobs.
5. Make failure output easy to diagnose.

## Review Checklist

- CI runs the checks that protect the changed code.
- Environment variables are explicit and documented.
- Secrets are only used in trusted jobs.
- Artifacts are named and retained intentionally.
- Scripts fail fast and do not hide command failures.
