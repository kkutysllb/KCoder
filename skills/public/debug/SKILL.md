---
name: debug
description: >-
  Use this skill when the user reports a bug, error, crash, or unexpected behavior
  in code. Trigger on requests like "debug this", "fix this bug", "why is this
  erroring", "something is wrong", "it's not working", "investigate this issue",
  or when a stack trace, error message, or test failure is shared. Also trigger
  when the user asks to diagnose performance problems or memory leaks.

package:
  type: knowledge-only
---

# Debug Skill

## Overview

A systematic debugging workflow that moves from symptom to root cause through
evidence-gathering rather than guess-and-check. The goal is to identify the
*cause* of the bug, not just a patch that silences the symptom.

## Debugging Workflow

### Phase 1: Reproduce and Isolate

1. **Reproduce the issue.** Get a reliable reproduction — a test case, a
   script, or a sequence of actions. If you cannot reproduce it, gather
   the exact environment details (OS, runtime version, config).

2. **Read the error message carefully.** Error messages often contain the
   file, line number, and variable state at the point of failure. Do not
   skim — extract every clue.

3. **Check recent changes.** Run `git log --oneline -20` and `git diff HEAD~5`
   to see what changed recently. Most bugs are introduced in recent commits.

### Phase 2: Investigate

1. **Trace the execution path.** Start from the error location and trace
   backwards through the call stack. Use `search_code` and `read_file_lines`
   to follow the data flow.

2. **Form hypotheses.** Based on the evidence, write down 2–3 possible
   causes ranked by likelihood. For each hypothesis, identify what evidence
   would confirm or refute it.

3. **Add diagnostic output.** Insert targeted logging or use a debugger to
   observe runtime state. Focus on the variables and branches involved in
   the hypothesis you are testing.

4. **Narrow the scope.** Binary-search through the code by commenting out
   sections or adding early returns to find the exact trigger condition.

### Phase 3: Fix

1. **Fix the root cause.** The fix should address *why* the bug happened,
   not just the specific instance. A fix that only handles the reported
   case will let related bugs through.

2. **Add a regression test.** Write a test that fails before the fix and
   passes after. This is non-negotiable — without a regression test the
   bug will return.

3. **Run the full test suite.** Use `run_tests` to verify the fix does not
   break anything else.

### Phase 4: Verify

1. **Check for similar issues.** Search the codebase for the same pattern
   that caused the bug — `search_code` for similar code structures.

2. **Review the diff.** Use `git_diff` to review the complete change set.
   Make sure no debug logging or temporary code leaked into the fix.

## Common Bug Categories

### Null / None Errors
- Check where the value originates and whether it can legitimately be absent
- Prefer returning empty collections over None
- Add validation at system boundaries (API, DB, user input)

### Off-by-One Errors
- Always check loop bounds: `<` vs `<=`, `0` vs `1` indexing
- Pay attention to inclusive vs exclusive ranges
- Verify array/list index calculations

### Concurrency Issues
- Look for shared mutable state accessed from multiple threads
- Check for missing locks, deadlocks, or race conditions
- Use `git_log` to find when concurrency was introduced

### Type Errors
- Check for implicit type coercion
- Verify generic type parameters are preserved through the call chain
- Look for missing null checks on optional types

## Anti-Patterns

- **Shotgun debugging:** Making random changes hoping something works
- **Symptom fixing:** Adding a try/except to silence the error without
  understanding why it occurs
- **Over-fixing:** Rewriting an entire module when a one-line fix would
  address the root cause
- **Skipping the regression test:** "I'll add it later" means never
