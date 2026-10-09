# shell 协议化加载（kcoder-app:// 自定义协议壳）

## Goal

把本地侧车 shell 窗口的加载形态从 `loadURL("http://127.0.0.1:<port>")` 换成
`kcoder-app://app` 自定义协议 + 主进程内部转发：页面全程看不到 loopback 地址，
loopback HTTP 面只服务主进程，鉴权 cookie 收进主进程不进页面。技术照抄上游
官方桌面壳（`apps/desktop`），但**架构形态按 KCoder 自己的约束重设计**——
两处与上游的根本分歧（见 D2/D3），不是移植上游代码。

验收（五条都要满足）：

1. 协议模式下 shell 完整可用：登录 → 会话收发（WS mux）、client 插件 bundle
   加载（/plugins/）、设置注入页锚点、复制、附件、主题跟随、折叠、登出重登；
2. 页面 URL 与页面内可见地址全程不出现 `http://127.0.0.1`（诊断页可断言）；
3. Host 重启（sync 上游 / 崩溃自愈）后 shell 自动恢复，新端口转发生效；
4. kill-switch 关闭后行为与现状完全一致（回归闸）；
5. `pnpm typecheck` 全绿（含新增 check 断言），新冒烟双模式各过一遍。

**状态：阶段 0–3 实施完成（2026-10-07）；check 54 项、smoke 18 项全绿，
产物关键串断言过。实机回归通过（2026-10-08）→ 灰度翻转已执行（2026-10-08，
`shellProtocolMode` 默认 true）。剩余：随下个版本发版观察 → 观察期结束执行
阶段 4 第二步（legacy 退役，清单见 Task List）。
存量处置：`pnpm typecheck` 曾因 `check-remote-addon-specs` 现红——
`staging/kcoder-runtime` 是麒麟时代遗留树（包名族 `@qilin/*`），已于
2026-10-08 经用户拍板删除（连同同源的 `kcoder-runtime.tar.gz`，均为
gitignored 的发版链暂存产物，下次发版重新物化）；typecheck 整链现全绿。**

## 背景

上游官方桌面壳（fork 克隆 `apps/desktop`，`@deepseek-ai/dsh-desktop`）已经把
「纯桌面化加载」做完了：自定义协议 + 内部转发 + WS 凭据改写。KCoder 现状是
shell 窗口直接 `loadURL` 侧车地址（`desktop/main/windows.ts:190`），loopback
端口对页面与本机其他进程可见。本计划把上游的关键技术搬进 KCoder，但上游的
两个前提（打包 dist 供给文档、preload boot 桥）与 KCoder 的两条命根
（零修改复用 + 无 preload 注入体系）冲突，必须换道——换道方案恰好更简单。

## Findings（事实固化，全部来自 fork 克隆 0.2.1-alpha.1 与本仓源码）

- **F1 协议注册**：`apps/desktop/src/main.ts:132-141` `registerSchemesAsPrivileged`
  权限集 `{standard, secure, supportFetchAPI, corsEnabled, stream, codeCache}`——
  让自定义协议在 fetch/CORS/流式上表现得像 https。上游 Electron ^44.0.0，
  与本仓 electron 44.0.0 同 major，形态已被上游验证。
- **F2 协议路由**：`main.ts:662-676` `protocol.handle` 三分支：`shell` 主机名
  → 壳自有文档；`app` 的静态入口（`/`、`/index.html`、`/assets/*`、favicon、
  manifest）→ 打包 dist 磁盘供给；其余 → 转发给 Host。
- **F3 转发核心**：`apps/desktop/src/web-document.ts:63-93` `forwardWebRequest`：
  请求 origin 白名单（非 `dsh-app://app` → 403）；删请求头
  `host/origin/cookie/sec-fetch-site` 后附主进程持有的 cookie；`duplex:'half'`
  流式转发（保取消）；响应扣留 `set-cookie` + 全部 connection-level 头
  （`WITHHELD_RESPONSE_HEADERS`）；`/plugins/*` 响应强写 `cache-control:
  no-store`（bundle revision 每次启动都变，磁盘缓存只会堆积）。
