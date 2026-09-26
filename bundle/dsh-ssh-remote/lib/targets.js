// dsh-ssh-remote — 远程目标绑定：把「本地工作区 ↔ 远程主机目录」绑在一起。
// 动机：壳的工作区是本地语义（路径按本地绝对值校验、bash/文件树吃本地 FS），
// 远程目录不能直接当工作区；于是采用"本地工作区绑定远程目标"的桥接：
// 用户在某个本地工作区里选定 host:/path 作为目标，agent 便在该远端目录上干活
// （ssh_* 工具默认 cwd 落到目标目录，系统提示实时注入目标）。
// 持久化：单文件 targets.json，bindings 按工作区路径存（多工作区互不干扰），
// activeWorkspace 指向最近使用的那个（工具默认 cwd / 提示注入用）。
import * as fs from 'node:fs'
import * as path from 'node:path'

function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }) }

export class TargetStore {
  /** @param opts {{ file: string, logger?: { warn?: Function } }} */
  constructor(opts) {
    this.file = opts.file
    this.logger = opts.logger
  }

  _read() {
    if (!fs.existsSync(this.file)) return { bindings: {}, activeWorkspace: null }
    try {
      const doc = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (!doc || typeof doc !== 'object') return { bindings: {}, activeWorkspace: null }
      return { bindings: doc.bindings || {}, activeWorkspace: doc.activeWorkspace || null }
    } catch {
      return { bindings: {}, activeWorkspace: null }
    }
  }

  _write(doc) {
    ensureDir(this.file)
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }

  /** 全部绑定：{ workspace: { hostId, path, updatedAt } }。 */
  list() { return this._read().bindings }

  /** 单个工作区的绑定。 */
  get(workspace) {
    return this._read().bindings[String(workspace)] || null
  }

  /** 绑定并置为活跃（一次写入即可用）。 */
  bind(workspace, hostId, remotePath) {
    const doc = this._read()
    doc.bindings[String(workspace)] = { hostId: String(hostId), path: String(remotePath), updatedAt: Date.now() }
    doc.activeWorkspace = String(workspace)
    this._write(doc)
    return doc.bindings[String(workspace)]
  }

  /** 解绑（不影响其它工作区）。 */
  unbind(workspace) {
    const doc = this._read()
    if (!Object.hasOwn(doc.bindings, String(workspace))) return false
    delete doc.bindings[String(workspace)]
    if (doc.activeWorkspace === String(workspace)) doc.activeWorkspace = null
    this._write(doc)
    return true
  }

  /** 指定活跃工作区（其绑定成为"当前远程目标"）。 */
  setActive(workspace) {
    const doc = this._read()
    if (!Object.hasOwn(doc.bindings, String(workspace))) return null
    doc.activeWorkspace = String(workspace)
    this._write(doc)
    return doc.bindings[String(workspace)]
  }

  /** 当前远程目标：{ workspace, hostId, path } | null。 */
  active() {
    const doc = this._read()
    const w = doc.activeWorkspace
    const b = w ? doc.bindings[w] : null
    return b ? { workspace: w, hostId: b.hostId, path: b.path } : null
  }

  /** 工具默认 cwd：仅当请求的主机就是目标主机时生效，否则返回 null 走 host.defaultCwd。 */
  activePathFor(hostId) {
    const a = this.active()
    return a && a.hostId === String(hostId) ? a.path : null
  }
}
