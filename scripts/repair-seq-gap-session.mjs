/**
 * 会话日志 seq 断档续接修复：日志前段被上游 torn-tail 恢复截断成种子区
 * （seq 0..N），而驻留进程后续追加的事件体沿用内存序号（如 394477 起），
 * 读路径（SessionLogScanner 的 seq = log.length 连续性契约）在接缝处拒载，
 * 表现为 "corrupt session log: seq gap in committed region"。
 *
 * 修复 = 把事件体整体平移续接到种子区之后（保序保内容，仅改序号）：
 * 顶层 seq / seq0（chunk 行）平移；信封级 sourceEventSeqs 逐条目处理——
 * 指向保留区的指针同步平移，指向丢失区（种子区之前）的指针丢弃，
 * 结果为空则删除该字段（读侧 assertProvenance 禁止非 assistant/message
 * 携带空数组）。读侧会严格校验该字段：要求条目为非负安全整数、全部指向
 * 更早事件且条数 <= 事件自身 seq，负数直接拒载并报 "unparsable committed
 * event"（平移出负数是实测踩过的坑）。
 * surfaceOp 同属序号引用：replace 的 start/end 指向保留区的同步平移；
 * 指向丢失区的（被替换节点在截断时就已不在 surface，回放必报
 * "start seq N not found in surface"）降级为 'append'——替换副本内容正是
 * 用户当时所见，作为新节点上屏语义正确。
 * data 内 shadowedSeqs / shadowedRange 一律不动：读路径不校验，且保持
 * 内部自洽（compaction invariant 要求二者首尾一致）；指向丢失区的属悬垂
 * 指针，回放时自然无匹配，无害。
 *
 * 保持上游多帧 zstd 布局（首帧仅 header 行、逐批次帧、帧带 XXH64
 * checksum）——zstd CLI 整体重压会产单帧无校验文件被
 * assertZstdHeaderFrame 拒载（实测踩过）。帧扫描逻辑逐字移植自上游
 * session-persistence-jsonl/src/zstd.ts 的 scanZstdFrames。
 *
 * 用法：node scripts/repair-seq-gap-session.mjs <session.jsonl.zstd>
 * （首次处理自动备份 .bak-seqgap；修复前确认无 dsh 进程在跑）
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib'

const ZSTD_MAGIC = 0xFD2FB528
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

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

/** 展开一条记录占用的事件数（移植上游解码口径：chunks 一行多事件）。 */
function expandedCount(rec) {
  if (rec.type === 'text-chunks' || rec.type === 'reasoning-chunks') return rec.data.texts.length
  if (rec.type === 'tool-call-chunks') return rec.data.args.length
  return 1
}

