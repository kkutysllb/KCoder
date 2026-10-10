/**
 * 存量会话预设迁移（纯逻辑半区，无 electron 依赖）。
 *
 * ## 背景（产品决策 D4，2026-10-10）
 *
 * Agent 预设收缩为单一 PTC 模式（见 product-policy.ts 的 D4 段）：上游四预设
 * 中 standard / minimal / cordis 三行禁用，ptc 吸收创造模式能力后成为唯一预设。
 * 会话组合按会话头里的 `agentPreset` 投影重建，预设不在注册表即
 * `agent-preset/not-found`——因此三个退役预设的存量会话 resume 全断，需要把
 * 会话日志里的预设 id 改写为幸存 id。
 *
 * ## 会话日志物理布局（deepseek-harness session-persistence-jsonl）
 *
 * `sessions/<工作区slug>/<会话id>/session.v<N>.jsonl.zstd`：多帧 zstd（首帧恰
 * 好一行 `type:'session'` 头记录、逐批次帧、帧带 XXH64 checksum）。预设 id 出现
 * 在两处：头记录顶层 `agentPreset` 字段、`agent-preset/selected` 事件的
 * `data.agentPreset`。改写只能整文件重建（不能删行：读路径依赖 seq 连续），
 * 帧扫描逐字移植自上游 `session-persistence-jsonl/src/zstd.ts` 的
 * scanZstdFrames；压缩参数对齐 compressZstdFrame（checksumFlag=1）——用 zstd
 * CLI 重压会产出单帧无校验文件，被 assertZstdHeaderFrame 拒载（实测踩过，
 * 见 scripts/fix-poison-session.mjs 文件头）。
 *
 * ## 安全性
 *
 * - **只在引擎启动前执行**（引擎运行中会话可能在屏，改写竞态；菜单项走
 *   「重启并迁移」路线，见 session-migration-window.ts）。
 * - 首次处理自动备份 `.bak-preset`，后续从备份重建（重复运行收敛到同一结果，
 *   原件永不二次破坏）。
 * - 写入走临时文件 + rename 原子替换；回读校验 seq 连续，失败即抛（调用方
 *   保留备份，用户可从 `.bak-preset` 手工恢复）。
 * - 扫描只解压**首帧**（头记录就是权威预设来源），1496 个会话秒级完成。
 *
 * @module desktop/shared/session-preset-migration
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib'
import { basename, join } from 'node:path'

const ZSTD_MAGIC = 0xFD2FB528
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

/** 收缩后的唯一幸存预设 id（product-policy 的 D4 段与之锚定）。 */
export const SURVIVOR_PRESET = 'ptc'

/**
 * 退役预设 → 幸存预设映射。`code` 是 0.1.x 时代 ptc 的旧 id（上游改名
 * commit 3ca9c7d489 未做会话兼容，与 scripts/fix-poison-session.mjs 的
 * PRESET_RENAME 同源）；其余三个随 D4 收缩退役。**两处映射必须同步维护**
 * （脚本与产品库各一份：脚本跑在系统 node 上处理单文件，产品库跑在
 * Electron 主进程处理全量——改动时两边同改）。
 */
export const PRESET_RENAME: Record<string, string> = {
  code: 'ptc',
  standard: 'ptc',
  cordis: 'ptc',
  minimal: 'ptc',
}

/** 一个待迁移会话（扫描产物，直接喂给迁移窗口的列表）。 */
export interface SessionPresetCandidate {
  /** 会话日志绝对路径（session.v<N>.jsonl.zstd）。 */
  file: string
  /** 会话 id（头记录的 id 字段）。 */
  sessionId: string
  /** 工作区目录名（路径 mangling 形态，如 `--Users-libing-AIDC--`）。 */
  workspaceDir: string
  /** 展示用工作区路径（尽力反 mangling；失败时原样展示目录名）。 */
  workspaceDisplay: string
  /** 头记录的 createdAt（epoch ms）。 */
  createdAt: number
  /** 退役预设 id（即 PRESET_RENAME 的键）。 */
  oldPreset: string
  /**
   * 会话标题（供迁移列表人工辨认；752 行的 cwd+日期没人审得动）。
   * 来源是日志体内的首个 `session/title` 事件（fallback 标题在首个用户
   * 消息后即出现，通常在前几帧）；无标题会话缺省。
   */
  title?: string
}

