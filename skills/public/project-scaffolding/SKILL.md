---
name: project-scaffolding
description: >-
  Use this skill when creating a new project structure, package layout,
  initial app skeleton, routes, service layers, test directories, or starter
  configuration.

package:
  type: knowledge-only
---

# Project Scaffolding Skill

## Purpose

Create a maintainable starting structure that supports future delivery.

## Workflow

1. Choose the minimal scaffold needed for the MVP.
2. Follow ecosystem conventions and existing repo patterns.
3. Add test, lint, typecheck, and build entry points early.
4. Include environment templates without secrets.
5. Commit to clear ownership boundaries between app, domain, tests, and config.

## Review Checklist

- The scaffold can run locally.
- Directory names reflect responsibilities.
- No unused framework boilerplate remains if it confuses the project.
- Generated files are deterministic and documented.
