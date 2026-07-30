---
name: using-superpowers
description: >-
  Use this meta-skill at the start of substantial Coding Agent work to decide
  which built-in Coding skills should guide the task. Trigger for multi-step
  changes, bug fixes, reviews, refactors, UI work, testing work, architecture
  changes, or whenever more than one engineering workflow might apply.

package:
  type: knowledge-only
---

# Using Superpowers Skill

## Purpose

Select the right Coding skills before acting. This prevents the agent from
using one generic workflow for every coding task.

## Workflow

1. Classify the user request: bug, implementation, review, refactor, test,
   UI, architecture, security, performance, release, or documentation.
2. Activate the smallest set of Coding skills that cover the work.
3. Prefer process skills first when they apply: debugging before fixing,
   planning before broad implementation, verification before completion.
4. Keep user instructions above skill instructions.
5. If a skill does not fit after reading the task context, do not force it.

## Skill Selection Examples

- Bug report -> `debug`, often `test-writer`, then
  `verification-before-completion`.
- New feature -> `implement`, possibly `api-design`, `frontend-engineering`,
  `database`, or `architecture`.
- PR review -> `code-review`, optionally `security-hardening`,
  `performance`, and `test-writer`.
- UI issue -> `frontend-engineering`, `ui-polish`, and
  `web-accessibility`.

## Boundary

This skill only selects and sequences OClaw Coding skills. It must not load or
mix unrelated global task skills, user memory, or non-Coding agent workflows.