- **F4 鉴权**：`web-document.ts:40-52` 用就绪 URL 令牌 GET → 303 set-cookie
  兑换 cookie，只留主进程。KCoder 已有同构物：`DshManager.mintAuthCookie`
  （`dsh-manager.ts:300-320`，authFetch 在用）。
- **F5 WS 凭据改写**：`main.ts:713-724` `onBeforeSendHeaders({urls:['ws://127.0.0.1/*']})`：
  仅主窗口；请求 origin ≠ `dsh-app://app` 直接 cancel；放行则改写
  origin → Host origin、附 cookie、`sec-fetch-site: same-origin`。页面侧
  WebSocket 照常连 `ws://127.0.0.1:<port>`（协议层不管 WS upgrade）。
- **F6 streamBaseUrl 契约（本设计的支点）**：客户端流连接地址读
  `globalThis.__DSH_TRANSPORT__?.streamBaseUrl ?? document.baseURI`
  （`packages/api/gateway/src/client/stream-client.ts:476-477`）；
  `ui-settings-account` 的账号 RPC 同读该全局
  （`ui-settings-account/src/client/index.ts:209-213`）。plain-web 引导
  （页面无 `dshDesktopBoot` 桥）在 `packages/client/web/src/boot.ts:66` 只 await
  `__DSH_BOOT_READY__`（Host 渲染的 index 尾部自己 resolve，缺席即无门），
  随后 `window.__ModuleLoader__` 照常启动。⇒ **只要在页面 bootstrap 前塞进
  `__DSH_TRANSPORT__.streamBaseUrl` 一个全局，plain-web 引导路径在自定义
  origin 下原样工作，不需要 preload、不需要 IPC boot 桥。**
- **F6b ownsHost 契约（v0.6.26 现场回归补上的第二成员）**：客户端按
  「页面 origin 是否回环」判特权面 `ctx.remote.$host.isLoopback`
  （`packages/client/connection/src/client/index.ts` +
  `loopback-hostname.ts`：localhost/[::1]/127/8），ui-settings 镜像据此选
  host/memory 持久化（`ui-settings/src/client/index.ts:39`）——memory 态下
  `ensure()` 空转、describe 视图永缺，提供商目录即报
  「settings are unavailable in this browser」（settings 文档控制器与聊天
  设置作用域同族降级）。上游在 `ClientTransportHooks` 留了显式声明位
  `ownsHost`（「Only a shell that assembles its own transport can set
  this」），自家 worker 组合 `apps/web/src/main.ts:25-26` 同款双成员注入
  `{ ownsHost: true, streamBaseUrl }`。⇒ 注入全局必须是**双成员**，
  缺 ownsHost 即非回环 origin 全族静默降级（check-shell-protocol H7/H8 +
  smoke P3b 把守）。
- **F7 上游桌面分支的触发条件**：`apps/web/src/main.ts:10-44` 只有检测到
  `globalThis.dshDesktopBoot`（上游 preload 注入）才走「IPC 取 injections +
  streamBaseUrl」的桌面引导。KCoder 不注入该全局 ⇒ 该分支永不激活。
- **F8 KCoder 侧车与壳现状**：spawn `dsh web --port 0 --no-open` + 就绪行解析
  （`dsh-manager.ts:163-195`）；`shellEntryUrl` 带令牌兑换 cookie
  （`dsh-manager.ts:281-284`）；shell 窗口 sandbox、无 preload、webviewTag
  （`windows.ts:121-126`）；重载判据 `!getURL().startsWith(dshUrl)`
  （`windows.ts:189-191`）；18 套注入器挂 `decorateShellWindow`
  （`windows.ts:359-449`，全 origin 无关）；will-navigate 前缀守卫
  （`windows.ts:425-441`）；远程窗口共用 decorateShellWindow 但 loadURL 直连
  远端地址（`remote-connections.ts:159`）。
- **F9 Host 无 CSP**：`packages/host/webserver` 源码无 content-security-policy
  ⇒ 转发响应无 CSP 语义冲突（阶段 0 仍须 curl 实测固化响应头清单）。
