---
id: git-worktrees
name: Git Worktrees
---
# Git Worktrees Skill

Use `git worktree` to run parallel work in separate directories sharing one repository, instead of stashing/switching in a single checkout.

- `git worktree add <path> <branch>` creates a linked working tree.
- Each worktree has its own branch and index; commits land in the shared object store.
- Keep build artifacts and deps per-worktree if your toolchain expects them locally.
- Remove with `git worktree remove <path>` when the work is merged.

Prefer a worktree for long-running parallel tasks over juggling `git stash`.
