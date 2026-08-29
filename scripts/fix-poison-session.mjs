/**
 * 会话日志毒事件中和修复：把白名单外的插件留毒事件（如已卸载的
 * dsh-rich-artifacts 写入的 artifact/published）中和为白名单内零状态
 * 副作用的装饰事件（hook/invoked），并保持上游多帧 zstd 布局（首帧
 * 仅 header 行、逐批次帧、帧带 XXH64 checksum）。0.1.2-alpha.1 起
 * assertEventsSupported 纯白名单硬校验且 ignorable 机制已删、读路径
 * 依赖 seq 连续，故既不能删行也不能只补标——替换是唯一正解。
 *
 * 直接用 `zstd` CLI 重压会产出单帧无校验文件，被
 * session-persistence-jsonl 的 assertZstdHeaderFrame 拒载（实测踩过）。
 *
 * 帧扫描逻辑逐字移植自上游
 * deepseek-harness/packages/session/session-persistence-jsonl/src/zstd.ts
 * 的 scanZstdFrames；压缩参数对齐 compressZstdFrame（checksumFlag=1）。
 *
 * 用法：node scripts/fix-poison-session.mjs <session.jsonl.zstd>...
 * （首次处理自动备份 .bak-poison，后续从备份重建）
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib'

const ZSTD_MAGIC = 0xFD2FB528
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

/** 毒事件类型 → 中和后的装饰事件类型（须在上游 KNOWN_SESSION_EVENT_TYPES 内）。 */
const POISON = 'artifact/published'
const NEUTRAL = 'hook/invoked'

/** 上游 preset 改名（commit 3ca9c7d489：code-mode → ptc）但会话兼容映射
 * 故意未做（等 v0→v1 migration PR），旧会话 resume 必炸。数据层对齐改名。 */
const PRESET_RENAME = { code: 'ptc' }

/** 上游白名单（生成自 core/session/known-event-types.ts，0.1.2-alpha.1）。 */
const KNOWN = new Set(`agent-preset/selected agent/inbox/spliced approval/asked approval/decided approval/policy assistant/chunk assistant/message command/done command/run compaction/end compaction/prune compaction/start compaction/summary feedback/record goal/change hook/invoked hook/result llm/retry llm/retry-started model/selection permission/preset plan/mode request/context request/header sandbox/mode schedule/change session-log-deepseek/delivery-accepted session/end-seed session/title session/title-llm-request step/end step/start subagent/descriptor subagent/model-selection-policy team/member team/message/delivered team/message/queued team/task todo/write tool-workflow/agent-end tool-workflow/agent-start tool-workflow/run-end tool-workflow/run-start tool/call tool/code-dispatch tool/code-dispatch-start tool/result turn/end turn/start user/message web/deepseek-search-llm-request`.split(' '))

/** 移植的 scanZstdFrames：定位全部完整帧边界（不解压）。 */
function scanZstdFrames(buffer) {
  const frames = []
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

function fixOne(target) {
  const bak = `${target}.bak-poison`
  if (!existsSync(bak)) copyFileSync(target, bak)
  // 从原始上游结构重建，不从（可能已被单帧重压污染的）当前文件
  const source = readFileSync(bak)
  const frames = scanZstdFrames(source)
  const out = []
  let neutralized = 0
  let renamed = 0
  for (const [i, range] of frames.entries()) {
    const plain = zstdDecompressSync(source.subarray(range.start, range.end))
    let text = plain.toString('utf8')
    if (i === 0 && (text.length === 0 || text.indexOf('\n') !== text.length - 1)) {
      throw new Error('first frame is not exactly one header line — abort')
    }
    const touched = text.includes(`"${POISON}"`) || text.includes('"agentPreset"')
    if (touched) {
      text = text.split('\n').map((line) => {
        if (!line) return line
        if (line.includes(`"${POISON}"`)) {
          const d = JSON.parse(line)
          if (d.type !== POISON || d.seq === undefined) return line
          neutralized += 1
          return JSON.stringify({
            type: NEUTRAL,
            seq: d.seq,
            time: d.time,
            data: {
              kcoder: 'poison-event-neutralized',
              original: POISON,
              note: 'uninstalled plugin leftover; alpha.1 removed the ignorable skip path',
            },
          })
        }
        if (line.includes('"agentPreset"')) {
          const d = JSON.parse(line)
          // 两种形态：旧基线写 header 顶层（type=session）；新基线走
          // agent-preset/selected 事件的 data.agentPreset
          const old = d.type === 'session' ? d.agentPreset : d.data?.agentPreset
          if (typeof old === 'string' && old in PRESET_RENAME) {
            if (d.type === 'session') d.agentPreset = PRESET_RENAME[old]
            else if (d.type === 'agent-preset/selected') d.data.agentPreset = PRESET_RENAME[old]
            else return line
            renamed += 1
            return JSON.stringify(d)
          }
        }
        return line
      }).join('\n')
    }
    out.push(zstdCompressSync(Buffer.from(text, 'utf8'), CHECKSUM_OPTIONS))
  }
  if (neutralized === 0 && renamed === 0) {
    console.log(`${target}: nothing to fix — untouched`)
    return
  }
  writeFileSync(target, Buffer.concat(out))
  console.log(`${target}: frames=${frames.length} neutralized=${neutralized} presetRenamed=${renamed}`)

  // 回读校验：全量白名单 + 展开后 seq 连续
  const rebuilt = readFileSync(target)
  const rframes = scanZstdFrames(rebuilt)
  const seqs = []
  const unknown = []
  rframes.forEach((range, i) => {
    const text = zstdDecompressSync(rebuilt.subarray(range.start, range.end)).toString('utf8')
    for (const line of text.split('\n')) {
      if (!line.trim() || i === 0) continue
      const d = JSON.parse(line)
      if (d.type === 'text-chunks' || d.type === 'reasoning-chunks') {
        for (let k = 0; k < d.data.texts.length; k++) seqs.push(d.seq0 + k)
        continue
      }
      if (d.type === 'tool-call-chunks') {
        for (let k = 0; k < d.data.args.length; k++) seqs.push(d.seq0 + k)
        continue
      }
      if (d.seq === undefined) continue
      seqs.push(d.seq)
      if (!KNOWN.has(d.type)) unknown.push(d.type)
    }
  })
  const gaps = seqs.slice(1).filter((s, j) => s !== seqs[j] + 1)
  console.log(`  verify: events=${seqs.length} range=${seqs[0]}-${seqs[seqs.length - 1]} gaps=${gaps.length === 0 ? 'NONE' : gaps.slice(0, 5)} unknown=${unknown.length === 0 ? 'NONE' : unknown}`)
  if (gaps.length !== 0 || unknown.length !== 0) throw new Error('verification failed')
  console.log('  REPAIR-OK')
}

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.error('usage: node scripts/fix-poison-session.mjs <session.jsonl.zstd>...')
  process.exit(1)
}
for (const target of targets) fixOne(target)
