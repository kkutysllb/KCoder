---
id: tdd
name: Test-Driven Development
---
# TDD Skill

Red-Green-Refactor:

1. **Red** — Write one small test for the next behavior. Run `run_tests` and confirm it fails for the *right* reason (not a compile/import error).
2. **Green** — Write the minimal code to make the test pass. Run `run_tests` again.
3. **Refactor** — Improve structure without changing behavior; keep tests green.

Never skip the Red step. One behavior per cycle. Commit at Green when sensible.
