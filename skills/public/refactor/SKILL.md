---
name: refactor
description: >-
  Use this skill when the user asks to refactor, clean up, restructure, or
  improve code quality without changing behavior. Trigger on requests like
  "refactor this", "clean up this code", "simplify this function", "extract
  this method", "reduce duplication", "improve code structure", "remove dead
  code", or when reviewing code that has maintainability issues. Also trigger
  for design-pattern introductions and architecture improvements.

package:
  type: knowledge-only
---

# Refactor Skill

## Overview

Refactoring changes the internal structure of code without changing its
external behavior. Every refactoring session must preserve correctness —
verified by existing tests or new characterization tests written before
the refactor begins.

## Pre-Refactor Checklist

Before changing any code:

1. **Ensure tests exist and pass.** Run `run_tests` first. If test coverage
   is thin, write characterization tests that capture current behavior
   before refactoring.

2. **Establish a baseline.** Use `git_status` to confirm a clean working
   tree. Commit or stash unrelated changes so the refactor diff is isolated.

3. **Define the goal.** Write down what "better" means for this code:
   readability, performance, testability, extensibility, or removing
   duplication. A refactoring without a clear goal tends to wander.

## Refactoring Workflow

### Step 1: Understand the Current Design

Read all the code that will be affected. Use `read_file_lines` and
`search_code` to map out:

- Public API surface (what callers depend on)
- Internal dependencies between components
- Data flow and state mutations

### Step 2: Apply Refactorings Incrementally

Make one refactoring at a time, running tests after each change. Small
steps make failures easy to localize.

**Common refactorings:**

- **Extract Function** — Move a code block into a named function when the
  block has a single purpose or is duplicated.

- **Extract Class** — Split a class that has grown beyond a single
  responsibility.

- **Rename** — Improve names to reveal intent. Use `search_code` to find
  all references before renaming.

- **Move** — Relocate a function or field to the module/class that owns
  the data it operates on.

- **Replace Conditional with Polymorphism** — Replace type-checking
  conditionals with a type hierarchy.

- **Replace Magic Number with Named Constant** — Give context-free
  literals a meaningful name.

- **Consolidate Conditional Expression** — Merge a sequence of checks
  that lead to the same result.

- **Replace Inheritance with Delegation** — When a subclass uses only a
  fraction of its parent's interface.

### Step 3: Verify After Each Step

1. Run the relevant tests
2. Check `git_diff` to review what changed
3. If tests fail, revert and retry with a smaller step

### Step 4: Commit in Logical Units

Commit frequently with clear messages:

```
refactor: extract validation logic from process_order
refactor: rename OrderManager to OrderService
refactor: replace if-else chain with strategy pattern
```

## When NOT to Refactor

- **During a bug fix** — Fix the bug first, refactor later. Mixing a
  behavior change with a refactor makes the fix hard to review.

- **Right before a release** — Refactorings can introduce subtle regressions.
  Schedule them when the team has time to deal with fallout.

- **Without tests** — If you cannot verify behavior is unchanged, do not
  refactor. Write tests first.

- **"Drive-by" refactorings** — Changing unrelated code while working on
  something else. Note it for later, but keep your current diff focused.

## Code Smell Reference

| Smell | Refactoring |
|---|---|
| Long method (>30 lines) | Extract Function |
| Large class (>300 lines) | Extract Class |
| Long parameter list (>4 params) | Introduce Parameter Object |
| Duplicated code | Extract Function + Pull Up |
| Feature envy | Move Function |
| Data clumps | Extract Class |
| Primitive obsession | Replace Data Type with Object |
| Switch statements | Replace Conditional with Polymorphism |
| Dead code | Delete (don't comment out) |
| Speculative generality | Remove unused abstractions |
