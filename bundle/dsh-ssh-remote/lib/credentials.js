// dsh-ssh-remote — 加密凭据库（密码登录用）。
// 设计：AES-256-GCM 逐条加密，主密钥为「自管」的 32 字节密钥文件（可挪到任意路径，
// 由配置 credentialsKeyFile 指定）；密文文件 credentials.enc 内不含任何明文。
// 键名是连接身份 user@host（不是 hostId）：这样 ssh 的密码提示词可直接反查，
// 跳板链上每一跳的提示也能各自命中（跳板密码暂未启用，但机制天然支持）。
// 安全边界：密码永不写入 hosts.json、不进工具输出/日志/导出 JSON。
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const ALG = 'aes-256-gcm'
const VERSION = 1

/** 连接身份键：user@host（ssh 密码提示词即此形态，供 askpass 反查）。 */
export function identityOf(user, host) {
  return String(user) + '@' + String(host)
}

function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }) }

export class CredentialStore {
  /**
   * @param opts {{ file: string, keyFile: string, logger?: { warn?: Function } }}
   */
  constructor(opts) {
    this.file = opts.file
    this.keyFile = opts.keyFile
    this.logger = opts.logger
  }

  /** 读取主密钥；create=true 时缺失则生成（0600）。 */
  _key(create) {
    if (fs.existsSync(this.keyFile)) {
      const buf = fs.readFileSync(this.keyFile)
      if (buf.length !== 32) throw new Error('凭据密钥文件长度异常（应为 32 字节）: ' + this.keyFile)
      return buf
    }
    if (!create) return null
    ensureDir(this.keyFile)
    const key = crypto.randomBytes(32)
    fs.writeFileSync(this.keyFile, key, { mode: 0o600 })
    try { fs.chmodSync(this.keyFile, 0o600) } catch { /* 尽力而为 */ }
    this.logger?.warn?.('[ssh-remote] 已生成凭据密钥文件: ' + this.keyFile + '（自管密钥，请自行备份；丢失后已存密码不可解，重设即可）')
    return key
  }

  _read() {
    if (!fs.existsSync(this.file)) return { version: VERSION, alg: ALG, entries: {} }
    try {
      const doc = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (!doc || typeof doc !== 'object' || typeof doc.entries !== 'object' || !doc.entries) return { version: VERSION, alg: ALG, entries: {} }
      return doc
    } catch {
      return { version: VERSION, alg: ALG, entries: {} }
    }
  }

  /** 原子写回（临时文件 + rename），权限 0600。 */
  _write(doc) {
    ensureDir(this.file)
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }

  /** 是否已为该连接存过密码。 */
  has(identity) {
    return Object.hasOwn(this._read().entries, identity)
  }

  /** 覆盖写入密码（明文只在内存与加密过程中出现）。 */
  set(identity, password) {
    const key = this._key(true)
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(ALG, key, iv)
    const data = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()])
    const doc = this._read()
    doc.entries[identity] = { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
    this._write(doc)
  }

  /** 取出密码；未存或密钥缺失返回 null（绝不抛给调用方以外的路径）。 */
  get(identity) {
    const rec = this._read().entries[identity]
    if (!rec) return null
    const key = this._key(false)
    if (!key) return null
    try {
      const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(rec.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(rec.tag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(rec.data, 'base64')), decipher.final()]).toString('utf8')
    } catch {
      return null
    }
  }

  /** 删除单条（其余条目不受影响）。 */
  remove(identity) {
    const doc = this._read()
    if (!Object.hasOwn(doc.entries, identity)) return false
    delete doc.entries[identity]
    this._write(doc)
    return true
  }

  /** 已存条目身份列表（不含密码）。 */
  list() { return Object.keys(this._read().entries) }
}
