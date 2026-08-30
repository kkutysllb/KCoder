# @kcoder/git-panel

KCoder 内置（in-box）dsh bundle：独立 git 工作区面板（变更统计胶囊 +
环境信息区 + 任务计划列表），以独立插件形态运行于 dsh web 层——命名与物化模式对齐
`@kcoder/skills-bundle`，替代退役中的 Electron 宿主实现
（`desktop/main/git-panel.ts` + renderer `views/git.ts`，见 M4）。

v0.5.0 对齐 Codex git 浮动面板能力：环境信息区（变更文件列表、工作位置/
worktree 切换、分支选择器（搜索 + 创建并检出）、提交或推送、比较分支外链）。

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
- server（`inject: ['webServer']`）多路并行探测：`status --porcelain=v1`
  三计数 + 逐文件列表、`diff HEAD --numstat` 行数和与逐文件映射、`ls-files --others` 的 untracked
  逐文件行数增补、约定位置计划文档扫描（plans/ · docs/plans/ · .plans/
  一层 + 根 plan.md 等，标题取首个 `#` 行，上限 6 条）、当前分支、
  ahead/behind（`rev-list --left-right --count`）、origin remote URL 与默认分支、
  worktree 清单、仓库根（realpath）。
- 写操作 RPC（v0.5.0）：`branches`（当前 + 本地分支清单）、`checkout`、
  `create-branch`（`checkout -b`）、`delete-branch`（`branch -d` 安全删；
  未合并拒绝并带 `merged` 标记，`force` 走 `-D`；当前分支拒绝）、`commit`（无暂存时先 `add -A` 全量暂存；
  信息非空 ≤2000 字；无任何变更拒绝）、
  `push`（按已配置上游）、`open-compare`（派生 GitHub 风格
  `compare/<default>...<branch>` URL 系统浏览器打开）。分支名过
  `isValidBranchName` 基础校验；写操作超时 30s（读 5s）。
- 安全边界（dsh-git-forge 同款）：isTrusted（loopback 放行 +
  `webRuntime.trustedHosts`）+ POST-only + JSON body；cwd 仅接受绝对路径；
  全部 git 调用 execFile（无 shell 拼接）。

## 环境信息区（v0.5.0，Codex 风格）

面板 body 顶部「环境信息」行布局，任务计划降为第二分区：

- **变更**：可展开逐文件列表（状态码 U/A/D/M 着色 + 路径 + `+a −r` 行数；
  上限 200 条截断提示）；点击走 better-sidebar editor 预览软依赖（缺席不动作）。
- **本地 ▾**：flyout「工作位置」——worktree 清单（主工作区标「本地」，
  当前项✓）；选中切换面板目标 cwd（只读视图切换；会话 cwd 不被改写）。
- **<branch> ▾**：flyout 分支选择器——搜索框（`搜索 <ws> 分支`）、本地分支
  列表（当前✓）、底部「创建并检出新分支…」内联输入流；非当前分支行
  hover 显删除按钮，行内二次确认，未合并时升级为「强制删除」确认。
- **提交或推送**：有待提交变更（staged/changed/untracked 任一）或 ahead>0
  时可用；内联提交盒（信息 textarea + 提交/推送按钮，按条件禁用）；
  提交在无暂存时自动暂存全部变更；ahead>0 时标签带「N 待推送」。
- **比较分支 ↗**：origin + 默认分支 + 当前分支齐备时可用；server 派生
  compare URL 并系统浏览器打开（本地路径 remote 等不可派形态拒绝）。

非 git 仓库时各行置灰（与标题栏按钮 .dim 同源）。

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
- 设置页联动（v0.5.3）：进设置页自动收起、返回工作区履约展开（与
  侧边栏互斥同款义务协议：仅自动收起带恢复，手动开关不参与义务并清
  除在途义务）。检测锚与 settings-page.ts 同源：
  `[class*="_overlay"] > [class*="_panel"][role="dialog"]`
  （SettingsRoot 专属组合，不误伤 ui-primitives Modal）。

## 主题跟随

面板与 flyout 挂 body 子树（`body[data-ds-dark-theme]` 后代选择器轨道
要求后代关系；SPA 重渲染只动 root 容器内部，body 直挂节点不受影响）。
唯一主题轨道为应用内 `body[data-ds-dark-theme]` 标记（上游 ui-theme
契约），不用 `prefers-color-scheme`——避免「应用内浅色 + 系统深色」
三态组合下面板与应用壳不一致；应用内切主题即时生效。

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
