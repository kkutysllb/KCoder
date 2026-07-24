import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '@qiongqi/adapter-storage'
import type { ModelConfig } from '@qiongqi/contracts'
import type { UsageSnapshot } from '@qiongqi/contracts'
import type { AuthSnapshot, AuthStore } from './auth-store.js'
import { ensureUserWorkspace, userWorkspacePaths } from './user-workspace-paths.js'

export type UserModelProfileRecord = NonNullable<NonNullable<ModelConfig['profiles']>[string]>

export type UserUsageEventRecord = {
  userId?: string
  threadId: string
  turnId?: string
  model?: string
  seq: number
  timestamp: string
  usage: UsageSnapshot
}

export type UserDataSnapshot = {
  version: 1
  auth: AuthSnapshot
  users: Record<string, UserDataRecord>
  usageEvents: UserUsageEventRecord[]
}

export type UserDataRecord = {
  activeModel?: string
  modelProfiles: Record<string, UserModelProfileRecord>
  modelSecrets: Record<string, { apiKey?: string }>
  settings: Record<string, unknown>
}

export interface UserDataStore {
  loadAuth(): Promise<AuthSnapshot>
  saveAuth(snapshot: AuthSnapshot): Promise<void>
  getUserSetting(userId: string, key: string): Promise<unknown | undefined>
  getUserSettingSync?(userId: string, key: string): unknown | undefined
  setUserSetting(userId: string, key: string, value: unknown): Promise<void>
  listModelProfiles(userId: string): Promise<{ activeModel?: string; profiles: Record<string, UserModelProfileRecord> }>
  saveModelProfile(userId: string, name: string, profile: UserModelProfileRecord, secret?: { apiKey?: string }): Promise<void>
  deleteModelProfile(userId: string, name: string): Promise<void>
  activateModelProfile(userId: string, name: string): Promise<void>
  resolveModelSecret(userId: string, name: string): Promise<{ apiKey?: string }>
  appendUsageEvent?(record: UserUsageEventRecord): Promise<void>
  listUsageEvents?(userId?: string): Promise<UserUsageEventRecord[]>
}

export class FileUserDataStore implements UserDataStore {
  private readonly path: string
  private queue: Promise<void> = Promise.resolve()
  private current: UserDataSnapshot = emptySnapshot()

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
    await ensureUserWorkspace(userWorkspacePaths(dirname(dirname(this.path)), userId))
  }

  async listModelProfiles(userId: string): Promise<{ activeModel?: string; profiles: Record<string, UserModelProfileRecord> }> {
    const user = (await this.read()).users[userId]
    return {
      activeModel: user?.activeModel,
      profiles: withSecrets(user?.modelProfiles ?? {}, user?.modelSecrets ?? {})
    }
  }

  async saveModelProfile(userId: string, name: string, profile: UserModelProfileRecord, secret: { apiKey?: string } = {}): Promise<void> {
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
    await ensureUserWorkspace(userWorkspacePaths(dirname(dirname(this.path)), userId))
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

  async appendUsageEvent(record: UserUsageEventRecord): Promise<void> {
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
      await ensureUserWorkspace(userWorkspacePaths(dirname(dirname(this.path)), record.userId))
    }
  }

  async listUsageEvents(userId?: string): Promise<UserUsageEventRecord[]> {
    const events = (await this.read()).usageEvents
    return events
      .filter((event) => userId === undefined || event.userId === userId)
      .sort(compareUsageEvents)
  }

  private async read(): Promise<UserDataSnapshot> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<UserDataSnapshot>
      this.current = normalizeSnapshot(parsed)
      return this.current
    } catch {
      this.current = emptySnapshot()
      return this.current
    }
  }

  private async update(mutator: (snapshot: UserDataSnapshot) => UserDataSnapshot): Promise<void> {
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

export class UserDataAuthStore implements AuthStore {
  constructor(private readonly store: UserDataStore) {}

  load(): Promise<AuthSnapshot> {
    return this.store.loadAuth()
  }

  save(snapshot: AuthSnapshot): Promise<void> {
    return this.store.saveAuth(snapshot)
  }
}

function normalizeSnapshot(value: Partial<UserDataSnapshot>): UserDataSnapshot {
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

function normalizeUsers(value: Record<string, unknown>): Record<string, UserDataRecord> {
  const out: Record<string, UserDataRecord> = {}
  for (const [userId, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    out[userId] = {
      activeModel: typeof raw.activeModel === 'string' ? raw.activeModel : undefined,
      modelProfiles: isRecord(raw.modelProfiles) ? raw.modelProfiles as Record<string, UserModelProfileRecord> : {},
      modelSecrets: isRecord(raw.modelSecrets) ? raw.modelSecrets as Record<string, { apiKey?: string }> : {},
      settings: isRecord(raw.settings) ? raw.settings : {}
    }
  }
  return out
}

function emptySnapshot(): UserDataSnapshot {
  return { version: 1, auth: { users: [], sessions: [] }, users: {}, usageEvents: [] }
}

function emptyUserRecord(): UserDataRecord {
  return { modelProfiles: {}, modelSecrets: {}, settings: {} }
}

function withSecrets(
  profiles: Record<string, UserModelProfileRecord>,
  secrets: Record<string, { apiKey?: string }>
): Record<string, UserModelProfileRecord> {
  const out: Record<string, UserModelProfileRecord> = {}
  for (const [name, profile] of Object.entries(profiles)) {
    out[name] = { ...profile, ...(secrets[name]?.apiKey !== undefined ? { apiKey: secrets[name]!.apiKey } : {}) }
  }
  return out
}

function withoutSecret(profile: UserModelProfileRecord): UserModelProfileRecord {
  const { apiKey: _apiKey, ...rest } = profile
  return rest
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUsageEventRecord(value: unknown): value is UserUsageEventRecord {
  if (!isRecord(value)) return false
  if (typeof value.threadId !== 'string' || typeof value.seq !== 'number') return false
  if (typeof value.timestamp !== 'string' || !isRecord(value.usage)) return false
  return true
}

function compareUsageEvents(a: UserUsageEventRecord, b: UserUsageEventRecord): number {
  return a.threadId.localeCompare(b.threadId) || a.seq - b.seq
}
