/**
 * 上游 deepseek-harness 契约适配层。
 *
 * 上游处于 developer preview，bin 路径、就绪行格式、CLI flags、
 * DSH_HOME 等约定都可能变化。本文件是桌面端对这些约定的**唯一**引用点：
 * 升级上游后若行为不符，只需要修改这里。
 *
 * 契约依据（2026-08, upstream 0.1.0-rc.5）：
 * - 就绪行：packages/bundle/web-app/src/index.ts `printUrl`
 *   `dsh web: http://127.0.0.1:<port>`（loader 结算后打印，是就绪信号）
 * - CLI：`dsh [--profile web] --host/--port/--trusted-host`；`web` 是
 *   `--profile web` 的硬编码别名；`--port 0` 让 OS 分配端口
 * - 构建产物 bin：apps/cli/package.json `bin.dsh = lib/bin.js`
 * - 源码运行：根 package.json script `dsh = node --import tsx/esm apps/cli/src/bin.ts`
 *   （SRC 回退模式，Web UI 仍需 `pnpm run build` 产物）
 * - Harness home：packages/util/home-paths `DSH_HOME` 环境变量，上游默认
 *   `~/.dsh`；KCoder 启动时预置为自有 `~/.kcoder`（老用户未迁移时暂用
 *   ~/.dsh，见 home-migration.ts 的决策与一键迁移）
 * - 插件管理：apps/cli/src/plugin.ts `dsh plugin --profile <name> <pnpm args>`
 *   （pnpm 转发器；声明 `dsh.bundle` 的依赖自动进入层叠）
 * - Profile 清单：`$DSH_HOME/profiles/web/package.json` 的
 *   `dsh.profile.bundles`（层叠顺序）与 `dsh.profile` 声明
 *
 * @module desktop/main/dsh-contract
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { satisfies, gte, valid } from 'semver'
import { app } from 'electron'
import type { DshSource } from '@shared/ipc-contract'

/**
 * 就绪行的解析规则：`dsh web: http://127.0.0.1:<port>[/?token=<进程启动令牌>]`。
 * 组 1 = 回环基址；组 2 = 可选的查询尾部。
 * alpha.1 基线起上游 BrowserAuth 门禁：根路径只认进程启动令牌（换取签名
 * cookie，303 回 `/`）或已持有的签名 cookie，其余一律 401（“dsh web
 * authentication required”）——就绪行里的令牌是宿主换 cookie 的唯一入口，
 * 绝不能丢（旧版无门禁时组 2 为空串，向后兼容）。
 */
export const READY_LINE_RE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(\S*)/

/** 就绪等待上限（毫秒）：dsh 需等 loader 结算后才打印 URL。 */
export const READY_TIMEOUT_MS = 60_000

/** 崩溃自动重启次数上限。 */
export const MAX_AUTO_RESTARTS = 3

/**
 * 上游锚定 = 自有 fork（kkutysllb/deepseek-harness）：上游修复直接以提交
 * 落集成分支 `kcoder/0.1.3-alpha.1`（= 基线 + 修复分支的 merge），不再用
 * KCoder 仓内 *.patch 归档应用。消费工作树在仓外单一路径（可用环境变
 * 量 KCODER_UPSTREAM_DIR 覆盖）。
 */
export const UPSTREAM_REPO = 'git@github.com:kkutysllb/deepseek-harness.git'

/** 消费分支：基线 + 上游修复合入（setup.sh / release.sh 断言同一分支）。 */
export const UPSTREAM_BRANCH = 'kcoder/0.1.3-alpha.1'

const DEFAULT_UPSTREAM_DIR = '/Users/libing/kk_Projects/deepseek-harness'

/** 上游工作树绝对路径（fork 本地克隆，仓外单一真相源）。 */
export const UPSTREAM_DIR = process.env.KCODER_UPSTREAM_DIR ?? DEFAULT_UPSTREAM_DIR

/** 桌面端工作区根（含 desktop/、scripts/、上游克隆）。 */
export const PROJECT_ROOT = resolve(__dirname, '..', '..')

/**
 * 打包内置的上游运行时压缩包（extraResources/kcoder-runtime.tar.gz）。
 * 运行时以单文件随包分发（散文件会让 electron-builder 的复制/签名
 * 撞 EMFILE），首启解压到 userData。开发态（未打包）返回 null。
 */
