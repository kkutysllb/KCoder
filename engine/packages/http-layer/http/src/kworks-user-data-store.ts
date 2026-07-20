import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '@qiongqi/adapter-storage'
import type { ModelConfig } from '@qiongqi/contracts'
import type { UsageSnapshot } from '@qiongqi/contracts'
import type { AuthSnapshot, AuthStore } from './auth-store.js'
import { ensureKWorksUserWorkspace, kworksUserWorkspacePaths } from './kworks-workspace-paths.js'

export type KWorksModelProfileRecord = NonNullable<NonNullable<ModelConfig['profiles']>[string]>

export type KWorksUsageEventRecord = {
  userId?: string
  threadId: string
  turnId?: string
  model?: string
  seq: number
  timestamp: string
  usage: UsageSnapshot
}

export type KWorksUserDataSnapshot = {
  version: 1
  auth: AuthSnapshot
  users: Record<string, KWorksUserRecord>
  usageEvents: KWorksUsageEventRecord[]
}

export type KWorksUserRecord = {
  activeModel?: string
  modelProfiles: Record<string, KWorksModelProfileRecord>
  modelSecrets: Record<string, { apiKey?: string }>
  settings: Record<string, unknown>
}

export interface KWorksUserDataStore {
  loadAuth(): Promise<AuthSnapshot>
  saveAuth(snapshot: AuthSnapshot): Promise<void>
  getUserSetting(userId: string, key: string): Promise<unknown | undefined>
  getUserSettingSync?(userId: string, key: string): unknown | undefined
  setUserSetting(userId: string, key: string, value: unknown): Promise<void>
  listModelProfiles(userId: string): Promise<{ activeModel?: string; profiles: Record<string, KWorksModelProfileRecord> }>
  saveModelProfile(userId: string, name: string, profile: KWorksModelProfileRecord, secret?: { apiKey?: string }): Promise<void>
  deleteModelProfile(userId: string, name: string): Promise<void>
  activateModelProfile(userId: string, name: string): Promise<void>
  resolveModelSecret(userId: string, name: string): Promise<{ apiKey?: string }>
  appendUsageEvent?(record: KWorksUsageEventRecord): Promise<void>
  listUsageEvents?(userId?: string): Promise<KWorksUsageEventRecord[]>
}

export class FileKWorksUserDataStore implements KWorksUserDataStore {
  private readonly path: string
  private queue: Promise<void> = Promise.resolve()
  private current: KWorksUserDataSnapshot = emptySnapshot()

  constructor(options: { workspaceRoot: string }) {
    this.path = join(options.workspaceRoot, 'system', 'data', 'user-data.json')
  }

  async loadAuth(): Promise<AuthSnapshot> {
    return (await this.read()).auth
  }

  async saveAuth(auth: AuthSnapshot): Promise<void> {
    await this.update((snapshot) => ({ ...snapshot, auth }))
  }

  async getUserSetting(userId: string, key: string): Promise<unknown | undefined> {
    return (await this.read()).users[userId]?.settings[key]
  }

  getUserSettingSync(userId: string, key: string): unknown | undefined {
    return this.current.users[userId]?.settings[key]
  }

  async setUserSetting(userId: string, key: string, value: unknown): Promise<void> {
    await this.update((snapshot) => {
      const user = snapshot.users[userId] ?? emptyUserRecord()
      return {
        ...snapshot,
        users: {
          ...snapshot.users,
          [userId]: {
            ...user,
            settings: {
              ...user.settings,
              [key]: value
            }
          }
        }
      }
    })
    await ensureKWorksUserWorkspace(kworksUserWorkspacePaths(dirname(dirname(this.path)), userId))
  }

  async listModelProfiles(userId: string): Promise<{ activeModel?: string; profiles: Record<string, KWorksModelProfileRecord> }> {
    const user = (await this.read()).users[userId]
    return {
      activeModel: user?.activeModel,
      profiles: withSecrets(user?.modelProfiles ?? {}, user?.modelSecrets ?? {})
    }
  }

  async saveModelProfile(userId: string, name: string, profile: KWorksModelProfileRecord, secret: { apiKey?: string } = {}): Promise<void> {
    await this.update((snapshot) => {
      const user = snapshot.users[userId] ?? emptyUserRecord()
      const nextSecrets = { ...user.modelSecrets }
      if (secret.apiKey !== undefined) nextSecrets[name] = { ...(nextSecrets[name] ?? {}), apiKey: secret.apiKey }
      return {
        ...snapshot,
        users: {
          ...snapshot.users,
          [userId]: {
            ...user,
            modelProfiles: {
              ...user.modelProfiles,
              [name]: withoutSecret(profile)
            },
            modelSecrets: nextSecrets
          }
        }
      }
    })
    await ensureKWorksUserWorkspace(kworksUserWorkspacePaths(dirname(dirname(this.path)), userId))
  }

  async deleteModelProfile(userId: string, name: string): Promise<void> {
    await this.update((snapshot) => {
      const user = snapshot.users[userId] ?? emptyUserRecord()
      const modelProfiles = { ...user.modelProfiles }
      const modelSecrets = { ...user.modelSecrets }
      delete modelProfiles[name]
      delete modelSecrets[name]
      return {
        ...snapshot,
        users: {
          ...snapshot.users,
          [userId]: {
            ...user,
            activeModel: user.activeModel === name ? Object.keys(modelProfiles)[0] : user.activeModel,
            modelProfiles,
            modelSecrets
          }
        }
      }
    })
  }

