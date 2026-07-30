---
name: agent-memory-isolation
description: >-
  Use this skill when Coding Agent memory, session state, project state, or
  task history must be isolated from other OClaw tasks, global memory, or
  unrelated conversations.

package:
  type: knowledge-only
---

# Agent Memory Isolation Skill

## Purpose

Prevent Coding Agent state from leaking into or depending on unrelated OClaw
task memory.

## Workflow

1. Treat Coding memory as scoped by thread id and project root.
2. Store durable Coding runtime state under the Qiongqi/OClaw Coding session
   store.
3. Do not read or write global task memory for Coding-specific decisions.
4. Keep active skills, tool policy, ROI, events, and task changes in Coding
   session state.
5. When a project changes, re-establish the boundary before reusing context.

## Review Checklist

- Memory keys include the Coding session/thread boundary.
- Project-specific facts are not reused for another project without evidence.
- Frontend inspector state reflects the active Coding session only.
- Tests cover isolation when shared middleware or stores are involved.
