// Monaco Editor 初始化：配置 Web Worker + 指向本地 monaco。
//
// 用 Vite 官方的 `?worker` 导入（dev/build 都由 Vite 重写为真实 worker
// bundle）。此前用 `new Worker(new URL('monaco-editor/esm/...', import.meta.url))`，
// URL 解析到不存在的 `src/lib/monaco-editor/...` → dev server SPA 回退返回
// HTML → worker 报 "Unexpected token '<'" 并退化为主线程运行。
//
// 并把 @monaco-editor/react 的 loader 指向本地安装的 monaco-editor
// （Electron 离线，不走 CDN）。导入本模块即完成副作用配置；
// CodeEditor 挂载前 import 一次即可。

import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
// monaco-editor 的 package.json exports 映射为 "./*" / "./*.js" →
// "./esm/vs/*.js"，worker 路径不能带 esm/vs 前缀，且需保留 .js 后缀
// 命中 "./*.js" 模式（否则 build 时 Rollup 解析失败）。
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalSelf = self as any

globalSelf.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  },
}

// 用本地安装的 monaco-editor（避免 @monaco-editor/react 默认从 CDN 加载）
loader.config({ monaco })

export {}
