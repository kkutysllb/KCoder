---
name: environment-setup
description: >-
  Use this skill when setting up local development, environment variables,
  dependency installation, dev servers, Docker/devcontainers, secrets templates,
  or onboarding commands.

package:
  type: knowledge-only
---

# Environment Setup Skill

## Purpose

Make the project reproducible for local development and CI.

## Workflow

1. Identify required runtimes, package managers, and services.
2. Provide `.env.example` or equivalent without secrets.
3. Document install, run, test, build, and migration commands.
4. Prefer deterministic dependency installation.
5. Verify a clean checkout can start the app.

## Review Checklist

- Required versions are clear.
- Missing config produces actionable errors.
- Dev and production configuration are separated.
- Setup docs match actual commands.
