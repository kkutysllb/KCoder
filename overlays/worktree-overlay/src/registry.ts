/**
 * Branch worktree registry — maps agent branches to isolated git worktree paths.
 *
 * Design: the worktree path is a PURE FUNCTION of (repoRoot, runId, branchId),
 * so it is recomputable after a crash/restart without persistence. The in-memory
 * Map is only a presence cache (does this branch have a live worktree right now?);
 * the path itself is derived, never stored as the source of truth.
 *
 * The KCoder engine shares one workspaceKey across all parallel branches of a run
 * (a confirmed v1.1.2 behaviour — see parallel-branch-state.ts / evented-v2-multi-
 * agent-runtime.ts). This registry + the enrichContext hook provide the per-branch
 * isolation the engine lacks, without modifying engine contracts.
 */
import { dirname, join } from 'node:path'

/**
 * Top-level directory holding all KCoder worktrees, as a sibling of each repo.
 * Conventional location: `<repo>/../.kcoder-wt/`. Keeping worktrees outside the
 * main repo path avoids git's refusal to nest worktrees and the "tool confusion"
 * the engine's own using-git-worktrees skill warns about.
 */
export const WORKTREE_ROOT_NAME = '.kcoder-wt'

/**
 * Derive the deterministic worktree path for a branch.
 *
 * `<repoParent>/.kcoder-wt/<runId>/<branchId>/` — recomputable from the triple,
 * so a process restart that loses the in-memory map can still find (or recreate)
 * the same worktree.
 */
export function resolveWorktreePath(repoRoot: string, runId: string, branchId: string): string {
  const repoParent = dirname(resolveRepoRoot(repoRoot))
  return join(repoParent, WORKTREE_ROOT_NAME, sanitizeRunId(runId), sanitizeBranchId(branchId))
}

/**
 * Derive the git branch ref for a worktree: `refs/heads/parallel/<runId>/<branchId>`.
 * Namespaced under `parallel/` so KCoder worktrees are easy to list/prune and never
 * collide with user branches.
 */
export function resolveWorktreeBranchRef(runId: string, branchId: string): string {
  return `refs/heads/parallel/${sanitizeRunId(runId)}/${sanitizeBranchId(branchId)}`
}

/**
 * In-memory presence cache: which (runId, branchId) currently have a live worktree,
 * and what is the threadId of the child agent running inside it (so enrichContext
 * can map a child thread back to its worktree).
 */
export class BranchWorktreeRegistry {
  /** runId -> branchId -> worktree metadata */
  private readonly runs = new Map<string, Map<string, BranchWorktreeEntry>>()
  /** childThreadId -> worktree metadata (reverse index for enrichContext lookups) */
  private readonly byThread = new Map<string, BranchWorktreeEntry>()

  /** Register a branch worktree and its child-thread binding. */
  register(entry: BranchWorktreeEntry): void {
    let branches = this.runs.get(entry.runId)
    if (!branches) {
      branches = new Map()
      this.runs.set(entry.runId, branches)
    }
    branches.set(entry.branchId, entry)
    if (entry.childThreadId) {
      this.byThread.set(entry.childThreadId, entry)
    }
  }

  /** Look up a worktree by (runId, branchId). */
  lookup(runId: string, branchId: string): BranchWorktreeEntry | undefined {
    return this.runs.get(runId)?.get(branchId)
  }

  /** Look up a worktree by child threadId (used by enrichContext). */
  lookupByThread(childThreadId: string): BranchWorktreeEntry | undefined {
    return this.byThread.get(childThreadId)
  }

  /** Bind a child threadId to an existing branch worktree (after delegate_task spawns). */
  bindThread(runId: string, branchId: string, childThreadId: string): void {
    const entry = this.runs.get(runId)?.get(branchId)
    if (entry && !entry.childThreadId) {
      entry.childThreadId = childThreadId
      this.byThread.set(childThreadId, entry)
    }
  }

  /** List all worktree entries for a run. */
  listForRun(runId: string): BranchWorktreeEntry[] {
    return [...(this.runs.get(runId)?.values() ?? [])]
  }

  /** Remove a single branch entry (e.g. after merge or cancel). */
  remove(runId: string, branchId: string): BranchWorktreeEntry | undefined {
    const branches = this.runs.get(runId)
    if (!branches) return undefined
    const entry = branches.get(branchId)
    if (!entry) return undefined
    branches.delete(branchId)
    if (entry.childThreadId) this.byThread.delete(entry.childThreadId)
    if (branches.size === 0) this.runs.delete(runId)
    return entry
  }

  /** Clear all entries for a run (e.g. after join completes). Does NOT remove worktrees on disk. */
  clearRun(runId: string): BranchWorktreeEntry[] {
    const branches = this.runs.get(runId)
    if (!branches) return []
    const entries = [...branches.values()]
    for (const entry of entries) {
      if (entry.childThreadId) this.byThread.delete(entry.childThreadId)
    }
    this.runs.delete(runId)
    return entries
  }
}

export interface BranchWorktreeEntry {
  runId: string
  branchId: string
  repoRoot: string
  worktreePath: string
  branchRef: string
  /** The child thread running inside this worktree (bound after delegate_task spawns). */
  childThreadId?: string
  createdAt: string
}

/** Resolve a possibly-relative repo root to absolute, expanding `~`. */
export function resolveRepoRoot(repoRoot: string): string {
  if (repoRoot.startsWith('~')) {
    return join(process.env.HOME ?? '', repoRoot.slice(1))
  }
  return repoRoot
}

// Sanitize path segments — strip characters unsafe for filesystem paths and git refs.
function sanitizeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9_.-]/g, '_')
}
function sanitizeBranchId(branchId: string): string {
  return branchId.replace(/[^A-Za-z0-9_.-]/g, '_')
}
