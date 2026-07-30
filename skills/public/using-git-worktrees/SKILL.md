---
name: using-git-worktrees
description: >-
  Use this skill when coding work needs isolation from the user's dirty working
  tree, parallel implementation paths, risky refactors, or PR-level branch work.

package:
  type: knowledge-only
---

# Using Git Worktrees Skill

## Purpose

Protect the user's current working tree while enabling isolated coding work.

## Workflow

1. Check current git status before creating or changing branches.
2. Prefer a separate worktree for risky, long-running, or parallel work.
3. Name branches and worktree paths by task purpose.
4. Never discard user changes unless explicitly requested.
5. Merge or remove the worktree only after verification and user direction.

## Boundary

For small changes inside the current active workspace, do not create a worktree
unless dirty state makes the change unsafe.
