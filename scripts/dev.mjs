#!/usr/bin/env node
/**
 * electron-vite 启动包装：Windows 控制台 UTF-8 代码页预设。
 *
 * 现象：`pnpm dev` 时主进程中文日志（如 mcp-builtin 的
 * 「跳过 xx：命令 xx 不在 PATH」）在 Windows 终端显示乱码
 * （「璺宠繃 fetch锛...」形态）——Node 子进程输出恒为 UTF-8 字节，
 * 而 Windows 控制台默认输出代码页 936（GBK），PowerShell 5.1 按
 * [Console]::OutputEncoding（动态跟随代码页）解码管道字节，
 * UTF-8 字节按 GBK 解读即乱码（macOS/Linux 终端原生 UTF-8 无此问题）。
 *
 * 修复：启动 electron-vite 前先执行 `chcp 65001`（cmd 内置命令，
 * 底层 SetConsoleOutputCP，作用于进程附着的整个控制台对象——
 * ConPTY 集成终端同样生效，后续 electron-vite / electron 主进程
 * 的 UTF-8 输出均按 UTF-8 解码显示）。
 *
 * 用法：node scripts/dev.mjs [args...]——args 透传给 electron-vite
 * （dev / preview / build ...；缺省 dev）。electron-vite 从项目
 * node_modules/.bin 解析绝对路径，直接 `node scripts/dev.mjs`
 * （不经 pnpm run、PATH 无 .bin）也能启动。
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import process from 'node:process'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const command = args.length > 0 ? args[0] : 'dev'

const binBase = join(ROOT, 'node_modules', '.bin', 'electron-vite')
const bin = process.platform === 'win32' ? binBase + '.cmd' : binBase
if (!existsSync(bin)) {
  console.error(`[dev] 未找到 electron-vite：${bin}（先 pnpm install）`)
  process.exit(1)
}

if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' })
  } catch {
    // chcp 失败（罕见：无控制台句柄等）不阻塞启动，仅日志可能乱码
  }
}

// Windows：.cmd shim 不能直接 spawn（Node 安全限制），显式 cmd /c
// 转发（不用 shell:true，避免 DEP0190 参数拼接警告）；类 Unix 的
// 可执行 shim 直启，无多余 shell 层
const child =
  process.platform === 'win32'
    ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/c', bin, command, ...args.slice(1)], { stdio: 'inherit' })
    : spawn(bin, [command, ...args.slice(1)], { stdio: 'inherit' })
child.on('error', (err) => {
  console.error(`[dev] 启动 electron-vite 失败：${err.message}`)
  process.exit(1)
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
