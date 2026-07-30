---
name: skill-authoring
description: >-
  Use this skill when creating, improving, or reviewing OClaw Coding skills,
  including SKILL.md content, activation descriptions, built-in skill coverage,
  and skill registry tests.

package:
  type: knowledge-only
---

# Skill Authoring Skill

## Purpose

Create Coding skills that are useful, scoped, and loadable by the isolated
OClaw Coding skill registry.

## Workflow

1. Define what the skill helps the Coding Agent do.
2. Write a strong description with clear trigger contexts.
3. Keep the body concise, procedural, and engineering-focused.
4. Avoid references to non-Coding agent tools, absolute user paths, or global
   memory.
5. Add or update registry tests for built-in coverage when needed.

## Review Checklist

- `SKILL.md` has valid YAML front matter with `name` and `description`.
- The skill is placed under `skills/public/coding/<id>/`.
- The content explains workflow and boundaries, not generic advice only.
- The skill does not require user-created project skills.
- Tests prove the registry can discover it.
