// dsh-ssh-remote — 远端执行世界引导（B-β 方案 §5.5）。
//
// 为什么引导必须留在本插件：上游 dsh-ssh 用 `BatchMode=yes` 调 ssh，OpenSSH
// 会在**客户端**直接把 password / keyboard-interactive 两个方法剔除
// （sshconnect2.c: authmethod_is_enabled —— 两者的 batch_flag 都指向
// options.batch_mode），所以 SSH_ASKPASS 也无从生效；而本插件自己的 ssh 调用
// 不设该标志，密码仍然可用。于是认证能力更强的这条通道承担一次性升级：
//
//   公钥 + ssh 别名 → 用户态 Node → helper 及其依赖 → 摘要 → 登记世界描述
//
// 升级完成后运行期交给 dsh-ssh（别名 + 公钥 + BatchMode）。全流程幂等。
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** dsh-ssh 及其 provider 的版本线；须与宿主基线同线（跨线会让类身份分裂）。 */
export const SSH_PACKAGE_VERSION = '0.1.7-rc.2'
/** cordis 是独立版本线（dsh-ssh 的 peer 为 ~4.0.4）。 */
export const CORDIS_VERSION = '4.0.4'
/** helper 的 peer 集：显式列全，避免 npm 解析歧义。 */
const HELPER_PACKAGES = [
  '@deepseek-ai/dsh-ssh',
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-fs-local',
  '@deepseek-ai/dsh-fs-sandbox',
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-sandbox-local',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-session-projection',
]

/** 远端 Node 默认版本（须 >=22.19 或 >=24，见宿主 engines）。 */
export const DEFAULT_NODE_VERSION = 'v24.21.0'

/** 结构化失败：code 供 UI 判别，detail 是给人看的原因。 */
export class ProvisionError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'ProvisionError'
    this.code = code
    this.detail = detail
  }
}

/** 远端脚本用：把路径按 POSIX 单引号安全包裹。 */
function q(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'"
}

