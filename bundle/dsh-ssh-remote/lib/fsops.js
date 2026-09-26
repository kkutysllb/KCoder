// dsh-ssh-remote — 远程文件语义：read（行号+二进制嗅探+sha）/ write（stdin 原子写）/
// edit（sha256 关键段）/ glob / grep。全部经 Runner（单参数直传远端 shell）。
import { randomBytes } from 'node:crypto'
import { shellQuote as q } from './exec.js'

export class FsOpsError extends Error {
  constructor(message, kind) {
    super(message)
    this.kind = kind
  }
}

function toFsError(result, fallback) {
  const kind = result.errorKind || fallback || 'remote-error'
  const msg = (result.stderr || result.stdout || ('exit ' + result.exitCode)).split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
  return new FsOpsError(msg, kind)
}

export class FsOps {
  constructor({ runner }) {
    this.runner = runner
  }

  /**
   * 读文件窗口。远端单条复合命令：
   *   h=$(sha256sum f); a=$(head -c 8192 f|wc -c); b=$(同去 NUL|wc -c); echo __SR__ h a b; sed -n 'o,ep' f
   * a!==b ⇒ 前 8KB 有 NUL ⇒ 二进制。返回 {content 行号文本, lines, sha256, binary}。
   */
  async read(host, filePath, { offset = 1, limit = 2000 } = {}) {
    if (typeof filePath !== 'string' || !filePath.startsWith('/')) throw new FsOpsError('filePath 必须是绝对路径（/ 开头）', 'bad-args')
    if (!Number.isFinite(Number(offset)) || !Number.isFinite(Number(limit))) throw new FsOpsError('offset/limit 必须为有限数字', 'bad-args')
    const f = q(filePath)
    const o = Math.max(1, Math.floor(offset))
    const e = o + Math.max(1, Math.floor(limit)) - 1
    const cmd = 'h=$(sha256sum ' + f + " 2>/dev/null | cut -d' ' -f1); a=$(head -c 8192 " + f + ' 2>/dev/null | wc -c); b=$(head -c 8192 ' + f + " 2>/dev/null | tr -d '\\0' | wc -c); echo \"__SR__ $h $a $b\"; sed -n '" + o + ',' + e + "p' " + f
    const r = await this.runner.run(host, cmd, { maxStdout: Math.min(2097152, (e - o + 1) * 4096 + 8192) })
    if (r.exitCode !== 0) throw toFsError(r, 'not-found')
    const lines = r.stdout.split('\n')
    const meta = (lines.shift() || '').trim().split(/\s+/)
    if (meta[0] !== '__SR__') {
      if (r.stdoutTruncated) throw new FsOpsError('输出被截断（窗口过大或文件行过长），请减小 limit/offset', 'result-truncated')
      throw new FsOpsError('远端返回缺少 __SR__ 元信息头', 'parse-error')
    }
    const sha256 = meta[1] && meta[1] !== '' ? meta[1] : null
    const a = Number(meta[2]) || 0
    const b = Number(meta[3]) || 0
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    const binary = a > 0 && a !== b
    if (binary) throw new FsOpsError('二进制文件（前 8KB 含 NUL），拒绝读取: ' + filePath, 'binary-rejected')
    const content = lines.map((l, i) => (o + i) + '\t' + l).join('\n') + (lines.length ? '\n' : '')
    return { path: filePath, lines: lines.length, windowStart: o, content, sha256, binary }
  }

