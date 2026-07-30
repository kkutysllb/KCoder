---
name: rollback-recovery
description: >-
  Use this skill when a patch fails, an automatic fix becomes stale, a generated
  change is wrong, files need to be restored, or the agent must recover from a
  bad intermediate state without discarding user work.

package:
  type: knowledge-only
---

# Rollback Recovery Skill

## Purpose

Recover safely from failed or unwanted changes while protecting user edits.

## Workflow

1. Inspect current git status and identify which files the agent touched.
2. Prefer targeted reversal of agent changes over broad reset commands.
3. Use saved review/fix metadata, diffs, or Qiongqi task changes to reconstruct
   the before state.
4. Ask before destructive operations that could remove user work.
5. Verify the project diff after recovery.

## Review Checklist

- User-created changes are not reverted accidentally.
- Recovery explains which files were restored and why.
- Stale automatic fixes leave the project unchanged.
- Scratch workspace cleanup does not delete project files.
