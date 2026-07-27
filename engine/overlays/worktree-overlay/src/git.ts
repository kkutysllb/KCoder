/**
 * Git worktree operations — thin wrappers over `git -C <repo> worktree ...`.
 *
 * All operations execute against the MAIN repo (repoRoot); the worktree path lives
 * outside the main repo (as a sibling) to avoid git's nesting refusal and keep the
 * main checkout's working tree untouched. Each operation is a bounded child process
 * with stderr capture and a timeout.
 */
import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 30_000

export interface GitWorktreeInfo {
  path: string
  branch: string
  head: string
}

/** Run `git` in repoRoot and return {stdout, stderr, code}. Throws on non-zero exit. */
async function git(repoRoot: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['-C', repoRoot, ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGTERM')
      reject(new Error(`git ${args.join(' ')} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.stdout.on('data', (c: Buffer) => stdoutChunks.push(c))
    proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c))
    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`failed to spawn git: ${err.message}`))
    })
    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      if (code !== 0) {
        reject(new Error(`git ${args.join(' ')} exited ${code}: ${stderr}`))
        return
      }
      resolve(Buffer.concat(stdoutChunks).toString('utf8'))
    })
  })
}

/**
 * Create a worktree at `worktreePath` on a new branch `branchRef`.
 * `git worktree add <worktreePath> -b <branchRef>`.
 */
export async function createWorktree(
  repoRoot: string,
  worktreePath: string,
  branchRef: string
): Promise<{ worktreePath: string; branchRef: string }> {
  // -b creates the branch; the worktree path must not already exist.
  await git(repoRoot, ['worktree', 'add', worktreePath, '-b', branchRef.replace(/^refs\/heads\//, '')])
  return { worktreePath, branchRef }
}

/**
 * Remove a worktree. `--force` removes it even if it has untracked/modified files.
 * Also prunes the worktree's administrative data from the main repo.
 */
export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  opts: { force?: boolean } = {}
): Promise<{ ok: true }> {
  const forceArgs = opts.force ? ['--force'] : []
  await git(repoRoot, ['worktree', 'remove', ...forceArgs, worktreePath])
  await git(repoRoot, ['worktree', 'prune']).catch(() => {
    // prune is best-effort; a failure here doesn't undo the removal.
  })
  return { ok: true }
}

/**
 * List all worktrees of the repo. Parses `git worktree list --porcelain`.
 */
export async function listWorktrees(repoRoot: string): Promise<GitWorktreeInfo[]> {
  const out = await git(repoRoot, ['worktree', 'list', '--porcelain'])
  const entries: GitWorktreeInfo[] = []
  let current: Partial<GitWorktreeInfo> = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) entries.push(current as GitWorktreeInfo)
      current = { path: line.slice('worktree '.length) }
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length)
    } else if (line === '' && current.path) {
      entries.push(current as GitWorktreeInfo)
      current = {}
    }
  }
  if (current.path) entries.push(current as GitWorktreeInfo)
  return entries
}

/**
 * Merge a worktree's branch ref back into the current HEAD of the main repo.
 * Uses `--no-ff` to always create a merge commit (preserves branch history for
 * attribution). Returns the new HEAD sha.
 *
 * The caller is responsible for ensuring the main repo is on the integration branch.
 */
export async function mergeWorktreeBranch(
  repoRoot: string,
  branchRef: string,
  opts: { noFf?: boolean } = {}
): Promise<{ merged: true; head: string }> {
  const ref = branchRef.replace(/^refs\/heads\//, '')
  const ffArgs = opts.noFf === false ? [] : ['--no-ff']
  await git(repoRoot, ['merge', ...ffArgs, '-m', `Merge parallel branch ${ref}`, ref])
  const head = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
  return { merged: true, head }
}

/** Resolve the current HEAD sha of the main repo (for setting a base before fan-out). */
export async function currentHead(repoRoot: string): Promise<string> {
  return (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
}

/** Check whether a path is a git repository (cheap probe). */
export async function isGitRepo(repoRoot: string): Promise<boolean> {
  try {
    await git(repoRoot, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}