export function bundledRuntimeArchive(): string | null {
  const base = process.resourcesPath
  if (base === undefined) return null
  const tar = join(base, 'kcoder-runtime.tar.gz')
  return existsSync(tar) ? tar : null
}

/** 已解压内置运行时的目标目录（userData 下，跨启动复用）。 */
function bundledRuntimeExtractDir(): string {
  return join(app.getPath('userData'), 'kcoder-runtime')
}

let runtimeBusy = false

/**
 * 确保内置运行时可用（幂等）：tar 指纹（size+mtime）与上次一致时直接
 * 复用解压目录；否则原子重新解压（临时目录解压后 rename 顶替）。
 * 首次解压约数秒（同步，一次性）；打包态无 tar 返回 null。
 */
export function ensureBundledRuntime(): string | null {
  const tar = bundledRuntimeArchive()
  if (tar === null) return null
  const dest = bundledRuntimeExtractDir()
  const stampOf = (p: string) => {
    const st = statSync(p)
    return `${st.size}:${Math.trunc(st.mtimeMs)}`
  }
  if (existsSync(join(dest, BUNDLED_BIN))) {
    try {
      if (readFileSync(join(dest, '.runtime-stamp'), 'utf8') === stampOf(tar)) return dest
    } catch { /* 指纹缺失，重新解压 */ }
  }
  if (runtimeBusy) return null
  runtimeBusy = true
  try {
    const tmp = `${dest}.tmp-${process.pid}`
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    // macOS/Linux/Windows 10+ 均自带 tar（bsdtar 兼容 -xzf）；失败回退
    // 到克隆/PATH 分支而非崩溃
    const res = spawnSync('tar', ['-xzf', tar, '-C', tmp], { timeout: 180_000 })
    const root = existsSync(join(tmp, BUNDLED_BIN)) ? tmp : join(tmp, 'kcoder-runtime')
    if (res.status !== 0 || !existsSync(join(root, BUNDLED_BIN))) {
      console.error(`[dsh-contract] 内置运行时解压失败：${String(res.stderr)}`)
      rmSync(tmp, { recursive: true, force: true })
      return null
    }
    writeFileSync(join(root, '.runtime-stamp'), stampOf(tar))
    rmSync(dest, { recursive: true, force: true })
    renameSync(root, dest)
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
    return dest
  } finally {
    runtimeBusy = false
  }
}

/**
 * 解析 assets/ 下的资产路径（官方 DeepSeek 图标等）。
 * 开发时在项目根 assets/；打包后在 extraResources 的 assets/ 下。
 */
export function resolveAsset(name: string): string {
  const dev = join(PROJECT_ROOT, 'assets', name)
  if (existsSync(dev)) return dev
  return join(process.resourcesPath ?? PROJECT_ROOT, 'assets', name)
}

/** 构建后的 CLI bin（相对上游根）。 */
export const UPSTREAM_BIN = join('apps', 'cli', 'lib', 'bin.js')

/** 物化运行时内的 CLI bin（pnpm deploy 输出即 CLI 包根，无 apps/cli 层级）。 */
export const BUNDLED_BIN = join('lib', 'bin.js')

/** 上游 web profile 名称。 */
export const WEB_PROFILE = 'web'

/** dsh Harness home（KCoder 默认自有 `~/.kcoder`，启动决策见
 * home-migration.ts：用户显式设置 DSH_HOME 时从之，老用户未迁移暂为 ~/.dsh）。 */
export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.kcoder')
}

/**
 * 运行时内 vendor 的 pnpm 入口（tools/pnpm/bin/pnpm.mjs；
 * materialize-peers 物化，版本对齐上游 packageManager）。pnpm npm 包
 * 零外部依赖（协作包自带在 dist/node_modules），解释器直跑入口即可。
 * 开发态/未物化返回 null。
 */
export function vendoredPnpmEntry(): string | null {
  const bundled = ensureBundledRuntime()
  if (bundled !== null) {
    const entry = join(bundled, 'tools', 'pnpm', 'bin', 'pnpm.mjs')
    if (existsSync(entry)) return entry
  }
  return null
}

/**
 * 在指定目录跑 pnpm（预置插件/补丁物化链的统一入口）：
 * - 打包态优先 vendor 实体——普通用户机器没有 pnpm（GUI 应用不经
 *   shell 启动，PATH 增强也救不了没装的），用与 dsh 同款解释器直跑；
 * - 开发态回退 PATH 上的 pnpm；Windows 上 npm shim 是 .cmd，
 *   CVE-2024-27980 加固后 spawn 必须带 shell（上游 plugin.ts 同款处理）。
 */
