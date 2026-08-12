/**
 * FileUserDataStore — KCoder-local per-user model profile storage.
 *
 * Reads/writes <workspaceRoot>/system/data/user-data.json. Only the model
 * profile methods are implemented (listModelProfiles / saveModelProfile /
 * deleteModelProfile / activateModelProfile) — that is all KCoder's
 * app/main/models.ts uses. The on-disk format is compatible with the old
 * on-disk schema so existing user-data.json files keep working.
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * A single model profile. `apiKey` is written to a separate secrets map
 * inside the same file so it does not leak into the main profile record
 * when it is forwarded to the renderer.
 */
export interface UserModelProfileRecord {
  providerModel: string
  baseUrl: string
  endpointFormat?: 'chat_completions' | 'responses' | 'messages'
  contextWindowTokens?: number
  supportsToolCalling?: boolean
  aliases?: string[]
  /** Included by listModelProfiles (merged from the secrets store). */
  apiKey?: string
  // ── QiLin ModelConfig 对齐字段（预设驱动，见 model-presets.ts）──
  /** 引擎 class path，如 qilin.models.patched_deepseek:PatchedChatDeepSeek。核心路由字段。 */
  use?: string
  displayName?: string
  supportsThinking?: boolean
  supportsVision?: boolean
  supportsReasoningEffort?: boolean
  /** 思考模式开启参数模板（从预设继承，如 { extra_body: { thinking: { type: 'enabled' } } }） */
  whenThinkingEnabled?: Record<string, unknown>
  /** 思考模式关闭参数模板 */
  whenThinkingDisabled?: Record<string, unknown>
  maxTokens?: number
  temperature?: number
  useResponsesApi?: boolean
  outputVersion?: string
  /** 每百万 token 计价（控制台成本展示用，可选） */
  pricing?: {
    currency: string
    inputPerMillion: number
    outputPerMillion: number
    inputCacheHitPerMillion?: number
  }
}

interface UserDataRecord {
  activeModel?: string
  modelProfiles: Record<string, UserModelProfileRecord>
  modelSecrets: Record<string, { apiKey?: string }>
}

interface UserDataSnapshot {
  version: 1
  users: Record<string, UserDataRecord>
}

export class FileUserDataStore {
  private readonly path: string
  private queue: Promise<void> = Promise.resolve()
  private current: UserDataSnapshot = emptySnapshot()

  constructor(options: { workspaceRoot: string }) {
    // v0.2: user-data.json 落在 <workspaceRoot>/config/（统一数据根的子目录）
    // 兼容 v0.1：若新位置不存在但旧 <workspaceRoot>/system/data/user-data.json
    // 存在，自动迁移过来（一次性）
    const newPath = join(options.workspaceRoot, 'config', 'user-data.json')
    const legacyPath = join(options.workspaceRoot, 'system', 'data', 'user-data.json')
    if (!existsSync(newPath) && existsSync(legacyPath)) {
      try {
        mkdirSync(dirname(newPath), { recursive: true })
        renameSync(legacyPath, newPath)
        console.log(`[KCoder] Migrated user-data.json: ${legacyPath} → ${newPath}`)
      } catch (err) {
        console.warn(`[KCoder] user-data.json migration failed, falling back to legacy path`, err)
      }
    }
    this.path = newPath
  }

  async listModelProfiles(
    userId: string
  ): Promise<{ activeModel?: string; profiles: Record<string, UserModelProfileRecord> }> {
    const user = (await this.read()).users[userId]
    return {
      activeModel: user?.activeModel,
      profiles: withSecrets(user?.modelProfiles ?? {}, user?.modelSecrets ?? {})
    }
  }

  async saveModelProfile(
    userId: string,
    name: string,
    profile: UserModelProfileRecord,
    secret: { apiKey?: string } = {}
  ): Promise<void> {
    await this.update((snapshot) => {
      const user = snapshot.users[userId] ?? emptyUserRecord()
      const nextSecrets = { ...user.modelSecrets }
      if (secret.apiKey !== undefined) {
        nextSecrets[name] = { ...(nextSecrets[name] ?? {}), apiKey: secret.apiKey }
      }
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
            activeModel:
              user.activeModel === name ? Object.keys(modelProfiles)[0] : user.activeModel,
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
      if (!user.modelProfiles[name]) {
        throw new Error(`model profile ${name} not found`)
      }
      return {
        ...snapshot,
        users: {
          ...snapshot.users,
          [userId]: { ...user, activeModel: name }
        }
      }
    })
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
      await atomicWriteJson(this.path, next)
      this.current = next
    })
    this.queue = run.then(() => undefined, () => undefined)
    await run
  }
}

// ============ helpers ============

function normalizeSnapshot(value: Partial<UserDataSnapshot>): UserDataSnapshot {
  const users: Record<string, UserDataRecord> = {}
  if (isRecord(value.users)) {
    for (const [userId, raw] of Object.entries(value.users)) {
      if (!isRecord(raw)) continue
      users[userId] = {
        activeModel: typeof raw.activeModel === 'string' ? raw.activeModel : undefined,
        modelProfiles: isRecord(raw.modelProfiles)
          ? (raw.modelProfiles as Record<string, UserModelProfileRecord>)
          : {},
        modelSecrets: isRecord(raw.modelSecrets)
          ? (raw.modelSecrets as Record<string, { apiKey?: string }>)
          : {}
      }
    }
  }
  return { version: 1, users }
}

function emptySnapshot(): UserDataSnapshot {
  return { version: 1, users: {} }
}

function emptyUserRecord(): UserDataRecord {
  return { modelProfiles: {}, modelSecrets: {} }
}

function withSecrets(
  profiles: Record<string, UserModelProfileRecord>,
  secrets: Record<string, { apiKey?: string }>
): Record<string, UserModelProfileRecord> {
  const out: Record<string, UserModelProfileRecord> = {}
  for (const [name, profile] of Object.entries(profiles)) {
    out[name] = {
      ...profile,
      ...(secrets[name]?.apiKey !== undefined ? { apiKey: secrets[name]!.apiKey } : {})
    }
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

/**
 * Atomic JSON write — temp file in the same directory then rename.
 *
 * `tmpdir()` is NOT used because rename across filesystems fails; the temp
 * file is created next to the target so rename is an atomic inode swap.
 */
async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const payload = `${JSON.stringify(data, null, 2)}\n`
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmpPath, payload, 'utf8')
  await rename(tmpPath, path)
}
