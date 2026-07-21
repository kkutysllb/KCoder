---
id: using-git-worktrees
name: Using Git Worktrees
---
# Using Git Worktrees

Isolate feature work without stashing or branch-hopping.

## Workflow

1. **Create** — `git worktree add ../<project>-<feature> -b feature/<name>`
2. **Setup** — install dependencies in the worktree (node_modules etc. are per-directory).
3. **Work** — all feature changes happen in the worktree; main workspace stays clean.
4. **Verify** — run tests inside the worktree.
5. **Cleanup** — after merge: `git worktree remove ../<project>-<feature>` and delete the branch.

## When to Use

- Feature work that must not disturb the current workspace state
- Before executing multi-step implementation plans
- Reviewing/patching a release while mid-feature elsewhere

## Rules

- Never `git worktree remove` with uncommitted changes without explicit confirmation.
- Keep worktree directories outside the main repo path (avoids tool confusion).
