---
name: verification-before-completion
description: >-
  Use this skill before claiming a coding task is done, fixed, passing, or
  ready. Trigger at the end of implementations, bug fixes, refactors, review
  improvements, UI changes, and backend API changes.

package:
  type: knowledge-only
---

# Verification Before Completion Skill

## Purpose

Do not claim completion without evidence.

## Workflow

1. Identify the smallest relevant verification commands.
2. Run focused tests for touched behavior.
3. Run typecheck, lint, build, or compile checks when the touched code depends
   on them.
4. If a command cannot run, state why and what risk remains.
5. Report exact command outcomes in the final response.

## Review Checklist

- Tests cover the behavior that changed.
- Frontend code typechecks after TypeScript changes.
- Backend code compiles or imports after Python service/router changes.
- No running command is left unfinished.
- The final answer separates verified facts from assumptions.
