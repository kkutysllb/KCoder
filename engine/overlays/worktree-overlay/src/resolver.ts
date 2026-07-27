/**
 * Branch workspace resolver — the Cut 3 injection core.
 *
 * The engine's `RefreshableToolHost.enrichContext` hook (runtime-factory.ts:826)
 * rewrites a ToolHostContext before every tool batch. We use it to override
 * `context.workspace` when the current thread is a child agent running inside a
 * registered branch worktree. This is the single field that bash cwd and all file
 * tools resolve against, so overriding it redirects every tool call into the
 * worktree — zero per-tool redirection needed.
 *
 * This resolver is injected as `options.branchWorkspaceResolver` on
 * `QiongqiServeRuntimeOptions` and flows through `createCodingAgent` (which
 * spreads `...options` unchanged) into the engine. When the resolver returns null
 * (thread is not a branch child), the engine keeps the original workspace.
 */
import { BranchWorktreeRegistry } from './registry.js'

export interface BranchWorkspaceResolver {
  /**
   * @param threadId the thread whose tool context is being enriched
   * @param workspace the thread's current (default) workspace
   * @returns the worktree path to use instead, or null to keep the default
   */
  (threadId: string, workspace: string): string | null
}

/**
 * Build a resolver backed by a BranchWorktreeRegistry. Looks up the threadId in
 * the registry's thread index; if it matches a branch worktree, returns that path.
 */
export function createBranchWorkspaceResolver(registry: BranchWorktreeRegistry): BranchWorkspaceResolver {
  return (threadId: string, _workspace: string): string | null => {
    const entry = registry.lookupByThread(threadId)
    return entry?.worktreePath ?? null
  }
}
