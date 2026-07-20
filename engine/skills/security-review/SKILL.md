---
id: security-review
name: Security Review
---
# Security Review Skill

Read-only security audit. Check each area:

- **Injection** — SQL/OS-command/template injection; unescaped output; path traversal.
- **Auth & Authz** — missing checks, privilege escalation, insecure tokens/sessions.
- **Secrets** — hardcoded keys, secrets in logs/URLs, committed `.env`.
- **Dependencies** — known-vulnerable versions, typosquatted packages.
- **Least privilege** — overly broad file/network/exec permissions, `danger-full-access` where read would do.

Report each finding with severity (critical/high/medium/low), `file:line`, evidence, and a concrete remediation. Read-only — do not fix; recommend.
