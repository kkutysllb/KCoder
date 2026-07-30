---
name: workflow-automation
description: >-
  Use this skill for scripts, CLIs, developer tooling, task automation, codegen,
  project maintenance commands, and repeatable local workflows.

package:
  type: knowledge-only
---

# Workflow Automation Skill

## Purpose

Automate repetitive engineering tasks with predictable, reviewable scripts.

## Workflow

1. Confirm the manual workflow and its inputs/outputs.
2. Prefer existing project scripting languages and package scripts.
3. Make the command idempotent where practical.
4. Validate inputs before writing files or running destructive operations.
5. Add a dry-run or clear output for risky workflows.

## Review Checklist

- The script has clear usage and failure messages.
- Paths are resolved safely and do not assume a single working directory unless
  documented.
- Generated files are deterministic.
- Destructive actions require explicit flags.
- Automation is tested or covered by a small fixture.
