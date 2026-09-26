# dsh-ssh-remote

DSH（DeepSeek Harness）插件：**SSH 远程运维/开发工具套件**——Agent 通过 10 个 `ssh_*` 工具在远程 Linux 主机上执行命令、读/写/编辑文件、搜索、双向传输（对标 VS Code Remote SSH 的核心工作流）。

- 系统 ssh 二进制 + **ControlMaster 连接复用**：首连后每次操作毫秒级；宿主重启自动重建；
- **远程文件编辑带防冲突**：读取记 sha256，提交前远端校验，文件被并发修改报 `stale-edit`；
- 所有命令/路径**参数数组直传**远端 shell，不经本地 shell——无引号地狱；
- 会话头部**状态胶囊**+面板；设置页**可视化主机管理**（表格 CRUD / 批量导入 / 导出，动态主机保存即生效）；
- 工具卡片化呈现：`ssh_run` 渲染终端卡（输出+退出码）、`ssh_read` 带文件跟随、`ssh_write`/`ssh_edit` 渲染 diff、`ssh_glob`/`ssh_grep` 渲染搜索卡（带封顶指示）；
- 回环 HTTP API（非回环 403）。

## 安装

```bash
dsh plugin --profile web add git+https://github.com/kkutysllb/dsh-kylin-ssh-tunnel.git
# 或 npm registry（版本可被插件管理检测，用户手动更新）
dsh plugin --profile web add dsh-ssh-remote
```

装完可在设置 → 插件中查看（标题/描述/图标由包内 `locale/{en,zh}.json` 与 `icon.svg` 提供），
并在会话头部看到 SSH 状态胶囊。

静态主机（可选，重启生效）——profile `cordis.patch.yml`：

```yaml
- id: ssh-remote
  config:
    hosts:
      - id: prod-1
        name: 生产机 1
        host: 203.0.113.10
        user: root            # 默认 root
        port: 22              # 默认 22
        auth: key             # 可选：key（默认，有私钥路径即此模式）/ agent / password
        identityFile: ~/.ssh/id_ed25519   # key 模式用；agent/password 模式可留空
        jump: bastion         # 可选：跳板（引用另一主机 id → ssh -J）
        defaultCwd: /srv/app  # 可选
    commandTimeoutMs: 60000
```

动态主机：设置页「SSH 远程主机」区块添加/导入，写入 `~/.dsh/ssh-remote/hosts.json`，**热生效**。
`id` 可留空——服务端自动补（name/host 的 slug + 计数去重），保存后可改；每张主机卡片带
「测试连接」按钮就地看连通性与延迟。

## 登录方式与凭据（v0.1.2 起）

主机卡片的「登录方式」三选一：

| 方式 | 行为 | 适用 |
| --- | --- | --- |
| `key` | `ssh -i <私钥路径>` + `BatchMode=yes` | 有专属私钥（默认；填了私钥路径即此模式） |
| `agent` | 不传 `-i`，交给 `~/.ssh/config` / ssh-agent / 默认密钥 | 密钥已在 agent、或写在 ssh config 里 |
| `password` | 强制密码认证（禁公钥），密码经 `SSH_ASKPASS` 注入 | 只允许密码登录的机器 |

**密码的存放与取用**

- 密码只存加密凭据库 `credentials.enc`（AES-256-GCM 逐条加密，与 hostsFile 同目录）；
  **不进 `hosts.json`、不进工具输出/日志/导出 JSON**（接口响应也永不回显）
- 主密钥是「自管」的 32 字节文件 `credentials.key`（0600）；可用
  `ssh-remote.config.credentialsKeyFile` 挪到任意位置（U 盘/私有目录）
- ⚠️ **丢了密钥文件 = 已存密码不可解**（重设密码即可）；密钥若与密文同目录，防护主要靠
  文件权限——在意的话请把密钥挪到别处并自行备份
- 连接时由 `askpass.sh`（0700）回调 `lib/askpass.js` 解密，把密码交给 ssh；密码不进命令行、
  不进环境变量；`ControlMaster` 让每次任务只在建连时取一次密码
- 设置页密码输入为 `type=password`，保存后立即清空、不回填

**明确不支持**：键盘交互 2FA（Google Authenticator 等）——那是逐次交互输入，无人值守通道无解；
遇到会直接认证失败（不会挂死，由 `SSH_ASKPASS_REQUIRE=force` 保证非交互）。
跳板链上的密码暂未启用（凭据按 `user@host` 存取，将来可直接支持每跳独立凭据）。

