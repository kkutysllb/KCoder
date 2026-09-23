# 上游 deepseek-harness 0.1.6-alpha.2 → 0.1.7-alpha.1 差异分析

> 分析日期：2026-09-22 · 仅分析，未改动任何代码
> 消费形态：KCoder v0.6.15（桌面壳），上游 fork = `kkutysllb/deepseek-harness`
> 前一版分析：`docs/upstream-0.1.6-alpha.2-analysis.md`（结构、口径、升级仪式与本文一致）
> 官方发布说明：GitHub Release `dsh-v0.1.7-alpha.1`（2026-09-22 发布，中英双语，Improvements 23 条 + Bug Fixes 25 条 + Chores 13 条）

---

## 0. 一句话结论

**这是一次「设置体系迁入 Profile 插件配置 + Agent 预设 bundle 化 + 会话格式 V4 + 交付物评审分栏化 + 语音输入实验线」的大版本；ui-slots 槽位契约与 MCP 引擎层零实质变化（重大利好），但设置 API 被整体重排（SettingsProvider→SettingsForms），且有两个 KCoder 运行时依赖包被上游删除——组合面断点比契约面断点更先到。**

- **好消息**：① `ui-slots` 源码零变化（仅版本戳+测试戳）——五个自研插件的槽位注册契约原样存活；② `packages/mcp` 零实质变化（仅版本戳）——引擎 MCP 层无需跟动；③ `SESSION_FORMAT_VERSION` 3→4 有完整迁移链且引擎自动迁移，KCoder 不直解会话文件。
- **坏消息（已实锤）**：① **运行时 121 个 dsh 依赖中 2 个被上游删除**：`@deepseek-ai/dsh-settings-file`（settings.yaml 后端）与 `@deepseek-ai/dsh-experimental-agent-team-web-profile`（Team Web UI 合并进单一 bundle，提交 9f21d7842a）——staging/kcoder-runtime 物化清单必须同步收口，否则 install/resolve 直接失败；② **settings 包 API 大重排**：`SettingsProvider`（abstract Service）+ `SettingsRegisterOptions/SettingsScope/SettingsSectionHooks/SettingsApplies` 全部删除，换成 `SettingsForms` + `SettingsDescriptor/SettingsDescribeOptions/SettingsPathOp`——「自定义设置插件需适配」是实打实的 API 断裂；③ **ui-primitives 81 个图标导出全部改名**（`Icon*Outline16/14` → `*Regular/*Medium` 双变体，另有 ReferenceIcon/LinkIcon/Menu 三组非图标破坏）——dsh-coding-sidebar 的最大量机械适配；④ llm-deepseek 只剩 Messages API（`DeepSeekProtocol` 类型、`Config.protocol` 删除且**残留即硬抛错**），`PUBLIC_BASE_URL` 改指 `https://api.deepseek.com/anthropic`；⑤ **pi-ai 出现官方第三个 pnpm patch**（流式大参数修复），与我方双 patch 钉同一 pi-ai@0.85.1，三方合并是最紧急集成项。
- **总账**：1299 提交（非 merge ~786：fix 384 / test 174 / feat 116 / docs 102 / refactor 72 / perf 17）/ 4754 文件（代码面 ~3905）/ +351718 −108840（大头上游自带 website tests 与 snapshots 录制）。窗口 5 天（2026-09-17 → 2026-09-22）。
- **本次分析口径**：官方发布说明逐条已对照代码核实（§2），发布说明未提及的代码级变更单列（§3），五个自研内置插件（技能/MCP/侧边栏/文件审查/终端）逐一给出升级点（§4）。

---

## 1. 对比口径

| 项 | 值 |
|---|---|
| 旧基线（当前消费态） | `ddefc45fbc7f8e46dd73185e68295696d1297887` = 上游 tag `dsh-v0.1.6-alpha.2`（2026-09-17 21:19） |
| 当前集成分支 | `kcoder/0.1.6-alpha.2` 尖端 `a01f995e87`（fork 侧含 tailCard 闸门、rendersExistingChildren 等自有分歧） |
| 新目标 | `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61` = 上游 tag `dsh-v0.1.7-alpha.1`（2026-09-22 12:12，fork master 已 ff 同步，merge PR #4901） |
| 提交量 | 1299（非 merge ~786）· fix 384 / test 174 / feat 116 / docs 102 / refactor 72 / perf 17 / chore 13 / build 4 / ci 3 / revert 1 |
| 文件量 | 4754（代码面 ~3905，其余为 .agents/notes、snapshots、website） |
| 变更最重的包 | `apps/web`(247) `apps/desktop`(241) `ui-chat`(116) `ui-sidebar-documentpreview`(110) `ui-primitives`(99) `ui-conversation`(71) `llm-deepseek`(65) `ui-settings-account`(58) `api/session-controller`(56) `apps/cli`(53) |
| 新增子包（20） | `api/account-controller`* `api/job-controller`* `boot/config-editor`* `client/ui-settings-account`* `client/ui-settings-agent-loop`* `client/ui-settings-shell`* `client/ui-settings-subagent`* `client/ui-settings-web-search`* `credentials/deepseek-account`* `credentials/deepseek-account-platform`* `experimental/api-speech-to-text`* `experimental/client-ui-voice-input`* `experimental/speech-to-text`* `experimental/speech-to-text-sensevoice`* `experimental/voice-input-bundle`* `host/product-telemetry-otel`* `preset/agent-preset`* `preset/agent-preset-registry`* `session/session-format-v3-to-v4`* `skill/tool-workspace-dependencies`*（* 号者部分为 git 树枚举口径下的显化，实际新增以 diff 为准，见 §3） |
| 删除子包（4） | `client/ui-settings-unarchive-sessions` `experimental/agent-team-web-profile` `preset/agent-presets` `settings/settings-file` |
| KCoder 运行时依赖校验 | staging/kcoder-runtime 107 个 dsh 包依赖：105 存活，**2 个缺失**（`dsh-settings-file`、`dsh-experimental-agent-team-web-profile`） |

---

## 2. 官方发布说明逐条 → 代码层核实

> 标记口径：【已核实】= 已定位到具体提交/文件；【待补】= 分域深挖进行中。
> 每条给出：发布说明原文摘要 → 代码落点 → 对 KCoder 的影响。

### 2.1 Chores（对下游影响最大，先列）

| # | 发布说明条目 | 代码落点 | KCoder 影响 |
|---|---|---|---|
| C1 | Session 日志升级 V4 + 批量迁移工具 + 兼容 V3 缺轮次结束记录 | `SESSION_FORMAT_VERSION = 4`（core/session/types.ts）；新包 `session/session-format-v3-to-v4`（"Streaming tool-role migration and delivery validation"，17 个 src 文件：tool-role/content/migration/validation/retired-syntax 等） | 引擎读旧会话自动迁移；KCoder 不直解会话文件；projcache 读兼容待核实 |
| C2 | 仅存于自定义事件的附件不再自动读取/导出，**插件需适配** | attachment 域（详见 §3） | file-review/terminal 若消费附件导出面需核对 |
| C3 | DeepSeek 适配器仅 Messages API，删 Chat Completions 与 protocol 选项 | `DeepSeekProtocol` 类型删除、`Config` 删 `protocol`、llm-deepseek 导出面重排（`DeepSeekFileStore/FilesClient/UploadIndex/MAX_*` 内敛）；web-app README 同步改写 | 若用户配置残留 `protocol:` 键的行为待核实（忽略/报错）；模型目录消费者无感 |
| C4 | 插件 locale 多语言标题/描述 + package.json 图标 | plugin manifest 新字段（详见 §4 插件管理器节） | 五个自研 bundle 可选跟进（管理页展示层） |
| C5 | 插件安装源：官方/npmmirror/自定义 | plugin-manager 安装流（详见 §4） | KCoder 自管物化链，低影响；插件管理 UI 面新能力 |
| C6 | bundle 多 patch 文件按序加载 + live-update 配置字段 | `dsh.bundle.patch` 列表化（web-app 组合已改为 cordis.patch.yml + presets/<id>.patch.yml 五文件形态） | 自研 bundle 的 patch 声明形态可渐进迁移；live-update 字段可减少重启 |
| C7 | `--dump-config-schema` 导出 Cordis 配置/patch JSON Schema | apps/cli | 配置编写辅助，无破坏 |
| C8 | Remote 双向流 + 二进制传输；工作区文件读取统一 `readBytes`，**插件需迁移旧接口** | `WorkspaceFileBytes.data`: base64 string → `Uint8Array`（泛型 `Data`）；新增 `WorkspaceByteReadOptions.baseFile`；新增 `workspace-file/watch-unsupported` 错误码；watch 帧语义改「当前目标元数据」 | 终端/侧栏/文件审查插件若走 remote 文件读取需迁移（待 §4 逐插件核实消费面） |
| C9 | 创造模式提示词精简 + 查询运行中插件配置字段 + Shell 提供 Profile 名称/目录 | preset/skill 域（详见 §3） | 无直接破坏 |
| C10 | Agent 预设改由 bundle 声明安装；设置页删复制/删除/打开目录；旧目录预设迁移 | `preset/agent-presets` 整包删除 → `preset/agent-preset` + `preset/agent-preset-registry`；web-app 组合改五文件 patch（每个 shipped preset 一个 `presets/<id>.patch.yml`：standard/ptc/minimal/cordis）；`.agent-presets` 目录旧形态退役 | KCoder 若有自定义 preset 落 `.agent-presets/` 需迁移；D2 overlay 锚点待核 |
| C11 | 设置改由 Profile 插件配置保存 + 实时更新字段；settings.yaml 仅导入一次；**自定义设置插件需适配** | `settings/settings-file` 删除；settings API 重排 `SettingsProvider`→`SettingsForms`（`SettingsRegisterOptions/Scope/SectionHooks/Applies` 删除，新增 `SettingsDescriptor/DescribeOptions/PathOp`）；各 SETTINGS_NAMESPACE（SHELL/PERMISSION/AGENT_LOOP/AGENT_DEFAULT_MODEL）迁入功能包（如 `packages/shell/shell`） | **dsh-shell-prefs 与 dsh-coding-sidebar 的 settings 注册面是头号适配点**（§4 细化）；KCoder 写入 settings.yaml 的键走一次性导入 |
| C12 | 内置浏览器 Web 默认关、Electron 默认开；聊天链接可选内置浏览器或新标签 | browser-use 域（详见 §3） | K 桌面壳属 Electron 形态，默认值翻转向；openpath-intercept 三道门待回归 |
| C13 | 实验性语音转写插件（本地模型下载） | `experimental/voice-input-bundle` + `client-ui-voice-input` + `speech-to-text(-sensevoice)` + `api-speech-to-text` 四件套 | 新组合面；不装不影响；若纳入物化需审模型下载隐私面 |

### 2.2 Improvements / Bug Fixes 逐条 → 代码落点（高相关项全列，其余归域）

**Improvements（体验优化，23 条中的高相关项）**：

