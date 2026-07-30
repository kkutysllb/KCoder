---
name: deployment
description: >-
  Use this skill when preparing deployment, hosting configuration, environment
  variables, build artifacts, release rollout, smoke checks, or rollback
  strategy.

package:
  type: knowledge-only
---

# Deployment Skill

## Purpose

Move verified software into a runnable environment safely.

## Workflow

1. Identify target environment and deployment mechanism.
2. Confirm build artifacts and runtime config.
3. Define required secrets and environment variables.
4. Run smoke checks after deployment.
5. Prepare rollback or mitigation steps.

## Review Checklist

- Deployment commands are reproducible.
- Secrets are not committed.
- Health checks and logs are accessible.
- Rollback path is known before release.
