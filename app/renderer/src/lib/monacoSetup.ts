// Monaco Editor 初始化：配置 Web Worker + 指向本地 monaco。
//
// 用 Vite 官方推荐的 `new Worker(new URL(..., import.meta.url))` 模式
// （比 `?worker` 导入在 build 时更可靠），并把 @monaco-editor/react 的
// loader 指向本地安装的 monaco-editor（Electron 离线，不走 CDN）。
// 导入本模块即完成副作用配置；CodeEditor 挂载前 import 一次即可。

import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalSelf = self as any

const mk = (rel: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (globalSelf.Worker as any)(new URL(rel, import.meta.url))

globalSelf.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return mk('monaco-editor/esm/vs/language/json/json.worker.js')
      case 'css':
      case 'scss':
      case 'less':
        return mk('monaco-editor/esm/vs/language/css/css.worker.js')
      case 'html':
      case 'handlebars':
      case 'razor':
        return mk('monaco-editor/esm/vs/language/html/html.worker.js')
      case 'typescript':
      case 'javascript':
        return mk('monaco-editor/esm/vs/language/typescript/ts.worker.js')
      default:
        return mk('monaco-editor/esm/vs/editor/editor.worker.js')
    }
  },
}

// 用本地安装的 monaco-editor（避免 @monaco-editor/react 默认从 CDN 加载）
loader.config({ monaco })

export {}