| 发布说明条目 | 代码落点 | 详节 |
|---|---|---|
| 侧边栏会话置顶/归档管理/筛选/撤销 | ui-workspace 33d496951c + workspace-controller | `pinnedSessionIds`、ViewOptionsMenu（archivedFilter 取代 ui-settings-unarchive-sessions 包）、undo toast |
| 运行中会话归档「停止并归档」 | cbae324bfa + subagent archive-admission | 归档请求 `stopRunningWork`；新错误 `workspace/session-active` 带活动清单 |
| 工作过程展示/性能与用量/开发者工具设置 | ui-chat 1bcb633c3f + ui-settings 系 | 过程组 contract/groups.ts；`transcriptView` 三值化；`performanceUsage`/`linkOpening`；developerTools 默认 on |
| 任务确认停止/命令超时转后台/工作流后台 | job-controller 新包 + d6bebc5783 + 12957a106e | `job.list/follow/kill`；shell 缝 `onExpiry:'offer'` promoteOnTimeout；workflow `run_in_background` 默认开 |
| 反馈入口 | ui-message-feedback（稳定面） | header 菜单经 `feedbackUi.openSession` |
| 文件预览回合后自动更新+响应本地变化 | documentpreview + sidebar-files `WatchWorkspaceDirectory` | 文件/目录自动刷新 |
| 系统默认/关联应用打开+显示位置 | ui-open-in-app 39bde1a5c9 + session-controller | `openWorkspacePath(action:'reveal',application)`；五落点槽位 |
| 改动审阅默认分栏+高亮+同步滚动 | ui-deliverables 90a1b23e4a/a4493ceb39 | 新 FileDiff.tsx（SplitRow+useCodeHighlighter） |
| 改动卡悬停单栏差异 | ui-deliverables 90a1b23e4a | 同一 FileDiff unified 形态 |
| 统一图标/状态/菜单/滚动条 | ui-primitives 4937343a5e | **81 图标改名 Regular/Medium 双变体**（下游最大适配量） |
| 长对话加载优化 | d7e523b8b8 + 3d360e7fdb + 客户端 4 连 | 冻结加速+跳页单批次发布+二分/推迟读 |
| Team 成员名称/状态统一/看板只读 | 507e0e6dfe/b9e59cbaee/253fb5e66d | `target`=成员名；两态词表 running\|inactive |
| Excel 预览 | documentpreview（扩主包） | fortune-sheet/exceljs/xlsx + Worker + readBytes 二进制 |
| 统一缩放控件 | documentpreview `zoom/` 子系统 | PDF/图片直接、Office 经转 PDF 间接 |
| 其余（默认工作区/模型页统一/输入栏收拢/Agent 模式说明/分批展开/设置卡片化等） | 各域已覆盖 | 见 §3.2 各节 |

**Bug Fixes（25 条中的高相关项）**：

| 发布说明条目 | 代码落点 | 核实状态 |
|---|---|---|
| 投影缓存特殊 JSON 字段丢失 | df0145271d（z.json→isJsonValue） | ✅ 相符 |
| pi-ai 大型流式工具参数阻塞 | a0f59aac40（**pnpm patch** 6 适配器删每 delta parseStreamingJson） | ✅ 相符（载体是 patch） |
| 取消轮次结束记录写入失败/混栈 | 35f3abf1fa（abortedCancelCause 复制声明字段） | ✅ 相符 |
| 新会话误复用/空白会话被占用 | 5c8933fbe3（blank=无 turn/start+writer 互斥+落盘） | ✅ 相符 |
| 受理/运行中会话刷新误显空白 | e3f0d3fb6e（engagedSessions 集合） | ✅ 相符 |
| Windows 沙箱越权删除 | d5ad3baeb5+36e632751e+3d5ba3b83f（Low integrity+Deny ACE 容器继承） | ✅ 相符（实现为三层 ACL） |
| 无法读取的可选插件包不中止 Profile | de662ee010（skippedBundles） | ✅ 相符 |
| macOS「从应用打开」重复 | 39bde1a5c9（dedupeMacApplications 折叠+默认标注） | ✅ 相符 |
| 极简模式 Bash/PS 取消 [object Object] | 9d4fa54c2d（return ''+ABORTED） | ✅ 相符（提交说明未提 [object Object] 字样，【有出入·轻】） |
| 终端后代判活无需 PID reap | 90f0dc8f7d+838da1d07e | ✅ 相符（发布说明原文即提交标题） |
| 普通 Bash 空权限说明 | 8cf9c0eded（空 justification 合法化） | ✅ 相符 |
| 检查工具重复注册预设失败 | 4aba48ec03（tool-cordis host 入口拆分） | ✅ 相符 |
| DeepSeek Files API 报错 | d6a0e3323e/3a0d640214（responseJson+HTTP status） | ✅ 相符 |
| Markdown 预览本地图片 | 7951cee0d5（markdown/path-images.ts 授权路由） | ✅ 相符 |
| 主动压缩预留预算 | 555b664b08 等 6 提交（headroomTokens 64K） | ✅ 相符 |
| 设置导航独立滚动 | 47ee608079（overflow 1 行修复） | ✅ 相符 |
| **反向代理子路径 Web 访问** | 引擎区间未找到对应功能提交（仅测试收紧） | ⚠️ 有出入（判定为应用侧修复） |
| **Playwright 插件新建会话失败** | de8b10f8ab（browser-use-runtime 依赖改 peer） | ✅ 相符（llm 域初判未找到，终端域已定位——根因 scope symbol 副本） |
| **Messages 旧子代理通知续话失败** | 候选：82c6a5e4f4+ae180d1d24（Messages 输入容忍）+子代理懒迁移族 | ⚠️ 无一一对应提交，按复现路径核对 |
| 其余 8 条（反向代理外的 UI 细节修复） | 低相关，见各域报告 | — |

---

## 3. 发布说明未提及的代码级变更（机械化扫描 + 分域核实）

### 3.1 已实锤（本人亲手验证）

1. **两个运行时依赖包被删**（§0 坏消息①）：`settings/settings-file`、`experimental/agent-team-web-profile`（删除提交 `9f21d7842a`，Team 工具与 Web UI 合并进单一 bundle；继任面在 `experimental/agent-team-profile`）。
2. **ui-slots 零实质变化**：diff 仅 package.json 版本戳 + 测试版本字串——槽位注册契约（keyed/list/children/rendersExistingChildren fork 分歧）全部存活。
3. **packages/mcp 零实质变化**：4 文件全为版本戳——连续第二版 MCP 引擎层无变化，KCoder 自研 MCP 体系的引擎对接面稳定。
4. **settings API 重排全名单**（§2.1 C11）。
5. **llm-deepseek 导出内敛名单**：`DeepSeekFileStore`/`DeepSeekFilesClient`/`DeepSeekUploadIndex`/`DeepSeekFileId`/`deepSeekFileScope`/`MAX_IMAGE_BYTES`/`MAX_FILE_UPLOAD_BYTES`/`MAX_STORED_FILE_*`/`MIN_FILE_EXPIRY_SECONDS`/`DeepSeekProtocol`/`DeepSeekFileConnection/Policy/Reference`/`DeepSeekFileObject/Page`/`DeepSeekUploadRecord`/`RequestDefaults`/`ResolvedDeepSeekOptions`/`DeepSeekAdapterOptions/DeepSeekCatalogModel/DeepSeekConnectionOptions` 等从 `src/index.ts` 删除（实现仍在包内，转内部消费）。
6. **其它包出口删除**（部分为跨包搬移，去向已定位/待定位）：`SettingsUpdateSource`/`StubSettingsScope`（settings）；`SESSION_LOG_EXPORT_PATH`（session-log-export 路径常量）；`HOST_BUILTIN_INSPECTION`（sandbox）；`LinkIcon/classifyLinkPath`/`Menu`/`MenuEntry/MenuItem/MenuSeparator/MenuLabel`/`ReferenceIcon`（UI 内部件）；`FILE_REFERENCE_PROMPT`（@ 路径提示词常量，搬移）；`statusLine`/`PublicJobSnapshot`（job-controller）；`Workspace` 类型；chat-completions 协议类型族（`export type * from './protocols/chat-completions/types.ts'` 删除）。
7. **web-app 组合面**：patch 单文件 → 五文件（+`presets/<id>.patch.yml`×4）；就绪行/`--no-open`/进程 token 语义不变（README 明示 redirect 回同目录去 token）。

### 3.2 分域深挖汇总

#### 3.2.1 模型层 / MCP / Remote 控制器面

**A. llm-deepseek（65 文件，+4716/−7171）**【C3 提及，语义相符；volatile 化未提及】：

- Messages-only：`src/protocols/chat-completions/` 整目录删除（1255 行）；messages adapter 折叠进顶层 `adapter.ts`（单类 `DeepSeekAdapter`，无 MessagesAdapter）；导出删 `MESSAGES_BASE_URL`/`DeepSeekProtocol`/CC 类型族，新增 `plainOptions()`/`Options`；**`PUBLIC_BASE_URL` 值改为 `https://api.deepseek.com/anthropic`**。
- **`protocol` 键硬抛错**（连 `protocol: messages` 也抛，不静默迁移）；配置 schema 全字段 `.volatile()` 化；`settingsNs` 改插件实例 id 命名空间。
- 账户令牌认证：`resolveAccountToken` → `x-dsh-auth-token` 替代 `x-api-key`（optional peer `dsh-deepseek-account`，无服务回退 API key 兼容）。
- Files API：`responseJson()` 空内容/截断 JSON 抛 `INVALID_RESPONSE` 带 HTTP status；元数据校验改 Messages 字段；`purpose`/`expires_at` wire 废弃。
- **模型目录/定价零变化**（deepseek-flash + deepseek-v4-pro）。

**B. llm-pi-ai（23 文件）**【提及；载体细节未提及】：

- pi-ai 版本不变（^0.85.1）。**大流式工具参数阻塞修复 = pnpm patch**（a0f59aac40，`patches/@earendil-works__pi-ai@0.85.1.patch` 73 行）：6 个流式适配器删每 delta `parseStreamingJson(accumulated)`（O(n²)→toolcall_end 一次解析），`toolcall_delta` 的 arguments 恒 `{}`。**与 KCoder 双 patch（0003 relay accountId + 0005 codex 回退）三方冲突**。
- `context.ts` 支持 V4 `role:'tool'`（重建 pi-ai toolResult），拒 developer/tool-change/deferred。

**C. packages/mcp 再次零功能变化**（580bdc7258：4 文件全为版本戳/强转清理）——KCoder 自研 MCP 体系与引擎对接面连续第三版稳定。

**D. Remote 面**【C8 提及】：

- **双向流 uplink**：mux 帧新增 `item`/`end`；`InvokeRemoteRequest` 增 `uplink`/`peer`；**`TypertGatewayWireStream.open` 破坏性改签 `(endpoint,payload,signal)→(endpoint,payload,uplink,peer,signal)`**；`connection.rpc.intercept` 处理器 +第4参 `peer`；**webserver 升级准入 `requestRejection(req)`→`connection.admit(req)`**（socket 生命周期绑 peer scope）。新错误码 `gateway/uplink-overflow`/`gateway/protocol`/`gateway/input-invalid`。
- **二进制 unary**：multipart 响应（JSON metadata part + 附件表），无 base64；仅 unary 结果。
- **readBytes 统一（无兼容期）**：删 `@Remote readAll`/`readRelated`，并 `readBytes(scope,path,{range?,baseFile?},signal)`，`data` base64→`Uint8Array`；README 迁移表：`readAll(p)`→`readBytes(p,{})`、`readRelated(base,rel)`→`readBytes(rel,{baseFile:base})`。`changes(scope)`→`changes(scope,path)` 目标化（Chokidar 单文件/直接子项），新错误码 `workspace-file/watch-unsupported`。
- 「反向代理子路径修复」：引擎区间未找到一一对应提交（仅测试收紧），判定为应用侧修复【有出入】。

**E. session-controller（56 文件）**：

- **job roster 移出控制流**（2132b7beeb）：control 帧删 `jobs` 字段——消费方改订 job-controller `job.list`。
- 归档会话闸门（cbae324bfa）：`agent/pre-step` 拦截归档 Session 及 subagent 后代（沿 origin='subagent' 血缘）。
- 子代理目录懒迁移/投影化（05b056f18c）：SubagentCatalog 移入 projection-store；**客户端契约删 `setSubagentCatalogOpen`/`refreshSubagents`，新增 `refreshProjections(sessionId)`**。
- 新 @Remote：`projections`（免激活读投影）、`workspacePathApplications` + `openWorkspacePath(application)` + `openNativeAssociatedPath`（文件关联 App 面）；fork `atSeq` 变精确 inclusive 边界；新错误 `session/writer-held`。
- 「Playwright 插件新建会话失败」「Messages 旧子代理通知续话失败」：区间内**未找到一一对应修复提交**（候选：82c6a5e4f4 Messages 输入容忍 + ae180d1d24；subagent 懒迁移族；ad83cce36a）【有出入，下游按复现路径核对】。

**F. job-controller（新包）+ jobs 底层大改**【提及，相符】：

