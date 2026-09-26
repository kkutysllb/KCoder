/**
 * 连接过程中的进度页。
 *
 * 刻意不依赖 electron：这样它能被单独渲染出来验证（"黑窗没提示"就是这么冒出来的
 * ——首帧文案原先靠脚本填，脚本一没跑成用户就看到纯黑窗口）。
 *
 * @module desktop/main/remote-progress-page
 */

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** HTML 转义：进度文案里会出现用户主机名与错误原文。 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * 生成进度页并返回可直接 loadURL 的地址。
 *
 * 首帧文案**直接写进 HTML**（不依赖脚本执行）；落成临时文件而非 data: URL——
 * 后者在部分环境被视为不可信来源，表现为一片空白。
 * @param host - 主机展示名。
 * @param title - 当前阶段标题。
 * @param detail - 失败时的完整原文（成功路径不传）。
 * @returns 页面文件 URL。
 */
export function progressPage(host: string, title: string, detail?: string): string {
  const html = `<!doctype html><meta charset="utf-8"><title>KCoder</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
         background:#17181a; color:#e8e8ea; font:14px/1.7 -apple-system,"PingFang SC",sans-serif }
  .box { width:min(720px,86vw) }
  h1 { font-size:16px; font-weight:600; margin:0 0 6px }
  .host { color:#9aa0a6; margin-bottom:18px }
  #s { font-family:ui-monospace,Menlo,monospace; font-size:12px; color:#b6bcc4;
       background:#1f2124; border:1px solid #303236; border-radius:8px;
       padding:10px 12px; max-height:44vh; overflow:auto; white-space:pre-wrap; margin:0 }
  pre.err { color:#ff8f8f; margin-top:12px }
</style>
<div class="box">
  <h1>${escapeHtml(title)}</h1>
  <div class="host">远程主机：${escapeHtml(host)}</div>
  ${detail === undefined ? '<pre id="s">正在准备…</pre>' : `<pre id="s" class="err">${escapeHtml(detail)}</pre>`}
</div>
<script>
  window.__stage = (line) => {
    const el = document.getElementById('s');
    el.className = '';
    el.textContent = (el.textContent === '正在准备…' ? '' : el.textContent + '\\n') + line;
    el.scrollTop = el.scrollHeight;
  };
</script>`
  const file = join(tmpdir(), `kcoder-remote-${String(Date.now())}.html`)
  writeFileSync(file, html)
  return pathToFileURL(file).href
}
