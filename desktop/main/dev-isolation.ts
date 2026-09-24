/**
 * dev / 打包两态的实例隔离（`app.isPackaged` 单一判别）。
 *
 * ## 为什么必须隔离
 *
 * 源码态（`pnpm dev`）与打包态的默认落点**完全重合**，导致两态无法共存：
 *
 * 1. **userData 同目录 → 单实例锁同键**。Electron 的 userData 默认
 *    `Application Support/<app name>`；打包读 `productName`（KCoder），源码
 *    态读 package.json 的 `name`（kcoder）。macOS 文件系统大小写不敏感，
 *    二者 inode 相同 = 同一目录 → `requestSingleInstanceLock()` 同键互斥，
 *    后启动者激活先启动者后自杀。**两态根本无法同时运行。**
 * 2. **`DSH_HOME` 同目录 → 引擎状态互踩**。`ensureKcoderBundles()` 每次启动
 *    重写 `profiles/web/package.json`、清退役/孤儿注册、物化或删除
 *    `node_modules`——源码态跑本地克隆（alpha.2 + fork 修复），打包态跑随包
 *    运行时，谁后启动谁赢，profile 被反复改写。
 *
 * 而两态的引擎状态本就该分属两个实例：源码态是**升级候选的验证场**（一次性、
 * 可抛弃、验证完重新物化），打包态是日常车（数据不该被候选版本改写）。此前
 * 把两者最不该耦合的部分——profile 依赖图与会话数据——绑死了。
 *
 * ## 隔离面
 *
 * 源码态经 `app.setPath('userData', …)` 换到 `<name>-dev` 目录（**内置运行时
 * 解压目录 `userData/kcoder-runtime` 随之分离**，见 dsh-contract 的
 * ensureBundledRuntime），`dshHome()` 回落到 `~/.kcoder-dev`。于是：
 *
 * | 资源 | 打包 | 源码态 |
 * |---|---|---|
 * | userData（桌面设置/认证/浏览器宿主/运行时解压） | `…/kcoder` | `…/kcoder-dev` |
 * | 单实例锁 | 独立 | 独立 |
 * | `DSH_HOME`（profile/会话/凭据/MCP 状态） | `~/.kcoder` | `~/.kcoder-dev` |
 * | **browser-host CDP 端口** | 9223 | **9224** |
 *
 * 最后一行是 2026-09-24 现场补的（打包态开着时源码态启动报 `EADDRINUSE
 * 127.0.0.1:9223`，`agent 浏览实况不可用`）：**文件系统路径能隔离，TCP 端口
 * 不能**——端口不在 `app.setPath` 的作用面内，只能由端口持有者自己按
 * `app.isPackaged` 分流（见 `browser-host.ts` 的 `browserHostPort()`）。注意
 * userData 那行隔离的只是浏览器宿主的**数据目录**，端口是另一件事：两边同端口
 * 时源码态 MCP 拼出的 `--cdp-endpoint` 与打包态完全相同，agent 浏览会**连到
 * 打包态的 Chromium 上**（跨实例串线），这正是本模块要防的事。
 *
 * 用户显式设置 `DSH_HOME` 时源码态同样尊重（与 home-migration 的「显式 >
 * 一切」一致），此时仅 userData 分离。
 *
 * ## 时机
 *
 * `applyDevIsolation()` 必须在本模块之外**最先**执行（index.ts 顶部 import
 * 副作用），且早于 `requestSingleInstanceLock()` 与 `applyBootHomeEnv()`——
 * 前者锁的是 userData 路径，后者会把决策写回 `process.env.DSH_HOME`。
 * `app.setPath` 在 ready 之前调用是受支持的；`app.isPackaged` 亦然。
 *
 * @module desktop/main/dev-isolation
 */

import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 源码态 userData 目录后缀。 */
const DEV_USERDATA_SUFFIX = '-dev'

/** 源码态 dsh home 目录名（home 下）。 */
export const DEV_HOME_DIR = '.kcoder-dev'

/**
 * 源码态接管的 dsh home 绝对路径（打包态或用户显式设 DSH_HOME 时 null）。
 *
 * 惰性函数而非模块级常量：`dshHome()` 可能在模块初始化期被调用，若在此
 * 读模块级绑定会撞 TDZ——不变量（`app.isPackaged` 进程内恒定）本就不需要
 * 提前求值。
 */
export function devHomeOverride(): string | null {
  if (app.isPackaged) return null
  if ((process.env.DSH_HOME ?? '').trim() !== '') return null
  return join(homedir(), DEV_HOME_DIR)
}

/**
 * 源码态隔离装配（index.ts 顶部、一切落盘逻辑之前调用）。幂等。
 *
 * 打包态直接返回——生产落点绝不被改动。
 */
export function applyDevIsolation(): void {
  if (app.isPackaged) return
  const before = app.getPath('userData')
  app.setPath('userData', `${before}${DEV_USERDATA_SUFFIX}`)
  console.log(
    `[isolation] 源码态隔离已启用：userData=${app.getPath('userData')}`
    + ` dsh home=${devHomeOverride() ?? `${process.env.DSH_HOME ?? '（用户自管）'}`}`,
  )
}
