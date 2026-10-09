#!/usr/bin/env node
/**
 * 上游克隆落点的**唯一解析实现**（shell 与纯 JS 消费方共用）。
 *
 * 解析优先级（与 `desktop/main/dsh-contract.ts` 的 `UPSTREAM_DIR` 同语义）：
 *   1. `KCODER_UPSTREAM_DIR`
 *   2. 仓内指针 `.upstream-dir`（`scripts/setup.sh` 成功后落盘）
 *   3. 仓内相邻克隆 `<repo>/deepseek-harness`（CI：release.yml 把 fork 克隆进
 *      工作区，与 deploy 同址）
 *   4. 历史默认（作者 mac 机路径）——非 mac 平台靠前三档
 *
 * 为什么单独一个模块（2026-10-10 现场）：此前 **7 处各自硬编码 mac 路径**
 * （`dev.mjs`、`materialize-peers.mjs`、`release.sh`、`setup.sh`、
 * `verify-vendor-purity.sh`、`smoke-bundle-profile.mjs`、`dsh-contract.ts`），
 * Windows 上不设环境变量就全部落空——`pnpm dev` 只停在 setup 页、`setup.sh`
 * 试图往 `/Users/libing/...` 克隆。收敛成一份实现后，新增消费方只需调用它。
 *
 * 用法：
 *   node scripts/upstream-dir.mjs                # 原生路径（Node 消费方）
 *   node scripts/upstream-dir.mjs --print-shell  # shell 友好（Git Bash 下 /d/...）
 *   node scripts/upstream-dir.mjs --print-pointer # 指针文件路径（setup.sh 落盘用）
 *
 * @module scripts/upstream-dir
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 上游克隆落点指针文件（由 scripts/setup.sh 落盘；见 .gitignore）。 */
export const UPSTREAM_POINTER = join(REPO_ROOT, '.upstream-dir')

/** 历史默认落点（作者 mac 机上的克隆位置；其它平台不适用，故事实上靠前两档）。 */
export const DEFAULT_UPSTREAM_DIR = '/Users/libing/kk_Projects/deepseek-harness'

/** 解析上游克隆落点（原生路径形态）。 */
export function resolveUpstreamDir() {
  const env = (process.env.KCODER_UPSTREAM_DIR ?? '').trim()
  if (env !== '') return env
  try {
    const pointer = readFileSync(UPSTREAM_POINTER, 'utf8').trim()
    if (pointer !== '') return pointer
  } catch {
    /* 指针缺失 → 试下一档 */
  }
  // CI（release.yml）把 fork 克隆进工作区、与 deploy 同址；本地通常不存在
  const inRepo = join(REPO_ROOT, 'deepseek-harness')
  if (existsSync(inRepo)) return inRepo
  return DEFAULT_UPSTREAM_DIR
}

/** 供 shell 消费：Windows 下把 `D:\x` 转成 `/d/x`（Git Bash 的 cd/git 认这个形态）。 */
export function toShellPath(p) {
  if (process.platform !== 'win32') return p
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p)
  return m !== null ? `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/')
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url
if (invokedDirectly) {
  const dir = resolveUpstreamDir()
  if (process.argv.includes('--print-pointer')) console.log(UPSTREAM_POINTER)
  else if (process.argv.includes('--print-shell')) console.log(toShellPath(dir))
  else console.log(dir)
}