/** 别名是否已可用（公钥 + BatchMode，即 dsh-ssh 的运行条件）。 */
export function aliasUsable(alias) {
  try {
    execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', alias, 'true'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** `~/.ssh/config` 里是否已有该 Host 段。 */
function aliasDeclared(alias) {
  const file = path.join(os.homedir(), '.ssh', 'config')
  if (!fs.existsSync(file)) return false
  return new RegExp(`^\\s*Host\\s+${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(fs.readFileSync(file, 'utf8'))
}

/**
 * 确保 `~/.ssh/config` 里有可用别名，且公钥已装到远端。
 *
 * 只做加法：已有同名 Host 段则原样保留（用户可能自己配了跳板等）；密钥固定落在
 * 插件数据目录而不是 `~/.ssh`，避免与用户既有密钥混淆，也便于随插件数据清理。
 * 私钥**不设口令**——BatchMode 下带口令私钥命中 SSH_ERR_KEY_WRONG_PASSPHRASE 会
 * 直接 quit 而不提示。
 * @param host - 主机记录（需要 user/host/port）。
 * @param opts - { alias, dataDir, runRemote, log }
 * @returns 别名（后续 dsh-ssh 的 host 值）。
 */
export async function ensureAlias(host, opts) {
  const { alias, dataDir, runRemote, log } = opts
  if (aliasUsable(alias)) {
    log(`别名 ${alias} 已可用（公钥 + BatchMode）`)
    return alias
  }

  const keyDir = path.join(dataDir, 'keys')
  fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 })
  const keyPath = path.join(keyDir, `${alias}_ed25519`)
  if (!fs.existsSync(keyPath)) {
    log(`生成专用无口令密钥：${keyPath}`)
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `dsh-remote-${alias}`, '-f', keyPath], { stdio: 'pipe' })
  }
  const pub = fs.readFileSync(`${keyPath}.pub`, 'utf8').trim()

  log('把公钥装到远端 authorized_keys（经密码通道，幂等）')
  const installed = await runRemote(host, [
    'set -e',
    'mkdir -p ~/.ssh && chmod 700 ~/.ssh',
    `grep -qF ${q(pub)} ~/.ssh/authorized_keys 2>/dev/null || printf '%s\\n' ${q(pub)} >> ~/.ssh/authorized_keys`,
    'chmod 600 ~/.ssh/authorized_keys',
    'echo ALIAS_OK',
  ].join('\n'))
  if (!String(installed.stdout || '').includes('ALIAS_OK')) {
    throw new ProvisionError('alias-failed', '公钥写入远端失败', String(installed.stderr || installed.stdout || '').slice(-300))
  }

  if (!aliasDeclared(alias)) {
    const configPath = path.join(os.homedir(), '.ssh', 'config')
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const block = [
      '',
      `# dsh-remote · ${host.name || alias}（由 dsh-ssh-remote 引导生成）`,
      `Host ${alias}`,
      `  HostName ${host.host}`,
      ...(host.port && host.port !== 22 ? [`  Port ${host.port}`] : []),
      `  User ${host.user}`,
      `  IdentityFile ${keyPath}`,
      '  IdentitiesOnly yes',
      '',
    ].join('\n')
    fs.appendFileSync(configPath, block)
    log(`已追加 ssh 别名段到 ${configPath}`)
  } else {
    log(`别名 ${alias} 已在 ssh config 中，未改动`)
  }

  if (!aliasUsable(alias)) {
    throw new ProvisionError(
      'alias-unusable',
      `别名 ${alias} 仍无法用公钥登录`,
      '检查远端是否允许 PubkeyAuthentication、~/.ssh 权限（700）与 authorized_keys（600），以及家目录不可 group-writable。',
    )
  }
  log(`别名 ${alias} 就绪`)
  return alias
}

/**
 * 引导一台主机：Node → helper 及依赖 → 摘要 → 世界描述登记。
 *
 * 所有远端步骤幂等：已就绪的步骤只做校验，重复执行不产生副作用。
 * @param host - 主机记录。
 * @param opts - { alias, dataDir, nodeVersion?, runRemote, log }
 * @returns { spec, log } —— spec 即已登记的世界描述。
 */
export async function provisionWorld(host, opts) {
  const { alias, dataDir, runRemote, log } = opts
  const nodeVersion = opts.nodeVersion || DEFAULT_NODE_VERSION
  // 这两个是**脚本里的 shell 表达式**，不是待引号包裹的用户数据：
  // 远端 shell 必须展开 $HOME（单引号会让它变成字面量路径，见 2026-09-26 实测）。
  const rootExpr = '"$HOME/.dsh-remote"'
  const workspaceExpr = '"$HOME/dsh-ws"'

  const probe = await runRemote(host, [
    'set -e',
    'printf \'{"os":"%s","arch":"%s","home":"%s"}\' "$(uname -s)" "$(uname -m)" "$HOME"',
  ].join('\n'), { timeoutMs: 30000 })
  let facts
  try {
    facts = JSON.parse(String(probe.stdout || '').trim())
  } catch {
    throw new ProvisionError('probe-failed', '远端环境探测失败', String(probe.stderr || probe.stdout || '').slice(-300))
  }
  if (facts.os !== 'Linux' && facts.os !== 'Darwin') {
    throw new ProvisionError('unsupported-os', `远端必须是 Linux 或 macOS（测得 ${facts.os}）`, '上游 SSH provider 不支持其他平台。')
  }
  log(`远端 ${facts.os}/${facts.arch}，home=${facts.home}`)

  const arch = facts.arch === 'aarch64' || facts.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  log(`安装/校验远端 Node ${nodeVersion}`)
  const nodeRun = await runRemote(host, [
    'set -euo pipefail',
    `ROOT=${rootExpr}`, `VER=${q(nodeVersion)}`, `TAR="node-$VER-${arch}.tar.xz"`,
    'mkdir -p "$ROOT"; cd "$ROOT"',
    'if [ -x "$ROOT/node/bin/node" ]; then echo "NODE_PRESENT $("$ROOT/node/bin/node" -v)"; exit 0; fi',
    'curl -fsSL -o "$TAR" "https://nodejs.org/dist/$VER/$TAR"',
    'curl -fsSL -o SHASUMS256.txt "https://nodejs.org/dist/$VER/SHASUMS256.txt"',
    'grep " $TAR\\$" SHASUMS256.txt | sha256sum -c -',
    'rm -rf "$ROOT/node"; mkdir -p "$ROOT/node"',
    'tar -xJf "$TAR" -C "$ROOT/node" --strip-components=1',
    'rm -f "$TAR"',
    'echo "NODE_INSTALLED $("$ROOT/node/bin/node" -v)"',
  ].join('\n'), { timeoutMs: 300000 })
  if (!/NODE_(PRESENT|INSTALLED)/.test(String(nodeRun.stdout || ''))) {
    throw new ProvisionError('node-failed', '远端 Node 安装失败', String(nodeRun.stderr || nodeRun.stdout || '').slice(-300))
  }
  log(String(nodeRun.stdout || '').trim().split('\n').pop())

  log('安装/校验 helper 及其依赖')
  const deps = HELPER_PACKAGES.map(p => `${p}@${SSH_PACKAGE_VERSION}`).join(' ')
  const helperRun = await runRemote(host, [
    'set -euo pipefail',
    `ROOT=${rootExpr}`,
    'export PATH="$ROOT/node/bin:$PATH"',
    'mkdir -p "$ROOT/helper"; cd "$ROOT/helper"',
    '[ -f package.json ] || echo \'{"name":"dsh-remote-helper","private":true,"version":"0.0.0"}\' > package.json',
    `npm i --no-audit --no-fund --loglevel=error ${deps} "@deepseek-ai/cordis@${CORDIS_VERSION}" >/dev/null`,
    'HELPER="$ROOT/helper/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js"',
    '[ -f "$HELPER" ] || { echo "HELPER_MISSING" >&2; exit 1; }',
    'OUT="$(node "$HELPER" </dev/null 2>&1 || true)"',
    'case "$OUT" in *"Cannot find package"*|*ERR_MODULE_NOT_FOUND*) echo "HELPER_DEPS_BROKEN" >&2; echo "$OUT" >&2; exit 1 ;; esac',
    'echo "HELPER_READY"',
  ].join('\n'), { timeoutMs: 600000 })
  if (!String(helperRun.stdout || '').includes('HELPER_READY')) {
    throw new ProvisionError('helper-failed', 'helper 及依赖安装失败', String(helperRun.stderr || helperRun.stdout || '').slice(-300))
  }
  log('helper 依赖解析 OK')

  const finalise = await runRemote(host, [
    'set -euo pipefail',
    `ROOT=${rootExpr}`,
    `mkdir -p ${workspaceExpr}`,
    'HELPER="$ROOT/helper/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js"',
    'printf \'{"node":"%s","helper":"%s","hash":"%s","workspace":"%s"}\' \\',
    '  "$ROOT/node/bin/node" "$HELPER" "$(sha256sum "$HELPER" | cut -d\' \' -f1)" "$HOME/dsh-ws"',
  ].join('\n'), { timeoutMs: 60000 })
  let resolved
  try {
    resolved = JSON.parse(String(finalise.stdout || '').trim())
  } catch {
    throw new ProvisionError('finalise-failed', '摘要计算失败', String(finalise.stderr || finalise.stdout || '').slice(-300))
  }

  const spec = {
    hostId: host.id,
    name: host.name || host.id,
    alias,
    node: resolved.node,
    helper: resolved.helper,
    helperHash: resolved.hash,
    workspace: resolved.workspace,
  }
  registerWorld(spec, dataDir)
  log(`世界描述已登记：${path.join(dataDir, 'worlds.json')}`)
  return spec
}

/**
 * 把世界描述 upsert 进 `<dataDir>/worlds.json`。
 *
 * 与 `hosts.json` 同目录（同为宿主 DSH_HOME 口径），但**分文件**：那份是主机与
 * 凭据（可手填），这份是「已引导就绪」的世界参数（只能由引导产出）。KCoder 的
 * 「远程」菜单读的就是这份。
 * @param spec - 已就绪的世界描述。
 * @param dataDir - 插件数据目录。
 */
export function registerWorld(spec, dataDir) {
  const file = path.join(dataDir, 'worlds.json')
  let worlds = []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) worlds = parsed
  } catch {
    // 首次登记或缺损文件：从空表重建（覆盖式写入）。
  }
  const next = worlds.filter(w => w && w.hostId !== spec.hostId)
  next.push(spec)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
  return file
}
