/**
 * runtime 归档写入器（tar.gz）——**可执行测试的单一来源**。
 *
 * ## 为什么要抽出来
 *
 * 「归档」这一段连着出过两次事故，而它此前只被 `node --check`（纯语法）看过：
 *
 * 1. **2026-10-10 现场**：`mode` 写死 `0o644` ⇒ 随包 runtime 里 `node-pty` 的
 *    `spawn-helper` 丢执行位，打包态终端 `posix_spawn failed: Permission denied`
 *    （dev 态走 node_modules 是 755，所以只在打包版复现）。
 * 2. **同日 CI**：归档自检用 `createReadStream().pipe(createGunzip())` +
 *    `[Symbol.asyncIterator]`，pipe 把 gunzip 置为 flowing 模式 ⇒ 迭代器永远等不到数据，
 *    归档写完后**静默挂死 20 分钟**直到步骤超时。
 * 3. **同日 CI 二连**：自检计数器声明在归档块内、结论行在块外引用 ⇒ `ReferenceError`。
 *    语法检查看不见作用域问题，只有真跑才看得见。
 *
 * 因此：写入逻辑在此成模块，由 `scripts/check-tar-writer.mjs` **真跑**（含系统 `tar`
 * 往返核对 + 「mode 写死」负对照），并挂进 `pnpm check` 的 `typecheck` 链。
 *
 * @module scripts/lib/tar-writer
 */
import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { createGzip } from 'node:zlib'

/** 八进制字段（tar 头的数值写法）。 */
export const octal = (v, digits) => v.toString(8).padStart(digits, '0')

/** 512B 对齐填充。 */
export const pad = (size) => Buffer.alloc((512 - (size % 512)) % 512)

/**
 * ustar 头（512B）：typeflag '0'=文件；name 超 100 字节时调用方先出 GNU 'L' 头。
 * **mode 必须取自源文件**（见模块头事故 1）。
 */
export function tarHeader(name, size, mtimeMs, mode, typeflag = '0') {
  const h = Buffer.alloc(512)
  const oct = (off, len, v) => h.write(octal(v, len - 1), off, len, 'ascii')
  const put = (off, len, s) => h.write(s, off, len, 'utf8')
  put(0, 100, name.slice(0, 100))
  oct(100, 8, mode & 0o7777)
  oct(108, 8, 0)
  oct(116, 8, 0)
  oct(124, 12, size)
  oct(136, 12, Math.trunc(mtimeMs / 1000))
  h.write('        ', 148, 8, 'ascii') // chksum 占位（空格）
  h.write(typeflag, 156, 1, 'ascii')
  h.write('ustar', 257, 6, 'ascii')
  h.write('00', 263, 2, 'ascii')
  let sum = 0
  for (const b of h) sum += b
  h.write(octal(sum, 6) + '\0 ', 148, 8, 'ascii')
  return h
}

/** 独立解析 tar 头里的 mode 字段（写头自检用；不复用写入侧意图）。 */
export function readHeaderMode(header) {
  return parseInt(header.subarray(100, 108).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8)
}

/**
 * 把 `{ rel, abs }[]` 打成 tar.gz。
 *
 * **执行位不变式**：源文件可执行 ⇒ 头部必须带执行位，违反即抛错（调用方负责终止构建）。
 * 自检发生在**写头那一刻**（O(1)、无流式交互），不会像归档后回读那样挂死。
 *
 * @param {{rel: string, abs: string}[]} tarFiles
 * @param {string} tarPath
 * @param {{modeOf?: (st: import('node:fs').Stats) => number}} [options]
 *   `modeOf` 是测试用活口（负对照注入写死 mode）；生产路径不传。
 * @returns {Promise<{files: number, execChecked: number}>}
 */
export async function writeTarGz(tarFiles, tarPath, options = {}) {
  const modeOf = options.modeOf ?? ((st) => st.mode)
  const gz = createGzip({ level: 6 })
  const out = createWriteStream(tarPath)
  gz.pipe(out)
  // 注：write 回调成功时 error 为 null（非 undefined），必须宽松比较
  const write = (buf) => new Promise((res, rej) => { gz.write(buf, (e) => (e != null ? rej(e) : res())) })
  let execChecked = 0
  for (const f of tarFiles) {
    const st = statSync(f.abs)
    const mode = modeOf(st)
    if (f.rel.length > 100) { // GNU LongName 头：超长路径的兼容写法
      const nameBuf = Buffer.from(f.rel, 'utf8')
      await write(tarHeader('././@LongLink', nameBuf.length + 1, st.mtimeMs, 0o644, 'L'))
      await write(Buffer.concat([nameBuf, Buffer.alloc(1), pad(nameBuf.length + 1)]))
    }
    const header = tarHeader(f.rel, st.size, st.mtimeMs, mode)
    if ((st.mode & 0o111) !== 0) {
      const encoded = readHeaderMode(header)
      if ((encoded & 0o111) === 0) {
        throw new Error('归档自检失败：可执行文件 ' + f.rel + ' 的 tar 头丢了执行位（源 mode ' + octal(st.mode & 0o7777, 4) + '，头部 ' + octal(encoded, 4) + '）——打包态终端会 posix_spawn Permission denied')
      }
      execChecked += 1
    }
    await write(header)
    for await (const chunk of createReadStream(f.abs)) await write(chunk)
    if (st.size > 0) await write(pad(st.size))
  }
  await write(Buffer.alloc(1024)) // 两个全零块结尾
  const done = new Promise((res, rej) => { out.on('error', rej); out.on('finish', res) })
  gz.end()
  await done
  return { files: tarFiles.length, execChecked }
}