- `job` Remote：`list` 整集 roster 流 / `follow` 非消费输出流（opened→output(next/lossy)→status）/ `kill`（"cancelled by the user"，不吞模型完成通知）。
- `dsh-jobs`/`dsh-jobs-local` 大改（+3358/−1117）：`JobEvent` 事件流、`JobOutputSource` 多通道、环缓冲、非消费 `readAt`、`JobSettleCause`——**coding-sidebar 的 jobs.output/kill 自有路由消费 ctx jobs 服务，需按新面核对**。
- 超时转后台（d6bebc5783）：shell 缝 `execute()` `onExpiry:'kill'|'offer'|'none'`，bash/pwsh `promoteOnTimeout:true` → `{kind:'promoted',jobId}`；工作流 `run_in_background`（默认开）。

**G. 账户/终端/设置控制器**：

- **terminal-controller src 零变化**（仅版本号）——上游终端线本版引擎侧无实质改动。
- account-controller（新）：`account` 命名空间 getState/getProfile/getBalance/startSignIn/cancelSignIn/signOut/watch；credentials/deepseek-account(-platform)（新）：PKCE 登录 + loopback 回调 + resolveToken；非 desktop 壳隐藏入口（75546dc8e9）。**KCoder 可不接入（API key 回退兼容）**。
- settings-controller：删 `canOpenAgentPresetDirectory` 与 `Config{nativeOpen}`；namespace 视图增 `autoGenerate`。
- product-telemetry-otel（新）：OTLP/HTTP 用量上报插件，**默认不挂载**（"shipped profiles do not mount it"），endpoint 指生产收集器；不挂载即零上报。session-telemetry-otel 同期新增（另一包）。

**H. 本域导出增删硬名单**：删 `MESSAGES_BASE_URL`/`DeepSeekProtocol`/CC 类型族/`SessionJob as JobView`/`canOpenAgentPresetDirectory`/`nativeOpen`/`setSubagentCatalogOpen`/`refreshSubagents`/`readAll`/`readRelated`；改签 `TypertGatewayWireStream.open`/`rpc.intercept`/`admit`/`changes`/`WorkspaceFileBytes.data`/fork `atSeq`；新增 `plainOptions`/`Options`/`RequestMessage`/`WorkspaceByteReadOptions`/job·account 两包/projections/workspacePathApplications/`session/writer-held`/`isRemoteJsonValue`（移至 dsh-typert-protocol）。

#### 3.2.2 终端 / 技能 / 实验特性 / 子代理与 Team / 浏览器 / 沙箱

**A. 终端线**：

- **`api-terminal-controller` src 零改动**（仅版本号+测试迁移到 remote-mock）——引擎终端线本版无实质变化。
- `ui-sidebar-terminal`：**recovery/cleanup 槽位主动停用**（b7b587692d，注释停用非删除——不再向 `conversation.session.header.actions` 与 `shell.overlay` 注册恢复按钮/重试浮层）；图标随 B 改名；retainTabs/tab 保留模型未动。
- 终端作业并入统一 Job 面（07941fe5e2 等：JobSpec/VisibleJobs→forCaller/CallerJobs 改名，terminal outcome 经 job registry 呈现）。
- 判活不依赖 PID reap（90f0dc8f7d+838da1d07e：`processIsRunning` 后代静默探测；subprocess-local 控制通道生命周期与托管进程分离、Windows Job runner exit+IPC 断开双事件结算）。
- 持久 shell 取消语义（9d4fa54c2d）：不再 `throwIfAborted` 抛 signal.reason（[object Object] 根因），改 return '' 由 ToolRuntime 统一发布 ABORTED。

**B. 技能线**：

- **skill 加载/发现/调用链零契约变化**（skill-filesystem/tool-skill/skill-badge/skill-office 仅版本号与资源打包）——**dsh-skills-bundle 的 `ctx.skills.register` 契约安全**。
- 新包 `skill/tool-workspace-dependencies`（6e49ccad18）：工具面（非 skill 面），解析 PrimaryRuntimeManifest（runtime.json，SHA-256 payloadDigest，Desktop 模式拷贝 payload 进 Harness home）。
- 创造模式提示词合一（7520fe94e1：creator prompt 与 standard 合一，删 tool-cordis prompt 区段，首回合 9572→8975 tokens）；创作者技能渐进披露（b13bbc027c：SKILL.md 瘦身 + `references/` 按需读 + `templates/` 可复制模板）；**shell-env 注入 `DSH_PROFILE`/`DSH_PROFILE_DIR`**。
- 「查询运行中插件配置字段与约束」（8c146d978f）：Host inspect `Builtin`→`Config` provider——live Loader 全条目 Config 投影自包含 JSON Schema（与 --dump-config-schema 同源投影器）。
- skill-catalog scope 解析重构（standingKeyFor→acquireScope AsyncDisposable lease），依赖从 `dsh-agent-presets/types` 改 `dsh-agent-preset-registry/types`。

**C. 实验特性**：

- 语音转写栈 5 包（47ae64ee68 系列）：voice-input-bundle=纯 cordis.patch.yml 组合包（insert 四行，**随发行 Profile 默认禁用**，插件管理器启用）；sensevoice provider=SenseVoiceSmall ONNX+Silero VAD（sherpa-onnx-node 平台原生包**装了就占磁盘**，int8≈239MB/fp32≈938MB，按 revision 下载+SHA-256 校验，缓存 `dshHomePath('speech-to-text','sensevoice')`）；UI=麦克风按钮+准备对话框+波形；桌面麦克风权限（apps/desktop `microphone-permissions.ts`）。
- `agent-team-web-profile` 并入 `agent-team`（9f21d7842a）：一 bundle 同时启用工具+Web UI；locale/icon 下沉各包。
- webworker-runtime（32 文件）：整个插件树跑进浏览器 Worker 的运行时（VFS+CJS loader+postMessage HTTP 隧道）Node shim 补齐——Web 预览/打包回归用。

**D. 子代理 / Team**：

- Team 工具改**成员名称寻址**（507e0e6dfe：roster 行删 id+name 双字段改 `target`）；可用性词表统一（Team：running|inactive|provisioning|failed；subagent list_agents：running|idle|ready→**running|inactive** 两态，interrupt 返回 previousStatus）。
- Team 任务看板只读（253fb5e66d），任务变更走工具。
- 归档先停后代（cbae324bfa：subagent archive-admission，terminal/subagent/team 注册进 workspace archive-admission 家族）。
- subagent 配置热更（601d6761e4：maxActiveSubagents/maxDepth 改 volatile）；目录发现重构（e55093b47d：**新增导出 `SubagentCatalogEntry`**，`SubagentListEntry` 形状变化——hasChildren 移入 child 行、activity 语义改写）。
- 工作流后台运行（12957a106e）：`run_in_background` **默认开**（enableRunInBackground 可关），注册 'workflow' job 立即返回 `{kind:'background',jobId,runId}`，JobKindMap 增 'workflow'。

**E. 浏览器域**：

- **内置浏览器默认值实现**（3eab1714bc）：web-app cordis.patch.yml 的 ui-sidebar-browser 行加 `disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"`——Web profile 禁用、desktop 保留。
- `linkOpening: 'sidebar'|'new-tab'` 设置（默认 sidebar）+ General 行（order 14）+ openExternalLink 路由。
- **Playwright 插件修复（de8b10f8ab）的普适教训**：npm 安装的 browser-use-runtime 自带 dsh-scope/dsh-mcp-client 副本 → scope-tag symbol 每模块实例唯一 → 工具注册进全局层 → 第二个 Agent 命名冲突失败；修复=改 peerDependencies。**注册 ctx.tools/用 scope 的插件包必须把 scope、mcp-client 声明为 peer，否则多会话必炸**。

**F. 权限/沙箱**：

- Windows 沙箱越权删除修复（d5ad3baeb5+36e632751e+3d5ba3b83f）：受限令牌降 **Low integrity** + 授权目录 Low no-write-up 强制标签 + 授权根内 Everyone SID 显式 Deny FILE_DELETE_CHILD（CONTAINER_INHERIT_ACE 只作用容器）——三层封死父目录删除路径与跨工作区互删。
- 普通 Bash 空权限说明合法化（8cf9c0eded：重复当前模式时空 justification 不再当升级失败）。

**G. apps/desktop 与 apps/cli**：上游自有壳为主（欢迎窗口/DevTools/Windows 卸载与签名脚本）——与 KCoder 自有打包链基本无关；**`@vscode/ripgrep` asarUnpack 修复（b20a383a7a）若下游打包含 ripgrep 可直接借鉴**；共享层：麦克风权限、webview guests lease、账号登录、强制更新隔离。本域**无删除导出**（仅 agent-team-web-profile 整包删除与 agent-presets 包拆分改名）。

#### 3.2.3 客户端 UI 契约面（packages/client 共 1260 文件，+53502/−18086）

**A. ui-slots 核心零变更**（src 区间 0 文件）——keyed/list/single、children 声明、registerFactory、Store seats 全部不变。KCoder fork 侧 `rendersExistingChildren` 分歧系我方独有（上游从无此 API），merge 天然干净。

**B. ui-primitives（99 文件）：图标体系全面改名**【提及（size-neutral icon weights note）】：

- **81 个 `Icon*Outline16/14/*` 数字后缀导出全删**，替换为 184 个 size-neutral `*Regular`（1px 描边）/`*Medium`（1.3px）双变体，`size` prop 独立控尺寸（4937343a5e，±2192 行）。删除名单含 IconSendOutline14/16、IconPaperPlaneOutline14、IconStopFill16、IconFolderOpen16/IconFolderClose16、IconSparkle16、IconShieldOutline16 等；新增 Microphone/Pin/Unarchive/CompareSplit/WorkspaceTree 等字形。
- 非图标破坏：`ReferenceIcon`→`ReferenceIconMedium/Regular`、`LinkIcon`→双变体（classifyLinkPath 保留）、`Menu` 拆出 `MenuItemButton`。新增 `SettingsForm` 全家、`SegmentedTabs/SegmentedControl`、`PathLabel`、`CODE_HIGHLIGHT_EXTENSIONS/languageForPath/useCodeHighlighter`、`PluginArtwork*`。
- 样式 token：`--dsw-specific-menu`、macOS 拖拽带规则、`ICON_REGULAR_STROKE=1/ICON_MEDIUM_STROKE=1.3`。

**C. ui-conversation（71 文件）**：

- 🔴 **`conversation.session.header.leading` 删除（无 shim）**→ 拆为 ui-layout `shell.leading`（root 域，macOS 桌面窗级 chrome 座）+ 本包 `conversation.header.leading`（root 域公共扩展点）；新常驻导航槽 `conversation.header`；`conversation.session.header` owner 增 `hideChrome`（9ae6f0defa/8019d37d3f）。
- 新槽 `conversation.input.activity`（owner 必实现 `onActiveChange`，展开占工具行宽并隐藏 accessory；首个使用者=语音输入）（0aa6f94749）。
- `onAddFiles/addFiles` 签名扩展 `(files, directories?)`——桌面真实路径改 `@path` 引用。
- 过程组契约：`contract/groups.ts` + group-registry/store + assembler `ConversationGroupDefinitions`（1bcb633c3f，PR #4852）。
- **DOM 锚点全部存活**：data-composer-card / data-composer-input / data-conversation-composer-overlay / data-conversation-scroll / conversation.session 均在位未动语义；新 CSS 变量 `--dsh-frame-leading-clearance/--dsh-frame-top-clearance`、composer 行模型名/图标 display 变量。
- 宿主侧设置注册改 volatile Config 投影模式（`settings.register` 模式废止，同 §3.2.5）。

**D. ui-chat（116 文件）：注入契约三处破坏性演进**：

- `ChatNodeOwnerProps`：+可选 `groupPart`；`inspectCall` 必填→可空（开发者工具开关）；`openSkill/openFile/forkAt` 仍必填。
- **`ChatNodeTurnDataInjected`→`ChatNodeInjected`（改名）**：hooks 增 `disclosure: SlotHookFactory<'conversation.chat.node',UseDisclosure>`；`hookContext` 改 `ChatNodeHookContext{turnData,disclosureReset}`（4b78b6577c）。
- **`ChatViewInjected.hooks.transcriptView` 删除→`presentation: ObservableSnapshot<ChatPresentationPolicy>`**；keyedHooks 增 `chatGroup`；transcriptView 模式 `['normal','compact']`→`['compact','detailed','expanded']`（legacy normal 只读映射 detailed）；新设置 `performanceUsage`/`linkOpening`（chat-settings 重写）。
- `turnTail` 槽存续（contract/slots.ts:265 原样）——file-review 挂靠点未变；反馈入口三件套稳定；消息卡片化无新契约。

