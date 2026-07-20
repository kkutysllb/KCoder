---
id: review
name: Code Review
---
# Code Review Skill

Inspect the requested changes (uncommitted, a branch, or a commit) and report findings.

Group findings by severity:

- **Critical** — bugs, data loss, security issues, broken builds. Must fix.
- **Important** — likely bugs, maintainability, missing tests. Should fix.
- **Minor** — style, naming, nitpicks. Optional.

Each finding includes a `file:line` reference and a concrete suggested fix. Confirm the issue exists before reporting it.