function repairOne(target) {
  const bak = `${target}.bak-seqgap`
  if (!existsSync(bak)) copyFileSync(target, bak)
  const source = existsSync(bak) ? readFileSync(bak) : readFileSync(target)
  const frames = scanZstdFrames(source)

  // 第一遍：定位断档接缝与平移量（展开口径全量扫描）
  let count = 0 // 已展开事件数 = 下一条记录的期望 seq
  let gapAtLine = -1
  let bodyStartSeq = -1
  const allLines = [] // [frameIndex, lineText]
  frames.forEach((range, fi) => {
    const text = zstdDecompressSync(source.subarray(range.start, range.end)).toString('utf8')
    if (fi === 0) {
      if (text.length === 0 || text.indexOf('\n') !== text.length - 1) {
        throw new Error('first frame is not exactly one header line — abort')
      }
    }
    for (const line of text.split('\n')) {
      allLines.push([fi, line])
      if (!line.trim() || (fi === 0)) continue
      const rec = JSON.parse(line)
      const s0 = rec.seq0 !== undefined ? rec.seq0 : rec.seq
      if (s0 === undefined) continue
      if (gapAtLine === -1 && s0 !== count) {
        gapAtLine = allLines.length
        bodyStartSeq = s0
      }
      count += expandedCount(rec)
    }
  })
  if (gapAtLine === -1) {
    console.log(`${target}: no seq gap found — untouched`)
    return
  }
  const seedEvents = (() => { // 断档前的种子区展开事件数
    let c = 0
    for (let i = 0; i < gapAtLine - 1; i++) {
      const [fi, line] = allLines[i]
      if (!line.trim() || fi === 0) continue
      c += expandedCount(JSON.parse(line))
    }
    return c
  })()
  const delta = bodyStartSeq - seedEvents
  console.log(`${target}: gap at expanded position ${seedEvents}, body starts seq ${bodyStartSeq}, shift -${delta}`)

  // 第二遍：逐帧改写（首帧直通；其余帧内按序号阈值平移——种子区序号恒小于
  // bodyStartSeq，两遍扫描的行索引空间不同，不用行号判断）
  const shiftSeqRef = (v) => v - delta
  // 溯源条目：保留区内平移；丢失区（平移后为负）丢弃；[a,b] 区间对按交截裁剪。
  const remapProvenance = (entries) => entries.flatMap((e) => {
    if (Array.isArray(e)) {
      if (e[1] < bodyStartSeq) return []
      return [[Math.max(e[0], bodyStartSeq) - delta, e[1] - delta]]
    }
    if (!Number.isSafeInteger(e) || e < 0 || e < bodyStartSeq) return []
    return [e - delta]
  })
  const out = []
  frames.forEach((range, fi) => {
    const text = zstdDecompressSync(source.subarray(range.start, range.end)).toString('utf8')
    if (fi === 0) {
      out.push(source.subarray(range.start, range.end)) // header 帧原始字节直通
      return
    }
    const lines = text.split('\n').map((line) => {
      if (!line.trim()) return line
      const rec = JSON.parse(line)
      const s0 = rec.seq0 !== undefined ? rec.seq0 : rec.seq
      if (s0 !== undefined && s0 >= bodyStartSeq) {
        if (rec.seq !== undefined) rec.seq = shiftSeqRef(rec.seq)
        if (rec.seq0 !== undefined) rec.seq0 = shiftSeqRef(rec.seq0)
        if (Array.isArray(rec.sourceEventSeqs)) {
          const remapped = remapProvenance(rec.sourceEventSeqs)
          if (remapped.length > 0) rec.sourceEventSeqs = remapped
          else delete rec.sourceEventSeqs // 读侧禁止非 assistant/message 携带空溯源
        }
        if (rec.surfaceOp !== undefined && rec.surfaceOp !== 'append'
          && typeof rec.surfaceOp === 'object' && rec.surfaceOp !== null) {
          if (rec.surfaceOp.start >= bodyStartSeq && rec.surfaceOp.end >= bodyStartSeq) {
            rec.surfaceOp.start = shiftSeqRef(rec.surfaceOp.start)
            rec.surfaceOp.end = shiftSeqRef(rec.surfaceOp.end)
          } else {
            rec.surfaceOp = 'append' // 被替换节点在丢失区，降级为新节点上屏
          }
        }
        // data.shadowedSeqs / data.shadowedRange 保持原样（见头注释）
      }
      return JSON.stringify(rec)
    })
    out.push(zstdCompressSync(Buffer.from(lines.join('\n'), 'utf8'), CHECKSUM_OPTIONS))
  })
  writeFileSync(target, Buffer.concat(out))

  // 回读校验：帧结构 + 展开后全量连续 + 首帧断言
  const rebuilt = readFileSync(target)
  const rframes = scanZstdFrames(rebuilt)
  let cnt = 0
  let total = 0
  rframes.forEach((range, fi) => {
    const text = zstdDecompressSync(rebuilt.subarray(range.start, range.end)).toString('utf8')
    if (fi === 0) {
      if (text.length === 0 || text.indexOf('\n') !== text.length - 1) {
        throw new Error('rebuilt first frame is not exactly one header line')
      }
      return
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const rec = JSON.parse(line)
      const s0 = rec.seq0 !== undefined ? rec.seq0 : rec.seq
      if (s0 === undefined) continue
      if (s0 !== cnt) throw new Error(`verify failed: line ${total + 1} expect ${cnt} got ${s0}`)
      // 复现读侧溯源校验（非负安全整数 + 条数 <= 自身 seq，区间对合法）
      if (Array.isArray(rec.sourceEventSeqs)) {
        let n = 0
        for (const e of rec.sourceEventSeqs) {
          if (Array.isArray(e)) {
            if (e.length !== 2 || !Number.isSafeInteger(e[0]) || !Number.isSafeInteger(e[1]) || e[0] < 0 || e[1] < e[0]) {
              throw new Error(`verify failed: bad provenance range at record ${total + 1}`)
            }
            n += e[1] - e[0] + 1
          } else {
            if (!Number.isSafeInteger(e) || e < 0) {
              throw new Error(`verify failed: negative provenance seq at record ${total + 1}: ${String(e)}`)
            }
            n += 1
          }
        }
        if (n > rec.seq) throw new Error(`verify failed: provenance length ${n} exceeds seq ${rec.seq} at record ${total + 1}`)
        if (n === 0 && rec.type !== 'assistant/message') {
          throw new Error(`verify failed: empty provenance on non-assistant event at record ${total + 1}`)
        }
        const own = rec.seq !== undefined ? rec.seq : (rec.seq0 !== undefined ? rec.seq0 : -1)
        for (const e of rec.sourceEventSeqs) {
          const hi = Array.isArray(e) ? e[1] : e
          if (hi >= own) throw new Error(`verify failed: provenance not earlier at record ${total + 1}`)
        }
      }
      if (rec.surfaceOp !== undefined && rec.surfaceOp !== 'append') {
        const ownSeq = rec.seq !== undefined ? rec.seq : rec.seq0
        if (rec.surfaceOp.start >= ownSeq || rec.surfaceOp.end >= ownSeq
          || rec.surfaceOp.start > rec.surfaceOp.end) {
          throw new Error(`verify failed: surfaceOp target not strictly earlier at record ${total + 1}`)
        }
      }
      cnt += expandedCount(rec)
      total += 1
    }
  })
  console.log(`  verify: frames=${rframes.length} records=${total} expanded=${cnt} contiguous=YES`)
  console.log('  REPAIR-OK')
}

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.error('usage: node scripts/repair-seq-gap-session.mjs <session.jsonl.zstd>...')
  process.exit(1)
}
for (const target of targets) repairOne(target)