/** 单文件迁移结果。 */
export interface MigrateOutcome {
  file: string
  /** 改写记录数（头 + selected 事件）。0 表示无需改写。 */
  renamed: number
  /** 帧数（重建规模，供日志）。 */
  frames: number
}

/** 移植的 scanZstdFrames：定位全部完整帧边界（不解压）。 */
export function scanZstdFrames(buffer: Buffer): Array<{ start: number; end: number }> {
  const frames: Array<{ start: number; end: number }> = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid frame magic at byte ${offset}`)
    }
    offset += 4
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) throw new Error(`reserved header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error(`reserved block type at byte ${offset - 3}`)
      offset += blockType === 0x01 ? 1 : blockSize
      if (lastBlock) break
    }
    if (checksum) offset += 4
    frames.push({ start, end: offset })
  }
  return frames
}

/** 从会话日志读头记录（只解压首帧——首帧恰一行 `type:'session'` 头）。 */
export function readSessionHeader(file: string): { id: string; createdAt: number; cwd?: string; agentPreset?: string } {
  const buffer = readFileSync(file)
  const frames = scanZstdFrames(buffer)
  if (frames.length === 0) throw new Error('empty session log')
  const plain = zstdDecompressSync(buffer.subarray(frames[0].start, frames[0].end)).toString('utf8')
  const firstLine = plain.split('\n')[0]
  if (!firstLine) throw new Error('first frame has no header line')
  const header = JSON.parse(firstLine) as { type?: string; id?: string; createdAt?: number; cwd?: string; agentPreset?: string }
  if (header.type !== 'session' || typeof header.id !== 'string' || typeof header.createdAt !== 'number') {
    throw new Error('first line is not a session header')
  }
  return { id: header.id, createdAt: header.createdAt, cwd: header.cwd, agentPreset: header.agentPreset }
}

/**
 * 读会话标题：按帧顺序解压，遇到**首个** `session/title` 事件即停（初标题
 * 足够人工辨认；后续改名事件不追溯——扫描面是 ~全部存量会话，成本优先）。
 * 没有标题事件（空会话/未命名）→ undefined。解析失败按无标题处理，
 * 不抛——标题是锦上添花，候选资格由头记录单独决定。
 */
export function readSessionTitle(file: string): string | undefined {
  const buffer = readFileSync(file)
  for (const range of scanZstdFrames(buffer)) {
    const plain = zstdDecompressSync(buffer.subarray(range.start, range.end)).toString('utf8')
    for (const line of plain.split('\n')) {
      if (!line.includes('"session/title"')) continue
      try {
        const d = JSON.parse(line) as { type?: string; data?: { title?: unknown } }
        if (d.type === 'session/title' && typeof d.data?.title === 'string' && d.data.title.length > 0) {
          return d.data.title
        }
      } catch { /* 坏行当无标题，继续扫 */ }
    }
  }
  return undefined
}

/**
 * 目录名反 mangling（**纯展示兜底**）：引擎的 projectKey（format.ts:225）把
 * `/`、`\`、`:` 的连跑折叠成单个 `-` 并保留字面 `-`——**不可逆**，同形目录名
 * 可能来自不同路径。权威工作区路径在头记录的 `cwd` 字段（candidateFromFile
 * 已优先使用）；本函数只在 cwd 缺席时给出近似展示：剥 `--` 包裹、解 `~XXXX`
 * 十六进制、分隔连跑按 `/` 还原。
 */
export function workspaceDisplayOf(dirName: string): string {
  const inner = dirName.replace(/^--/, '').replace(/--$/, '')
  if (!inner) return dirName
  return '/' + inner
    .replace(/~([0-9A-Fa-f]{4})/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return code > 0 && code < 0x110000 ? String.fromCharCode(code) : `~${hex}`
    })
    .replace(/-+/g, '/')
}

/**
 * 单文件候选判定（两种扫描共享的内核）：读头记录，预设属于退役映射
 * → 候选；读不了/头损坏 → error 由调用方上报。
 */