**E. ui-deliverables（36 文件）：审阅体验重做，锚点 API 稳定**：

- 分栏审阅新 `FileDiff.tsx`（SplitRow + useCodeHighlighter + 双轴同步滚动）；review tab 默认 `split:true`；改动卡 hover 单栏差异（90a1b23e4a）。
- 新共享子槽 **`deliverables.file.actions` / `deliverables.review.file.actions`**（list/session，owner {actionUrl,available,pending,onAction(action,application?)}）；`openPresented/openChanged` 签名扩展（+action/application，返回 `Promise<PresentedOpenFailure>`）；**`PRESENT_HOST_PATH`→`PRESENT_HOST_ROUTE` 改名**。
- **`showCodeDiff = ctx.configForms.developerTools.enabled`——开发者工具关闭时 changed-files 卡片与 summary 读取整个摘除**（默认 on，2026-09-20 推翻初始 off）。
- `selectProducedFiles/producedForClosing` 签名逐字符未变 ✓；changes-review 路由与 `sidebar.right.pane.tab` 挂靠未变。
- 文件交付指引改 prompt 侧（28fbe7433d + 单次最多推荐 4 文件）。

**F. ui-workspace（38 文件）**：置顶（pinnedSessionIds + follow 'pinned' 帧）、归档 `stopRunningWork` 选项 + 新错误 `workspace/session-active`（归档语义从拒绝变「可停后归档」）、ViewOptionsMenu（归档筛选取代 ui-settings-unarchive-sessions）、首装默认工作区 `initializeDefault`（host 启动时初始化）、`subagent-lineage.ts` 删除改父投影。

**G. ui-settings 系**：5 个新 companion-page 分区包（account/agent-loop/shell/subagent/web-search，注册进 Plugins 页 `plugins.item` 槽）；**服务更名 `ctx.settingsScope`→`ctx.configForms`**（ui-theme/locale/ui-agent-preset/ui-deliverables 全部 inject 更新）；开发者工具 `DEVELOPER_TOOLS_NAMESPACE='ui-settings'` 默认 on（off 时隐藏 Trajectory/Inspect/tab 栏/preset chip/changed-files 卡）；新槽 `settings.launcher`；设置导航独立滚动（1 行 overflow 修复）。

**H. ui-sidebar 系 + ui-layout + ui-open-in-app**：

- documentpreview（110 文件）：Excel 预览进主包（fortune-sheet/exceljs/xlsx/PapaParse，Worker 解析，readBytes 二进制读）；统一缩放控件 `zoom/` 子系统；Markdown 本地图片修复（7951cee0d5 授权路由）；新槽 `sidebar.right.tab.document.actions`/`unpreviewable`。
- sidebar-browser：桌面载体切 `<webview>`（Electron 分区存储）；Web iframe 改 opt-in——「内置浏览器 Web 默认关/Electron 默认开」落地。
- sidebar-right：`rightbar.session` owner 增 `active` 与 `retainTab(tabId,signal)`；`tab.visible` 收窄为前台 Session 可见。
- sidebar-files：新 `WatchWorkspaceDirectory` Remote（侧栏文件自动刷新）。
- ui-layout：第 5 个 root 童槽 `shell.leading`（macOS 独占）。
- ui-open-in-app：四落点扩展（header.utilities/document.actions/unpreviewable/deliverables 两槽），底层复用 `session.canOpenWorkspacePath`/`openWorkspacePath`（+`action:'reveal'`/`application`），无新 Host 路由；macOS 去重=「同 bundleId+同显示名折叠为一条 + 默认应用单独标注」（发布说明「修复重复列出」语义相符）。

**I. 其它**：ui-tool `ToolCallOwnerProps` 新增必填 `useDisclosure`（tool.call.toolview 渲染器类型不兼容）；ui-agent-preset +configForms、presetGuide 双语指南；ui-trajectory 受开发者工具门控；ui-theme/locale 宿主侧 volatile Config 投影重写（服务读法未变）。

**J. 破坏面清单（下游必改）**：① 图标名（量最大）；② `conversation.session.header.leading`→`shell.leading`/`conversation.header.leading`；③ Chat/Node 注入面新形状（disclosure/presentation）；④ `settingsScope`→`configForms`；⑤ `ToolCallOwnerProps.useDisclosure`；⑥ `onAddFiles/addFiles` 第二参；⑦ `openPresented/openChanged` 返回类型；⑧ transcriptView 三值化。**稳定面**：ui-slots 核心、turnTail、selectProducedFiles/producedForClosing、四 DOM 锚点、changes-review 路由、`sidebar.right.pane.tab`、反馈三件套。

#### 3.2.4 Session / 存储内核（41 实质提交，+8283/−603，135 文件；packages/storage/* 零实质变更）

**A. SESSION_FORMAT_VERSION 3→4**（669b724a78 主 + ad83cce36a 收尾）【发布说明提及】：

- **V4 数据格式**：① `tool/result` 从「user 角色 + tool-result 包装 block」变**一等 tool 角色消息**（`role:'tool'`、顶层 `toolCallId`、直接 content 数组、可选 `isError`）；退役 `tool-result` block 被拒收；② 消息来源 `source.kind:'plugin'` 包装废除，改生产者自有 kind（compact→compact-checkpoint、ptc→ptc-mode、system-prompt→`system-prompt/runtime-context`，其余→`plugin:<原名>`）；③ 新事件 `developer/message`（工具增删记录，表面事件 4→5 个）；④ `turn/end.reason` 新增 `forked`；⑤ `EpochHeader.system` 退役（`never`）；⑥ **`system/message` 原生接纳必须 `source.kind:'system-prompt'`**（旧手工构造 seed 会被拒）。
- **迁移链**：V0→V1→V2→V3→V4（session-format-catalog `currentVersion: 4`）；读路径**懒迁移**（打开 V3 即内存转换，写路径校验后发布 V4 后继）；批量 CLI `pnpm run migrate:sessions-to-v4 [--sessions-dir][--jobs N]`（并行 + 结构化失败汇总）。「兼容 V3 缺轮次结束」= `observeRestart()` 合成 `interrupted` turn/end + 全 seq 重映射（#4689）。
- **V3 迁移硬拒绝清单**（不发布后继、不改源文件、每次打开重试）：未知必需事件、嵌套 tool-result 包装、带 deferLoading 的工具定义、delivery generation≥4 marker、目录证据冲突——失败汇总应纳入升级 SOP。

**B. session-persistence-jsonl 读写路径**（27 文件）【提及但语义有出入——发布说明只提批量工具】：

- 读路径冷打开先 `prepareCatalogFacts()` 枚举直属 subagent 子日志证据，`validateRelatedSources()` 校验成员集合，漂移抛 `JsonlGenerationSourceChangedError`；损坏子 header 隔离 warn（不再阻断列表）、损坏 zstd header 帧在 list() 剔除。
- **revision 语义（隐性破坏）**：formatVersion<4 的历史会话 revision 从 `<fileRev>` 变 **`<fileRev>:<corpusHash>`**（全语料 sha256）——历史会话缓存失效粒度全库级，凡把 revision 当缓存键/比较的代码不能假设单段格式。

**C. 投影缓存**【提及（JSON 字段丢失），但夹带未提及的签名破坏】：

- 修复 `__proto__` 键丢失（df0145271d）：`z.json()` → `z.custom(isJsonValue)`（只读谓词、不重建不克隆）；存储表示与 domain version 7 不变，纯读取端修正。KCoder 自研投影缓存模块应**照抄该方案**。
- **签名破坏（未提及，编译期即炸）**：`cachedSnapshot(meta, inheritedEventCount, keys?)` → `(meta, keys?)`；`cachedPredecessorTitle(meta, inheritedEventCount)` → `(meta)`；`asOfSeq: -1` 哨兵废止（86ca9de07e）。**与 KCoder fork 修复分支 `fix/session-projection-cache-per-unit-isolation` 正面相交（冲突预判 #2）**。
- V4 迁移使全部 formatVersion:3 投影缓存行失配 → 升级后首轮全量冷折叠重建（预期行为，非故障）。
- 新增 wire 必填字段：session-list 的 `SessionProjectionHints.kind: 'sequenced'|'cached'`——自解析 session.list 响应需处理。

**D. 附件载体白名单**（0c44e5461d）【提及】：`imageInEvent()` 从「任意事件按字段名猜」改 switch(event.type) 白名单（user/message、tool/ptc-dispatch、system|developer/message、tool/result、team/message/queued、agent/inbox/spliced、assistant 完成 block、compaction/summary）；**session/title-llm-request 移出载体**；未知事件 payload 完全不透明；ZIP 导出同理。自研插件把附件塞自渲染自定义事件的，升级后预览/导出拿不到。

**E. 其余内核项**：

- 取消轮次 turn/end 修复（35f3abf1fa）：`abortedCancelCause()` 复制声明字段（Node fetch 给 abort reason 挂可枚举 stack 导致写入被拒/混入）；自实现取消路径须同样窄化。
- 主动压缩（555b664b08 等 6 提交）：新增 `headroomTokens`（默认 65_536，modelPolicies 可覆盖），`maxTokens` 默认 8192→继承 headroom；压力门控按消息预算；显式配置过 8192 的 profile 行为不变。
- blank 会话语义（5c8933fbe3，#4392）：blank 判据 `seq===0` →「无 turn/start」；**blank 会话开始落盘**（旧「blank 不 touch disk」假设失效）；复用臂显式 `session.create` 先持有 writer 再返回（多实例互斥）。已受理/运行中会话刷新重连空白误判修复（e3f0d3fb6e，`engagedSessions` 集合）。
- 长会话优化：深冻结数值索引遍历（d7e523b8b8）+ 历史跳页单批次发布（3d360e7fdb）+ 客户端二分/推迟读——非存储层分页。
- agent-loop **删除导出** `AGENT_LOOP_SETTINGS_NAMESPACE`/`AgentLoopSettings`/`AGENT_LOOP_SETTINGS_SCHEMA`（`maxParallelToolCalls` 迁 profile-backed 设置体系，Config 类型变 `Volatile<number>`）。
- 新增 `buildForkSeed(events, boundary)`（core/session/fork.ts）与 `SessionPersistence.identity: symbol`（session-query 缓存键）。

#### 3.2.5 boot / 插件管理器 / 设置体系 / Agent 预设（~30 核心提交）

**A. 设置体系迁移**（601d6761e4 主 + 3f7016a422 volatile 机制）【发布说明提及，语义相符，细节远超发布说明】：

