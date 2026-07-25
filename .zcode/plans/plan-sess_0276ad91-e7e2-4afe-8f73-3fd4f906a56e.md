# 新建任务 UI + 分支选择路由 — 实施计划

## 目标
设计并实现「新建任务」对话框：选择项目目录（Electron 文件夹选择器）+ 选择/新建仓库分支 + 选模型/工作模式 + 填任务标题 → 调 `POST /v1/threads` 创建带完整参数的线程。补 2 个后端路由支持分支列表与新建切换。

---

## Phase 1：后端补分支路由（workspace.ts + compat.ts + routes/index.ts）

### 1.1 新增分支相关处理器（compat.ts，与 kworksGitCommitProject 同模式）
在 compat.ts 末尾新增两个导出函数，复用已有的 `runGit` / `runGitStrict` / `isGitRepository` / `readJsonBody` / `jsonResponse` / `isObject` / `stringValue`：

- `kworksListBranches(workspacePath)` → `GET /v1/workspace/branches?path=`
  - 校验 `path` 参数；`isGitRepository` 为 false 则返回 `{ branches: [], current: null }`
  - `git branch --list --format=%(refname:short)` → 解析为 `string[]`
  - `git branch --show-current` → `current`
  - 返回 `{ path, branches, current }`

- `kworksCreateBranch(workspacePath, request)` → `POST /v1/workspace/branch`
  - body: `{ path: string, name: string, base?: string }`
  - 校验 name 合法性（非空、无空白）；`isGitRepository` 校验
  - `git branch <name> [<base>]`（不切换，避免影响其他进程）+ 返回 `{ path, branch: name }`
  - 失败用 `runGitStrict` 返回 detail（例如分支已存在）

### 1.2 注册路由（routes/index.ts）
在现有 `GET /v1/workspace/status`（约 L806）附近注册：
```ts
router.add('GET', '/v1/workspace/branches', async (request) => { … kworksListBranches(request) })
router.add('POST', '/v1/workspace/branch', async (request) => { … kworksCreateBranch(request) })
```
注意：`/v1/workspace/*` 路由用 `authenticateOrInternal`（与 `/api/projects/*` 一致）。

### 1.3 验证
- `cd engine && pnpm typecheck && pnpm build`

---

## Phase 2：Electron 文件夹选择器 IPC（main + preload）

### 2.1 新增 `setupDialogIPC`（app/main/dialog.ts，镜像 terminal.ts 结构）
```ts
export function setupDialogIPC(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('dialog:openFolder', async (event, options?) => {
    const win = BrowserWindow.fromWebContents(event.webContents) ?? getWindow()
    if (!win) return null
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      ...options
    })
    return r.canceled ? null : r.filePaths[0]
  })
}
```

### 2.2 注册（app/main/index.ts）
```ts
import { setupDialogIPC } from './dialog'
// 在 setupTerminalIPC(() => mainWindow) 之后
setupDialogIPC(() => mainWindow)
```

### 2.3 preload 暴露（app/preload/index.ts）
在 `kcoder` bridge 加 `dialog` 命名空间（镜像 terminal）：
```ts
dialog: {
  openFolder: (options?) => ipcRenderer.invoke('dialog:openFolder', options) as Promise<string | null>
}
```
并扩展 `Window.kcoder` 类型声明。

---

## Phase 3：前端 API 客户端扩展（engine-api.ts）

### 3.1 扩展 createThread（已有，改为接受 payload）
```ts
async createThread(payload?: {
  title?: string; workspace?: string; model?: string;
  workModeId?: string; mode?: 'agent' | 'plan'
}): Promise<ThreadResponse> {
  // body: JSON.stringify(payload ?? {})
}
```
返回类型改为后端实际返回（ThreadSchema 含 id/createdAt/workspace/model）—— 扩展 ThreadResponse 加 workspace/model/createdAt。

### 3.2 新增方法
- `listBranches(path): Promise<{ path, branches: string[], current: string | null }>` → `GET /v1/workspace/branches?path=`
- `createBranch(path, name, base?): Promise<{ path, branch }>` → `POST /v1/workspace/branch`
- `getWorkspaceStatus(path): Promise<{ path, exists, isGitRepository, branch, headSha, isDirty, fileChangeCount }>` → `GET /v1/workspace/status?path=`（已有路由，前端未对接）

