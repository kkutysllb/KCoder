# @kcoder/stats-panel

KCoder 内置（in-box）dsh bundle：会话统计图表面板。hover 输入框下方的
StatsLine 缩略条时，从底部向上弹出可视化面板（轮/步计数、首 token 平均、
解码速度、LLM/工具调用耗时分解条、输入/输出 Token 用量条、缓存命中率环），
替代上游的纯文本 Tooltip。

以独立插件形态运行于 dsh web 层，替代退役的 Electron 宿主实现
（`desktop/main/stats-hover.ts`）——命名与物化模式对齐
`@kcoder/git-panel`（见 `kcoder-skills-bundle.ts` BUNDLES 表）。

## 形态

```
bundle/kcoder-stats-panel/        ← 源（开发态；打包态 electron-builder extraResources）
├── package.json                  dsh.bundle.patch + dsh.client 双面声明
├── entry.js                      server 半：占位（纯 client 交付，无 RPC）
├── client.js                     client 半：行文本解析 + 自绘底部面板
├── cordis.patch.yml              bundle 层：挂 kc-stats-panel 占位插件（id 可被后层覆写）
├── README.md
└── tests/run-tests.mjs           node 直跑单测（parseStatsLine 纯逻辑）
```

零构建链：交付物即手写产物。client.js 无 import/export，由 dsh
client-modules 按 `exports["./client"]` 读入、`/plugins` combo 路由
拼接执行 `window.__ModuleLoader__.load` 注册协议。

## 工作原理

- **结构锚**：StatsLine 的分隔符 span（class 含 `_sep`）是缩略条 root
  （`_root`）的直接子级——closest 到第一个 `_root` 即缩略条，三重校验
  （parentElement 恒等 / 计数组文本「N 轮 · M 步」/ 高度 ≤48px），
  hover 热区精确，宁可静默降级也不错挂到大容器；
- **压制上游 Tooltip**：capture 阶段拦 `mouseover`/`mouseout`（React
  合成事件走 root 委托，事件到不了 root，文本气泡不再触发）；事件拦截
  存在重建竞态窗口，另有气泡本体狙杀兜底（专职 observer 扫
  `span[role=tooltip]`，文本命中统计行特征即 `display:none`，其他
  tooltip 零误伤）；
- **数据**：解析缩略条 DOM 文本（zh/en 双格式），agent 执行中数字持续
  更新 → MutationObserver 实时重绘；时长双格式兼容上游新基线 i18n 文案
  （`45.2s|45.2秒` / `2m42s|2分42秒`——旧正则只认英文格式导致中文界面
  LLM/工具调用/首 token 三项落空，v0.1.0 修复项）；
- **面板**：fixed 贴底向上弹出，消费 `--dsh-terminal-inset` 让位变量
  （不钻内嵌终端底下）；水平以缩略条中心线对齐（右侧栏展开/窗口缩放
  实时跟随）；`pointer-events:none` 纯展示，离开 200ms 收起；
- **主题**：跟随 `body[data-ds-dark-theme]` 暗色轨（面板挂
  document.body，后代选择器恒有效）；
- **脆性边界**：上游文案/结构改动 → 解析静默失败，面板显示可解析的
  部分（全部失败则不弹），不崩不错位。

## 测试

```
node bundle/kcoder-stats-panel/tests/run-tests.mjs
```

覆盖 `parseStatsLine`：zh 新基线时长格式（v0.1.0 修复回归）、en 格式
兼容、K/M 档 token 计数、部分可解析与空输入边界。