function candidateFromFile(
  filePath: string,
  workspaceDir: string,
): { kind: 'candidate'; value: SessionPresetCandidate } | { kind: 'skip' } | { kind: 'error'; error: unknown } {
  try {
    const header = readSessionHeader(filePath)
    if (header.agentPreset !== undefined && header.agentPreset in PRESET_RENAME) {
      // 标题尽力而为：读不出来不丢候选（候选资格只由头记录决定）
      let title: string | undefined
      try {
        title = readSessionTitle(filePath)
      } catch { /* 标题缺失照常列出 */ }
      return {
        kind: 'candidate',
        value: {
          file: filePath,
          sessionId: header.id,
          workspaceDir,
          // 权威工作区路径是头记录的 cwd；目录名反解只做 cwd 缺席时的展示兜底
          workspaceDisplay: header.cwd ?? workspaceDisplayOf(workspaceDir),
          createdAt: header.createdAt,
          oldPreset: header.agentPreset,
          title,
        },
      }
    }
    return { kind: 'skip' }
  } catch (error) {
    return { kind: 'error', error }
  }
}

/** 会话目录下的日志文件全路径；目录不可读 → 空数组 + 上报。 */
function logFilesOf(sdPath: string, onError?: (file: string, error: unknown) => void): string[] {
  try {
    if (!statSync(sdPath).isDirectory()) return []
    return readdirSync(sdPath)
      .filter((f) => f.endsWith('.jsonl.zstd'))
      .map((f) => join(sdPath, f))
  } catch (error) {
    onError?.(sdPath, error)
    return []
  }
}

/** 会话根下的工作区目录名列表；根不存在（全新安装）→ 空数组。 */
function workspaceDirsOf(sessionsRoot: string): string[] {
  try {
    return readdirSync(sessionsRoot)
  } catch {
    return []
  }
}

/**
 * 扫描会话根目录（**同步**，阻塞式）：列出「头记录预设属于退役预设」的会话。
 * 只解压每个文件的首帧。会话量大时请用 {@link scanSessionCandidatesAsync}——
 * 同步版适合脚本/测试场景。
 */
export function scanSessionCandidates(
  sessionsRoot: string,
  onError?: (file: string, error: unknown) => void,
): SessionPresetCandidate[] {
  const candidates: SessionPresetCandidate[] = []
  for (const workspaceDir of workspaceDirsOf(sessionsRoot)) {
    const wsPath = join(sessionsRoot, workspaceDir)
    let sessionDirs: string[] = []
    try {
      if (!statSync(wsPath).isDirectory()) continue
      sessionDirs = readdirSync(wsPath)
    } catch (error) {
      onError?.(wsPath, error)
      continue
    }
    for (const sessionDir of sessionDirs) {
      for (const filePath of logFilesOf(join(wsPath, sessionDir), onError)) {
        const r = candidateFromFile(filePath, workspaceDir)
        if (r.kind === 'candidate') candidates.push(r.value)
        else if (r.kind === 'error') onError?.(filePath, r.error)
      }
    }
  }
  candidates.sort((a, b) => b.createdAt - a.createdAt)
  return candidates
}

/**
 * 扫描会话根目录（**异步分片**）：逻辑同 {@link scanSessionCandidates}，但每
 * 处理完一个会话目录就让出一次事件循环——Electron 主进程在扫描期间保持
 * 可响应（窗口绘制/输入不冻结）。约 1500 会话的机器上总耗时秒级。
 */
export async function scanSessionCandidatesAsync(
  sessionsRoot: string,
  onError?: (file: string, error: unknown) => void,
): Promise<SessionPresetCandidate[]> {
  const candidates: SessionPresetCandidate[] = []
  const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
  for (const workspaceDir of workspaceDirsOf(sessionsRoot)) {
    const wsPath = join(sessionsRoot, workspaceDir)
    let sessionDirs: string[] = []
    try {
      if (!statSync(wsPath).isDirectory()) continue
      sessionDirs = readdirSync(wsPath)
    } catch (error) {
      onError?.(wsPath, error)
      continue
    }
    for (const sessionDir of sessionDirs) {
      await tick()
      for (const filePath of logFilesOf(join(wsPath, sessionDir), onError)) {
        const r = candidateFromFile(filePath, workspaceDir)
        if (r.kind === 'candidate') candidates.push(r.value)
        else if (r.kind === 'error') onError?.(filePath, r.error)
      }
    }
  }
  candidates.sort((a, b) => b.createdAt - a.createdAt)
  return candidates
}

