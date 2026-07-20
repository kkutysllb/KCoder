import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { atomicWriteFile } from '@qiongqi/adapter-storage'

export type UserRole = 'admin' | 'user'
export type UserStatus = 'active' | 'disabled'

export type UserRecord = {
  id: string
  email: string
  passwordHash: string
  role: UserRole
  status: UserStatus
  createdAt: string
  updatedAt: string
}

export type SessionRecord = {
  id: string
  tokenHash: string
  userId: string
  createdAt: string
  expiresAt: string
  revokedAt?: string
}

export type AuthSnapshot = {
  users: UserRecord[]
  sessions: SessionRecord[]
}

export interface AuthStore {
  load(): Promise<AuthSnapshot>
  save(snapshot: AuthSnapshot): Promise<void>
}

export class InMemoryAuthStore implements AuthStore {
  private snapshot: AuthSnapshot = { users: [], sessions: [] }

  async load(): Promise<AuthSnapshot> {
    return cloneSnapshot(this.snapshot)
  }

  async save(snapshot: AuthSnapshot): Promise<void> {
    this.snapshot = cloneSnapshot(snapshot)
  }
}

export class FileAuthStore implements AuthStore {
  private readonly filePath: string

  constructor(options: { dataDir: string }) {
    this.filePath = resolve(options.dataDir, 'auth', 'auth.json')
  }

  async load(): Promise<AuthSnapshot> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AuthSnapshot>
      return {
        users: Array.isArray(parsed.users) ? parsed.users.filter(isUserRecord) : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions.filter(isSessionRecord) : []
      }
    } catch {
      return { users: [], sessions: [] }
    }
  }

  async save(snapshot: AuthSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await atomicWriteFile(this.filePath, JSON.stringify(cloneSnapshot(snapshot), null, 2))
  }
}

function cloneSnapshot(snapshot: AuthSnapshot): AuthSnapshot {
  return {
    users: snapshot.users.map((user) => ({ ...user })),
    sessions: snapshot.sessions.map((session) => ({ ...session }))
  }
}

function isUserRecord(value: unknown): value is UserRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<UserRecord>
  return (
    typeof item.id === 'string' &&
    typeof item.email === 'string' &&
    typeof item.passwordHash === 'string' &&
    (item.role === 'admin' || item.role === 'user') &&
    (item.status === 'active' || item.status === 'disabled') &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  )
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<SessionRecord>
  return (
    typeof item.id === 'string' &&
    typeof item.tokenHash === 'string' &&
    typeof item.userId === 'string' &&
    typeof item.createdAt === 'string' &&
    typeof item.expiresAt === 'string' &&
    (item.revokedAt === undefined || typeof item.revokedAt === 'string')
  )
}
