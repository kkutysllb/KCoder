---
id: verification
name: Verification Before Completion
---
# Verification Before Completion

Before claiming any work is complete, fixed, or passing, you MUST run verification commands and confirm their actual output.

## Core Principle

**Evidence before assertions.** Never tell the user something works without proving it.

## Checklist

1. **Identify verification commands** — determine which commands prove the claim:
   - Bug fixed → run the reproduction steps or relevant tests
   - Feature implemented → run tests + build
   - Refactor done → run full test suite + lint
   - Build issue resolved → run the build

2. **Run the commands** — execute them in the workspace and read the full output.

3. **Confirm the output** — check exit codes and output text:
   - Tests: all pass, no skips that hide failures
   - Build: completes without errors
   - Lint: no new violations introduced

4. **Report honestly** — if verification fails, say so and fix it. Never claim success based on reasoning alone.

## Anti-patterns

- ❌ "The fix should work because..." (without running anything)
- ❌ Running only a subset of tests that you know will pass
- ❌ Ignoring warnings that indicate the problem persists
- ❌ Claiming "all tests pass" from memory of a previous run

## When to Apply

- Before committing or creating PRs
- Before telling the user a bug is fixed
- Before marking any task as complete
- After any code change that affects behavior
