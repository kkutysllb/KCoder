---
name: pr-review-advanced
description: >-
  Use this skill for PR-level review that needs merge-base context, multiple
  commits, commit intent, aggregate diff, risk grouping, review decision, and
  findings across the full branch.

package:
  type: knowledge-only
---

# PR Review Advanced Skill

## Purpose

Review a branch as a coherent change set, not just as unrelated file diffs.

## Workflow

1. Resolve base ref and merge base locally.
2. Read commit subjects between merge base and `HEAD`.
3. Compare commit intent with aggregate diff and Qiongqi task changes.
4. Group findings by severity and risk area.
5. Produce a decision: pass, needs review, or request changes.

## Review Checklist

- Base ref fallback is recorded when the requested ref is unavailable.
- Findings cite files, commits, or Qiongqi events.
- Cross-file behavior changes are reviewed together.
- Large PRs include a risk summary and suggested review order.
