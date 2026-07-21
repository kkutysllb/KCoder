---
id: verification-before-completion
name: Verification Before Completion
---
# Verification Before Completion

Never claim success without running the proof.

## Core Principle

**Evidence before assertions.** Every completion claim needs fresh command output.

## Checklist

1. **Pick the proof commands**:
   - Bug fixed → reproduction steps / regression test
   - Feature done → tests + build
   - Refactor → full suite + lint
2. **Run them now** — not from memory of an earlier run.
3. **Read the full output** — exit codes, failures, new warnings.
4. **Report honestly** — failures get reported and fixed, not explained away.

## Anti-patterns

- ❌ "The fix should work because..." (nothing was run)
- ❌ Running only the tests you know pass
- ❌ "All tests pass" from a stale previous run
- ❌ Treating skipped tests as passing tests
