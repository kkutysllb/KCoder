/**
 * 引擎 shell 页的唯一 preload——铁律 1「无 preload」的**唯一例外**（2026-10-09）。
 *
 * 只暴露上游契约桥 `__DSH_HOST_PATHS__`：composer 把拖入/粘贴/选取的本机文件
 * 转成 `@绝对路径` 引用（不落字节上传）；无真实路径（如粘贴的截图字节）回空串，
 * 上游按「无路径」回落上传，行为与 web 端一致。webUtils.getPathForFile 必须在
 * 能持有页面 File 对象的 electron 上下文里调，最小桥是唯一通道——上游官方桌面
 * （apps/desktop/src/preload-app.ts，同为自定义 scheme 架构）用的就是同款单桥。
 *
 * 边界（plans/kcoder-app-protocol.md D3 例外记录 + check-shell-protocol H9/H10 把守）：
 *   1) 只在本地 shell 页 origin 暴露——remote 窗口/其他文档一概不给（本机路径
 *      不得喂给远端工作区页）；
 *   2) 暴露面恰好 `pathFor` 一个方法，不携带任何宿主通道或 Node 能力；
 *      `window.desktop`（宿主 IPC 面）属于另一份 preload/desktop/index.ts，
 *      只挂 landing/面板，**永不进引擎页**；
 *   3) `data-platform`、`dshDesktopBoot`、`dshDesktop` 等上游桌面分支全局
 *      一概不设——上游保持 web 形态，是注入器自持几何的前提。
 *
 * @module desktop/preload/host-paths
 */

/* sandboxed preload 的类型面：tsconfig.node 无 DOM lib，location 由宿主注入
 * （上游官方桌面同款 top-level 门），File 走 @types/node（undici）同形类型。 */
declare const location: { protocol: string; hostname: string }

import { contextBridge, webUtils } from 'electron'

// origin 字面量与 main/shell-protocol-core 的 SHELL_PAGE_ORIGIN 一致
// （preload 不 import 主进程模块；一致性由 check-shell-protocol 对账）
if (location.protocol === 'kcoder-app:' && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('__DSH_HOST_PATHS__', {
    pathFor: (file: File): string => webUtils.getPathForFile(file),
  })
}