/**
 * 迁移单个会话文件：从备份（或原件）重建全部帧，改写两处预设 id
 * （头记录顶层 + `agent-preset/selected` 事件），回读校验 seq 连续后
 * 原子替换。与 scripts/fix-poison-session.mjs 同一套帧机制；差异只有
 * 两点——改写对象是预设 id（不动事件类型，故不做事件白名单校验），
 * 备份名是 `.bak-preset`。
 * @returns renamed=0 表示无需改写（已在备份后又被迁移过等竞态）。
 */
export function migrateSessionFile(target: string): MigrateOutcome {
  const bak = `${target}.bak-preset`
  if (!existsSync(bak)) copyFileSync(target, bak)
  // 从备份（原件）重建：重复运行收敛到同一结果，原件永不二次破坏
  const source = readFileSync(bak)
  const frames = scanZstdFrames(source)
  const out: Buffer[] = []
  let renamed = 0
  for (const [i, range] of frames.entries()) {
    const plain = zstdDecompressSync(source.subarray(range.start, range.end))
    let text = plain.toString('utf8')
    if (i === 0 && (text.length === 0 || text.indexOf('\n') !== text.length - 1)) {
      throw new Error('first frame is not exactly one header line — abort')
    }
    if (text.includes('"agentPreset"')) {
      text = text.split('\n').map((line) => {
        if (!line || !line.includes('"agentPreset"')) return line
        let d: { type?: string; agentPreset?: unknown; data?: { agentPreset?: unknown } }
        try {
          d = JSON.parse(line) as typeof d
        } catch {
          return line
        }
        // 两种形态：头记录顶层（type=session）；agent-preset/selected 事件
        const old = d.type === 'session' ? d.agentPreset : d.data?.agentPreset
        if (typeof old !== 'string' || !(old in PRESET_RENAME)) return line
        if (d.type === 'session') d.agentPreset = PRESET_RENAME[old]
        else if (d.type === 'agent-preset/selected' && d.data !== undefined) d.data.agentPreset = PRESET_RENAME[old]
        else return line
        renamed += 1
        return JSON.stringify(d)
      }).join('\n')
    }
    out.push(zstdCompressSync(Buffer.from(text, 'utf8'), CHECKSUM_OPTIONS))
  }
  if (renamed === 0) return { file: target, renamed: 0, frames: frames.length }
  // 原子替换：临时文件 + rename（半写状态不可见）
  const tmp = `${target}.mig-tmp`
  writeFileSync(tmp, Buffer.concat(out))
  // 回读校验：展开后 seq 连续（读路径的硬不变量；含 chunk 流的 seq0 展开）
  const rebuilt = readFileSync(tmp)
  const rframes = scanZstdFrames(rebuilt)
  const seqs: number[] = []
  rframes.forEach((range, i) => {
    const text = zstdDecompressSync(rebuilt.subarray(range.start, range.end)).toString('utf8')
    for (const line of text.split('\n')) {
      if (!line.trim() || i === 0) continue
      let d: { type?: string; seq?: number; data?: { texts?: unknown[]; args?: unknown[] }; seq0?: number }
      try {
        d = JSON.parse(line) as typeof d
      } catch {
        continue
      }
      if (d.type === 'text-chunks' || d.type === 'reasoning-chunks') {
        const texts = d.data?.texts
        if (Array.isArray(texts) && typeof d.seq0 === 'number') {
          for (let k = 0; k < texts.length; k++) seqs.push(d.seq0 + k)
        }
        continue
      }
      if (d.type === 'tool-call-chunks') {
        const args = d.data?.args
        if (Array.isArray(args) && typeof d.seq0 === 'number') {
          for (let k = 0; k < args.length; k++) seqs.push(d.seq0 + k)
        }
        continue
      }
      if (d.seq !== undefined) seqs.push(d.seq)
    }
  })
  const gaps = seqs.slice(1).filter((s, j) => s !== seqs[j] + 1)
  if (gaps.length !== 0) {
    try {
      writeFileSync(tmp, '') // 失败不留半成品内容（rename 前先毁掉）
    } catch { /* 尽力而为 */ }
    throw new Error(`seq verification failed (gaps at ${gaps.slice(0, 5).join(',')})`)
  }
  renameSync(tmp, target)
  return { file: target, renamed, frames: frames.length }
}

/** 文件名（不含目录）——迁移窗口列表的次要展示。 */
export function sessionFileBasename(file: string): string {
  return basename(file)
}
