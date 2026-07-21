---
id: finishing-a-development-branch
name: Finishing a Development Branch
---
# Finishing a Development Branch

Guide the completion of development work once implementation is done.

## Entry Conditions

- Implementation complete, all tests passing
- Working tree reviewed for stray/unrelated changes

## Workflow

1. **Verify completion** — run the test suite; check `git status`/`git diff` for uncommitted or unrelated changes.
2. **Present structured options**:
   - **Merge** — rebase/merge into the target branch locally
   - **Pull request** — push and open a PR with a summary of changes
   - **Cleanup** — discard the branch (only with explicit confirmation)
3. **Execute the choice** — perform the selected integration step.
4. **Post-check** — confirm the target branch builds and tests pass after integration.

## Rules

- Never force-push or delete branches without explicit user confirmation.
- PR descriptions must summarize what changed and why, generated from actual diffs.