- **存储位**：settings.yaml/local.yaml 不复存在。新服务 `SettingsForms`（`ctx.settings`，`inject = ['configEditor','profileContext']`，挂载于 `bundle/base/cordis.patch.yml:102`）：所有写入经 `ctx.configEditor.edit()` 落到**当前 profile 的 cordis.patch.yml 对应 entry 的 config**，再走 Loader reconcile 生效。新包 `boot/config-editor`（`ctx.configEditor`）提供 `entries()/configuration()/edit()`（withFileLock + 原子写 + HMR 队列串行）。
- **可编辑范围收窄**：只有 Config schema 里 `.volatile()` 标注的字段可被设置页编辑（schema meta，非 package.json 清单字段）；`volatileForm()/projectForm()/isVolatilePath()` 按「最近 volatile 祖先」投影表单，越界写入报 "not volatile"。volatile 运行时机制（3f7016a422）落在 **vendor cordis**：`Entry.update/_commitVolatile` 对仅 volatile 变化跳过重挂载、发 `loader/volatile-update`。
- **API 全换**：`describe({redactSecrets})` / `update(ns,patch,expectedRevision)` / `replace(ns,section,expectedRevision)` / `mutate(ns,pathOps,expectedRevision)` / `configure({auto},fiber)`；乐观锁 `SettingsConflictError(SETTINGS_CONFLICT)`；事件 `settings/document-updated`；`SettingsDescriptor.applies` 收窄为字面 `'live'`；`./invariant` 子路径删除。旧 `SettingsProvider`/`SettingsScope`/`SettingsRegisterOptions`/`SettingsSectionHooks`/`SettingsApplies`/`SettingsUpdateSource` 全删。
- **一次性导入**：`importLegacyDocument()` Loader 结算后执行——把 `<profile>/settings.yaml` **改名 `settings.yaml.imported`**（防重复导入），逐 section 进 profile entry。改名映射 `LEGACY_SECTION_ENTRIES` 仅 3 条：`ui-developer-tools→ui-settings`、`ui-onboarding→ui-settings-general`、`shell→pwsh-sandbox/bash-sandbox`（按平台）。**不匹配 section 仅 warn 丢弃**（值留在 .imported）；**所属插件无 volatile 字段时即使 entry 存在导入也失败**。
- **KCoder 写过的 settings.yaml 键去向**：命中 3 条映射的落新 entry；其余按 section 名找同名 entry，找不到/无 volatile 字段即导入失败——升级后必须人工核对 `.imported` 文件内容。

**B. Agent 预设 bundle 化**（d1e22a7e24 + 7520fe94e1 + 4aba48ec03）【提及，语义相符】：

- preset = 普通插件行：声明包 `@deepseek-ai/dsh-agent-preset`，Config 即 `PresetDefinition { id 必填, name?, description?, order?, plugins: [cordis entry 行可嵌 group] }`，`Service.init` 里 `ctx.agentPresets.register(config)`。注册表 `AgentPresetRegistry`（`ctx.agentPresets`，Config 含 `default` 必填 + `selectedDefault`/`modeSelectionEnabled` volatile）为每个声明建独立 scope + 内存 Loader 树，失败标记 broken 只禁新绑定。
- **与 cordis.patch.yml 合流**：preset 行长在 bundle patch/profile patch 里；web bundle 改为 `dsh.bundle.patch` 列表（主 patch 只留 registry 行，四个内置 preset 各占 `presets/<id>.patch.yml`）。**Web 预设编辑器保存 = 按 id 覆写 profile patch 的 config.plugins——profile cordis.patch.yml 又多一个官方写者。**
- **旧目录零兼容**：`$DSH_HOME/.agent-presets/` 不再被任何代码扫描，无自动迁移器；官方指引要求手工转 bundle patch 行并逐一核对插件包名（改过名的包激活期才报错）。`PresetTrust`/`includeShippedRoot/includeUserRoot` 信任模型整体废除；设置页删复制/删除/打开目录入口。
- **检查工具重复注册修复**（4aba48ec03）：`tool-cordis` 拆出 host 侧入口 `@deepseek-ai/dsh-tool-cordis/host`（每进程一次），per-session 行只留工具+prompt；`tool-plugin-manager` 行 gate 在 profileContext 上。

**C. 插件管理器**【全部提及】：

- 多 patch 按序：`dsh.bundle.patch: string → string|string[]`（package-manifest），`ProfileLayer.patchPath→patchPaths`，app-boot 新导出 `bundlePatchFiles/bundlePatchPaths`，全链改走列表。
- 安装源：`registry` + `fallbackRegistries`（**默认含 npmmirror**）——仅对「换源可解」失败 fallback，git/tarball 不重试；`plugin_manager` 工具新增 registry 参数。
- locale/图标：package.json 顶层 `icon` 字段（≤256KiB、限 manifest 目录内）；多语言 = 包导出的 locale 资源（Node exports 解析，不执行插件代码；`readPluginMeta`/`metaOf`；`LocalizedText = string | {en,[locale]}`）。icon 非法只产生 `PluginLocalizedMeta.error` 诊断不拒载。**外部 bundle 要被读到标题/描述需在 exports 暴露 locale 文件**。
- 损坏可选 bundle 跳过（de662ee010）：manifest 不可读的已选 bundle 打印诊断并跳过（`skippedBundles`），plugin-manager 页保留错误与禁用/移除。
- 安装弹窗可关闭/按请求 id 恢复（736730c3fd、f938ebad64）。
- **client 契约**：`ui-plugin-manager` client inject 数组新增 `'configForms'`；新 slots `plugins.bundle.activation`、`plugins.detail.actions/badge/section`（原 `plugins.bundle.config`/`plugins.row.config` 保留）；`PackageMeta→PluginLocalizedMeta`。

**D. boot/app-boot 解析重构**【发布说明仅提「修复源码启动初始化失败并支持 link」】：

- **resolution mode 概念整体删除**：`ProfileResolutionMode`（link/dual/runtime 三代）与 `createProfileResolutionGeneration`/`healProfilesModuleFallback`/`healIsolatedProfileModuleFallback`/`unlinkProfileModuleFallback` 全删；唯一路径 `createRuntimeResolution()`（Node ESM+CJS resolver 拦截层，不再创建 fallback links）。
- **新导出 `removeLinkProjections()`**（02fec3209e）：清除 profile node_modules 下 `.dsh-module-fallback` 旧投影 symlink；官方在 `loadProfile` 与 Desktop `applyRelease` 每次启动各调一次。**不接入则残留投影可复现「已取消选的 bundle 抢占解析」回归**——KCoder 自管 profile 生命周期，必须接入。
- linked peers 解析（3e7af9cfbb/c9d4b7561d/cf41c158ba）：link 目录下导入走 Node 真实祖先链 + 每层 node_modules 叠加 linked peers 映射；**同一 link name 改指新目录需重启进程**（resolver 硬拒热 relink）；删除 link 与 relink 解耦（7252e5823b）。
- 新事件 `app-boot/config-reload`（reconcile 成功后发）；contained-group 隔离本区间无实质变化；`--dump-config-schema`（4eb26f0e71）实现主体在 app-boot `src/config-schema/`，输出 JSON Schema 2020-12，partial 投影时 exit 1（脚本化校验需同看退出码）。

**E. 本域导出增删硬名单**：app-boot 删 `createProfileResolutionGeneration`/`heal*`/`unlink*` + 类型 `ProfileResolutionMode` 族；settings 删 `SettingsProvider`（默认导出）等六件 + invariant 子路径；`dsh-settings-file` 整包（`Config`/`resolveSpec`/`FileSettingsProvider`）；`dsh-agent-presets` 整包（`AgentPresets`/`discoverPresets`/`mountPreset`/`PresetTrust` 等全族）；替代包 `dsh-agent-preset-registry`（`AgentPresetRegistry` 等）+ `dsh-config-editor`（`ConfigEditor`）。

---

## 4. 自研内置插件逐个升级点

> 消费面基线（考古结论）：五 bundle 由 `desktop/main/kcoder-skills-bundle.ts` 物化进 `$DSH_HOME/profiles/web/node_modules/` 并按序写入 `dsh.profile.bundles`（skills-bundle → @kkutysllb/dsh-terminal → shell-prefs → coding-sidebar → file-review-kcoder）。重型消费者：coding-sidebar（peer 面最宽）、file-review-kcoder（typert 协议面）；轻 bundle：skills-bundle / terminal / shell-prefs（零 dsh import，纯 ctx 服务）；MCP 体系（desktop/main/mcp-*）零 dsh import、纯文件面。

### 4.1 `dsh-skills-bundle`（技能包，1.0.2）

- **消费面**：仅 `ctx.skills.register({name, description, whenToUse?, source:'runtime', content, resourceBase:{kind:'directory',path}})`（rank 250）；无 slot/RPC/配置/文件写入；单一事实源 `skills/manifest.json`。
- **升级点**：
  1. ✅ **技能加载/发现/调用链零契约变化**（skill-filesystem/tool-skill/skill-badge 仅版本号；`ctx.skills.register` 的 `source:'runtime'`/`resourceBase` 契约安全）——**预计零适配**。
  2. 上游新增 `skill/tool-workspace-dependencies` 是工具面非技能面，不触及；创造模式提示词精简（C9）不触及 runtime skill 注册。
  3. 无 peer 键、无 settings、无 patch。
- **机会项（可借鉴，非必须）**：① 上游创作者技能的「SKILL.md 瘦身 + references/ 按需读 + templates/ 可复制模板」渐进披露结构；② shell-env 新注入 `DSH_PROFILE`/`DSH_PROFILE_DIR`，39 个技能的文档可引用；③ 借 C4 locale/icon 机制进插件管理页展示。

### 4.2 自研 MCP 体系（desktop/main/mcp-builtin|mcp-store|mcp-settings）

- **消费面**：零 dsh import。mcp-store 直写 `$DSH_HOME/profiles/web/cordis.patch.yml` 的 `@deepseek-ai/dsh-mcp-client` insert 条目（id `mcp-<serverName>`，config: serverName/transport/command/args/env/cwd/url/headers/toolCallTimeoutMs，YAML Document API 保真改写，**整份重写**）；mcp-builtin 五件钉版 + `$DSH_HOME/mcp-builtin-state.json`（BUILTIN_VERSION=6）；mcp-settings DOM 注入设置对话框「MCP 服务器」分区（`settings.section` 锚点 + MutationObserver 自愈）+ console 通道。
- **升级点**：
  1. **引擎 MCP 层连续第三版零变化**（本版 580bdc7258 仅版本戳/强转清理）——对接面无需适配，`mcp-client` config 字段面原样。
  2. 🔴 **profile cordis.patch.yml 多写者升级（R6）**：settings 迁移后 `configEditor`（withFileLock+原子写+HMR 队列）直接写同文件 entry config；preset 编辑器保存也按 id 覆写同文件。mcp-store 的「整份 YAML 重写」与官方写者并发存在互相覆盖窗口——mcp-store 在 Electron 主进程拿不到 `ctx.configEditor`，至少需要：写前重读最新文档（已有）+ **对齐官方锁文件约定**（调查 config-editor 的锁实现并复用同一锁语义）或把写入时机与 HMR reconcile 错峰。
  3. 🟡 **mcp-settings DOM 锚点**：设置页本版大改（新 SettingsForms 自动表单、新设置分区、导航独立滚动修复）——`settings.section` 锚点父级与 navList 结构可能漂移，MutationObserver 自愈逻辑需按新 DOM 复验【待 UI 域报告核实】。
  4. ✅ patch 文件 insert 语义 / `watchUserPatches` HMR 重组契约不变（非 volatile 行仍走 reconcile）；`plugins.ts` 宿主 peer 清单里 `dsh-mcp-client` 版本号展示自动跟随。

### 4.3 `dsh-coding-sidebar`（侧边栏工作台，1.0.26）——本版工作量最大