- **F10 origin 语义现状**：`--port 0` 每次启动随机端口 ⇒ 今天的页面 origin
  （`http://127.0.0.1:<随机端口>`）本来就活不过一次重启，localStorage 从未
  跨重启存续。换成恒定 origin `kcoder-app://app` 是语义升级而非迁移风险。

## 设计决策（与上游的分歧即自有设计）

### D1 命名与作用域：`kcoder-app://app`，只覆盖本地侧车

scheme 用 `kcoder-app`（与深链 `kcoder://` 同品牌族），主机名只用 `app`。
不设上游的 `shell` 主机名——KCoder 面板窗口继续 file:// + preload IPC
（现状工作良好，迁协议零产品价值，不做）。远程连接窗口（`remote-connections`）
**不进本计划**：它们加载的是远端真实网络地址，不存在 loopback 暴露问题；
`decorateShellWindow` 本就 origin 无关，零改动。

### D2 文档来源 = 转发，不打包 dist（与上游第一分歧）

上游把 `@deepseek-ai/dsh-web-frontend/dist` 打进安装包磁盘供给静态入口，
injections 经私有 IPC 递给页面（F2/F7）。KCoder **不搬这半边**：文档（含
/assets）全部转发给 Host。理由：

- Host 渲染的 index.html 自带引导行（模块装载 facade + 注入表 +
  `__DSH_BOOT_READY__` 尾部 resolve，F6）——KCoder 的全部内置 bundle 注入
  面今天就是靠它工作的，转发 = 这套东西**原样保留**；
- 不新增打包链：`sync-upstream` / vendored 运行时 / 版本钉版流程零改动；
  打包 dist 意味着壳与前端 dist 多出一层必须同步的版本耦合，违背「宿主
  不碰引擎物」的边界。

代价：文档首字节要等侧车就绪——今天的 landing → showShell 状态机本来就在
ready 之后才加载，无回归。

### D3 不引入 preload，不写 `data-platform`（与上游第二分歧，命根级）

上游壳靠 preload 注入 `dshDesktopBoot` boot 桥（F7）并写
`html[data-platform='darwin']` 激活引擎 app-region 表。KCoder 的
workspace-header / sidebar-toggle 正是按「该标记**永不落地**」自持的
（ARCHITECTURE.md §12 铁律 1 记录了三层根因）——任何模仿上游 preload 的
举动会整表翻转这套自持几何。故：

- **不新增暴露上游桌面分支的 preload**，shell 维持 sandbox +
  contextIsolation + 不写 `data-platform`。**唯一例外（2026-10-09）**：
  `desktop/preload/host-paths.ts` 单桥——只暴露 `__DSH_HOST_PATHS__`
  （composer 拖/粘/选本机文件转 `@绝对路径` 引用，无路径回空串回落上传）。
  立例理由：`webUtils.getPathForFile` 必须在能持有页面 File 对象的
  electron 上下文里调，注入器体系（页面主世界）没有这个能力，最小桥是
  唯一通道；上游官方桌面（apps/desktop/src/preload-app.ts，同为自定义
  scheme 架构）即同款单桥。例外边界：origin 门（仅 kcoder-app://app）、
  恰好一个方法、不携带宿主通道、**不写 data-platform / 不给
  dshDesktopBoot**（上游 web 形态保持不变）——check-shell-protocol K 组
  钉源码最小性，smoke-shell-protocol P3c/P3d 钉真桥行为与运行时缺席；
- 页面需要的唯一新信息是 `streamBaseUrl` + `ownsHost`（F6/F6b），在**协议层**
  对 text/html 响应做有界缓冲 + `<head>` 后注入一行：

  ```html
  <script>globalThis.__DSH_TRANSPORT__={streamBaseUrl:'http://127.0.0.1:<port>',ownsHost:true}</script>
  ```

  这是上游自己的契约全局（F6），KCoder 只是换了个递送通道（HTML 内联 vs
  IPC）。注入判据：`content-type` 以 `text/html` 开头且 body ≤ 2 MiB
  （index.html 实际几十 KB）才缓冲改写，其余一律流式透传，绝不破坏
  `/plugins/*` bundle 与 API 流式响应。

