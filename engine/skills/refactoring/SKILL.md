---
id: refactoring
name: Refactoring
---
# Refactoring Skill

Refactor in tiny, behavior-preserving moves.

- **One step at a time** — extract a function, rename, inline — then verify.
- **Tests are the safety net** — run them after every step. If tests are missing, add characterization tests first.
- **Never mix refactor + behavior change** — do one or the other in a given change.
- **Commit frequently** — each green step is a checkpoint you can revert to.

If a step is hard to verify, it's too big — split it.
