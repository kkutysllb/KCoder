#!/usr/bin/env node
/**
 * 用上游官方 DeepSeek 图标（deepseek-harness/website/public/favicon.svg，
 * 官方鲸鱼标志 #4D6BFE）栅格化生成本应用图标与托盘图标。
 *
 * 通过 Electron 离屏渲染（Chromium SVG 引擎）栅格化，无新增依赖：
 * - assets/icon.png：白色圆角底 + 官方鲸鱼（1024，桌面端窗口/关于用）
 * - build/icon.png：512（electron-builder 打包用）
 * - assets/tray.png：透明底官方鲸鱼（32，菜单栏托盘）
 *
 * 用法：pnpm icons   （等价于 electron scripts/make-icons.cjs）
 * 前置：上游克隆存在（图标取自上游，不自行设计）。
 */

const { app, BrowserWindow, nativeImage } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const SRC_SVG = join(ROOT, 'deepseek-harness', 'website', 'public', 'favicon.svg')

/** 应用图标：macOS 标准白色 squircle 画布 + 居中官方鲸鱼（画布是标准底板，标志本身未做任何改动）。 */
function appIconHtml(svg) {
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;width:100%;height:100%;overflow:hidden}
    .canvas{position:absolute;inset:5.5%;border-radius:23.5%;background:#ffffff;
      display:flex;align-items:center;justify-content:center}
    .canvas svg{width:74%;height:74%;display:block}
  </style></head><body><div class="canvas">${svg}</div></body></html>`
}

/** 托盘图标：透明底、原始比例、官方原色。 */
function trayIconHtml(svg) {
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;width:100%;height:100%;overflow:hidden}
    body svg{width:100%;height:100%;display:block}
  </style></head><body>${svg}</body></html>`
}

/** 单一离屏窗口：两次导航分别截取，避免窗口销毁/重建竞态。 */
let shared = null

async function withWindow(size, run) {
  if (shared === null || shared.isDestroyed()) {
    shared = new BrowserWindow({
      width: size,
      height: size,
      show: false,
      frame: false,
      transparent: true,
      useContentSize: true,
      webPreferences: { offscreen: true },
    })
  }
  return run(shared)
}

/** 离屏窗口渲染 HTML 并截取整页 PNG（尺寸统一缩回逻辑尺寸，兼容 Retina 2x）。 */
async function capture(html, size) {
  return withWindow(size, async (win) => {
    // 沙箱环境偶发 ERR_FAILED：重试一次即可恢复
    let lastError = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        lastError = null
        break
      } catch (error) {
        lastError = error
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    if (lastError !== null) throw lastError
    // 等待离屏首帧绘制完成，再留一拍保证 SVG 上色
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 800)
      win.webContents.once('paint', () => {
        clearTimeout(timer)
        setTimeout(resolve, 150)
      })
    })
    const image = await win.webContents.capturePage()
    // Retina 屏下 capturePage 返回物理像素（2x），统一缩回逻辑尺寸
    const { width, height } = image.getSize()
    if (width < size || height < size) {
      throw new Error(`capturePage 尺寸异常: ${width}x${height}（期望 ≥ ${size}）`)
    }
    return image.resize({ width: size, height: size })
  })
}

app.whenReady().then(async () => {
  const svg = readFileSync(SRC_SVG, 'utf8')
  mkdirSync(join(ROOT, 'assets'), { recursive: true })
  mkdirSync(join(ROOT, 'build'), { recursive: true })

  const appIcon = await capture(appIconHtml(svg), 1024)
  writeFileSync(join(ROOT, 'assets', 'icon.png'), appIcon.toPNG())
  writeFileSync(join(ROOT, 'build', 'icon.png'), appIcon.resize({ width: 512, height: 512 }).toPNG())

  const whale = await capture(trayIconHtml(svg), 256)
  writeFileSync(join(ROOT, 'assets', 'tray.png'), whale.resize({ width: 32, height: 32 }).toPNG())

  shared?.destroy()
  console.log('官方图标已生成：assets/icon.png (1024)、build/icon.png (512)、assets/tray.png (32)')
  app.exit(0)
}).catch((error) => {
  console.error('图标生成失败:', error)
  app.exit(1)
})