### 3.3 新增 ProjectEntry 类型 + listProjects 方法
```ts
interface ProjectEntry { id, name, path, is_git_repo, created_at, updated_at }
async listProjects(): Promise<{ projects: ProjectEntry[] }> → GET /api/projects
```

---

## Phase 4：NewTaskDialog 组件（app/renderer/src/components/NewTaskDialog/）

新建 `NewTaskDialog/index.tsx`，采用现有模态模式（`fixed inset-0 z-50` + `bg-black/60` backdrop，参考 AuthModal）。

**字段与交互：**
1. **项目目录**：显示当前路径 + `[选择文件夹]` 按钮（调 `window.kcoder.dialog.openFolder()`）。
   - 选择后自动调 `getWorkspaceStatus(path)` 显示 git 徽章（分支名 + 干净/脏）。
   - 若是 git 仓库，调 `listBranches(path)` 填充分支列表。
2. **仓库分支**：单选列表（radio）+ `[+ 新建]` 切换输入框。
   - 选已有分支 → 仅记录，不切换（后端当前分支即工作分支）。
   - 输入新分支名 → 创建任务时先 `createBranch(path, name)`。
3. **任务标题**：文本输入（可选，留空后端默认 'New chat'）。
4. **模型**：下拉（数据来自 `getModels()`，标记 active）。
5. **工作模式**：下拉（coding，KCoder 唯一模式，暂固定；预留扩展）。
6. **创建/取消**：创建按钮 loading 态，错误内联显示。

**提交流程（createTask）：**
```
1. 若新分支名非空 → createBranch(path, name, base)
2. createThread({ workspace: path, model, workModeId: 'coding', title })
3. setThreadId + setWorkspacePath(path)
4. onSuccess → 关闭对话框
```

### i18n（i18n/index.tsx）
新增 ~15 个 key（newtask.*），中英双语。

---

## Phase 5：接入 App 与 Sidebar

### 5.1 Sidebar「新建任务」按钮（Sidebar/index.tsx）
`handleNewChat` 改为：`clearMessages()` + 触发 NewTaskDialog 打开。
- 新增 `onNewTask?: () => void` prop，按钮 onClick 调用之。
- 保留 clearMessages/setThreadId(null) 逻辑。

### 5.2 App.tsx 状态管理
- `const [showNewTask, setShowNewTask] = useState(false)`
- `<Sidebar onNewTask={() => setShowNewTask(true)} />`
- `<NewTaskDialog isOpen={showNewTask} onClose={...} onCreated={(thread) => { ... }} />`
- onCreated：`setThreadId` + `setWorkspacePath` + 关闭对话框（不立即发消息，进入空对话等用户输入）

### 5.3 useChat.ts sendMessage
- 当 threadId 已存在（由 NewTaskDialog 创建）时，跳过 createThread，直接用现有 threadId 发消息。
- 已有逻辑覆盖（`if (!currentThreadId)` 守卫）—— 无需改动。

---

## 验证

每个 Phase 后：
- `cd app && npx tsc --noEmit`（前端类型检查）
- Phase 1 后：`cd engine && pnpm typecheck && pnpm build`
- 手动 `pnpm dev`：点「新建任务」→ 选目录 → 看到分支列表 → 输入新分支 → 创建 → 验证 thread 创建 + workspace 切换 + 分支被创建

## 文件清单
**后端（3 文件）：** compat.ts（+2 函数）、routes/index.ts（+2 路由）
**Electron（3 文件）：** app/main/dialog.ts（新）、app/main/index.ts（+1 行）、app/preload/index.ts（+dialog 命名空间）
**前端（5 文件）：** engine-api.ts（扩展）、NewTaskDialog/index.tsx（新）、Sidebar/index.tsx（改 handleNewChat）、App.tsx（+状态）、i18n/index.tsx（+key）

## 不在本次范围
- 4 个无后端面板的 CRUD（subagents/plugins/commands/remote）—— 用户明确为下一步
- 分支切换 UI（当前仅创建，不切换检出）—— 后续可加 checkout 路由
- worktree 隔离模式 —— 已明确排除
