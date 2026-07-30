---
name: patch-authoring
description: >-
  Use this skill when producing code patches, one-click fixes, deterministic
  automatic fixes, minimal diffs, stale-safe replacements, or applyable changes.

package:
  type: knowledge-only
---

# Patch Authoring Skill

## Purpose

Create the smallest safe patch that solves the verified problem.

## Workflow

1. Identify the exact file and text range that owns the change.
2. Prefer a small replacement over a broad rewrite.
3. Preserve formatting, imports, public contracts, and nearby style.
4. Make automatic patches stale-safe by validating expected current content.
5. After applying, refresh diff and run focused verification.

## Review Checklist

- The patch changes only files needed for the behavior.
- Generated fix metadata includes expected text and replacement intent when
  used by one-click apply.
- Ambiguous logic, security-sensitive edits, and dependency upgrades require
  human review instead of automatic application.
- Patch failure messages explain stale state or unsafe targets clearly.