### D4 鉴权：复用 mintAuthCookie，页面退出兑换链

cookie 兑换沿用 `DshManager.mintAuthCookie`（F4，已在 authFetch 用）。
协议模式下 `shellEntryUrl` 的令牌 URL 不再交给页面：令牌仍从就绪行解析、
兑换仍在主进程、转发时附带——**令牌与 cookie 都不进页面**（比今天更收紧：
今天的首次加载 URL 里带 `?token=`）。响应头扣留清单照抄上游 F3。
Host 重启 → `onReady` 清 cookie（已有）→ 新 cookie 兑换 → 见 D6 重载。

### D5 WS 守卫：照抄上游形态，pattern 收窄

`onBeforeSendHeaders({urls:['ws://127.0.0.1/*']})`：仅本地 shell 主窗口；
origin ≠ `kcoder-app://app` cancel；放行则按当前 hostUrl 改写 origin、附
cookie、`sec-fetch-site: same-origin`（F5）。pattern 保持宽匹配 + 函数内
`requested.host !== target.host` 放行——远程窗口的
`ws://<远端IP>/*` 不落 127.0.0.1 pattern，天然不受影响。主进程自己的 mux
消费（subagent-monitor 等）不经此层。

### D6 重载时机：从「URL 前缀变化」改为「hostOrigin 变化」

今天 `!getURL().startsWith(dshUrl)` 靠地址变化触发重载（`windows.ts:189`）。
协议模式下页面 URL 恒为 `kcoder-app://app/...`，且注入的 streamBaseUrl 随
HTML 固化——**Host 换端口后必须整页重载**（与今天语义相同，今天也是必然
重载）。实现：模块级记住「当前已加载的 hostOrigin」，dsh `state-changed` 到
ready 且 origin 变化、shell 正在显示协议页 ⇒ 重载一次。landing → showShell
首载路径不变（auth 门禁、ready-to-show 最大化等全不动）。

### D7 导航守卫双前缀

will-navigate：协议模式下 `kcoder-app://app` 前缀放行（页面内整页跳转）、
`kcoder:` 深链照旧拦截、其余 `shell.openExternal`。kill-switch 的 legacy 模式
沿用现有 dshUrl 前缀判据。setWindowOpenHandler 不动。

### D8 kill-switch：store 字段 + 偏好页开关

`DesktopSettings` 增 `shellProtocolMode: boolean`（灰度期默认 **false**，
2026-10-08 实机回归通过后翻转为默认 **true**——开关语义从「逃生门」转为
「回退档」），偏好页加开关（诊断页展示当前加载形态）。协议路径有字段级
开关，回退 = 关开关重启。GUI 协作惯例（AI 交付清单 → 用户实测）决定了
灰度必须有用户可达的逃生门。legacy 路径保留到协议模式默认化一个版本后
再删（含 store 字段与开关 UI，清单见阶段 4）。

### D9 断言先行

纯逻辑（URL 映射、请求头改写、响应头扣留、HTML 注入 splice、origin 判定）
收进零依赖模块，`check-*.mjs` 断言直测并挂 typecheck 链尾——沿用
`remote-target.ts` + `check-remote-addon-specs.mjs` 的既有形态，不引入测试
框架。

## Task List

### 阶段 0：事实固化 — complete（2026-10-07）

- [x] 真侧车（fork 克隆 + `DSH_HOME=~/.kcoder-dev` 探针）响应头固化：文档
      `text/html; charset=utf-8` + chunked **无 content-length**（→ 有界缓冲
      只能缓冲后判量）；401 门禁真实存在；**无任何 CSP 头**（F9 落地）
- [x] `/plugins/*` 现值 = `public, max-age=31536000, immutable` + per-launch
      `rev`——恒定 origin 下 no-store 覆写实锤为必修（坑记 3 兑现）
- [x] dist 零 `127.0.0.1` 绝对引用（`apps/web/dist` 全根相对：`./assets/…`、
      `plugins/??…&rev=…`）；产物 bundle 内 `__DSH_TRANSPORT__`/`streamBaseUrl`
      在位（F6 产物层证实）
