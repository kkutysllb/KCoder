/**
 * local-services.ts — 产品级本地服务（2026-08 重构）。
 *
 * 自研 kcoder_gateway 删除后，不依赖引擎 HTTP 的产品功能由主进程提供：
 *   - runtime-config：读写 qilin.runtime.yaml（经 python-runtime venv 的
 *     product_services.py，PyYAML 安全合并，保留用户配置）
 *   - token-usage：聚合 runs 表用量（qilin.db，sqlite 只读）
 *   - workspace git：git status/branch/commit/push（node child_process）
 *
 * 数据根：KCODER_APP_DATA_DIR（默认 ~/.kcoder），与 sidecar 一致。
 */

import { execFileSync, execFile } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'

let runtimeDir = ''
let dataDir = ''

export function initLocalServices(opts: { runtimeDir: string; dataDir: string }): void {
  runtimeDir = opts.runtimeDir
  dataDir = opts.dataDir
}

function pythonPath(): string {
  return join(runtimeDir, '.venv', 'bin', 'python')
}

function runProductService(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      pythonPath(),
      [join(runtimeDir, 'product_services.py'), ...args],
      { env: { ...process.env, KCODER_APP_DATA_DIR: dataDir }, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || String(error.message)))
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new Error(`invalid JSON from product_services: ${stdout}`))
        }
      }
    )
  })
}

// ── runtime-config ──────────────────────────────────────────────

export async function getRuntimeConfig(section?: string): Promise<unknown> {
  const args = ['runtime-config', 'get']
  if (section) args.push(section)
  return runProductService(args)
}

export async function updateRuntimeConfigSection(
  section: string,
  value: Record<string, unknown>
): Promise<unknown> {
  return runProductService(['runtime-config', 'set', section, JSON.stringify(value)])
}

// ── token-usage ─────────────────────────────────────────────────

export async function getTokenUsageStats(year?: number, month?: number): Promise<unknown> {
  const args = ['token-usage', 'stats']
  if (year) args.push(String(year))
  if (month) args.push(String(month))
  return runProductService(args)
}

export async function getTokenUsageTimeseries(days = 30): Promise<unknown> {
  return runProductService(['token-usage', 'timeseries', String(days)])
}

// ── workspace git（node git 封装，语义对齐旧 workspace_routes）──

const GIT_TIMEOUT = 15000
const GIT_LONG_TIMEOUT = 60000

function gitJson(repo: string, args: string[], timeout = GIT_TIMEOUT): unknown {
  try {
    const out = execFileSync('git', args, { cwd: repo, timeout, encoding: 'utf-8' })
    try {
      return JSON.parse(out)
    } catch {
      return { stdout: out.trim() }
    }
  } catch (e) {
    const err = e as { stderr?: string; message?: string }
    return { error: (err.stderr || err.message || 'git failed').trim() }
  }
}

export function gitStatus(repo: string): unknown {
  // 结构对齐旧 /v1/workspace/status：{branch, dirty, changes:[{path,status}]}
  const branchRaw = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repo, timeout: GIT_TIMEOUT, encoding: 'utf-8'
  }).trim()
  const porcelain = execFileSync('git', ['status', '--porcelain'], {
    cwd: repo, timeout: GIT_TIMEOUT, encoding: 'utf-8'
  }).trim()
  const changes = porcelain
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ path: line.slice(3), status: line.slice(0, 2).trim() || 'M' }))
  return { branch: branchRaw, dirty: changes.length > 0, changes }
}

export function gitCreateBranch(repo: string, name: string): unknown {
  const r = gitJson(repo, ['checkout', '-b', name]) as { error?: string }
  return { ok: !r.error, error: r.error }
}

export function gitCommit(repo: string, message: string): unknown {
  execFileSync('git', ['add', '-A'], { cwd: repo, timeout: GIT_TIMEOUT, encoding: 'utf-8' })
  try {
    execFileSync('git', ['commit', '-m', message], { cwd: repo, timeout: GIT_TIMEOUT, encoding: 'utf-8' })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as { stderr?: string }).stderr?.trim() || 'commit failed' }
  }
}

export function gitPush(repo: string): unknown {
  try {
    const out = execFileSync('git', ['push'], { cwd: repo, timeout: GIT_LONG_TIMEOUT, encoding: 'utf-8' })
    return { ok: true, stdout: out.trim() }
  } catch (e) {
    const err = e as { stderr?: string; message?: string }
    return { ok: false, error: (err.stderr || err.message || 'push failed').trim() }
  }
}

export function gitBranchList(repo: string): unknown {
  const raw = execFileSync('git', ['branch', '-a', '--format=%(refname:short)'], {
    cwd: repo, timeout: GIT_TIMEOUT, encoding: 'utf-8'
  }).trim()
  return { branches: raw.split('\n').filter(Boolean) }
}

export function gitLog(repo: string, n = 10): unknown {
  const raw = execFileSync(
    'git',
    ['log', `-${n}`, '--pretty=format:%h%x09%an%x09%s'],
    { cwd: repo, timeout: GIT_TIMEOUT, encoding: 'utf-8' }
  ).trim()
  const commits = raw.split('\n').filter(Boolean).map((line) => {
    const [hash, author, ...rest] = line.split('\t')
    return { hash, author, subject: rest.join('\t') }
  })
  return { commits }
}

export function repoExists(repo: string): boolean {
  return existsSync(join(repo, '.git'))
}
