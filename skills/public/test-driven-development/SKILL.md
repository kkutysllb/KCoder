---
name: test-driven-development
description: >-
  Use this skill when implementing behavior changes or bug fixes where a
  focused failing test can be written first. Trigger on TDD, regression test,
  bug fix, behavior change, edge case, or when tests are missing for risky code.

package:
  type: knowledge-only
---

# Test-Driven Development Skill

## Purpose

Prove that a test catches the intended behavior before writing the fix.

## Workflow

1. Write the smallest test that expresses the desired behavior or regression.
2. Run that test and confirm it fails for the expected reason.
3. Implement the minimal code needed to pass.
4. Re-run the focused test.
5. Run the relevant broader suite before completion.

## Boundary

Use judgment for UI polish, configuration, or generated files where test-first
is not practical. When skipping test-first, state the reason and still verify
with the best available command.
