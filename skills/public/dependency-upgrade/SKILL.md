---
name: dependency-upgrade
description: >-
  Use this skill for dependency upgrades, package manager changes, vulnerability
  remediation, lockfile updates, SDK migrations, and version compatibility work.

package:
  type: knowledge-only
---

# Dependency Upgrade Skill

## Purpose

Upgrade dependencies safely while controlling compatibility and regression risk.

## Workflow

1. Identify why the upgrade is needed: security, bug fix, feature, or platform
   compatibility.
2. Read the relevant changelog or migration notes when available.
3. Upgrade the smallest dependency set that solves the need.
4. Run tests that cover integration points using the dependency.
5. Note breaking changes and follow-up cleanup separately.

## Review Checklist

- Lockfile changes match manifest changes.
- No unrelated package churn.
- Public API usage is updated for breaking changes.
- Security fixes include the vulnerable package path when known.
- Runtime configuration still matches the upgraded library.