- **消费面**：peer 13 包（`^0.1.5-rc.2 || ^0.1.6-alpha.1 || ^0.1.6-alpha.2`）；`turnTail` list 语义已适配；`settings.section` slot；自有 `betterSidebar` 服务；host 路由 ~45 方法 + 4 prefix + 3 WS upgrade；动态服务名 `agents/agentPresets/sessionTitle/subagents/agentTeams/jobs/sessionPersistence/modules`；ui-primitives ~40 符号；node-pty enforce。
- **升级点**：
  1. 🔴 **设置面整体迁移（C11）**：`settings.register(ns, PrefsSchema)` + `describe` + `update` 的旧 namespace 模式**随 SettingsProvider 一并死亡**（新 API 仅 describe/update/replace/mutate/configure，`SettingsNamespace` 变 profile entry id 的 Branded 类型）。`SIDEBAR_PREFS_NS`（agentTerminalTools/agentOpenTools/terminalShell 等门控）必须迁移为 **Config schema `.volatile()` 字段**（`ctx.settings.configure({auto})` 控制表单策略）；`settings.section` slot 的自定义 UI 是否保留待 UI 域核实。
  2. 🔴 **peer 版本键**：现 range 不覆盖 `0.1.7-alpha.1`（semver 预发布规则：`^0.1.6-alpha.2` 不匹配 [0,1,7] 元组）——全部 @deepseek-ai peer 需追加 `|| ^0.1.7-alpha.1`。
  3. 🟡 **jobs 服务大改**：host 路由 `jobs.output/kill` 消费的 ctx jobs 服务重构（JobEvent 流/环缓冲/readAt/JobSettleCause）——两个路由的实现需按新面核对（kill 理由已标准化为 "cancelled by the user"）。
  4. 🟡 **`ctx.get('agentPresets')` 换实现**：旧 `AgentPresets` 服务类删除 → `AgentPresetRegistry`（`ctx.agentPresets`）——sidechat/team 相关的预设读取方法面需逐一核对（register(PresetDefinition)/auditRows 等）。
  5. 🔴 **ui-primitives 图标面（实锤，量最大）**：上游 81 个 `Icon*Outline16/14` 数字后缀导出**全删**，替换为 `*Regular`（1px）/`*Medium`（1.3px）双变体（4937343a5e）；本插件 client 30+ 处 import 的 `Icon*Outline16/14`、`IconCloseFill14` 与 `ReferenceIcon`/`LinkIcon`（改双变体）、`Menu`（拆出 MenuItemButton）全部编译期报错——机械替换 + `size` prop 独立控尺寸。
  6. 🟡 **desktop 侧 settings.yaml 补写块**（preset-plugins.ts 的 `dsh-coding-sidebar.titleBarCompat/titleBarStripPx`）：不在任何 volatile schema → 一次性导入必失败（R5）——改写 profile patch config 或收编进插件 Config schema。
  7. 🟡 **subagent 类型形状**：`SubagentListEntry` 结构变化（hasChildren 移入 child 行、activity 语义改写）+ 新增 `SubagentCatalogEntry`——`snapshotSubagentDescriptor` 与 `subagents.live` 路由的消费面需对齐。
  8. ⚪ webServer.register/registerUpgrade 形状：gateway 准入改 `connection.admit(req)` 属连接层内部，插件面 register 契约不变；node-pty enforce 规则本版未动。
  9. ⚪ `session.snapshotEvents()`/`SessionLogOffset` 存活；`inheritedEventCount` 语义放宽（seed 可自带 fork closers）；fork 新 API `buildForkSeed`（若 subagent 派生面板复用 fork 语义需跟进）；peer 依赖纪律（scope/mcp-client 必须 peer，Playwright 插件教训）本插件已合规。

### 4.4 `dsh-file-review-kcoder`（文件审查，1.0.7）

- **消费面**：peer 12 包（`>=0.1.0-rc.5 <0.2.0 || ^0.1.6-alpha.1 || 0.1.6-alpha.2`）；typert 三表 + contribution（`fileReview/status|apply|recorded`）；`tools/post-execute` cordis 事件；`ctx.systemPrompt.section({name,order:190})` + `getSectionOrder('DELIVERABLE_FILE_REFERENCES')` 探测；`writeFileAtomic`；消费上游 `/api/present.host|open`；双轨 turnTail + 自有 `fileReviewChanges` Definition（动态 resolve `uiConversation`）。
- **升级点**：
  1. 🔴 **peer 版本键**：同 4.3 #2，需追加 `|| ^0.1.7-alpha.1`（rc.7 老钉更须复核——`>=0.1.0-rc.5 <0.2.0` 语义上仍覆盖 0.1.7-alpha.1，但 typert/api-remotes 的实际 API 面已远漂，版本键覆盖 ≠ 兼容）。
  2. 🔴 **api-remotes/typert 面漂移**：`TypertGatewayWireStream.open` 改签（+uplink/peer）、`isRemoteJsonValue` 移至 dsh-typert-protocol、multipart 二进制 unary——file-review 的 TypertRemoteContribution 与 `$mount` 链需按新 typert-protocol 重验【待编译验证】。
  3. 🟡 **`/api/present.host|open` 契约**：上游文件打开语义大改（`PRESENT_HOST_PATH`→`PRESENT_HOST_ROUTE` 常量改名；新 `deliverables.file.actions`/`deliverables.review.file.actions` list 槽 + `openPresented/openChanged` 签名扩展 + `workspacePathApplications`）——present 两路由 URL 与响应形态需按新 ui-deliverables 源码核对（常量改名通常伴随路由语义整理）。
  4. 🟡 **`DELIVERABLE_FILE_REFERENCES` section 探测**：文件交付指引改为 prompt 侧策略（28fbe7433d：选择性交付 + 单次最多推荐 4 文件）——section 顺序/文案可能重排，`getSectionOrder` 存在性探测的降级路径需实测。
  5. 🟡 **开发者工具门控（新依赖面）**：原生 changed-files 卡片受 `configForms.developerTools.enabled` 支配（默认 on；off 时整个摘除）——file-review 的可见性与原生卡片不再同生，产品上要明确自家评审行是否跟随该开关。
  6. 🟡 **表面事件匹配面**：表面事件 4→5（+developer/message）、`tool/result` 表面角色 'user'→'tool'、`isAppendSurfaceEvent` 引擎实现随 V4 调整——`fileReviewChanges` Definition 的事件匹配（type/seq/surfaceOp/data.arguments 镜像）需对齐。
  7. ⚪ C2 附件白名单：file-review 自定义事件只存变更记录不存附件载荷，初判不受影响；undo/redo `writeFileAtomic`（atomic-write 包本版零变化）。
  8. ⚪ ui-deliverables 分栏评审/悬停 diff（Improvements）为原生面增强，与本插件 claim 协作（`deliverables` turn data + `fileReviewChanges`）无契约冲突；`selectProducedFiles/producedForClosing` 签名逐字符未变 ✓。**机会项**：自定义打开动作可改走/加挂 `deliverables.*.file.actions` list 槽（onAction 失败须返回 `PresentedOpenFailure`）。

### 4.5 `dsh-terminal`（终端插件，@kkutysllb/dsh-terminal 1.1.1）

- **消费面**：零 dsh import；host `inject=['webServer']`，prefix `/dsh-terminal/api`（rpc/SSE stream/vendor/deps）+ loopback/trustedHosts 信任栅栏；client 消费上游 `/api/session/list` 作工作区桶键探针；node-pty ^1.1.0 与 `dsh-subprocess-local` 同 range 同 integrity。
- **升级点**：
  1. ✅ **上游终端线引擎侧零变化**：`api-terminal-controller` src 零 diff；`ui-sidebar-terminal` 仅图标替换与 **recovery/cleanup 槽位主动停用**（b7b587692d，注释停用非删除——上游在 Web 侧回退了会话头恢复按钮与 shell.overlay 重试浮层；自研件可自决是否跟随）。D2 overlay 禁用行继续有效。
  2. 🟡 **webServer 升级准入链**：`requestRejection`→`connection.admit(req)`（peer scope 绑定）——SSE stream 长连接在升级握手/信任采样上的行为需回归（插件面 register 契约不变）。
  3. 🟡 **`/api/session/list` 响应新增必填字段** `SessionProjectionHints.kind`——探针用法为宽松读取，预计无感。
  4. ⚪ node-pty enforce/共享保留区规则本版未动；jobs 超时转后台（promoteOnTimeout）只影响引擎 shell 工具。**借鉴项**：判活勿依赖 PID reap（后代静默探测）；gateway 上行流打开后可在终端流内回传输入/ack；上游终端 recovery 槽位停用说明「会话头恢复按钮」这一产品位官方已放弃，自研件的等价入口是差异化点。

### 4.6 `dsh-shell-prefs`（Shell 偏好桥，1.0.1，附加观察对象）

- **消费面**：client `inject=['locale','theme']`，发布 `window.__kcoderShellPrefs` 窄接口；`locale.getSnapshot()/subscribe()/setLocale` vs `theme.getTheme()/subscribe()/setTheme` 读法不同名。
- **升级点**：✅ **locale/theme 服务读法未变**（本版两包为宿主侧 volatile Config 投影重写 + 图标/token 视觉统一，`getSnapshot/getTheme/subscribe/setLocale/setTheme` 服务面零改动）——预计零适配，升级后跑一次账号菜单语言/主题切换回归即可。

### 4.7 交叉事项（五件 + MCP 共通）

1. **peer/版本键**：全部 @deepseek-ai 依赖补 `|| ^0.1.7-alpha.1`；devDependencies 钉版同步。
2. **manifest 可选跟进**：package.json `icon` 字段 + locale 资源（需 exports 暴露）→ 插件管理页展示（纯可选）。
3. **settings.yaml 退役**：desktop 侧所有 settings.yaml 补写块（coding-sidebar 避让块、titleBarCompat 块）必须迁往 profile patch / 插件 Config。
4. **`removeLinkProjections()` 接入**：KCoder 自管 profile 生命周期（applyRelease/loadProfile 等价点）应调用，防旧投影抢占解析。
5. **批量迁移 SOP**：升级后先跑 `pnpm run migrate:sessions-to-v4` 再开放使用。

---

## 5. 升级仪式改动面（按 alpha.2 七件套推演）

| 落点 | 现值 | 需改为 |
|---|---|---|
| `upstream/BASELINE` | 末行 `ddefc45fbc…` | `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61` + 追加 0.1.7-alpha.1 升级记录 |
| fork 集成分支 | `kcoder/0.1.6-alpha.2` | 新建 `kcoder/0.1.7-alpha.1`（基于 tag → merge 旧集成树整体重放；不 reset 旧分支） |
| `desktop/main/dsh-contract.ts` UPSTREAM_BRANCH | `kcoder/0.1.6-alpha.2` | `kcoder/0.1.7-alpha.1` |
| `scripts/setup.sh` / `release.sh` | 同上 | 同上（grep 归零验证） |
| staging/kcoder-runtime 依赖 | 含 2 个已删除包 | 移除 `dsh-settings-file`、`dsh-experimental-agent-team-web-profile`；按 §3/§4 结论增补新包（config-editor? speech? telemetry-otel 是否入组 = 产品决策） |
| settings.yaml / profile | KCoder 直写键 | 走一次性导入验证；后续新键落 profile 插件配置 |
| 预放冲突面 | tailCard 闸门×ui-deliverables；editUserMessage×ui-chat；pi-ai 双 patch×上游；win32 黑窗×上游；rendersExistingChildren×ui-slots（零 diff，天然免冲突） | 逐文件并集取语义 |

---

## 6. 风险与待确认项

- **R1（运行时）**：物化清单 2 删包 + 组合面五文件 patch 化 + 新实验语音线/telemetry-otel 是否入组——上轮最大坑类（运行时交付链）本次有明确清单，验收前置检查纳入 `--dump-config` 复验。
- **R2（设置）**：settings.yaml 一次性导入的键覆盖面、SettingsForms 迁移对 shell-prefs/coding-sidebar 设置节的影响。
- **R3（预设）**：`.agent-presets/` 目录退役——KCoder 是否有落盘自定义 preset。
- **R4（模型）**：llm-deepseek Messages-only 对 relay/codex 双 patch 的重放面（上游 llm-pi-ai 23 文件同动）。
- **R4a（pi-ai 第三 patch 冲突，最紧急）**：上游大流式工具参数修复（a0f59aac40，PR #4740）载体是 **pnpm patch `patches/@earendil-works__pi-ai@0.85.1.patch`（73 行）**，从 6 个流式适配器删每 delta 的 `parseStreamingJson(accumulated)`；我方已有双 patch（codex 协议回退 0005 + relay accountId 0003）钉同一 `pi-ai@0.85.1`，且 openai-completions.js / openai-responses-shared.js 大概率与 codex patch 触碰同文件段——patchedDependencies 三方合并 + 逐段对齐。
- **R4b（llm-deepseek 配置硬抛错）**：`resolveAdapterOptions` 对任何含 `protocol` 键的配置**硬抛错**（连 `protocol: messages` 也抛）；`PUBLIC_BASE_URL` 值从 `https://api.deepseek.com` 改为 `https://api.deepseek.com/anthropic`。所有持久化配置必须清除 protocol 键。
- **R4c（账户体系）**：新增 account-controller + credentials/deepseek-account(-platform)；llm-deepseek 有令牌时用 `x-dsh-auth-token` 替代 `x-api-key`（deepseek-account 为 optional peer，无服务回退 API key 兼容）。KCoder 桌面壳可暂不接入（回退兼容），如需 DeepSeek 账号登录须自供平台实现。
- 【待补】分域报告的其余风险项。