  /** 全量读（edit 用，1MB 上限）。 */
  async readWhole(host, filePath) {
    if (typeof filePath !== 'string' || !filePath.startsWith('/')) throw new FsOpsError('filePath 必须是绝对路径（/ 开头）', 'bad-args')
    const f = q(filePath)
    const cmd = 'h=$(sha256sum ' + f + " 2>/dev/null | cut -d' ' -f1); s=$(wc -c < " + f + ' 2>/dev/null); echo "__SR__ $h $s"; cat ' + f
    const r = await this.runner.run(host, cmd, { maxStdout: 1048576 + 8192 })
    if (r.exitCode !== 0) throw toFsError(r, 'not-found')
    const lines = r.stdout.split('\n')
    const meta = (lines.shift() || '').trim().split(/\s+/)
    if (meta[0] !== '__SR__') {
      if (r.stdoutTruncated) throw new FsOpsError('输出被截断（窗口过大或文件行过长），请减小 limit/offset', 'result-truncated')
      throw new FsOpsError('远端返回缺少 __SR__ 元信息头', 'parse-error')
    }
    const size = Number(meta[2]) || 0
    if (size > 1048576) throw new FsOpsError('文件超过 1MB，不支持编辑: ' + filePath, 'file-too-large')
    if (r.stdout.includes('\0')) throw new FsOpsError('二进制文件，拒绝编辑: ' + filePath, 'binary-rejected')
    // edit 的 stale 判据依赖 sha：强校验（BSD sha256sum 前导空格已由 trim 消化）
    const sha = meta[1] || ''
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new FsOpsError('远端 sha256sum 输出异常（远端可能缺少 coreutils）: "' + sha.slice(0, 20) + '"', 'parse-error')
    // join('\n') 恰好保留结尾换行的有无（往返保真，edit 需要精确原文）
    const body = lines.join('\n')
    return { sha256: sha, content: body }
  }

  /** 全量覆写：stdin → readlink 实体化 → 同目录 tmp → 原子 mv；mkdirs 可选建父目录。 */
  async write(host, filePath, content, { mkdirs = false } = {}) {
    if (typeof filePath !== 'string' || !filePath.startsWith('/')) throw new FsOpsError('filePath 必须是绝对路径（/ 开头）', 'bad-args')
    const f = q(filePath)
    const rand = randomBytes(6).toString('hex')
    // readlink -f 要求中间目录已存在：mkdirs 分支必须先建目录再解析，
    // 否则「向尚不存在的新嵌套路径写入」会在 readlink 处 exit 76（mkdirs 语义即覆盖该场景）。
    const pre = mkdirs ? 'd=$(dirname ' + f + '); mkdir -p "$d" || exit 71; ' : ''
    const script = pre
      + 'f=$(readlink -f -- ' + f + ') || exit 76; '
      + 't="$f.__tmp__' + rand + '"; '
      + 'cat > "$t" || { rm -f "$t"; exit 70; }; '
      + 'mv "$t" "$f" || { rm -f "$t"; exit 70; }; '
      + 'sha256sum "$f" | cut -d\' \' -f1'
    const r = await this.runner.runWithStdin(host, script, { stdin: content })
    if (r.exitCode !== 0) throw toFsError(r, 'write-failed')
    const sha = (r.stdout || '').trim().split(/\s+/).pop()
    return { path: filePath, sha256: /^[0-9a-f]{64}$/.test(sha) ? sha : null }
  }