## 版本兼容（dsh 0.1.7 世代起）

插件按框架契约把宿主侧依赖声明为 `peerDependencies`，并且**范围对预发布代友好**：

| peer | 范围 | 说明 |
|------|------|------|
| `@deepseek-ai/dsh` | `>=0.1.0-rc.5 <0.2.0` | 宿主本体（`apps/cli`） |
| `@deepseek-ai/dsh-tools` | `>=0.1.0-rc.5 <0.2.0` | `defineTool` 契约 |
| `@deepseek-ai/schemastery` | `>=3.18.0 <4.0.0` | 配置 schema |

宿主在**安装时**与 **profile 加载时**都会校验这些 peer（`evaluatePluginCompatibility()`，
只检查 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`），不满足即抛出
`incompatible-version` 类型化拒绝。校验按 `includePrerelease` 语义做
`semver.satisfies`，因此 `0.1.7-rc.2` 这类预发布版本能落进 `>=0.1.0-rc.5 <0.2.0`；
写成 `^0.1.0-rc.5` 在默认 npm/pnpm 语义下反而不匹配 `0.1.7-rc.x`。

确需绕过（例如临时验证更早/更晚的宿主）时，豁免是 profile 内
`compatibility.json` 的**精确 `name@version` → 运行时版本**对，可经插件管理器 UI，
或：

```bash
dsh plugin allow-version @deepseek-ai/dsh-tools@0.1.8 --accept-risk
```

## QiLin（麒麟）双通道适配（v0.1.1 起，v0.1.2 对齐 dsh 0.1.7-rc.2）

manifest 同时声明 `qilin` 与 `dsh` 两个通道的 `bundle.patch` / `client`：
QiLin 的插件管理器只认原生键 `qilin.bundle.patch`（缺失会报「没有声明组合包」），
DSH 宿主读 `dsh.*`；两通道指向同一份 `cordis.patch.yml` 与 client 交付物，
行为完全一致。两个通道都带 `manifestVersion: 1`（新版清单版本标识）。

## 麒麟（QiLin）引擎安装

```bash
# npm registry（推荐：版本可被插件管理检测，用户手动更新）
qilin plugin --profile qilin add dsh-ssh-remote

