---
id: systematic-debugging
name: Systematic Debugging
---
# Systematic Debugging

Evidence-driven diagnosis — no fixes without proof of root cause.

## The Loop

1. **Reproduce** — get a stable, minimal reproduction first. No repro → no fix.
2. **Read the error** — full stack trace, exact message, exit code. Most bugs die here.
3. **Hypothesize** — list 2–4 ranked causes; each must be falsifiable.
4. **Test hypotheses** — one variable at a time: bisection (git/code), logging, minimal cases. Record results.
5. **Fix the root cause** — the smallest change that eliminates the cause, not the symptom.
6. **Verify** — repro now passes; regression test added; full suite green.

## Anti-patterns

- ❌ Shotgun changes ("let me try a few things")
- ❌ Fixing the symptom while the cause lives on
- ❌ Declaring fixed after one green run of a flaky repro
- ❌ Ignoring the actual error message in favor of a theory
