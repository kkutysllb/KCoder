---
id: code-review
name: Code Review (deep)
---
# Code Review Skill (deep)

A slower, deeper review than the basic review skill. Read the entire change before commenting. Check each item:

- **Correctness** — does it do what it claims? Edge cases? Off-by-one/null/empty handling?
- **Security** — input validation, auth/authz, injection, secrets, unsafe deserialization.
- **Readability** — clear names, single responsibility, no surprising control flow.
- **Tests** — do new tests cover the behavior? Do existing tests still hold?

Read-only: do not edit files. Report findings by severity with `file:line` and a concrete suggested change.
