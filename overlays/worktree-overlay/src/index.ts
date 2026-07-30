/**
 * @kcoder/worktree-overlay — public surface.
 *
 * A 'pudding' package that gives parallel agent branches isolated git worktrees,
 * without modifying the QiongQi engine's contracts or core source. Two integration
 * points consume this package:
 *
 *   1. The MCP stdio server (startWorktreeMcpServer) — registered via
 *      capabilities.mcp.servers in engine-host.ts; exposes worktree tools to agents.
 *   2. The branch workspace resolver (createBranchWorkspaceResolver) — injected as
 *      options.branchWorkspaceResolver; overrides ToolHostContext.workspace for
 *      child threads running inside a worktree, so bash/file tools target the
 *      worktree automatically.
 */
export {
  BranchWorktreeRegistry,
  resolveWorktreePath,
  resolveWorktreeBranchRef,
  resolveRepoRoot,
  WORKTREE_ROOT_NAME,
  type BranchWorktreeEntry
} from './registry.js'
export {
  createWorktree,
  removeWorktree,
  listWorktrees,
  mergeWorktreeBranch,
  currentHead,
  isGitRepo,
  type GitWorktreeInfo
} from './git.js'
export { createBranchWorkspaceResolver, type BranchWorkspaceResolver } from './resolver.js'
export { startWorktreeMcpServer } from './mcp-server.js'
