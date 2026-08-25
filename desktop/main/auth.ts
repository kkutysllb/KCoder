/**
 * 本地账户鉴权：注册/登录/登出 + 会话态。
 *
 * 定位是「本地简单鉴权」——不联网、不第三方、不 tryLocalServer：
 * - 账户库 `userData/kcoder-auth.json`：多账户（用户名 → scrypt 哈希），
 *   密码从不落明文（随机 16B salt + scryptSync 64B，hex 存储）；
 * - 会话态只在主进程内存；`lastUser` 随账户库持久化——下次启动自动
 *   恢复登录态（桌面应用「记住我」语义，登出即清除）；
 * - 门禁消费方：windows.showShellWindow（未登录 → landing）、
 *   ipc shell:show / shell:openExternal（未登录拒绝跳转）。
 *
 * 校验用 timingSafeEqual（hex 等长恒定），无外部依赖。
 *
 * @module desktop/main/auth
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type { AuthResult, AuthStatus } from '@shared/ipc-contract'

export type { AuthResult, AuthStatus }

/** 一个账户的持久化形状（密码只存哈希）。 */
interface AccountRecord {
  salt: string
  hash: string
}

/** 账户库文件形状。 */
interface AuthStore {
  accounts: Record<string, AccountRecord>
  /** 上次登录用户（启动自动恢复登录态；登出清除）。 */
  lastUser: string | null
}

/** 会话态（仅内存；随主进程生命周期）。 */
let session: string | null = null

function storePath(): string {
  return join(app.getPath('userData'), 'kcoder-auth.json')
}

/** 读账户库（缺省/坏文件回退空库——门禁语义不变：无账户即未登录）。 */
function loadStore(): AuthStore {
  try {
    const raw = JSON.parse(readFileSync(storePath(), 'utf8')) as Partial<AuthStore>
    const accounts = raw.accounts !== null && typeof raw.accounts === 'object' ? raw.accounts : {}
    return { accounts, lastUser: typeof raw.lastUser === 'string' ? raw.lastUser : null }
  } catch {
    return { accounts: {}, lastUser: null }
  }
}

function persistStore(store: AuthStore): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(storePath(), `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error('[auth] persist failed:', error)
  }
}

/** 密码 → 哈希（scrypt，Node 内置；本地鉴权不引入 bcrypt 依赖）。 */
function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

/** 恒定时间比较（hex 等长）。 */
function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** 用户名合法性：trim 后 2–24 位，字母/数字/中文/._-（首尾空白剔除）。 */
function validUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (name.length < 2 || name.length > 24) return null
  if (/[^\p{L}\p{N}._-]/u.test(name)) return null
  return name
}

/** 密码合法性：4–64 位（本地简单鉴权，刻意宽松）。 */
function validPassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length < 4 || raw.length > 64) return null
  return raw
}

/** 启动恢复：上次登录用户仍在账户库 → 自动回登录态（记住我）。 */
export function initAuthSession(): void {
  const store = loadStore()
  if (store.lastUser !== null && store.accounts[store.lastUser] !== undefined) {
    session = store.lastUser
  }
}

/** 当前鉴权状态快照。 */
export function authStatus(): AuthStatus {
  const store = loadStore()
  return {
    loggedIn: session !== null,
    username: session,
    hasAccount: Object.keys(store.accounts).length > 0,
  }
}

/** 门禁谓词（showShellWindow / openExternal 等热路径用）。 */
export function authLoggedIn(): boolean {
  return session !== null
}

function result(ok: boolean, error: string | null = null): AuthResult {
  return { ok, error, status: authStatus() }
}

/** 注册新账户：重名拒绝；成功即登录。 */
export function authRegister(rawUser: unknown, rawPass: unknown): AuthResult {
  const username = validUsername(rawUser)
  if (username === null) return result(false, '账号需为 2–24 位字母、数字或中文（可含 . _ -）')
  const password = validPassword(rawPass)
  if (password === null) return result(false, '密码需为 4–64 位')
  const store = loadStore()
  if (store.accounts[username] !== undefined) return result(false, '该账号已存在，请直接登录')
  const salt = randomBytes(16).toString('hex')
  store.accounts[username] = { salt, hash: hashPassword(password, salt) }
  store.lastUser = username
  persistStore(store)
  session = username
  return result(true)
}

/** 登录：账户不存在/密码错误统一文案（不泄露账号存在性）。 */
export function authLogin(rawUser: unknown, rawPass: unknown): AuthResult {
  const username = validUsername(rawUser)
  const password = validPassword(rawPass)
  if (username === null || password === null) return result(false, '账号或密码不正确')
  const store = loadStore()
  const record = store.accounts[username]
  if (record === undefined || !sameHash(record.hash, hashPassword(password, record.salt))) {
    return result(false, '账号或密码不正确')
  }
  store.lastUser = username
  persistStore(store)
  session = username
  return result(true)
}

/** 登出：清会话态与 lastUser（下次启动不再自动恢复）。 */
export function authLogout(): AuthResult {
  const store = loadStore()
  store.lastUser = null
  persistStore(store)
  session = null
  return result(true)
}
