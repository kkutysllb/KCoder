---
id: requesting-code-review
name: Requesting Code Review
---
# Requesting Code Review

Prepare work so reviewers can be effective quickly.

## Self-Check Checklist (before submitting)

- [ ] Tests pass locally (full suite, not a subset)
- [ ] No unrelated changes mixed in; diff is minimal
- [ ] No debug artifacts (console.log, commented code, TODO hacks)
- [ ] Public API changes are intentional and documented
- [ ] Edge cases and error paths are handled + tested

## Submission Package

1. **What** — one-line summary of the change.
2. **Why** — the problem or requirement driving it.
3. **How** — approach taken and key design decisions.
4. **Risk** — what could break; where reviewers should focus.
5. **Scope** — explicit review ask (logic? performance? style?).

## Rules

- Never submit red builds; fix first.
- Small, focused changes get better reviews — split when possible.
