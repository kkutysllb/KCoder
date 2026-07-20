import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import type { AuthStore, SessionRecord, UserRecord, UserRole } from './auth-store.js'

const scrypt = promisify(scryptCallback)
const PASSWORD_HASH_PREFIX = 'scrypt'
const PASSWORD_KEY_LENGTH = 64
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type PublicUser = {
  id: string
  email: string
  username: string
  display_name: string
  system_role: UserRole
  is_admin: boolean
  auth_provider: 'local'
  needs_setup?: boolean
}

export type AuthSession = {
  accessToken: string
  expiresIn: number
  user: PublicUser
}

export type AuthSetupStatus = {
  initialized: boolean
  has_admin: boolean
  needs_setup: boolean
  local_auth_enabled: boolean
  registration_enabled: boolean
}

export type AuthActor = {
  userId: string
  role: UserRole
  sessionId: string
  user: PublicUser
}

export class AuthError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

export class AuthService {
  private readonly store: AuthStore
  private readonly now: () => Date
  private readonly sessionTtlMs: number
  private queue: Promise<void> = Promise.resolve()

  constructor(options: { store: AuthStore; now?: () => Date; sessionTtlMs?: number }) {
    this.store = options.store
    this.now = options.now ?? (() => new Date())
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
  }

  async setupStatus(): Promise<AuthSetupStatus> {
    const snapshot = await this.store.load()
    const hasAdmin = snapshot.users.some((user) => user.role === 'admin' && user.status === 'active')
    return {
      initialized: hasAdmin,
      has_admin: hasAdmin,
      needs_setup: !hasAdmin,
      local_auth_enabled: true,
      registration_enabled: false
    }
  }

  async initialize(input: { email: string; password: string }): Promise<AuthSession> {
    return this.withLock(async () => {
      const snapshot = await this.store.load()
      if (snapshot.users.some((user) => user.role === 'admin')) {
        throw new AuthError('system is already initialized', 409)
      }
      const now = this.nowIso()
      const user: UserRecord = {
        id: randomUUID(),
        email: normalizeEmail(input.email),
        passwordHash: await hashPassword(validatePassword(input.password)),
        role: 'admin',
        status: 'active',
        createdAt: now,
        updatedAt: now
      }
      const { session, accessToken } = this.createSession(user.id)
      snapshot.users.push(user)
      snapshot.sessions.push(session)
      await this.store.save(snapshot)
      return this.sessionResponse(user, accessToken)
    })
  }

  async register(input: { email: string; password: string }): Promise<AuthSession> {
    return this.withLock(async () => {
      const snapshot = await this.store.load()
      const email = normalizeEmail(input.email)
      if (snapshot.users.some((user) => user.email === email)) {
        throw new AuthError('email is already registered', 409)
      }
      const now = this.nowIso()
      const user: UserRecord = {
        id: randomUUID(),
        email,
        passwordHash: await hashPassword(validatePassword(input.password)),
        role: 'user',
        status: 'active',
        createdAt: now,
        updatedAt: now
      }
      const { session, accessToken } = this.createSession(user.id)
      snapshot.users.push(user)
      snapshot.sessions.push(session)
      await this.store.save(snapshot)
      return this.sessionResponse(user, accessToken)
    })
  }

