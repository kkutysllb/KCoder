---
name: test-writer
description: >-
  Use this skill when the coding task requires adding, fixing, or improving
  automated tests. Trigger on requests mentioning tests, pytest, vitest, jest,
  regression coverage, failing tests, test gaps, snapshots, fixtures, or TDD.

package:
  type: knowledge-only
---

# Test Writer Skill

## Purpose

Create focused automated tests that prove behavior, catch regressions, and keep
the review surface small.

## Workflow

1. Identify the behavior contract before touching implementation code.
2. Prefer the narrowest test level that proves the behavior: unit for pure
   logic, integration for API/data boundaries, and E2E only for critical flows.
3. Write or update the failing test first when fixing a bug or changing
   behavior.
4. Use realistic inputs and avoid over-mocking the code under test.
5. Run the specific test file, then the relevant broader suite.

## Review Checklist

- Test name states the behavior, not the implementation.
- The test fails for the expected reason before the fix.
- Fixtures are local, minimal, and easy to read.
- Edge cases cover empty input, invalid input, and boundary values when relevant.
- No sleep-based timing assertions unless the project already uses that pattern.
