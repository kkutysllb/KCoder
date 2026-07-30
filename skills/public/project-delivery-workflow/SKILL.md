---
name: project-delivery-workflow
description: >-
  Use this orchestration skill when starting a project from requirements and
  carrying it through design, scaffolding, implementation, validation, review,
  documentation, deployment, and handoff.

package:
  type: knowledge-only
---

# Project Delivery Workflow Skill

## Purpose

Coordinate the full lifecycle of a project so the Coding Agent can move from
idea to working software without skipping requirements, verification, or
handoff.

## Workflow

1. Requirements: activate `requirements-analysis`, `product-spec`, and
   `acceptance-criteria`.
2. Design: activate `technical-design`, `architecture`, `api-design`,
   `database`, `security-hardening`, and `observability`.
3. Setup: activate `project-scaffolding`, `environment-setup`, `build-system`,
   `ci-cd`, and `workflow-automation`.
4. Implementation: activate `vertical-slice-development`, `implement`,
   `test-driven-development`, `test-writer`, and domain-specific skills.
5. Validation: activate `qa-test-plan`, `webapp-testing`,
   `playwright-verification`, `performance`, and `web-accessibility`.
6. Review: activate `diff-analysis`, `code-review`, `pr-review-advanced`,
   `security-review`, and `rollback-recovery`.
7. Delivery: activate `docs`, `release-engineering`, `deployment`,
   `operations-runbook`, and `handoff-docs`.

## Review Checklist

- Each phase has explicit outputs before moving to the next.
- Architecture and scope decisions are recorded, not implied.
- Implementation proceeds in vertical slices that can be tested.
- Delivery includes deployment and operational ownership, not only source code.