# GitHub 直装 / install straight from GitHub
qilin plugin --profile qilin add github:kkutysllb/dsh-kylin-ssh-tunnel
```

装完在 QiLin 设置 → 插件里可见、可启停；SSH 隧道/远程执行面板需要
系统 ssh（ControlMaster；Windows 降级直连）。

### 注意事项（QiLin）

- **必须经 `qilin plugin add` 装进 profile**：包会落到 profile 私有的
  `~/.qilin/profiles/<name>/node_modules`——裸包名原生解析的第一跳。
  **不要**手工把包目录放进共享的 `~/.qilin/profiles/node_modules`：那里是
  宿主自己的安装保留区，bundle 层包放进去激活时会直接 `failed to import`。
- **引擎版本**：本仓 v0.1.2 按 QiLin 3.0.4 / dsh 0.1.7-rc.2 世代对齐；早期
  QiLin 3.0.0+/3.0.2+ 亦在 peer 范围内可用（peer 范围跨 0.1.x 全代）。
- **运行时解析**：依赖解析为运行时模式，插件运行期导入由 profile 安装图经
  进程内 generation 解析；引擎包按框架契约声明于 peerDependencies，由宿主
  安装副本统一解析。
- **数据根**（hosts.json、ControlMaster socket）按
  `QILIN_HOME → DSH_HOME → ~/.dsh` 解析（QiLin 启动器会把 DSH_HOME
  钉到麒麟家目录）。

## Agent 工具

| 工具 | 作用 |
|------|------|
| `ssh_hosts` | 列出主机（id/名称/来源/跳板）——远程任务先调它 |
| `ssh_status` | 连接池状态（master/延迟/命令数/最后错误） |
| `ssh_run` | 远程命令（bash 解释，cwd 可选，带超时）→ `{exitCode, stdout, stderr, durationMs}` |
| `ssh_read` | 读远程文件窗口（带行号，offset/limit；二进制拒绝） |
| `ssh_write` | 全量覆写（stdin→tmp→原子 mv；mkdirs 可选） |
| `ssh_edit` | 字面量替换（唯一命中或 replaceAll；**stale-edit 防冲突**） |
| `ssh_glob` | 远程 find -name（上限 200） |
| `ssh_grep` | 远程 grep -rnE -I（POSIX ERE；**-I 跳过二进制文件**；上限 250；默认排除 .git） |
| `ssh_push` / `ssh_pull` | 上传/下载（单文件 scp；目录 tar-over-ssh，recursive=true） |

## 设计要点

- **ControlMaster**：`~/.dsh/ssh-remote/cm/<id>.sock`，`ControlPersist` 默认 600s；操作前 `-O check`，失效自动重建；插件停止 `-O exit`。Windows 宿主自动降级逐次直连（功能完整，速度较慢）。
- **edit 防冲突**：读全文记 sha256 → 本地替换 → 远端「内容落 tmp → 原文件 sha 校验 → 原子 mv」，变了 exit 75 → `stale-edit`。
- **安全**：仅密钥认证（BatchMode）；`StrictHostKeyChecking=accept-new`（首连自动接受 host key，信任权衡自行评估）；HTTP API 仅回环。
- **已知限制**：
  - `ssh_run` 超时只终止本地 ssh，远端命令可能继续（可自行包 `timeout N cmd`）；
  - `ssh_grep` 为 POSIX ERE，与 ripgrep 语法有差异；
  - 编辑限 1MB 内文本；
  - `ssh_push` / `ssh_pull` 大目录（tar-over-ssh）默认 180s 超时，超大目录可通过 `timeoutMs` 参数放宽；
  - 非 22 端口主机的连接重建在下一次操作时自动完成（无操作内重试）；
  - scp 远端路径含特殊字符（空格/引号）时可能受限，复杂路径建议先 ssh_run 确认；
  - hostsFile（`~/.dsh/ssh-remote/hosts.json`）除设置页手工录入外，也支持在设置页从 `~/.ssh/config` 文本批量导入（解析 Host 块/ProxyJump，导入前可预览）；
  - HTTP API 状态码语义：404 = 路由不存在，409 = 冲突（静态主机不可删除/覆盖、id 重复、probe 目标不存在），403 = 非回环访问。

## 结构

- `lib/index.js` —— 插件入口：10 个工具注册、系统提示段（`ssh-remote`）、回环 HTTP 路由、disposer
- `lib/hosts.js` · `lib/settings-store.js` —— 主机注册表（静态+动态）与动态主机持久化
- `lib/connection.js` —— ControlMaster 连接层（`-O check` / 失效重建 / `-O exit` 拆除）
- `lib/exec.js` · `lib/fsops.js` · `lib/transfer.js` —— 命令执行 / 远程文件系统 / 双向传输
- `lib/home.js` —— 数据根解析（`QILIN_HOME → DSH_HOME → ~/.dsh`）
- `client/index.js` —— 浏览器半：会话头部状态胶囊 + 设置页「SSH 远程主机」区块
- `cordis.patch.yml` —— 组合包补丁（dsh/qilin 共用）

## 开发

```bash
npm run setup-dev   # node_modules → 引擎 profile 的符号链接（缺失 peer 仅告警）
npm run typecheck   # 8 文件 + client 语法检查
npm test            # 全量冒烟 182 断言（T2–T13，fake spawn，不碰网络）
# 真机验证（可选）：
SSH_REMOTE_HOST=1.2.3.4 SSH_REMOTE_KEY=~/.ssh/id_ed25519 npm run live
```

维护约定：

- 注册进 `webServer` 的 handler 严格是 `(req, res)` 两参（对齐 dsh 0.1.7 的 `WebRoute` 契约）；
  测试需要注入 body 时用 `apply()` 返回实例上的 `handleApi(req, res, bodyOverride)`（第三参仅测试面）。
- 工具呈现（`presentCall` / `presentResult` / `output.presentationMeta`）必须**纯函数、replay-safe、永不抛**：
  引擎只对 schema 合法的参数调用，非法参数短路为 `undefined`；函数内部仍不得依赖 `execute` 的副作用。
- 新增宿主侧 peer 依赖时，范围写成 `>=x.y.z-rc.n <next-major`，避免预发布代被 `^` 语义挡在门外。

## License

MIT
