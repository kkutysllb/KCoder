/**
 * 附件选择器：把 dsh-drag-to-attachment 插件的模式切换按钮改造成
 * 文件选择入口——用户直觉是「点附件图标 = 打开文件选择弹窗」，原
 * 「点击切附件/路径模式」的语义反人性。
 *
 * 链路（对插件零修改零 fork）：
 * 1. 页面注入脚本在 document capture 阶段拦下按钮点击（按钮是插件经
 *    slots 注入 conversation.input.left 的 React 组件，无稳定 id，但
 *    title 两态均以「拖拽/粘贴 →」开头——按此前缀识别；capture 拦在
 *    React 合成事件之前，stopPropagation 后原 onClick 不触发）；
 * 2. 主进程开原生文件对话框（文件/文件夹/多选）；
 * 3. 选中的真实路径经 pathToFileURL 编码为 file:// URI，回放给页面
 *    合成 drop 事件（text/uri-list 载荷）；
 * 4. 插件的 document capture drop 监听接住，其 fast path（uri-list
 *    带真实路径时）直接入队——零索引定位、零 .drops 副本、不读文件
 *    内容（isTrusted=false 无碍，插件未校验）。
 *
 * 拖入/粘贴的原有行为完全不动（仍走定位链）；插件未装/未加载时按钮
 * 不存在，本拦截静默空转。附件模式下合成 drop 走 fast path 入队；
 * 路径模式下走 appendPaths 插入草稿——与手动拖入同一语义。
 *
 * 插件的双模式（📎 附件 / 📄 路径，点击切换）在本改造下废除：拦截
 * 后 onClick 永不触发，localStorage 强制归位 attachment（注入时 +
 * 每次拦截时双写；已加载会话的闭包残留靠下次整页加载归位）。
 *
 * 已知小瑕疵：fast path 的 queued 不带 isDir，对话框选中的文件夹在
 * 消息里显示为普通文件卡（agent 拿到的路径不受影响）；拖入文件夹仍
 * 生成 [附件·目录] 卡片。
 *
 * @module desktop/main/attach-picker
 */

import { pathToFileURL } from 'node:url'
import { dialog, type BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'

/** console 通道前缀（与注入脚本约定）。 */
const PICK_PREFIX = '__dsh_attach__:'

/** 页面注入脚本（纯 JS：模板字符串内禁 TS 注解）。 */
const PAGE_JS = `(() => {
  if (window.__dshAttachWired) return
  window.__dshAttachWired = true

  const MODE_KEY = 'dsh.dragToAttachment.mode'
  const forceAttachment = () => {
    // 插件的双模式存 localStorage：强制归位附件模式（旧版按钮切出的
    // 「路径」残留会让拖/选文件把绝对路径插进草稿文本）
    try { window.localStorage.setItem(MODE_KEY, 'attachment') } catch {}
  }
  // 注入即写：若插件尚未加载，它初始化时读到附件模式；若已加载，
  // 闭包内的 currentMode 已定（点击被拦后不再变化），下次整页加载归位
  forceAttachment()

  /* 拦截插件的模式切换按钮：点击不再切模式，而是上报主进程开文件
     对话框。识别三重匹配：原始两态 title（「拖拽/粘贴 →」开头）、
     我们改写后的 title、按钮文本（📎 附件 / 📄 路径）。改写 title
     会让后续点击失配穿透（首版踩坑：第二次点击 React onClick 执行、
     模式被切成「路径」），必须把改写后的值也纳入匹配。 */
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null
    if (btn === null) return
    const title = btn.getAttribute('title') ?? ''
    const label = (btn.textContent || '').trim()
    if (!title.startsWith('拖拽/粘贴 →')
      && !title.startsWith('选择文件作为附件')
      && label !== '📎 附件' && label !== '📄 路径') return
    e.preventDefault()
    e.stopPropagation()
    btn.setAttribute('title', '选择文件作为附件（也可直接拖入/粘贴）')
    forceAttachment()
    console.log('__dsh_attach__:' + JSON.stringify({ action: 'pick' }))
  }, true)

  /* 主进程对话框结果回放：真实路径 → file:// uri-list → 合成 drop
     （插件的 fast path 见模块头注释）。 */
  window.__dshAttachDrop = (uris) => {
    const dt = new DataTransfer()
    dt.setData('text/uri-list', uris.join('\\r\\n'))
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  }
})()`

/**
 * 给 shell 窗口挂附件选择器（每次整页加载后重新注入；重复调用安全，
 * 窗口重建时旧监听随窗口销毁）。
 */
export function attachPicker(win: BrowserWindow): void {
  // 先捕获：closed 时窗口已销毁，再访问 win.webContents getter 会抛
  const { webContents } = win
  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(PICK_PREFIX)) return
    let payload: Record<string, unknown>
    try { payload = JSON.parse(message.slice(PICK_PREFIX.length)) as Record<string, unknown> } catch { return }
    if (payload.action !== 'pick' || win.isDestroyed()) return
    void dialog.showOpenDialog(win, {
      title: '选择文件作为附件',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    }).then((result) => {
      if (win.isDestroyed() || result.canceled || result.filePaths.length === 0) return
      const uris = result.filePaths.map((p) => pathToFileURL(p).href)
      void webContents.executeJavaScript(
        `window.__dshAttachDrop && window.__dshAttachDrop(${JSON.stringify(uris)})`,
        true,
      ).catch(() => {
        // 页面跳转间隙失败属正常，下次加载会重注入
      })
    }).catch(() => {
      // 对话框本身失败（极少）：静默
    })
  }
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  }
  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    webContents.removeListener('console-message', onConsole)
    webContents.removeListener('did-finish-load', onDidLoad)
  })
}
