---
name: task-decomposition
description: >-
  Use this skill when breaking broad coding requests into Qiongqi tasks, task
  ids, staged work, implementation phases, or independent subtasks.

package:
  type: knowledge-only
---

# Task Decomposition Skill

## Purpose

Split complex coding work into traceable tasks that can be executed, reviewed,
and verified independently.

## Workflow

1. Identify the user-visible objective and acceptance criteria.
2. Split by ownership boundary: backend, engine, API, frontend, tests, docs.
3. Assign each task a clear output and verification step.
4. Record task context so Qiongqi changes and events can be grouped later.
5. Keep UI polish and core engine changes as separate tasks when possible.

## Review Checklist

- Each task can be completed without guessing the next one.
- Task ids connect file changes to the user request.
- Dependencies are ordered explicitly.
- The plan avoids tiny busywork tasks that do not help verification.
