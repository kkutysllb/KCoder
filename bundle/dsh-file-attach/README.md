# @kkutysllb/dsh-file-attach

> **文件/文件夹附件**——浏览器选文件 + server 定位链（文件名 → cwd 下搜索还原真实绝对路径）+ 发送时注入 `[附件]name|path` 路径行，agent 按路径 read/bash 访问；消息气泡把附件行渲染为卡片。**图片完全走原生**：粘贴/拖拽/发送的图片链路零参与。

自 KCoder 内置插件线独立发布的 dsh 插件（原创实现，v1.0.0 起独立版本线）。

## 安装

```bash
dsh plugin install @kkutysllb/dsh-file-attach
```

## 为什么是路径引用

上游引擎附件包（`@deepseek-ai/dsh-attachment`）目前只接受光栅格式（PNG/JPEG/WebP/GIF），通用文件暂不支持。不改引擎的前提下，文件附件的唯一通道是**路径引用**：把真实绝对路径以 `[附件]name|path` 行注入 prompt，agent 用 read/bash 工具按路径访问。本插件因此不碰上传接口，也永不处理图片。

## 使用

- **📎 按钮**：输入栏左侧；点击选文件（可多选），Alt+点击选文件夹。
- **拖拽**：把非图片文件/文件夹拖进页面即入队（纯图片拖拽不拦截；混合载荷只收文件部分）。
- **定位链**：选中的文件按当前会话工作区（cwd）搜索还原真实路径——唯一命中直接入队；多候选在 chip 上点选；未命中标红（可手动移除或换会话目录重试）。
- **发送**：已定位的附件以 `[附件]name|path`（文件夹为 `[附件·目录]name|path`）行随消息发出；气泡里渲染为附件卡片（原始路径不直接展示）。

## 形态

- 纯产物直提包：`entry.js`（cordis 层挂载，server 定位 RPC）+ `client.js`（`window.__ModuleLoader__.load({id})` 注册，经 `/plugins` combo 路由拼接执行）+ `cordis.patch.yml`（bundle 层声明）。
- server RPC：`POST /dsh-file-attach/api/locate`——`execFile` 跑 `find`（POSIX）/`Get-ChildItem`（win32）在 cwd 下按文件名搜索，深度上限、忽略 `node_modules`/`.git`、候选上限、超时兜底。
- 安全边界：isTrusted（loopback + webRuntime.trustedHosts）+ POST-only + JSON body + 无 shell 拼接 + 参数校验（文件名拒路径分隔符与 `..`）。

## 边界与风险

- 上游 UI 锚点（composer 卡片容器、输入栏 slot、`sendSession` 签名）变更会使对应功能静默失效——client 插件共性风险。
- 定位链在纯浏览器远程部署同样可用（server 跑在引擎侧）；但「按路径读取本地文件」的语义仅对 **agent 与浏览器同机**（本机部署）成立——远程浏览器选的文件不在引擎机器上，定位会失败或给出引擎侧同路径文件，属预期限制。
- 目录 attachment 展开由 agent 侧完成（读目录列文件），大目录建议改用具体文件。

## 开发

- 本仓为开发真源；改动后跑 `node scripts/sync-to-dsh-plugins.mjs` 同步 dsh-plugins 镜像并提交推送。
- `pnpm test`（node 直跑纯逻辑单测：候选排序/参数校验/markup 解析）；`pnpm smoke`（prepack 自动）做契约形态校验。
- 分发链：本仓 → dsh-plugins 镜像 → KCoder `bundle/`（`scripts/sync-bundles.mjs` 单向同步，禁止反向手改）。

## 许可

MIT © dsh-external