  /**
   * 字面量替换编辑（乐观并发）：
   *  1) readWhole 拿全文 + sha256；
   *  2) 本地字面量替换（默认必须唯一命中）；
   *  3) 远端关键段：stdin 先落 tmp → 校验原文件 sha 未变 → 原子 mv；变了 exit 75。
   */
  async edit(host, filePath, oldString, newString, { replaceAll = false } = {}) {
    if (!oldString) throw new FsOpsError('oldString 不能为空', 'bad-args')
    const whole = await this.readWhole(host, filePath)
    const count = whole.content.split(oldString).length - 1
    if (count === 0) throw new FsOpsError('oldString 在 ' + filePath + ' 中未找到', 'not-found')
    if (count > 1 && !replaceAll) throw new FsOpsError('oldString 命中 ' + count + ' 处（需唯一或 replaceAll）', 'not-unique')
    // 单替换必须走纯字面量拼接：String.replace 的 replacement 会展开 $&/$`/$' 等模式
    let next
    if (replaceAll) {
      next = whole.content.split(oldString).join(newString)
    } else {
      const idx = whole.content.indexOf(oldString)
      next = whole.content.slice(0, idx) + newString + whole.content.slice(idx + oldString.length)
    }
    const f = q(filePath)
    const rand = randomBytes(6).toString('hex')
    // readlink -f 实体化：symlink 路径下 tmp 与目标落在同一物理目录（原子 mv 前提）；
    // mv 带失败守卫——否则 mv 失败会落到末尾 sha256sum 旧文件、以 exit 0 返回旧 sha（静默丢写）。
    const script = 'f=$(readlink -f -- ' + f + ') || exit 76; '
      + 't="$f.__tmp__' + rand + '"; '
      + 'cat > "$t" || { rm -f "$t"; exit 70; }; '
      + 'if [ "$(sha256sum "$f" | cut -d\' \' -f1)" = \'' + (whole.sha256 || '') + '\' ]; then mv "$t" "$f" || { rm -f "$t"; exit 70; }; else rm -f "$t"; exit 75; fi; '
      + 'sha256sum "$f" | cut -d\' \' -f1'
    const r = await this.runner.runWithStdin(host, script, { stdin: next })
    if (r.exitCode === 75) throw new FsOpsError(filePath + ' 在读取后已被修改（远端 sha256 不符），请重新 read 后再编辑', 'stale-edit')
    if (r.exitCode !== 0) throw toFsError(r, 'edit-failed')
    const sha = (r.stdout || '').trim().split(/\s+/).pop()
    return { path: filePath, replaced: replaceAll ? count : 1, sha256: /^[0-9a-f]{64}$/.test(sha) ? sha : null }
  }

  /** 远端 find：文件路径数组（上限 200，超出标 truncated）。exit 1（部分目录不可读）在有结果时容忍。 */
  async glob(host, pattern, { path: root = '.', maxDepth = 3 } = {}) {
    const depth = Number(maxDepth)
    if (!Number.isFinite(depth)) throw new FsOpsError('maxDepth 必须为有限数字', 'bad-args')
    const n = Math.max(1, Math.min(10, Math.floor(depth)))
    const cmd = 'find ' + q(root) + ' -maxdepth ' + n + ' -name ' + q(pattern) + ' -type f'
    const r = await this.runner.run(host, cmd, { maxStdout: 524288 })
    const files = r.stdout.split('\n').filter(Boolean)
    files.sort()
    if (r.exitCode !== 0 && (r.exitCode !== 1 || files.length === 0)) throw toFsError(r, 'glob-failed')
    const truncated = files.length > 200 || Boolean(r.stdoutTruncated)
    // total = 远端在本次输出预算内给出的条数（内联页 200 条之前的计数），供搜索卡显示封顶指示
    return { files: truncated ? files.slice(0, 200) : files, truncated, total: files.length }
  }

  /** 远端 grep -rnE（POSIX ERE）；上限 250 行，超出标 truncated；exit 1 = 无匹配，容忍。 */
  async grep(host, pattern, { path: root = '.', include = '', ignoreCase = false } = {}) {
    const parts = ['grep', '-rnE', '-I']
    if (ignoreCase) parts.push('-i')
    if (include) parts.push('--include=' + q(include))
    parts.push('--exclude-dir=.git', '--', q(pattern), q(root))
    const cmd = parts.join(' ')
    const r = await this.runner.run(host, cmd, { maxStdout: 524288 })
    if (r.exitCode !== 0 && r.exitCode !== 1) throw toFsError(r, 'grep-failed')
    const matches = r.stdout.split('\n').filter(Boolean)
    const truncated = matches.length > 250 || Boolean(r.stdoutTruncated)
    // total = 本次输出预算内匹配到的行数（内联页 250 条之前的计数），供搜索卡显示封顶指示
    return { matches: truncated ? matches.slice(0, 250) : matches, truncated, total: matches.length }
  }
}
