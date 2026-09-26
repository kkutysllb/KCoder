/**
 * 逐主机「执行世界」：描述文件的读取，以及从描述生成 profile overlay。
 *
 * 为什么是逐主机的：上游 SSH 世界是**部署所有、进程级、单主机**的——
 * `dsh-ssh` 的 `host` 是 OpenSSH 别名，`workspace` 是单值，而 `ctx.fs` /
 * `ctx.subprocess` / `ctx.sandbox` 都是单一服务名。因此「每个远程主机一个
 * sidecar」是唯一成立的编排，而每个 sidecar 需要一个**把自己那个世界装起来**
 * 的 overlay。静态 bundle 装不下逐主机数据，这一层就是补它的。
 *
 * 数据由引导流程写入（插件仓 `scripts/provision-remote-world.mjs --register`），
 * 与 `hosts.json` 同目录同 DSH_HOME 口径。
 *
 * @module desktop/main/remote-world
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-contract'

/** 一台已引导就绪的远程主机：装好 Node 与 helper、并有可用 ssh 别名。 */
export interface RemoteWorldSpec {
  /** 主机 id（与插件主机注册表的 id 一致）。 */
  hostId: string
  /** 展示名。 */
  name: string
  /** `~/.ssh/config` 里的 Host 别名——`dsh-ssh` 只接受别名，不接受 user@host。 */
  alias: string
  /** 远端 Node 可执行文件绝对路径。 */
  node: string
  /** 远端 helper 入口绝对路径。 */
  helper: string
  /** 上述 helper 入口的 SHA-256（不匹配即拒绝连接）。 */
  helperHash: string
  /** 远端默认工作区绝对路径。 */
  workspace: string
}

/** 描述文件：与插件共用的 `<DSH_HOME>/ssh-remote/` 目录。 */
export function remoteWorldsPath(): string {
  return join(dshHome(), 'ssh-remote', 'worlds.json')
}

/** 生成的 overlay 落点。 */
export function remoteOverlayPath(hostId: string): string {
  return join(dshHome(), 'ssh-remote', 'overlays', `${hostId}.yml`)
}

/**
 * Read the registered worlds. A missing or malformed file is an empty list:
 * this feeds a menu, and a broken registry must not take the shell down.
 * @returns every registered world, in file order.
 */
export function readRemoteWorlds(): RemoteWorldSpec[] {
  const path = remoteWorldsPath()
  if (!existsSync(path)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is RemoteWorldSpec => {
      const candidate = entry as Partial<RemoteWorldSpec>
      return typeof candidate.hostId === 'string' && candidate.hostId !== ''
        && typeof candidate.alias === 'string' && candidate.alias !== ''
        && typeof candidate.node === 'string' && candidate.node !== ''
        && typeof candidate.helper === 'string' && candidate.helper !== ''
        && typeof candidate.helperHash === 'string' && candidate.helperHash !== ''
        && typeof candidate.workspace === 'string' && candidate.workspace !== ''
    })
  } catch {
    return []
  }
}

/**
 * Build the overlay that turns one profile into this host's execution world.
 *
 * Three groups, in dependency-free order (rows activate on service
 * availability, not position):
 * - **disable** the local providers, freeing `ctx.subprocess` / `ctx.sandbox` /
 *   `ctx.fs`. Each carries its `name` as an assertion: a patch's `name` is a
 *   mismatch check, not an override, so a renamed upstream row skips the patch
 *   loudly instead of silently disabling something else.
 * - **pin** the directory picker to the in-app browse pair. The upstream
 *   `directory-picker-auto` resolves to the host's OS chooser on macOS, which
 *   lists THIS machine — the wrong machine for a remote world.
 * - **insert** the SSH world and its picker surface.
 * @param spec - one registered world.
 * @returns the overlay document.
 */
export function remoteWorldOverlay(spec: RemoteWorldSpec): string {
  return `# 由 KCoder 生成的远程执行世界 overlay（host: ${spec.hostId}）
# 用法：dsh <profile> --patch <productPolicy> --patch <本文件> web --port 0 --no-open

# 1) 禁用本地 provider，腾出 ctx.subprocess / ctx.sandbox / ctx.fs
- id: subprocess
  name: "@deepseek-ai/dsh-subprocess-local"
  disabled: true
- id: sandbox
  name: "@deepseek-ai/dsh-sandbox-local"
  disabled: true
- id: fs-sandbox
  name: "@deepseek-ai/dsh-fs-sandbox"
  disabled: true

# 2) 沙箱工作区根指向远端
- id: sandbox-policy
  name: "@deepseek-ai/dsh-sandbox-policy"
  config:
    mode: workspace-write
    workspaceRoot: ${spec.workspace}

# 3) 目录选择器钉成应用内 browse（auto 在 macOS 会选本机 OS 对话框）
- id: directory-picker
  name: "@deepseek-ai/dsh-host-directory-picker-auto"
  disabled: true

# 4) 插入 SSH 世界
- insert:
    - id: ssh
      name: "@deepseek-ai/dsh-ssh"
      config:
        host: ${spec.alias}
        node: ${spec.node}
        helper: ${spec.helper}
        helperHash: ${spec.helperHash}
        workspace: ${spec.workspace}
    - id: subprocess-ssh
      name: "@deepseek-ai/dsh-subprocess-ssh"
    - id: sandbox-ssh
      name: "@deepseek-ai/dsh-sandbox-ssh"
    - id: fs-ssh
      name: "@deepseek-ai/dsh-fs-ssh"
    - id: directory-picker-browse
      name: "@deepseek-ai/dsh-host-directory-picker-browse"
    - id: directory-picker-browse-surface
      name: "@deepseek-ai/dsh-client-ui-directory-picker-browse"
`
}

/**
 * Write one world's overlay next to the registry, creating the directory on
 * first use. Rewritten every call: the spec is the source of truth, and a stale
 * overlay would point a sidecar at a helper digest that no longer exists.
 * @param spec - one registered world.
 * @returns the overlay file path, for `--patch`.
 */
export function writeRemoteWorldOverlay(spec: RemoteWorldSpec): string {
  const path = remoteOverlayPath(spec.hostId)
  mkdirSync(join(dshHome(), 'ssh-remote', 'overlays'), { recursive: true })
  writeFileSync(path, remoteWorldOverlay(spec))
  return path
}
