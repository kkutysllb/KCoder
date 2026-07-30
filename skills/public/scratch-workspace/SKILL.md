---
name: scratch-workspace
description: >-
  Use this skill when the Coding Agent needs temporary files, analysis outputs,
  generated intermediate artifacts, logs, scripts, or task workspaces that must
  not pollute the user's project root.

package:
  type: knowledge-only
---

# Scratch Workspace Skill

## Purpose

Keep temporary Coding Agent files outside the project being modified.

## Workflow

1. Resolve scratch root as `~/.oclaw-coding/{thread_id}/workspace`.
2. Store analysis files, generated intermediate data, and temporary scripts
   under the scratch root.
3. Write to the project root only when producing intentional user-facing code
   changes.
4. Record scratch paths in Qiongqi session state when they matter.
5. Clean up or label temporary outputs so they do not confuse review.

## Review Checklist

- No agent-only files are created in the project root.
- Scratch paths include the current thread id.
- Project diff excludes scratch workspace artifacts.
- Permission errors explain the accessible root and intended scratch location.