  async activateModelProfile(userId: string, name: string): Promise<void> {
    await this.update((snapshot) => {
      const user = snapshot.users[userId] ?? emptyUserRecord()
      if (!user.modelProfiles[name]) throw new Error(`model profile ${name} not found`)
      return {
        ...snapshot,
        users: {
          ...snapshot.users,
          [userId]: { ...user, activeModel: name }
        }
      }
    })
  }

  async resolveModelSecret(userId: string, name: string): Promise<{ apiKey?: string }> {
    return (await this.read()).users[userId]?.modelSecrets[name] ?? {}
  }

  async appendUsageEvent(record: KWorksUsageEventRecord): Promise<void> {
    await this.update((snapshot) => {
      if (snapshot.usageEvents.some((event) => event.threadId === record.threadId && event.seq === record.seq)) {
        return snapshot
      }
      return {
        ...snapshot,
        usageEvents: [
          ...snapshot.usageEvents,
          record
        ]
      }
    })
    if (record.userId) {
      await ensureKWorksUserWorkspace(kworksUserWorkspacePaths(dirname(dirname(this.path)), record.userId))
    }
  }

  async listUsageEvents(userId?: string): Promise<KWorksUsageEventRecord[]> {
    const events = (await this.read()).usageEvents
    return events
      .filter((event) => userId === undefined || event.userId === userId)
      .sort(compareUsageEvents)
  }

  private async read(): Promise<KWorksUserDataSnapshot> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<KWorksUserDataSnapshot>
      this.current = normalizeSnapshot(parsed)
      return this.current
    } catch {
      this.current = emptySnapshot()
      return this.current
    }
  }

  private async update(mutator: (snapshot: KWorksUserDataSnapshot) => KWorksUserDataSnapshot): Promise<void> {
    const run = this.queue.catch(() => undefined).then(async () => {
      const next = normalizeSnapshot(mutator(await this.read()))
      await mkdir(dirname(this.path), { recursive: true })
      await atomicWriteFile(this.path, `${JSON.stringify(next, null, 2)}\n`)
      this.current = next
    })
    this.queue = run.then(() => undefined, () => undefined)
    await run
  }
}

export class KWorksUserDataAuthStore implements AuthStore {
  constructor(private readonly store: KWorksUserDataStore) {}

  load(): Promise<AuthSnapshot> {
    return this.store.loadAuth()
  }

  save(snapshot: AuthSnapshot): Promise<void> {
    return this.store.saveAuth(snapshot)
  }
}

function normalizeSnapshot(value: Partial<KWorksUserDataSnapshot>): KWorksUserDataSnapshot {
  return {
    version: 1,
    auth: {
      users: Array.isArray(value.auth?.users) ? value.auth.users : [],
      sessions: Array.isArray(value.auth?.sessions) ? value.auth.sessions : []
    },
    users: isRecord(value.users) ? normalizeUsers(value.users) : {},
    usageEvents: Array.isArray(value.usageEvents)
      ? value.usageEvents.filter(isUsageEventRecord).sort(compareUsageEvents)
      : []
  }
}

function normalizeUsers(value: Record<string, unknown>): Record<string, KWorksUserRecord> {
  const out: Record<string, KWorksUserRecord> = {}
  for (const [userId, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    out[userId] = {
      activeModel: typeof raw.activeModel === 'string' ? raw.activeModel : undefined,
      modelProfiles: isRecord(raw.modelProfiles) ? raw.modelProfiles as Record<string, KWorksModelProfileRecord> : {},
      modelSecrets: isRecord(raw.modelSecrets) ? raw.modelSecrets as Record<string, { apiKey?: string }> : {},
      settings: isRecord(raw.settings) ? raw.settings : {}
    }
  }
  return out
}

function emptySnapshot(): KWorksUserDataSnapshot {
  return { version: 1, auth: { users: [], sessions: [] }, users: {}, usageEvents: [] }
}

function emptyUserRecord(): KWorksUserRecord {
  return { modelProfiles: {}, modelSecrets: {}, settings: {} }
}

function withSecrets(
  profiles: Record<string, KWorksModelProfileRecord>,
  secrets: Record<string, { apiKey?: string }>
): Record<string, KWorksModelProfileRecord> {
  const out: Record<string, KWorksModelProfileRecord> = {}
  for (const [name, profile] of Object.entries(profiles)) {
    out[name] = { ...profile, ...(secrets[name]?.apiKey !== undefined ? { apiKey: secrets[name]!.apiKey } : {}) }
  }
  return out
}

function withoutSecret(profile: KWorksModelProfileRecord): KWorksModelProfileRecord {
  const { apiKey: _apiKey, ...rest } = profile
  return rest
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUsageEventRecord(value: unknown): value is KWorksUsageEventRecord {
  if (!isRecord(value)) return false
  if (typeof value.threadId !== 'string' || typeof value.seq !== 'number') return false
  if (typeof value.timestamp !== 'string' || !isRecord(value.usage)) return false
  return true
}

function compareUsageEvents(a: KWorksUsageEventRecord, b: KWorksUsageEventRecord): number {
  return a.threadId.localeCompare(b.threadId) || a.seq - b.seq
}