- [x] 深链无冲突：仓内 `kcoder://` 只是 will-navigate 内部回调协议，无 OS
      注册（setAsDefaultProtocolClient 全仓零命中）；`kcoder-app` 进程内独占。
      佐证：本机官方 DeepSeek Harness 渲染进程命令行带全套六旗
      `--standard/secure/cors/fetch/streaming/code-cache-schemes=dsh-app`

### 阶段 1：协议模块 — complete（2026-10-07）

- [x] `desktop/main/shell-protocol-core.ts`（零依赖纯逻辑）+
      `desktop/main/shell-protocol.ts`（electron 接线：scheme 注册 /
      protocol.handle / forwardShellRequest / WS 头改写）；cookie 经
      `DshManager.authFetch`（新增 `authCookieValue` getter 供 WS 守卫）
- [x] `scripts/check-shell-protocol.mjs`（54 断言）挂 typecheck 链尾

### 阶段 2：壳接线（双模式）— complete（2026-10-07）

- [x] `windows.ts` `showShellWindow` 双模式分流 + hostOrigin 变化重载（D6
      并入 showShellWindow 的既有调用点——state-changed/activate 都汇于此，
      无需另挂监听）；`getBaseUrl` 协议模式返回恒定 origin；偏好翻转两向自愈
- [x] `logoutToLanding` 无需改动（about:blank 卸载本就双模式兼容，重登录
      按「非协议页」重载）
- [x] store `shellProtocolMode`（默认 false）+ `Preferences` 契约 + 偏好页
      开关（注明重启生效）+ 诊断页「加载形态」展示（坑记 6 落地）
- [x] 产物关键串断言：`kcoder-app` / `__DSH_TRANSPORT__` 在 out/main，
      `shellProtocolMode` 在 main+renderer 两侧 bundle

### 阶段 3：冒烟与文档 — complete（2026-10-07）

- [x] `scripts/smoke-shell-protocol.mjs`（真 electron + 假侧车 18 断言）：
      页面 origin/secure context、streamBaseUrl 注入、/api 转发与头剥离、
      POST 流式往返、/plugins no-store、set-cookie 扣留、WS 头改写 +
      **webContentsId 门负对照**（第二窗口原样放行）、503 可见面。注：注入器
      锚点不在本冒烟——注入器 origin 无关且已有 11 支 GUI 冒烟覆盖，本冒烟
      只抓协议集成面
- [x] `pnpm smoke:shell-protocol` 脚本入口 + `release.sh prepush` 门
- [x] ARCHITECTURE.md §3/§4/§7 与根 README 架构图同步

### 阶段 4：灰度与退役 — complete（第一步 2026-10-08 / 第二步 2026-10-10）

- [x] 实机回归通过 → store 默认值翻 true（2026-10-08）：协议加载成为
      默认形态，偏好页开关转为回退档（「工作台协议加载」，关闭 = 回退
      直连）；偏好/契约/ARCHITECTURE/README 的默认语义六处同步
- [x] **legacy 退役（2026-10-10 执行；用户拍板跳过剩余观察期）**，按下列清单完成：
      1. `windows.ts`：showShellWindow 双模式分支收敛为协议单路（删
         `dshManager.shellEntryUrl` 令牌加载、will-navigate 的 legacy
         前缀判据与 getBaseUrl 双态）；
      2. `dsh-manager.ts`：`shellEntryUrl`/`shellUrlWithTitlebarInset`
         若协议外无消费方则一并删（`shellPageUrl` 已自带 inset 参数）；
      3. `store.ts`：`shellProtocolMode` 字段与 DEFAULTS 项删除（存量
         用户的 true 值随 `...raw` 并入内存，无害）；
      4. `ipc-contract.ts` / `ipc.ts` / 偏好页：开关 UI 与契约字段删除；
      5. `smoke-shell-protocol.mjs`：无 legacy 半区（本来就单测协议），
         核对无遗漏即可；`check-shell-protocol.mjs` 不涉默认值；
      6. ARCHITECTURE §3 图收敛单路 + §4 行去掉「偏好可关」表述；
      7. 回归：设置页开关消失、协议形态默认生效、无回归项

