---
name: security-hardening
description: >-
  Use this skill for security-sensitive coding work, including authentication,
  authorization, secrets, input validation, SSRF, CSRF, path traversal, command
  execution, dependency risk, and hardening existing code.

package:
  type: knowledge-only
---

# Security Hardening Skill

## Purpose

Reduce exploitable risk in code changes without adding broad or speculative
rewrites.

## Workflow

1. Locate trust boundaries: HTTP handlers, CLI input, files, environment,
   database queries, templates, and shell commands.
2. Verify authentication and authorization separately.
3. Treat user-controlled paths, URLs, commands, SQL, and serialized payloads as
   unsafe until validated or parsed with a structured API.
4. Move secrets out of source and logs.
5. Add regression tests for the rejected unsafe input or permission boundary.

## Review Checklist

- No hardcoded credentials or tokens.
- No string-built SQL, shell commands, or filesystem paths with unchecked input.
- Error messages do not expose secrets or internal paths unnecessarily.
- Permission checks happen server-side at the resource boundary.
- Security fixes are small enough for review and include tests where possible.
