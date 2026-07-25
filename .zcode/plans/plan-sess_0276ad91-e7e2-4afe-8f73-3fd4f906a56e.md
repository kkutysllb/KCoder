# 4 个无后端面板 CRUD 路由对接实施计划

## 现状
前端 API 客户端方法**已全部写好**（`engine-api.ts` L687-951，类型也齐全），但后端路由不存在（返回 404）。4 个面板用 localStorage mock + 硬编码常量。本次：后端补路由 → 前端从 localStorage 切到真实 API。

## 存储方案决策
**统一用 `userDataStore` JSON 存储**（与 MCP/projects 同模式），而非 `.md` 文件。
- 理由：4 个面板的数据形状都是结构化 JSON（非纯 markdown 提示词），JSON 存储实现统一、可测试、与现有 `capabilities.mcp`/`coding.projects` 完全一致
- `.md` 文件方案（镜像 skills）可作为后续增强，本次不做
- 存储键：`subagents.items`、`plugins.states`、`commands.items`、`remote.config`（加在 compat.ts 现有 `USER_SETTING_*` 常量旁）

---

## Phase 1：后端 SubAgents CRUD（compat.ts + index.ts）

### 1.1 compat.ts 新增 handler（5 个）
复用 `readJsonBody`/`isObject`/`stringValue`/`stringList`/`ownerUserId`，存储用 `userDataStore.getUserSetting/setUserSetting('subagents.items')`：
- `kworksListSubAgents(runtime, actor)` → 返回 `{ agents: [...BUILTIN_AGENTS, ...userAgents] }`（builtin 硬编码，同前端 mock）
- `kworksCreateSubAgent(runtime, actor, request)` → body `{name, description, tools, content, inheritMode}`，生成 id，写回数组，201
- `kworksUpdateSubAgent(runtime, actor, id, request)` → 同上但 map 更新
- `kworksDeleteSubAgent(runtime, actor, id)` → filter 删除
- `kworksCloneSubAgent(runtime, actor, id, request)` → 复制 builtin 为 user agent

builtin agents 列表在后端定义（与前端 `BUILTIN_AGENTS` 一致，含 general-purpose 等 10 个 KCoder 专家）。

### 1.2 index.ts 注册路由（替换 L405 的 stub）
```
GET    /api/subagents            → list
POST   /api/subagents            → create
PUT    /api/subagents/:id        → update
DELETE /api/subagents/:id        → delete
POST   /api/subagents/:id/clone  → clone
```
全用 `authenticateOrInternal` 守卫。

---

## Phase 2：后端 Commands CRUD

### 2.1 compat.ts 新增 handler（4 个）
存储键 `commands.items`：
- `kworksListCommands(runtime, actor)` → 返回 `{ commands: [...SKILL_COMMANDS, ...userCommands] }`
- `kworksCreateCommand` / `kworksUpdateCommand` / `kworksDeleteCommand`
- skill commands 在后端硬编码（与前端 `SKILL_COMMANDS` 一致）

### 2.2 index.ts 注册路由
```
GET    /api/commands       → list
POST   /api/commands       → create
PUT    /api/commands/:id   → update
DELETE /api/commands/:id   → delete
```

---

## Phase 3：后端 Plugins（toggle + discover）

### 3.1 compat.ts 新增 handler（3 个）
存储键 `plugins.states`（`Record<string, boolean>`，仅存 enabled 覆盖）：
- `kworksListPlugins(runtime, actor)` → 返回 `{ plugins: [...] }`（INSTALLED_PLUGINS 硬编码 + 合并 states）
- `kworksTogglePlugin(runtime, actor, id, request)` → body `{ enabled }`，更新 states map
- `kworksDiscoverPlugins()` → 返回 `{ plugins: DISCOVER_PLUGINS }`（marketplace mock，硬编码）
- `kworksInstallPlugin`/`kworksCheckPluginUpdates` → 简单 stub（返回成功），marketplace 集成后续做

### 3.2 index.ts 注册路由
```
GET  /api/plugins              → list
POST /api/plugins/:id/toggle   → toggle
GET  /api/plugins/discover     → marketplace
POST /api/plugins/install      → stub
POST /api/plugins/check-update → stub
```

---

## Phase 4：后端 Remote Control

### 4.1 compat.ts 新增 handler（4 个）
存储键 `remote.config`（单 JSON 对象，默认值同前端 `DEFAULT_PREFS`）：
- `kworksGetRemoteConfig(runtime, actor)` → 返回 config（合并默认值）
- `kworksSaveRemoteConfig(runtime, actor, request)` → 合并写入
- `kworksListRemoteSessions()` → 返回 `{ sessions: [] }`（无真实会话管理，空列表）
- `kworksTestRemoteConnection(request)` → body `{url, token}`，fetch 探测，返回 `{ok, latencyMs?, error?}`
- `kworksRevokeRemoteSession(id)` → stub（无真实会话）

### 4.2 index.ts 注册路由
```
GET    /api/remote/config         → config
PUT    /api/remote/config         → save
POST   /api/remote/test           → test
GET    /api/remote/sessions       → list (empty)
DELETE /api/remote/sessions/:id   → revoke (stub)
```

---

## Phase 5：前端面板切真实 API（4 个文件）

每个面板统一改造模式：
1. 删除 `loadMock()`/`saveMock()` localStorage 函数
2. `useEffect` 在挂载时调 `api.listXxx()` 加载，存入 state
3. create/update/delete/clone 改调 `api.createXxx()` 等，成功后刷新列表
4. 保留硬编码 builtin/skill 常量在前端（用于即时渲染，API 返回的也含这些）—— 或直接用 API 返回的合并列表（更简洁，**推荐**）
5. 保留 loading/error 态

**文件：**
- `SubAgentsSettings.tsx` → `api.listSubAgents/createSubAgent/updateSubAgent/deleteSubAgent/cloneSubAgent`
- `CommandsSettings.tsx` → `api.listCommands/createCommand/updateCommand/deleteCommand`
- `PluginsSettings.tsx` → `api.listPlugins/togglePlugin`（discover/install/check-update 保留 UI）
- `RemoteSettings.tsx` → `api.getRemoteConfig/saveRemoteConfig/testRemoteConnection/listRemoteSessions`

**engine-api.ts**：已有的方法签名基本匹配，可能微调返回类型（如 list 返回 `{agents}` vs 数组）。

---

## 验证
每个 Phase 后：
- `cd engine && pnpm typecheck && pnpm build`
- `cd app && npx tsc --noEmit`
- Phase 1-4 后：`cd engine && pnpm vitest run tests/`（确认不破坏现有测试）
- 手动验证：打开设置面板，增删改查操作持久化生效

## 文件清单
**后端（2 文件）：** compat.ts（+~16 handler）、routes/index.ts（+~20 路由）
**前端（5 文件）：** engine-api.ts（微调）、4 个 Settings 面板（localStorage → API）

## 不在本次范围
- `.md` 文件存储方案（本次用 JSON，后续可增强）
- 真实的插件 marketplace 集成（install/check-update 用 stub）
- 真实的远程会话管理（sessions 返回空列表，revoke stub）
- 「打开文件夹」IPC（各面板的 openFolder 按钮仍为 stub）