---

## 7. 建议落地顺序（供讨论）

> **✅ 第 1 项已执行（2026-09-22）**：fork 集成分支 `kcoder/0.1.7-alpha.1` 已重建并推送（尖端 `e8036fb560`）。执行记录见 §8。

1. **fork 重建集成分支 `kcoder/0.1.7-alpha.1`**：基于 tag → merge 六修复分支（pi-ai 双 patch 需先与官方第三 patch 三方合并——最紧急）→ cherry-pick 品牌化/imageRequestPricing/测试适配三件套 → merge 旧集成树（预期冲突面：`ui-deliverables`×tailCard 闸门、`session-projection-cache`×隔离修复分支、`pnpm-workspace/lock`×patchedDependencies、`win32-process`）。ui-slots 零上游 diff，fork 侧 rendersExistingChildren 天然免冲突。
2. **staging 物化清单收口**：删 `dsh-settings-file`、`dsh-experimental-agent-team-web-profile`；评估是否入组 `boot/config-editor`（settings 依赖链会带）、语音四件套（默认禁用+占盘 239MB+，建议不入组）、product-telemetry-otel（默认不挂载，维持）；`--dump-config` 复验 D2 overlay 两行。
3. **settings 迁移专项**：settings.yaml 一次性导入实况核对（`.imported` 文件内容）；dsh-coding-sidebar 的 SIDEBAR_PREFS_NS → Config volatile schema；desktop 侧 titleBarCompat/避让补写块迁 profile patch；mcp-settings DOM 锚点复验；mcp-store 与 configEditor 的同文件写约定对齐（R6）。
4. **dsh-coding-sidebar 适配批**（工作量最大）：图标全量替换 → settings 迁移 → jobs/agentPresets/subagent 类型核对 → peer 键追加。
5. **dsh-file-review-kcoder 适配批**：peer 键 → typert 面重验 → present 路由与 DELIVERABLE_FILE_REFERENCES 探测实测 → 表面事件匹配对齐 V4。
6. **全量回归**：会话 CRUD 走 V4 自动迁移（先跑 `migrate:sessions-to-v4` 批量）、附件行为 C2、浏览器默认值 C12（desktop profile 应启用）、账号菜单语言/主题、终端 SSE、skills 注册、`removeLinkProjections` 接入生效。

---

## 8. 执行记录

### 8.1 第一批已执行（2026-09-22：fork 集成分支重建，对应 §7 第 1 项）

**产物**：fork 分支 `kcoder/0.1.7-alpha.1` @ `e8036fb560`（= tag `dsh-v0.1.7-alpha.1` + 单次 `merge --no-ff origin/kcoder/0.1.6-alpha.2` 整体重放 22 个自有提交），已推 `kkutysllb/deepseek-harness`。旧分支未 reset。

**冲突实况（预判 33 交集 → 实际 10 冲突）**：

1. `patches/@earendil-works__pi-ai@0.85.1.patch`（add/add，R4a）：三方合一——上游 6 文件 hunk（删每 delta parseStreamingJson）+ 我方 2 文件 hunk（codex relay accountId + 缺 terminal 合成），`openai-responses-shared.js` 同文件双 hunk 合段（我方 hunk 新基坐标 651→650）。install 实测应用成功，lock 补丁哈希更新为 `a62e2913…`；四修复点在 patched dist 逐点验证落盘。
2. `pnpm-lock.yaml`：取上游侧，`CI=true pnpm install --no-frozen-lockfile` 重收敛。
3. `pnpm-workspace.yaml`：自动合并产生 pi-ai 键重复（上游移位 × 我方原位各一份），手工去重；fortune-sheet 两条新 patch 键保留。
4. ui-chat 五文件：并集——上游新解构（`groupPart/usePresentation/useChatGroup`，移除 `historyIncomplete/compactTranscript/openView/useTranscriptView`）× 我方 `editUserMessage` 链（apply.ts→ChatView→ChatNodeSeat→MessageItem→MessageIconActions 全链核验贯通）；`IconEditOutline16→IconEditOutlineRegular`；locale 去品牌化随我方。
5. `ui-conversation/assembly.ts`：import 并集（上游 ConversationGroupRegistry × 我方 SessionInputResolver）。
6. `ui-plugin-manager/index.ts`：上游 inject 加 locale resolver + children 表新增 3 槽（activation/detail.actions/badge/section）× 我方 `pageChildren` 共享渲染面——`pageChildren` 并入新槽，两处渲染宿主 inject 同构。
7. `session-projection-cache/tests/cache.spec.ts`：接口条目并集（bad-only × title）。

**合并后适配 6 处（随集成收口，与历次升级同型）**：

1. `cache.spec.ts`：`cachedSnapshot(meta, SessionLogOffset(0))` → `(meta)`（R7：上游删 inheritedEventCount 参数）。
2. `codex-fallback.spec.ts` / `opencode-session.spec.ts`：夹具 `source:{kind:'plugin',plugin:'test'}` → `{kind:'test'}`（V4 废除 plugin 包装；对齐上游同包测试写法）。
3. `ui-chat/locale.ts`：上游新增键 `message.turnProcess.deepDivingFor`（过程组 toggle 文案）随品牌化 → `'KCoder...，用时{duration}'`。
4. `ui-tool/ToolRow.tsx`：我方彩色 diffStat 片段 × 上游 `TextShimmer(children: string)` 类型冲突——`typeof suffix === 'string'` 收窄分流（字符串走 TextShimmer、片段走带 `diffStat` 类的 span），删除对 Element 的恒等死比较。
5. `ChatView.tsx` 解构行拆两行（max-len 140，与 alpha.2 轮同款）。
6. `ptc-runtime-python`：`typescript/no-unnecessary-condition` 抑制恢复一对（alpha.2 曾摘除——"settled 收窄不复现"，本次合并后复现，按历史对称处理；注释两轮压缩过 max-len）。

**质量门（全绿）**：pnpm install 通过（补丁应用成功）；vitest 920/920（llm-pi-ai+projection-cache+ui-chat）+ 1236/1236（ui-conversation/ui-deliverables/ui-plugin-manager/ui-renderer/ui-tool）+ 355/355（ui-tool 补跑）+ 14/14（codex-fallback/opencode-session 复跑）；全仓 typecheck（host+client）通过；lefthook 提交门全绿（translation pairing / third-party notices / whitespace / vendor manifest / lint）。

**完整性断言**：14 个关键自有提交均为新尖端祖先；`git diff --name-only tag..尖端` = 49 文件全为我方自定义面。

**下一批（§7 第 2 项起）的前置同步**：`upstream/BASELINE` 追加本次记录并将钉版 SHA 改为 `c36a83ff6b…`；`desktop/main/dsh-contract.ts` UPSTREAM_BRANCH → `kcoder/0.1.7-alpha.1`；`scripts/setup.sh` / `release.sh` 分支名同步（3 处断言，完成后 grep 归零验证）。

### 8.2 第二批已执行（2026-09-22：前置同步 + staging 物化收口，对应 §7 第 2 项）

**前置同步（KCoder 侧，提交 56f911d）**：`upstream/BASELINE` 钉版换 `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61` + 追加 0.1.7-alpha.1 升级记录；`desktop/main/dsh-contract.ts` UPSTREAM_BRANCH → `kcoder/0.1.7-alpha.1`；`scripts/setup.sh`/`release.sh` 分支名同步（3 处）；`grep kcoder/0.1.6-alpha.2 desktop scripts` 归零 ✓。

**fork 强制全量重建**：清 `apps/cli/lib`/`lib`/`dist`/`apps/web/dist` 后 `CI=true pnpm run build` → **263 个 client 产物**（上轮 248，新包如期入组），exit 0。

**物化链（release.sh build）三连坑与解法**：① `pnpm install --frozen-lockfile` 无 TTY purge 确认中止（workspace.yaml 注释记载的已知坑）→ `CI=true` 重跑；② deploy 后 `materialize-peers` 因 electron 二进制被①的首次中止 install 重链掉而崩（getElectronPath）→ `pnpm fix:electron` 从缓存 zip 恢复 ✓；③ deploy 需写 fork 目录临时文件，工作区沙箱 EPERM → 提权重跑。三坑均为已知类（运行时交付链），无新雷。

**staging 收口结果（staging/kcoder-runtime @ 0.1.7-alpha.1，不入库）**：deploy 闭包 80 顶层依赖——`dsh-settings-file`/`dsh-experimental-agent-team-web-profile` **自动消失**（CLI 包不再依赖，验证 §3.1 预判）；`dsh-config-editor`/`dsh-agent-preset`/`dsh-agent-preset-registry`/`dsh-session-format-v3-to-v4` 全部在位（设置/预设/V4 迁移链可用）；materialize-peers 自检通过（25228 文件 → tar.gz 162MB，签名 228）。

**复验（--dump-config --patch 实测三行 + 冒烟）**：
1. `session-log-deepseek / enabled: false`（D2）✓
2. `ui-sidebar-terminal / disabled: true` ✓
3. `ui-deliverables / config.tailCard: false`（我方 tailCard 闸门在新基线生效）✓
4. MCP 行 7 条存活（mcp-store 的 cordis.patch.yml 在五文件 patch + preset registry 新组合下无冲突）✓
5. `smoke-runtime.mjs`：就绪行 + 首页 200 ✓（READY_LINE_RE 契约存活）
6. 新引擎首启 `removeLinkProjections()` 已在真实 profile 清理陈旧投影链接（R 风险项的行为落地，luxon 等旧 .dsh-module-fallback 链接被移除）✓

**遗留至下一批**：settings.yaml 一次性导入需真实 App 首启核验（`~/.kcoder/settings.yaml` 3662B 在场，dump-config 路径不触发插件激活；核对 `.imported` 改名与 K 补写键存活 = §6 R5）＝第 3 项 settings 迁移专项的第一步。

### 8.3 第三批已执行（2026-09-22：settings 迁移专项，对应 §7 第 3 项）

**① 一次性导入实况核对（隔离副本双启实证）**：`~/.kcoder` 克隆到 /tmp 后启动新引擎——`settings.yaml` 启动即改名 `.imported` ✓，但 **12 个 section 仅 2 个落位**（`ui-onboarding→ui-settings-general` 映射 + `locale`），其余**静默失败**（上游 `logger.warn` 在 headless 下不可见＝可观测性缺口），用户值全部保全于 `.imported`。dump 路径不触发插件激活故不消费 settings.yaml（live 首启才会）。

**② 关键用户值手工迁移（live profile，dump 逐一验证）**：`ui-theme.preferenc=dark`、`agent-default-model={zai-coding-cn, glm-5.3-flash, max}`、`better-sidebar` 行（agentOpenTools/defaultWidthPercent/titleBarCompat/titleBarStripPx/tabsEnabled 四项用户值）。合并语义实证：**profile 层行对 bundle 行逐键覆盖**。

**③ desktop 侧两处改造（提交 2fdd5e7）**：新增 `desktop/main/profile-config-lock.ts`——与引擎 configEditor 同锁文件同协议（`<profile>/package.json.lock`，wx+pid+退避；R6 对齐），`mcp-store` 的整份 YAML 重写纳入锁内（save/delete 异步化 + 四个调用方跟改）；`preset-plugins` 的标题栏避让补写从 settings.yaml 迁到 profile patch 行 config（逐键守卫，settings.yaml 写入器已因文件消失自然失效）。

