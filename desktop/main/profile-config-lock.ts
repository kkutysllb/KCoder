/**
 * profile 配置面读改写的跨进程互斥锁。
 *
 * 与引擎侧约定对齐（升级差异分析 R6）：0.1.7 起引擎的 configEditor
 * （@deepseek-ai/dsh-config-editor）经 @deepseek-ai/dsh-atomic-write 的
 * `withFileLock(join(profileDir, 'package.json'), …)` 串行化全部 profile
 * cordis.patch.yml 写入（settings 表单、preset 编辑器、插件管理 patch
 * writer 同走此锁）。桌面侧 mcp-store 的「整份 YAML 重写」此前无锁，
 * 与官方写者并发存在互相覆盖窗口——本 helper 采用**同一锁文件**
 * `<profileDir>/package.json.lock` 与同一独占创建协议（wx + pid + 退避
 * 重试 + 超时），双方即互斥；重试节奏不必逐字节一致，独占创建即原语。
 *
 * 引擎实现的权威形态见 fork 仓 packages/util/atomic-write/src/（withFileLock）。
 *
 * @module profile-config-lock
 */
import { constants } from 'node:fs'
import { open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { WEB_PROFILE, dshHome } from './dsh-contract'

const LOCK_WAIT_MS = 5_000
const RETRY_INITIAL_MS = 25
const RETRY_MAX_MS = 500

/** profile 目录（$DSH_HOME/profiles/web）。 */
export function profileDir(): string {
  return join(dshHome(), 'profiles', WEB_PROFILE)
}

/**
 * 持有 profile 配置锁执行一次读改写。
 *
 * @param op - 持锁期间的操作（读文档 → 改 → 写回必须整体在锁内）。
 * @returns 操作结果；锁在成功与失败两条路径上都释放。
 * @throws 超时（默认 5s）或非竞争性错误（权限等）时原样抛出。
 */
export async function withProfileConfigLock<T>(op: () => Promise<T>): Promise<T> {
  const lockPath = join(profileDir(), 'package.json.lock')
  const deadline = Date.now() + LOCK_WAIT_MS
  let delay = RETRY_INITIAL_MS
  let retriedPermissionError = false
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    try {
      const handle = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
      try {
        await handle.writeFile(`${process.pid}\n`, 'utf8')
      } finally {
        await handle.close()
      }
      break
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (code !== 'EEXIST') {
        // Windows 上竞争对手在独占创建与 lstat 之间释放锁时会抛瞬态
        // EPERM——与引擎实现同样的一次性重试兜底。
        if (process.platform !== 'win32' || code !== 'EPERM' || retriedPermissionError) throw error
        retriedPermissionError = true
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`profile-config-lock: timed out waiting for the writer lock at ${lockPath}`)
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, RETRY_MAX_MS)
  }
  try {
    return await op()
  } finally {
    try {
      await unlink(lockPath)
    } catch {
      // 释放失败不掩盖操作结果：下个写者的 wx 会因 EEXIST 进退避，
      // 5s 超时后显式报错（与引擎「锁残留」行为一致）。
    }
  }
}
