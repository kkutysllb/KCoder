#!/usr/bin/env node
/**
 * 以「真 Electron」形态跑一支脚本（冒烟专用，跨平台）。
 *
 * 为什么需要它：`ELECTRON_RUN_AS_NODE` 一旦被继承，electron 会退化成纯 Node，
 * 窗口 API 全不可用——所以既有冒烟一律要「先摘掉这个变量再起 electron」。此前
 * 写在 package.json 里的是 `env -u ELECTRON_RUN_AS_NODE pnpm exec electron …`，
 * 而 `env -u` 是 POSIX 写法：Windows 的默认 npm script shell 是 cmd.exe，
 * `pnpm run smoke:titlebar` 直接报 `'env' is not recognized as an internal or
 * external command`（2026-10-10 本机实测，7 支冒烟全中）。这里在 spawn 前删掉
 * 该变量，两种平台一条路。
 *
 * 用法：node scripts/run-electron.mjs scripts/smoke-titlebar.mjs [参数…]
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const [script, ...rest] = process.argv.slice(2)
if (script === undefined) {
  console.error('[run-electron] 用法：node scripts/run-electron.mjs <脚本> [参数…]')
  process.exit(2)
}

// electron 包在「非 Electron 进程」里的导出就是可执行文件路径。
const require = createRequire(import.meta.url)
const electron = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, [resolve(script), ...rest], { stdio: 'inherit', env })
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal !== null ? 1 : 0))
})
