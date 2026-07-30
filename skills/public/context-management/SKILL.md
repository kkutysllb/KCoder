---
name: context-management
description: >-
  Use this skill when managing Coding Agent context, long sessions, compressed
  state, project boundaries, task memory, active skills, or preventing unrelated
  context from influencing code changes.

package:
  type: knowledge-only
---

# Context Management Skill

## Purpose

Keep the Coding Agent focused on the current project, task, and evidence.

## Workflow

1. Establish project root, thread id, task id, and scratch workspace early.
2. Load only context needed for the current step.
3. Keep facts from code, logs, tests, and user messages separate from
   assumptions.
4. Persist durable Coding context through Qiongqi session files.
5. Drop or quarantine unrelated task memory.

## Review Checklist

- Current task context is not mixed with other OClaw workflows.
- Active skills are recorded for the session.
- Long-running work summarizes verified state before continuing.
- Context compaction preserves task boundaries and pending verification.
