---
name: diff-analysis
description: >-
  Use this skill when analyzing project diffs, task changes, changed hunks,
  additions/deletions, file-level risk, before/after code comparisons, or
  review findings that must be grounded in concrete changed lines.

package:
  type: knowledge-only
---

# Diff Analysis Skill

## Purpose

Understand what changed before deciding whether the change is correct.

## Workflow

1. Start from the file list and classify each changed file by role and risk.
2. Read unified hunks with surrounding context, not only added lines.
3. Separate user-authored project changes from agent scratch or generated
   artifacts.
4. Link findings to file paths, hunks, task ids, or Qiongqi events.
5. Summarize impact in terms of behavior, API, data, tests, and UI.

## Review Checklist

- The analysis distinguishes project diff from Qiongqi task changes.
- Large or high-risk files are called out explicitly.
- Deleted code is reviewed as carefully as added code.
- Findings cite concrete changed files instead of generic concerns.
- No conclusion is made from a stale or missing diff.
