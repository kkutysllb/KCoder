---
id: test-driven-development
name: Test-Driven Development
---
# Test-Driven Development

Tests first, always. Red → Green → Refactor.

## The Cycle

1. **Red** — write ONE failing test capturing the next slice of behavior. Run it; confirm it fails for the right reason.
2. **Green** — write the minimal implementation to pass. No gold-plating.
3. **Refactor** — clean up with the passing test as a safety net; re-run.
4. Repeat until the feature is complete.

## Rules

- Never write implementation code without a failing test demanding it.
- A test that can't fail is worthless — verify the red state.
- One behavior per test; name tests after the behavior, not the method.
- Bugfix ⇒ regression test first (red), then fix (green).

## When Stuck

- Test hard to write? That's design feedback — simplify the interface.
- Big red gap? The slice is too large — split it smaller.
