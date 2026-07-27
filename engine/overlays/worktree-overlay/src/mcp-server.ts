#!/usr/bin/env node
/**
 * MCP stdio server exposing git worktree operations as agent-callable tools.
 *
 * Registered into the engine via `capabilities.mcp.servers['git-worktree']` in
 * engine-host.ts. The server is a single stdio subprocess; it shares a process-wide
 * BranchWorktreeRegistry with the host (via module singleton) so enrichContext
 * lookups and tool calls see the same view.
 *
 * Tools:
 *   - create_worktree({ repoRoot, runId, branchId }) → { worktreePath, branchRef }
 *   - list_worktrees({ repoRoot }) → [{ path, branch, head }]
 *   - remove_worktree({ repoRoot, worktreePath, force? }) → { ok }
 *   - merge_worktree({ repoRoot, branchRef, noFf? }) → { merged, head }
 *
 * Annotations: list is readOnly; remove/merge are destructive (trigger approval).
 *
 * Note: the MCP SDK's high-level server.tool() overload takes a zod raw shape for
 * the input schema (ZodRawShapeCompat). We use zod v3 (the SDK's compat layer
 * accepts v3 or v4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  BranchWorktreeRegistry,
  resolveWorktreePath,
  resolveWorktreeBranchRef
} from './registry.js'
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
  mergeWorktreeBranch,
  isGitRepo
} from './git.js'

/**
 * Start the MCP stdio server. The registry is injected so the host process and the
 * server share one source of truth (the host calls register(); the server reads it).
 */
export async function startWorktreeMcpServer(registry: BranchWorktreeRegistry): Promise<void> {
  const server = new McpServer({
    name: 'kcoder-git-worktree',
    version: '0.1.0'
  })

  // create_worktree — creates an isolated worktree for a parallel branch.
  server.tool(
    'create_worktree',
    'Create an isolated git worktree for a parallel agent branch. Returns the worktree path to pass as the workspace for delegate_task or as the cwd for subsequent tool calls.',
    {
      repoRoot: z.string().describe('Absolute path to the main repository root.'),
      runId: z.string().describe('The engine run id (e.g. run_<threadId>_<turnId>).'),
      branchId: z.string().describe('The durable parallel branch id.')
    },
    async (args) => {
      const { repoRoot, runId, branchId } = args
      if (!(await isGitRepo(repoRoot))) {
        return { content: [{ type: 'text', text: `Not a git repository: ${repoRoot}` }], isError: true }
      }
      const worktreePath = resolveWorktreePath(repoRoot, runId, branchId)
      const branchRef = resolveWorktreeBranchRef(runId, branchId)
      try {
        await createWorktree(repoRoot, worktreePath, branchRef)
        registry.register({
          runId,
          branchId,
          repoRoot,
          worktreePath,
          branchRef,
          createdAt: new Date().toISOString()
        })
        return {
          content: [{ type: 'text', text: JSON.stringify({ worktreePath, branchRef }) }]
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to create worktree: ${(err as Error).message}` }],
          isError: true
        }
      }
    }
  )

  // list_worktrees — read-only listing.
  server.tool(
    'list_worktrees',
    'List all git worktrees of a repository.',
    {
      repoRoot: z.string().describe('Absolute path to the main repository root.')
    },
    { readOnlyHint: true },
    async (args) => {
      try {
        const worktrees = await listWorktrees(args.repoRoot)
        return { content: [{ type: 'text', text: JSON.stringify(worktrees) }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to list worktrees: ${(err as Error).message}` }],
          isError: true
        }
      }
    }
  )

  // remove_worktree — destructive; removes the worktree and prunes.
  server.tool(
    'remove_worktree',
    'Remove a git worktree (use after a branch is merged or cancelled). Use force to discard uncommitted changes.',
    {
      repoRoot: z.string().describe('Absolute path to the main repository root.'),
      worktreePath: z.string().describe('Absolute path of the worktree to remove.'),
      force: z.boolean().default(false).describe('Remove even if the worktree has modifications.')
    },
    { destructiveHint: true },
    async (args) => {
      try {
        await removeWorktree(args.repoRoot, args.worktreePath, { force: args.force })
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to remove worktree: ${(err as Error).message}` }],
          isError: true
        }
      }
    }
  )

  // merge_worktree — destructive; merges a branch back into the main repo HEAD.
  server.tool(
    'merge_worktree',
    'Merge a parallel branch back into the main repository HEAD. Call this after a branch completes and the main repo is on the integration branch.',
    {
      repoRoot: z.string().describe('Absolute path to the main repository root.'),
      branchRef: z.string().describe('The branch ref to merge (e.g. refs/heads/parallel/runId/branchId).')
    },
    { destructiveHint: true },
    async (args) => {
      try {
        const result = await mergeWorktreeBranch(args.repoRoot, args.branchRef)
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to merge branch: ${(err as Error).message}` }],
          isError: true
        }
      }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// When run directly as `node dist/mcp-server.js`, start with a fresh registry.
// (The in-process host path shares a registry instance via startWorktreeMcpServer.)
const isDirectRun = import.meta.url === `file://${process.argv[1]}`
if (isDirectRun) {
  startWorktreeMcpServer(new BranchWorktreeRegistry()).catch((err) => {
    console.error('[kcoder-worktree-mcp] fatal:', err)
    process.exit(1)
  })
}
