import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { TurnStateV1, TurnStateSerializer } from './turn-event-types.js'
import type { LoopRun } from './loop-plan.js'

type StoredRun = LoopRun | TurnStateV1

/** Upgrade a v1 turn state to a LoopRun (v2) shape. */
function upgradeToLoopRun(state: StoredRun): LoopRun {
  if (state.version === 2) return state
  // version === 1
  return {
    version: 2,
    threadId: state.threadId,
    turnId: state.turnId,
    stepIndex: state.stepIndex,
    phaseCursor: 0,
    events: state.events ?? [],
    items: state.items ?? [],
    status: state.status === 'running' ? 'running' : state.status,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt
  }
}

/**
 * File-based persistence of {@link LoopRun} for crash recovery.
 *
 * Stores each turn state at:
 * `<rootDir>/<threadId>/turns/<turnId>/state.json`
 *
 * On load, legacy `version: 1` blobs are upgraded to `LoopRun`.
 */
export class FileTurnStateStore implements TurnStateSerializer {
  constructor(private readonly rootDir: string) {}

  async save(state: LoopRun): Promise<void> {
    const dir = this.stateDir(state.threadId, state.turnId)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'state.json'),
      JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    )
  }

  async load(threadId: string, turnId: string): Promise<LoopRun | undefined> {
    try {
      const text = await readFile(
        join(this.stateDir(threadId, turnId), 'state.json'),
        'utf8'
      )
      return upgradeToLoopRun(JSON.parse(text) as StoredRun)
    } catch {
      return undefined
    }
  }

  async delete(threadId: string, turnId: string): Promise<void> {
    await rm(this.stateDir(threadId, turnId), { recursive: true, force: true })
  }

  async list(threadId: string): Promise<LoopRun[]> {
    const root = join(this.rootDir, threadId, 'turns')
    try {
      const entries = await readdir(root, { withFileTypes: true })
      const states: LoopRun[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          const text = await readFile(join(root, entry.name, 'state.json'), 'utf8')
          states.push(upgradeToLoopRun(JSON.parse(text) as StoredRun))
        } catch {
          // Skip corrupt states
        }
      }
      return states
    } catch {
      return []
    }
  }

  private stateDir(threadId: string, turnId: string): string {
    return join(this.rootDir, threadId, 'turns', turnId)
  }
}