  async login(input: { email: string; password: string }): Promise<AuthSession> {
    const snapshot = await this.store.load()
    const email = normalizeEmail(input.email)
    const user = snapshot.users.find((item) => item.email === email && item.status === 'active')
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new AuthError('invalid email or password', 401)
    }
    return this.withLock(async () => {
      const current = await this.store.load()
      const freshUser = current.users.find((item) => item.id === user.id && item.status === 'active')
      if (!freshUser) throw new AuthError('invalid email or password', 401)
      const { session, accessToken } = this.createSession(freshUser.id)
      current.sessions.push(session)
      await this.store.save(current)
      return this.sessionResponse(freshUser, accessToken)
    })
  }

  async verifyToken(token: string | null): Promise<AuthActor | null> {
    if (!token) return null
    const snapshot = await this.store.load()
    const tokenHash = hashToken(token)
    const nowMs = this.now().getTime()
    const session = snapshot.sessions.find((item) => item.tokenHash === tokenHash)
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= nowMs) return null
    const user = snapshot.users.find((item) => item.id === session.userId && item.status === 'active')
    if (!user) return null
    return {
      userId: user.id,
      role: user.role,
      sessionId: session.id,
      user: toPublicUser(user)
    }
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return
    await this.withLock(async () => {
      const snapshot = await this.store.load()
      const tokenHash = hashToken(token)
      const now = this.nowIso()
      let changed = false
      const sessions = snapshot.sessions.map((session) => {
        if (session.tokenHash !== tokenHash || session.revokedAt) return session
        changed = true
        return { ...session, revokedAt: now }
      })
      if (changed) await this.store.save({ ...snapshot, sessions })
    })
  }

  async changePassword(input: { actor: AuthActor; currentPassword: string; newPassword: string }): Promise<AuthSession> {
    return this.withLock(async () => {
      const snapshot = await this.store.load()
      const user = snapshot.users.find((item) => item.id === input.actor.userId && item.status === 'active')
      if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new AuthError('invalid current password', 401)
      }
      const now = this.nowIso()
      const updatedUser: UserRecord = {
        ...user,
        passwordHash: await hashPassword(validatePassword(input.newPassword)),
        updatedAt: now
      }
      const users = snapshot.users.map((item) => (item.id === updatedUser.id ? updatedUser : item))
      const sessions = snapshot.sessions.map((session) =>
        session.userId === updatedUser.id && !session.revokedAt
          ? { ...session, revokedAt: now }
          : session
      )
      const { session, accessToken } = this.createSession(updatedUser.id)
      sessions.push(session)
      await this.store.save({ users, sessions })
      return this.sessionResponse(updatedUser, accessToken)
    })
  }

  private createSession(userId: string): { session: SessionRecord; accessToken: string } {
    const now = this.now()
    const accessToken = `kworks_${randomBytes(32).toString('base64url')}`
    const session: SessionRecord = {
      id: randomUUID(),
      tokenHash: hashToken(accessToken),
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.sessionTtlMs).toISOString()
    }
    return { session, accessToken }
  }

  private sessionResponse(user: UserRecord, accessToken: string): AuthSession {
    return {
      accessToken,
      expiresIn: Math.floor(this.sessionTtlMs / 1000),
      user: toPublicUser(user)
    }
  }

  private nowIso(): string {
    return this.now().toISOString()
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.queue.catch(() => undefined)
    let release!: () => void
    this.queue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await work()
    } finally {
      release()
    }
  }
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.email,
    display_name: user.email,
    system_role: user.role,
    is_admin: user.role === 'admin',
    auth_provider: 'local'
  }
}

export function authSessionBody(session: AuthSession): Record<string, unknown> {
  return {
    access_token: session.accessToken,
    token_type: 'bearer',
    expires_in: session.expiresIn,
    user: session.user,
    needs_setup: false
  }
}

function normalizeEmail(email: string): string {
  const normalized = String(email ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new AuthError('valid email is required', 400)
  }
  return normalized
}

function validatePassword(password: string): string {
  const value = String(password ?? '')
  if (value.length < 8) throw new AuthError('password must be at least 8 characters', 400)
  return value
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url')
  const key = await scrypt(password, salt, PASSWORD_KEY_LENGTH)
  return `${PASSWORD_HASH_PREFIX}$${salt}$${Buffer.from(key as Buffer).toString('base64url')}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, salt, encoded] = stored.split('$')
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !encoded) return false
  const expected = Buffer.from(encoded, 'base64url')
  const actual = await scrypt(String(password ?? ''), salt, expected.length)
  const actualBuffer = Buffer.from(actual as Buffer)
  return actualBuffer.length === expected.length && timingSafeEqual(actualBuffer, expected)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}