export function runPnpm(
  args: string[],
  cwd: string,
  timeoutMs: number,
): SpawnSyncReturns<string> {
  const entry = vendoredPnpmEntry()
  if (entry !== null) {
    const runtime = resolveRuntime() ?? { command: process.execPath, args: [], isElectron: true }
    return spawnSync(runtime.command, [...runtime.args, entry, ...args], {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      env: runtime.isElectron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
    })
  }
  return spawnSync('pnpm', args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    shell: process.platform === 'win32',
  })
}

/** 上游 package.json 的 engines.node 要求；克隆缺失时返回 null。 */
export function upstreamNodeRange(): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(UPSTREAM_DIR, 'package.json'), 'utf8')) as {
      engines?: { node?: string }
    }
    return manifest.engines?.node ?? null
  } catch {
    return null
  }
}

/** 上游克隆是否存在（目录 + git 元数据）。 */
export function upstreamCloned(): boolean {
  return existsSync(join(UPSTREAM_DIR, '.git'))
}

/** 上游是否已完成 `pnpm run build`（以 CLI bin 产物为准）。 */
export function upstreamBuilt(): boolean {
  return existsSync(join(UPSTREAM_DIR, UPSTREAM_BIN))
}

/**
 * 运行 dsh 用的 Node 解释器。
 *
 * 统一带 `--expose-internals`：web profile 的 HMR 服务需要 node internal
 * ESM loader（vendor/loader 的 requireInternal）。系统 node 下可走
 * node-addon-require-builtin 回退，但 Electron 内置 node 下回退不可用，
 * 必须显式给 flag（v0.1.0 真机首启即挂在此处，本地冒烟因用系统 node
 * 而漏过）。
 *
 * 优先系统 node（与用户构建上游时的版本一致），其版本必须满足上游
 * engines.node；不满足时退回 Electron 内置 node（ELECTRON_RUN_AS_NODE）；
 * 都不满足时返回 null（应引导用户修环境）。
 */
export function resolveRuntime(): { command: string; args: string[]; isElectron: boolean } | null {
  const range = upstreamNodeRange()
  const sysNode = spawnSync('node', ['--version'], { encoding: 'utf8', timeout: 5_000 })
  const sysOk =
    sysNode.status === 0 && typeof sysNode.stdout === 'string'
    && (range === null || satisfies(sysNode.stdout.trim().slice(1), range))
  if (sysOk) return { command: 'node', args: ['--expose-internals'], isElectron: false }
  const electronVersion = `v${process.versions.node}`
  if (range === null || satisfies(electronVersion.slice(1), range)) {
    return { command: process.execPath, args: ['--expose-internals'], isElectron: true }
  }
  return null
}

/** 一条可执行的 dsh 命令描述。 */
export interface DshCommand {
  source: DshSource
  /** 进程命令（解释器或可执行文件）。 */
  command: string
  /** command 之后、子命令之前的固定参数（如 bin 路径）。 */
  baseArgs: string[]
  /** `web` 子命令是否支持 `--no-open`（上游 ≥ 0.1.0-rc.8）。rc.8 起
   *  `dsh web` 默认把就绪 URL 交给系统默认浏览器；宿主侧车必须传
   *  `--no-open` 抑制（Electron shell 窗口自己加载该 URL）。旧版的
   *  commander 把未知 option 当错误退出——传了会直接炸启动，且旧版
   *  本无自动开浏览器行为，不传即正确。版本未知时保守不传。 */
  webNoOpen: boolean
  /** 工作目录。 */
  cwd: string
  /** 需要注入的环境（ELECTRON_RUN_AS_NODE 等）。 */
  env: NodeJS.ProcessEnv
  /** 人类可读描述（诊断面板展示）。 */
  describe: string
  /** 面向终端用户的脱敏描述（关于页等）：与 describe 同语义但不含本机
   * 绝对路径——开发者目录 / userData 路径属个人机器信息，不对外暴露。 */
  describePublic: string
}

/** 目录内 dsh 仓的版本号（monorepo 根 package.json 的 version）；读不到/非 semver 返回 null。
 * 导出供 about-settings 等读取实际运行时版本。 */
export function upstreamVersionIn(dir: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? valid(manifest.version) : null
  } catch {
    return null
  }
}

