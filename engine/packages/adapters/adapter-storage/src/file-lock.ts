import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const LOCK_OWNER_FILE = 'owner.json'
const LOCK_POLL_MS = 5
const LOCK_WAIT_TIMEOUT_MS = 60_000
const OWNERLESS_LOCK_STALE_MS = 10 * 60_000

type LockOwner = { pid: number; createdAtMs: number; key: string }

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM'
  }
}

async function readOwner(lockPath: string): Promise<LockOwner | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(lockPath, LOCK_OWNER_FILE), 'utf8')) as Partial<LockOwner>
    if (Number.isInteger(parsed.pid) && (parsed.pid ?? 0) > 0 && typeof parsed.createdAtMs === 'number' && typeof parsed.key === 'string') {
      return parsed as LockOwner
    }
  } catch {
    // Acquisition may have crashed before owner metadata was written.
  }
  return undefined
}

async function reclaimIfStale(lockPath: string): Promise<boolean> {
  const owner = await readOwner(lockPath)
  if (owner) {
    if (isAlive(owner.pid)) return false
    await rm(lockPath, { recursive: true, force: true })
    return true
  }
  const info = await stat(lockPath).catch(() => undefined)
  if (!info) return true
  if (Date.now() - info.mtimeMs < OWNERLESS_LOCK_STALE_MS) return false
  await rm(lockPath, { recursive: true, force: true })
  return true
}

export async function withFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`
  await mkdir(dirname(path), { recursive: true })
  const startedAt = Date.now()
  for (;;) {
    try {
      await mkdir(lockPath)
      try {
        await writeFile(join(lockPath, LOCK_OWNER_FILE), JSON.stringify({
          pid: process.pid,
          createdAtMs: Date.now(),
          key: path
        } satisfies LockOwner), 'utf8')
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      try {
        return await operation()
      } finally {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error
      if (await reclaimIfStale(lockPath)) continue
      if (Date.now() - startedAt >= LOCK_WAIT_TIMEOUT_MS) throw new Error(`Timed out waiting for file lock: ${path}`)
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS))
    }
  }
}
