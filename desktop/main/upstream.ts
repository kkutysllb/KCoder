/**
 * 上游仓库（deepseek-harness 本地克隆）的状态检测与同步流水线。
 *
 * 同步 = fetch → 脏检查 → `pull --ff-only` → `pnpm install` → `pnpm run build`。
 * 每步输出实时以 `upstream:progress` 事件流式推送（供同步面板渲染）。
 * 脏工作树时拒绝同步——上游克隆必须保持 pristine，才能随时跟进
 * upstream 而不被本地改动纠缠（这也是"不污染上游"的纪律落点）。
 *
 * @module desktop/main/upstream
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { UPSTREAM_BRANCH, UPSTREAM_DIR, UPSTREAM_REPO, upstreamBuilt, upstreamCloned, upstreamNodeRange } from './dsh-contract'
import type { UpstreamProgress, UpstreamStatus } from '@shared/ipc-contract'

/** 同步中标志：同步进行时拒绝重复触发与 dsh 启动竞争。 */
let syncing = false

export function isSyncing(): boolean {
  return syncing
}

/* ---------- git 小工具 ---------- */

function git(args: string[], options: { timeout?: number } = {}): { ok: boolean; out: string } {
  const result = spawnSync('git', ['-C', UPSTREAM_DIR, ...args], {
    encoding: 'utf8',
    timeout: options.timeout ?? 30_000,
  })
  return { ok: result.status === 0, out: (result.stdout ?? '') + (result.stderr ?? '') }
}

/** 上游克隆状态快照（未克隆时其余字段为默认值）。 */
export function upstreamStatus(): UpstreamStatus {
  const base: UpstreamStatus = {
    cloned: upstreamCloned(),
    head: null,
    ahead: false,
    behind: false,
    behindCount: -1,
    dirty: false,
    built: upstreamBuilt(),
    nodeRange: upstreamNodeRange(),
  }
  if (!base.cloned) return base
  const head = git(['rev-parse', '--short', 'HEAD'])
  if (!head.ok) return base
  base.head = head.out.trim()
  const dirty = git(['status', '--porcelain'])
  base.dirty = dirty.ok && dirty.out.trim() !== ''
  const counts = git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
  if (counts.ok) {
    const [ahead, behind] = counts.out.trim().split(/\s+/).map(Number)
    base.ahead = (ahead ?? 0) > 0
    base.behind = (behind ?? 0) > 0
    base.behindCount = behind ?? -1
  }
  return base
}

/* ---------- 同步流水线 ---------- */

/** 进度事件源：ipc 层订阅后转发给渲染进程。 */
export const progressEvents = new EventEmitter()

function emit(step: string, line: string, error = false): void {
  progressEvents.emit('progress', { step, line, error } satisfies UpstreamProgress)
}

/**
 * 长命令执行器：流式输出 stdout/stderr，失败即中止流水线。
 * @returns 是否成功。
 */
function run(step: string, command: string, args: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child: ChildProcess = spawn(command, args, { cwd: UPSTREAM_DIR, stdio: ['ignore', 'pipe', 'pipe'] })
    const onLine = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line !== '') emit(step, line)
      }
    }
    child.stdout?.on('data', onLine)
    child.stderr?.on('data', onLine)
    child.on('error', (error) => {
      emit(step, `无法执行 ${command}: ${String(error)}`, true)
      resolve(false)
    })
    child.on('exit', (code) => {
      const ok = code === 0
      if (!ok) emit(step, `${step} 失败（退出码 ${String(code)}）`, true)
      resolve(ok)
    })
  })
}

/**
 * 执行完整同步流水线。成功后由调用方（ipc 层）重启 dsh 侧车。
 * @returns 成功与否与错误信息。
 */
export async function syncUpstream(): Promise<{ ok: boolean; error: string | null }> {
  if (syncing) return { ok: false, error: '同步已在进行中' }
  if (!upstreamCloned()) return { ok: false, error: '上游克隆不存在，请先在“设置”页完成初始化' }
  syncing = true
  try {
    emit('检查', '检查工作树状态…')
    const status = upstreamStatus()
    if (status.dirty) {
      const message = '上游工作树有本地改动，拒绝同步：请在终端中 cd deepseek-harness && git stash 或 git checkout 后重试（保持克隆 pristine 是桌面端跟进上游的前提）'
      emit('检查', message, true)
      return { ok: false, error: message }
    }
    emit('检查', `当前 ${status.head ?? '?'}，工作树干净`)

    emit('拉取', 'git fetch origin…')
    if (!git(['fetch', 'origin', '--prune'], { timeout: 120_000 }).ok) {
      const message = 'git fetch 失败（网络或远端问题）'
      emit('拉取', message, true)
      return { ok: false, error: message }
    }
    const behind = git(['rev-list', '--count', 'HEAD..@{upstream}'])
    if (behind.ok && behind.out.trim() === '0') {
      emit('拉取', '已是最新，无需更新（仍将重新构建）')
    } else {
      emit('拉取', `git pull --ff-only（落后 ${behind.ok ? behind.out.trim() : '?'} 个提交）`)
      const pull = git(['pull', '--ff-only'])
      if (!pull.ok) {
        const message = 'git pull --ff-only 失败（本地与远端分叉？）'
        emit('拉取', message, true)
        return { ok: false, error: message }
      }
    }

    emit('依赖', 'pnpm install…')
    if (!(await run('依赖', 'pnpm', ['install', '--prefer-offline']))) {
      return { ok: false, error: 'pnpm install 失败' }
    }

    emit('构建', 'pnpm run build…（上游全量构建，可能需要数分钟）')
    if (!(await run('构建', 'pnpm', ['run', 'build']))) {
      return { ok: false, error: 'pnpm run build 失败' }
    }

    emit('完成', `同步完成：${upstreamStatus().head ?? '?'}`)
    return { ok: true, error: null }
  } finally {
    syncing = false
  }
}

/* ---------- 首次引导 ---------- */

/**
 * 首次引导：克隆上游 + install + build（setup 页触发）。
 * 已克隆时退化为同步流水线。
 */
export async function setupUpstream(): Promise<{ ok: boolean; error: string | null }> {
  if (upstreamCloned()) return syncUpstream()
  if (syncing) return { ok: false, error: '初始化已在进行中' }
  syncing = true
  try {
    emit('克隆', `git clone ${UPSTREAM_REPO}（fork 锚定，克隆后切 ${UPSTREAM_BRANCH}）…`)
    const clone = spawnSync(
      'git',
      ['clone', '-b', UPSTREAM_BRANCH, UPSTREAM_REPO, UPSTREAM_DIR],
      { encoding: 'utf8', timeout: 600_000, stdio: 'pipe' },
    )
    if (clone.status !== 0) {
      const message = `克隆失败：${(clone.stderr ?? '').trim().slice(0, 500)}`
      emit('克隆', message, true)
      return { ok: false, error: message }
    }
    emit('克隆', '克隆完成')
  } finally {
    syncing = false
  }
  return syncUpstream()
}