## §7 契约清单新增行（升级上游时必查）

| 契约 | 落点 |
|---|---|
| `__DSH_TRANSPORT__.streamBaseUrl` 全局（stream-client 读，缺席回落 `document.baseURI`；ui-settings-account 账号 RPC 同读） | `shell-protocol.ts`（HTML 注入行） |
| 转发面：`/api/*` 全量、`/plugins/*`（强 no-store）、text/html 首文档；WS upgrade 走 `ws://127.0.0.1/*` 头改写 | `shell-protocol.ts` |

## 风险与坑记（预登记）

1. **混合内容**：`kcoder-app` 注册为 secure scheme，页面若引用 `http://`
   绝对资源会被拦。阶段 0 的 dist grep 就是防这个；命中则该资源一并走转发。
2. **origin 持久化语义变化**：恒定 origin 意味着页面 localStorage/缓存跨重启
   存续（今天 per-port origin 从未存续，F10）。这是升级，但表现为「某些页面
   状态在重启后还在」——用户报告时按设计意图解释，不当回归修。
3. **插件 bundle 缓存**：恒定 origin + `/plugins/*` 忘写 no-store =
   跨启动读到旧 revision bundle，插件「更新了没生效」。no-store 是必修不是
   优化（上游注释原文即为此）。
4. **WS 头改写只护主窗口**：`webContentsId` 判定照上游；webview guest
   （ui-sidebar-browser）的 WS 不落 127.0.0.1，无需覆盖——但阶段 3 冒烟
   要含一条「guest 流量不受 guard 影响」的负对照。
5. **`__DSH_TRANSPORT__` 上游若改名/改形**：§7 新行即查即改；注入行的
   生成源集中在 shell-protocol.ts 一处，产物流断言兜底。
6. **协议失败面**：`protocol.handle` 抛错表现为页面 503/ERR——诊断页已加
   「加载形态 + 侧车状态」对照展示（2026-10-07 落地）；转发失败返回可见 502 文本。

## 实施坑记（2026-10-07 现场新增）

7. **Electron ESM 主进程顶层 `await app.whenReady()` = 死锁**：ready 事件要等
   主模块顶层求值结束才发。smoke-settings-anchors.mjs:169 已有警告注释，本轮
   仍然踩中（首版冒烟无声挂死）——冒烟骨架必须 `whenReady().then(async () => …)`。
8. **源码 TS 直载（Node 24 原生类型擦除）的两道坎**：extensionless 相对导入
   （`./dsh-manager`）要 `module.registerHooks` 补 `.ts` 解析；打包器语义的
   `__dirname`（dsh-contract 顶层求 PROJECT_ROOT）要预先垫全局。
   check/smoke 直载 `desktop/main/*.ts` 本尊的判据只有一份原则不变。
9. **假侧车路由必须按 pathname**：转发会原样携带查询串，`req.url === '/'`
   精确匹配把带 `?dsh-desktop-titlebar-inset=` 的文档落 404——表现为页面
   origin 正常、正文为空、streamBaseUrl 缺席（P3/P4 首轮红即此）。
10. **GUI 冒烟的等待器必须按目标条数轮询**：一次性 upgrade 唤醒会被前一条
    捕获抢先，负对照（第二窗口）读到手 elif undefined——首轮 W5 假红即此。


## 回归清单（用户实测，阶段 3 → 阶段 4 门）

登录进工作台 / 会话收发（流式） / 内置终端（dsh-terminal） / 右侧工作台
（dsh-coding-sidebar）/ 复制与附件 / 设置三注入页锚点（关于/数据迁移/MCP/
技能）/ 主题深浅切换与折叠无痕 / 更新按钮深链 / 登出→landing→重登 /
「重建上游」后 shell 自动恢复 / 托盘保活关闭重开 / kill-switch 关闭逐项
复测 / 远程连接窗口一轮（确认不受影响）/ 源码态 `pnpm dev` 一轮。
