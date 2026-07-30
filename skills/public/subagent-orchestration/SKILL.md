---
name: subagent-orchestration
description: >-
  Use this skill when a coding task has multiple independent workstreams that
  can be researched, reviewed, or implemented in parallel without shared writes.

package:
  type: knowledge-only
---

# Subagent Orchestration Skill

## Purpose

Split independent work safely while keeping ownership and integration clear.

## Workflow

1. Identify independent tasks with no shared file edits.
2. Give each worker a narrow objective, input context, and expected output.
3. Keep final integration and verification in the main Coding Agent.
4. Do not delegate reading skill instructions or deciding project-wide design.
5. Reconcile findings before editing shared files.

## Boundary

Use this only when parallelism reduces risk or time. Do not split tightly
coupled implementation across agents.
