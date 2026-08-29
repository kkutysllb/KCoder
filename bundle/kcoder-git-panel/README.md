# @kcoder/git-panel

KCoder 内置（in-box）dsh bundle：独立 git 工作区面板（变更统计胶囊 +
任务计划列表），以独立插件形态运行于 dsh web 层——命名与物化模式对齐
`@kcoder/skills-bundle`，替代退役中的 Electron 宿主实现
（`desktop/main/git-panel.ts` + renderer `views/git.ts`，见 M4）。

## 形态

```
bundle/kcoder-git-panel/          ← 源（开发态；打包态 electron-builder extraResources）
├── package.json                  dsh.bundle.patch + dsh.client 双面声明
├── entry.js                      server 半：只读 git 快照 RPC + open-plan 回退
├── client.js                     client 半：页面内浮动面板 + 标题栏开关按钮
├── cordis.patch.yml              bundle 层：挂 kc-git-panel 插件（id 可被后层覆写）
├── README.md
└── tests/run-tests.mjs           node 直跑单测（纯逻辑 + 真 git 临时仓库集成）
```

零构建链：交付物即手写产物（server 走 dsh cordis 插件加载；client 由
dsh client-modules 按 `exports["./client"]` 读入、`/plugins` combo 路由
拼接执行 `window.__ModuleLoader__.load` 注册协议）。

## 数据流

- client 按当前会话现场读取 cwd（`sessions` 快照 → `byId[current].cwd`），
  轮询 `POST /kc-git-panel/api/snapshot {cwd}`（开 15s / 收 60s，开合与
  刷新立即拉）；多窗口各自跟随自己的工作区。
- server（`inject: ['webServer']`）四路并行探测：`status --porcelain=v1`
  三计数、`diff HEAD --numstat` 行数和、`ls-files --others` 的 untracked
  逐文件行数增补、约定位置计划文档扫描（plans/ · docs/plans/ · .plans/
  一层 + 根 plan.md 等，标题取首个 `#` 行，上限 6 条）。
- 安全边界（dsh-git-forge 同款）：isTrusted（loopback 放行 +
  `webRuntime.trustedHosts`）+ POST-only + JSON body；cwd 仅接受绝对路径。

## 计划点击预览（软依赖三层）

1. `betterSidebar` 在 → `openTab({type:'editor', path, id:'editor:'+path})`
   （侧边栏文件预览，与消息区文件链接同链路）；
2. 缺席 → `POST /kc-git-panel/api/open-plan {path}` → server 用系统默认
   应用打开（macOS `open` / Windows `start` / Linux `xdg-open`；仅
   .md/.markdown/.txt 白名单）。

## 开合

- 标题栏按钮 `__dsh_kc_git_btn`（`__dsh_desktop_titlebar` 宿主内，
  right:148px——与退役兼容期的旧宿主按钮 right:108px 并存不冲突），
  git-branch 图标 + 双色胶囊徽章（+N 绿 / −N 红，与代码 diff 约定一致）。
- 面板开时内容区右侧让位（`--dsh-git-inset` + center/details 列
  padding-right，384px），与 better-sidebar 的让位变量互不覆盖。
- 外部编排入口：`window.__dshGitPanelOpen()` / `window.__dshGitPanelToggle()`。

## 物化与接线

- `desktop/main/kcoder-skills-bundle.ts` 的 `BUNDLES` 表登记
  `{pkg:'@kcoder/git-panel', dir:'kcoder-git-panel', intactFiles:['client.js']}`；
  启动时拷贝进 `$DSH_HOME/profiles/web/node_modules/@kcoder/git-panel`
  并注册进 profile 清单 `dsh.profile.bundles`（紧跟 dsh-web-app 之后）。
- 入口必须叫 `entry.js`（物化器的存在性检查）；版本号变化才重拷。

## 测试

```sh
node bundle/kcoder-git-panel/tests/run-tests.mjs
```

纯逻辑用例 + 真 git 临时仓库集成用例（git 缺席时集成块自动 SKIP）。