**④ dsh-coding-sidebar 1.0.29（真源仓提交 + dsh-plugins 镜像 + bundle 镜像三仓同步）**：
- **根因级修复（本批最大发现）**：schema 必须由 **fork `@deepseek-ai/schemastery`** 构造——volatile 引用包装发生在 fork 的 `Schema.resolve`（`createVolatile`），stock schemastery 只认 `meta.volatile` 标记、**不产生引用**，导致 loader `_commitVolatile` 收集不到引用而**静默跳过**（症状：写盘成功、响应值不变、事件不发）。devDeps 直连 cosmokit 以过 TS2742。
- 配置合并：26 个偏好字段并入 Config 并 `.volatile()`；`prefsOf()/plainConfig()` 现读活引用；`PrefsSchema` 原样保留为兼容导出（含 https 默认 false 的历史不一致，明确不动）。
- 桥接块替换：`settings.register/describe/update` → `ctx.inject(['configEditor'])` + `edit(entry, current => ({...current, ...patch}))`；entry 查找按 **name/id 双匹配并跳过 disabled 行**（实测 bundle 行 id = `better-sidebar`、name = `dsh-coding-sidebar`，另有多挂防重的 !!js disabled 表达式）；`loader/volatile-update` 事件驱动两个模型工具门控重评估；revision 为会话内单调计数（409 映射保留）；`SettingsConflictError` 本地化（删 dsh-settings peer/dev）。
- 门禁全绿：`tsc --noEmit` ✓、`pnpm test`（新增 7 组断言：fork 引用解析/标记矩阵/默认兜底/解包）✓、`pnpm build` ✓、`pnpm smoke`（产物+契约+双面加载）✓。

**⑤ 端到端复测（新引擎 + 物化插件，HTTP 实测三路径）**：settings.get 返回活值（含上轮 patch 的 tools=true/strip=52/compat=true）✓；settings.update 改 strip=64/compat=false → **响应即新值**（volatile 引用原地更新，前一轮「写盘成功但响应旧值」的失败模式已消除）、rev 0→1 ✓；再 get 持久 ✓；陈旧 revision → 409 `settings-conflict` ✓；patch 文件收敛为合并后的 config ✓。

**⑥ mcp-settings DOM 冒烟（已收口）**：本机复现失败 → A/B 证明为**预先存在的门禁腐化**（脚本查 `.dmi-row`、实现类名早为 `dmi-card`，迁移前版本同样失败），修复 6 处选择器后 light/dark 双主题 **ALL PASS**（提交见 KCoder 仓）。注意：该冒烟用自带合成 DOM 验证 PAGE_JS 注入/console 通道机制，真实设置页锚点仍以 App 实跑为准。

**遗留（第 4 项起）**：coding-sidebar 余下适配（81 图标改名 / jobs 服务面 / agentPresets 注册表 / subagent 类型 / peer 键追加）属第 4 项。

### 8.4 第四批已执行（2026-09-22：coding-sidebar 0.1.7 契约适配批，对应 §7 第 4 项）

**产物**：dsh-coding-sidebar **1.0.30**（真源仓 `be00eb7`、dsh-plugins `8798af3`、KCoder bundle `bf18523` 三仓同步；`sync-bundles --check` 零差异）。

**⚠️ 一处更正（承 §8.3 的错误结论）**：引擎包 `@deepseek-ai/dsh-*` 的 **0.1.7-alpha.1 已发布**（npmjs 与 npmmirror 均有；dist-tag `alpha` 已指向更新的 **0.1.7-alpha.2**）。此前 `npm view <pkg>@0.1.7-alpha.1` 报错使 §8.3 误判为「未发布」——真实原因是该次查询失败未细究。因此本批**直接平移 devDeps 12 条至 0.1.7-alpha.1**（对齐集成分支基线），无需任何本地替换 hack。附带发现：上游已发 alpha.2，本次集成分支仍锚定 alpha.1（如需追 alpha.2 属下一轮基线决策）。

**真实断裂（用真实发布包后 typecheck 暴露）**：
1. **V4 消息来源**：`sidechat-routes.ts` 的边界注入 `source: { kind: 'plugin', plugin: … }` 在 0.1.7 类型下非法（`kind:'plugin'` 包装已废除）→ 改为**自有 kind** `'sidechat-injection'`，以 `declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { … } }` 注册（上游 `time-context` 同范式）；实际识别走文本前缀，行为零变化。
2. **jobs `kill` 的 caller 语义**：旧 `caller?: Agent` → 新 `caller?: SessionId`——插件原先传 `agents.get(sessionId)`（Agent 对象）会被归属栅栏判外来、kill 一律 404；已改为传会话 id（结构面同步改注释）。

**机械适配**：30 个图标导入名按 size-neutral 新命名改写（`Icon*Outline16/14` → `Icon*OutlineRegular`，Fill 同理），24 文件；插件自有的 19 个本地图标（Terminal/Upload/Diff/Pdf/Docx…）不依赖上游导出、无需改。

**核对后免改**：`AgentPresetRegistry` 保留 `resolve`/`mount`（与 session-controller 同范式）；`snapshotSubagentDescriptor` 同名同参数字段；`SubagentListEntry.activity: 'running'|'inactive'` 与 child 行 `hasChildren` 均可继续消费；`WebUpgradeRoute` 形态未变；`webServer.register(kind:'prefix')` 已由 live boot 实证可用。

**依赖面**：peer 11 条追加 `|| ^0.1.7-alpha.1`；devDeps 12 条平移 `0.1.7-alpha.1`。

**门禁（真实发布包）**：`tsc --noEmit` ✓、`pnpm test` ALL PASS ✓、`pnpm build` ✓、`pnpm smoke` ✓；新 build 在隔离 profile 的 live boot 就绪且 settings 路由返回持久值（strip=64）✓。

**方法教训（值得入 SOP）**：把「本地 node_modules 换成 fork 构建产物」作为 typecheck 手段会**掩盖真实断裂**——本批的 V4 source kind 与 jobs caller 两处，正是在改用真实发布包后才暴露。后续升级一律以发布包为准，fork 构建仅作对照。

### 8.5 第五批已执行（2026-09-22：file-review 适配批 1.0.8 + 第 6 项全量回归，对应 §7 第 5/6 项）

**产物**：dsh-file-review-kcoder **1.0.8**（真源仓 / dsh-plugins / KCoder bundle 三仓同步；`--check` 零差异）。门禁全绿：typecheck 0 错、build 成功、smoke 45/45 + render 13/13（无 `as any`/`@ts-ignore`/删功能）。

**依赖面（rc.7 → 0.1.7-alpha.1 一步到位）**：devDeps 平移；**删已死的 `@deepseek-ai/dsh-client-runtime`**（最高仅 0.1.1-rc.2、fork 已无此包；类型迁往 `dsh-session/types`＋`api-session-controller/client`＋`ui-conversation/client`）；补 `dsh-api-session-controller`/`dsh-session`；peer 追加 `^0.1.7-alpha.1`。

**install 阻断与解法（值得入 SOP）**：`@deepseek-ai/dsh-api-session-controller@0.1.7-alpha.1` 的 peer 链
（→ `dsh-agent-preset-registry` → `@deepseek-ai/dsh-settings@^0.1.7-alpha.1`）中，**只有预发布可满足**的 peer 范围被 pnpm 的 peer 自动安装退化成熟稳定范围（`>=0.1.7 <0.2.0`）后报 `ERR_PNPM_NO_MATCHING_VERSION`；连换 llm/subagent/invariants/brand/settings 多包（每轮报不同的包）极易误判为上游发布问题。二分定位（/tmp 独立复现 → 12 条 devDeps 折半 → 单包）后确认根因，**解 = `autoInstallPeers: false`**（peer 本就由宿主引擎运行时提供）。另：pnpm 11 构建门要求 `allowBuilds` record 且值须为 `true`（写 `false` 仍报 `ERR_PNPM_IGNORED_BUILDS`；且 pnpm 会把自己的提示文本写回 pnpm-workspace.yaml，覆盖手工编辑）。

**契约适配（19 错 / 6 根因，逐条引 fork 权威路径）**：① `ConversationSnapshot` 现仅 `{views, activeTargets}`，转录切片移至 chat target 的 `legacy`（11 处）；② `SessionStandardProps.sessionId` 由 ui-session merge（ui-slots 只留空座位）；③ `connection/reset` 事件属主为 dsh-client-connection；④ `ctx.slots` 归 ui-renderer（不做 Context merge，改结构面 `SlotRegistryFace` 服务代理读取，服务缺席挂空 effect）；⑤ `TurnTailOwnerProps` 从 ui-conversation **移到** ui-chat；⑥ `ctx.remote` 在本基线是 any（ClientRemote 属主 api-gateway 缺席）→ 以 `mountRemoteContribution` 恢复 `$mount` 签名。新增 `src/client/dsh-contracts.ts` 集中镜像 6 个缺席属主包的结构面（每处注明权威路径）。

**另修（运行时行为）**：`present.host`/`present.open` 路由**文档相对化**（去前导斜杠）——0.1.7 浏览器侧 app 路由统一约定，前缀剥离反代挂载下修复 404，根部署等价。

**第 6 项全量回归（可无头验证部分，均通过）**：
1. D2 三行（session-log-deepseek 关 / ui-sidebar-terminal 禁用 / tailCard false）✓
2. MCP 行 7 条存活 ✓
3. **内置浏览器默认值**：`ui-sidebar-browser` 行 `disabled: !!js profileContext?.name !== 'desktop'` ✓ 生效——**但 KCoder 桌面壳跑的是 `web` profile，故内置浏览器在 KCoder 里默认关闭**（与「Electron 默认启用」的预期相反；linkOpening 默认 sidebar 时链接回退新标签页，行为优雅）。列为产品决策项。
4. `removeLinkProjections()` 真实 profile 首启清理陈旧投影链接 ✓
5. V4 批量迁移 CLI 功能可用（`migrate:sessions-to-v4`，33 会话语料 7 分钟未完——真实语料建议择机跑；中途 kill 会留 `.migration.*.tmp`）✓
6. **live profile bundle 解析零跳过**：五件行 + `dsh-video-generator` 行全部在场（/tmp 副本曾「跳过 video-generator」系相对符号链接在副本下断裂的伪影）✓

**待 App 实跑（本环境无 GUI）**：会话 CRUD 走 V4 懒迁移、附件 C2 白名单、终端 SSE 升级、插件 UI 面（图标新命名/侧栏渲染）。**待产品裁决**：内置浏览器是否要按「桌面壳 = Electron」放开（改 profile 名或本地补 `disabled` 覆盖）；file-review 是否补 `deliverables.file.actions` 子槽（现 tailCard=false 下「用其它应用打开」静默缺失）。

### 8.6 第六批已执行（2026-09-22：两项产品裁决落地 / 之一）

> 用户裁决：① 内置浏览器按「桌面壳 = Electron」放开；② 新增 file-review 的 open-with 能力；③ 0.1.7-alpha.2 锚定待开发环境验收后再议。

**① 内置浏览器放开（已落地，KCoder 提交 471ec6c + 00655ea）**：
- 上游 0.1.7 起 `ui-sidebar-browser` 行默认值按 profile 名判定（`!!js profileContext?.name !== 'desktop'` 即禁用），而 KCoder 桌面壳跑 `web` profile → 被误关。产品策略层（overlay 最后应用）以同 id 行覆盖 `disabled: false` 放开；`dump-config` 实测 `ui-sidebar-browser disabled:false` ✓ 且 `ui-sidebar-terminal` 仍 `disabled:true` 不受影响 ✓。
- **连带前提（本轮新发现并补齐）**：上游桌面端的浏览器载体是 `<webview>`（`apps/desktop/src/main.ts` 主窗口 `webviewTag: primary`），而 KCoder 主窗口此前**未开** `webviewTag` → 只放开行会让 tab 起不来。故同批：主窗口 `webPreferences.webviewTag: true` + 挂 `will-attach-webview` guest 加固（删 `preload/nodeIntegration*/webviewTag/plugins/navigateOnDragDrop` 等危险项，强制 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true`），加固序列对齐上游 `apps/desktop/src/browser-guests.ts`；partition 仍由插件按 Workspace 键控，不在此覆盖。KCoder typecheck 通过；guest 渲染与真实浏览器行为待 App 验收。
- 遗留观察：聊天链接打开位置仍由 chat 设置 `linkOpening`（默认 `sidebar` = 内置浏览器 tab）；自研 coding-sidebar 的浏览器 tab 与原生 tab 并存属既有形态（产品铁律只约束「原生右侧栏不复用」，不约束浏览器承载）。
