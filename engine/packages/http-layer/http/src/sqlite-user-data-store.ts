import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AuthSnapshot, SessionRecord, UserRecord } from './auth-store.js'
import type {
  UserModelProfileRecord,
  UserUsageEventRecord,
  UserDataStore
} from './user-data-store.js'
import { ensureUserWorkspace, userWorkspacePaths } from './user-workspace-paths.js'

export class SqliteUserDataStore implements UserDataStore {
  private db: SqliteDatabase | null = null
  private readonly dbPath: string

  constructor(private readonly options: { workspaceRoot: string; sqlitePath?: string }) {
    this.dbPath = options.sqlitePath ?? join(options.workspaceRoot, 'system', 'data', 'user-data.sqlite')
  }

  async ready(): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true })
    const sqlite = await import('better-sqlite3')
    const Database = sqlite.default
    const db = new Database(this.dbPath) as unknown as SqliteDatabase
    this.db = db
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
      CREATE TABLE IF NOT EXISTS user_state (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        active_model TEXT
      );
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, key)
      );
      CREATE TABLE IF NOT EXISTS model_profiles (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, name)
      );
      CREATE TABLE IF NOT EXISTS model_secrets (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        api_key TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, name)
      );
      CREATE TABLE IF NOT EXISTS usage_events (
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        turn_id TEXT,
        model TEXT,
        timestamp TEXT NOT NULL,
        usage_json TEXT NOT NULL,
        PRIMARY KEY (thread_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_usage_events_user_timestamp ON usage_events(user_id, timestamp);
    `)
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  async loadAuth(): Promise<AuthSnapshot> {
    const db = this.requireDb()
    const users = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all().map(rowToUser)
    const sessions = db.prepare('SELECT * FROM auth_sessions ORDER BY created_at ASC').all().map(rowToSession)
    return { users, sessions }
  }

  async saveAuth(snapshot: AuthSnapshot): Promise<void> {
    const db = this.requireDb()
    await Promise.all(snapshot.users.map((user) =>
      ensureUserWorkspace(userWorkspacePaths(this.options.workspaceRoot, user.id))
    ))
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM auth_sessions').run()
      const insertUser = db.prepare(`
        INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at)
        VALUES (@id, @email, @passwordHash, @role, @status, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          password_hash = excluded.password_hash,
          role = excluded.role,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `)
      for (const user of snapshot.users) insertUser.run(user)
      const snapshotUserIds = new Set(snapshot.users.map((user) => user.id))
      const currentUsers = db.prepare('SELECT id FROM users').all() as Array<{ id: string }>
      for (const currentUser of currentUsers) {
        if (!snapshotUserIds.has(currentUser.id)) {
          db.prepare('DELETE FROM users WHERE id = ?').run(currentUser.id)
        }
      }
      const insertSession = db.prepare(`
        INSERT INTO auth_sessions (id, token_hash, user_id, created_at, expires_at, revoked_at)
        VALUES (@id, @tokenHash, @userId, @createdAt, @expiresAt, @revokedAt)
      `)
      for (const session of snapshot.sessions) insertSession.run({ ...session, revokedAt: session.revokedAt ?? null })
    })
    tx()
  }

  async getUserSetting(userId: string, key: string): Promise<unknown | undefined> {
    return this.getUserSettingSync(userId, key)
  }

  getUserSettingSync(userId: string, key: string): unknown | undefined {
    const row = this.requireDb().prepare('SELECT value_json AS valueJson FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key) as { valueJson?: string } | undefined
    if (!row?.valueJson) return undefined
    return JSON.parse(row.valueJson) as unknown
  }

  async setUserSetting(userId: string, key: string, value: unknown): Promise<void> {
    await ensureUserWorkspace(userWorkspacePaths(this.options.workspaceRoot, userId))
    this.requireDb().prepare(`
      INSERT INTO user_settings (user_id, key, value_json, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, key, JSON.stringify(value))
  }

  async listModelProfiles(userId: string): Promise<{ activeModel?: string; profiles: Record<string, UserModelProfileRecord> }> {
    const db = this.requireDb()
    const state = db.prepare('SELECT active_model AS activeModel FROM user_state WHERE user_id = ?').get(userId) as { activeModel?: string } | undefined
    const rows = db.prepare(`
      SELECT p.name, p.profile_json AS profileJson, s.api_key AS apiKey
      FROM model_profiles p
      LEFT JOIN model_secrets s ON s.user_id = p.user_id AND s.name = p.name
      WHERE p.user_id = ?
      ORDER BY p.updated_at DESC
    `).all(userId) as Array<{ name: string; profileJson: string; apiKey?: string | null }>
    const profiles: Record<string, UserModelProfileRecord> = {}
    for (const row of rows) {
      const parsed = JSON.parse(row.profileJson) as UserModelProfileRecord
      profiles[row.name] = { ...parsed, ...(row.apiKey ? { apiKey: row.apiKey } : {}) }
    }
    return { activeModel: state?.activeModel, profiles }
  }

  async saveModelProfile(userId: string, name: string, profile: UserModelProfileRecord, secret: { apiKey?: string } = {}): Promise<void> {
    const db = this.requireDb()
    const paths = userWorkspacePaths(this.options.workspaceRoot, userId)
    await ensureUserWorkspace(paths)
    const profileJson = JSON.stringify(withoutSecret(profile))
    db.prepare(`
      INSERT INTO model_profiles (user_id, name, profile_json, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, name) DO UPDATE SET
        profile_json = excluded.profile_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, name, profileJson)
    if (secret.apiKey !== undefined) {
      db.prepare(`
        INSERT INTO model_secrets (user_id, name, api_key, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, name) DO UPDATE SET
          api_key = excluded.api_key,
          updated_at = CURRENT_TIMESTAMP
      `).run(userId, name, secret.apiKey)
    }
  }

  async deleteModelProfile(userId: string, name: string): Promise<void> {
    const db = this.requireDb()
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM model_secrets WHERE user_id = ? AND name = ?').run(userId, name)
      db.prepare('DELETE FROM model_profiles WHERE user_id = ? AND name = ?').run(userId, name)
      db.prepare('UPDATE user_state SET active_model = NULL WHERE user_id = ? AND active_model = ?').run(userId, name)
    })
    tx()
  }

  async activateModelProfile(userId: string, name: string): Promise<void> {
    const db = this.requireDb()
    const exists = db.prepare('SELECT 1 FROM model_profiles WHERE user_id = ? AND name = ?').get(userId, name)
    if (!exists) throw new Error(`model profile ${name} not found`)
    db.prepare(`
      INSERT INTO user_state (user_id, active_model)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET active_model = excluded.active_model
    `).run(userId, name)
  }

  async resolveModelSecret(userId: string, name: string): Promise<{ apiKey?: string }> {
    const row = this.requireDb().prepare('SELECT api_key AS apiKey FROM model_secrets WHERE user_id = ? AND name = ?').get(userId, name) as { apiKey?: string } | undefined
    return row?.apiKey ? { apiKey: row.apiKey } : {}
  }

  async appendUsageEvent(record: UserUsageEventRecord): Promise<void> {
    if (record.userId) {
      await ensureUserWorkspace(userWorkspacePaths(this.options.workspaceRoot, record.userId))
    }
    this.requireDb().prepare(`
      INSERT OR IGNORE INTO usage_events (
        user_id,
        thread_id,
        seq,
        turn_id,
        model,
        timestamp,
        usage_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.userId ?? null,
      record.threadId,
      record.seq,
      record.turnId ?? null,
      record.model ?? null,
      record.timestamp,
      JSON.stringify(record.usage)
    )
  }

  async listUsageEvents(userId?: string): Promise<UserUsageEventRecord[]> {
    const db = this.requireDb()
    const rows = userId
      ? db.prepare(`
          SELECT
            user_id AS userId,
            thread_id AS threadId,
            seq,
            turn_id AS turnId,
            model,
            timestamp,
            usage_json AS usageJson
          FROM usage_events
          WHERE user_id = ?
          ORDER BY thread_id ASC, seq ASC
        `).all(userId)
      : db.prepare(`
          SELECT
            user_id AS userId,
            thread_id AS threadId,
            seq,
            turn_id AS turnId,
            model,
            timestamp,
            usage_json AS usageJson
          FROM usage_events
          ORDER BY thread_id ASC, seq ASC
        `).all()
    return rows.map(rowToUsageEvent)
  }

  private requireDb(): SqliteDatabase {
    if (!this.db) throw new Error('SQLite user data store is not initialized')
    return this.db
  }
}

type SqliteStatement = {
  run(...args: unknown[]): unknown
  get(...args: unknown[]): unknown
  all(...args: unknown[]): unknown[]
}

type SqliteDatabase = {
  pragma(value: string): unknown
  exec(sql: string): unknown
  prepare(sql: string): SqliteStatement
  transaction(fn: () => void): () => void
  close(): void
}

function rowToUser(row: unknown): UserRecord {
  const item = row as Record<string, string>
  return {
    id: item.id,
    email: item.email,
    passwordHash: item.password_hash,
    role: item.role as UserRecord['role'],
    status: item.status as UserRecord['status'],
    createdAt: item.created_at,
    updatedAt: item.updated_at
  }
}

function rowToSession(row: unknown): SessionRecord {
  const item = row as Record<string, string | null>
  return {
    id: String(item.id),
    tokenHash: String(item.token_hash),
    userId: String(item.user_id),
    createdAt: String(item.created_at),
    expiresAt: String(item.expires_at),
    ...(item.revoked_at ? { revokedAt: item.revoked_at } : {})
  }
}

function rowToUsageEvent(row: unknown): UserUsageEventRecord {
  const item = row as Record<string, string | number | null>
  return {
    ...(typeof item.userId === 'string' && item.userId ? { userId: item.userId } : {}),
    threadId: String(item.threadId),
    seq: Number(item.seq),
    ...(typeof item.turnId === 'string' && item.turnId ? { turnId: item.turnId } : {}),
    ...(typeof item.model === 'string' && item.model ? { model: item.model } : {}),
    timestamp: String(item.timestamp),
    usage: JSON.parse(String(item.usageJson))
  }
}

function withoutSecret(profile: UserModelProfileRecord): UserModelProfileRecord {
  const { apiKey: _apiKey, ...rest } = profile
  return rest
}