/** `--version` 输出（首行形如 `0.1.0-rc.8`）解析出的 semver；失败返回 null。 */
function parseVersionOutput(stdout: string): string | null {
  const first = stdout.split('\n', 1)[0]?.trim() ?? ''
  return valid(first)
}

/**
 * 解析启动 dsh 的命令，优先级：
 * 1. `DSH_BIN` 环境变量（可执行文件或 `node script.js` 形式）
 * 2. 打包内置运行时（resources/kcoder-runtime.tar.gz 首启解压到
 *    userData；系统 node 满足版本要求时用系统，否则用 Electron 内置 node）
 * 3. 本地克隆的构建产物（`node apps/cli/lib/bin.js`，开发态）
 * 4. PATH 中的 `dsh`
 *
 * @returns 命令描述；找不到任何可用来源时返回 null。
 */
export function resolveDshCommand(): DshCommand | null {
  // 1) 显式环境变量：支持 "dsh" 或 "node /path/bin.js"
  const envBin = process.env.DSH_BIN
  if (envBin !== undefined && envBin !== '') {
    const parts = envBin.split(/\s+/)
    // --version 探测一次（与 PATH 分支同款）：DSH_BIN 可指向任意版本
    //（含 rc.7 及更早），--no-open 门必须按实际版本判定
    const probe = spawnSync(parts[0], [...parts.slice(1), '--version'], {
      encoding: 'utf8',
      timeout: 10_000,
    })
    const version = probe.status === 0 ? parseVersionOutput(probe.stdout) : null
    return {
      source: 'env',
      command: parts[0],
      baseArgs: parts.slice(1),
      webNoOpen: version !== null && gte(version, '0.1.0-rc.8'),
      cwd: UPSTREAM_DIR,
      env: {},
      describe: `$DSH_BIN: ${envBin}`,
      describePublic: '环境变量 $DSH_BIN',
    }
  }

  // 2) 打包内置运行时（物化产物是纯 JS，不挑 node 小版本；
  //    系统 node 缺失或不满足 range 时无条件用 Electron 内置 node）
  const bundled = ensureBundledRuntime()
  if (bundled !== null) {
    const runtime = resolveRuntime()
    const cmd = runtime ?? { command: process.execPath, args: ['--expose-internals'], isElectron: true }
    const version = upstreamVersionIn(bundled)
    return {
      source: 'checkout',
      command: cmd.command,
      baseArgs: [...cmd.args, join(bundled, BUNDLED_BIN)],
      webNoOpen: version !== null && gte(version, '0.1.0-rc.8'),
      cwd: bundled,
      env: cmd.isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
      describe: `内置运行时: ${cmd.isElectron ? 'Electron node' : '系统 node'} ${join(bundled, BUNDLED_BIN)}`,
      describePublic: `内置运行时: ${cmd.isElectron ? 'Electron node' : '系统 node'}`,
    }
  }

  // 3) 本地克隆的构建产物（版本随仓库基线走，读根 package.json 零成本）
  if (upstreamCloned() && upstreamBuilt()) {
    const runtime = resolveRuntime()
    if (runtime !== null) {
      const version = upstreamVersionIn(UPSTREAM_DIR)
      return {
        source: 'checkout',
        command: runtime.command,
        baseArgs: [...runtime.args, join(UPSTREAM_DIR, UPSTREAM_BIN)],
        webNoOpen: version !== null && gte(version, '0.1.0-rc.8'),
        cwd: UPSTREAM_DIR,
        env: runtime.isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
        describe: `本地克隆: ${runtime.isElectron ? 'Electron node' : '系统 node'} ${join(UPSTREAM_DIR, UPSTREAM_BIN)}`,
        describePublic: `本地克隆: ${runtime.isElectron ? 'Electron node' : '系统 node'}`,
      }
    }
    return null
  }

  // 4) PATH 中的 dsh（用户全局安装了 @deepseek-ai/dsh 或自行链接；
  //    存在性探测顺手的 --version stdout 决定 --no-open 门）
  const probe = spawnSync('dsh', ['--version'], { encoding: 'utf8', timeout: 10_000 })
  if (probe.status === 0) {
    const version = parseVersionOutput(probe.stdout)
    return {
      source: 'path',
      command: 'dsh',
      baseArgs: [],
      webNoOpen: version !== null && gte(version, '0.1.0-rc.8'),
      cwd: UPSTREAM_DIR,
      env: {},
      describe: 'PATH 中的 dsh',
      describePublic: 'PATH 中的 dsh',
    }
  }
  return null
}
