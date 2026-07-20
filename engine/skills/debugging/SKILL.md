---
id: debugging
name: Systematic Debugging
---
# Systematic Debugging Skill

Debug deliberately, not by trial and error.

1. **Reproduce** — Establish a reliable, minimal reproduction. No repro = no fix.
2. **Isolate** — Narrow to the smallest input/config that triggers it.
3. **Hypothesize** — Form one specific hypothesis about the cause.
4. **Verify** — Confirm the hypothesis with evidence (logs, a probe, a failing test) *before* changing code.
5. **Fix** — Apply the minimal change. Confirm the reproduction now passes and nothing else regressed.

Never apply a "fix" you cannot explain. If the symptom vanishes but you don't know why, that's not a fix — keep investigating.
