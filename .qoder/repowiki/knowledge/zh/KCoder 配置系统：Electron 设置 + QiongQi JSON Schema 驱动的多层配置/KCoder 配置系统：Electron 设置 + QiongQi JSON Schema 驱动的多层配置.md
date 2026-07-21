---
kind: configuration_system
name: KCoder 配置系统：Electron 设置 + QiongQi JSON Schema 驱动的多层配置
category: configuration_system
scope:
    - '**'
source_files:
    - engine/config.example.json
    - engine/packages/foundation/contracts/src/qiongqi-config.ts
    - engine/packages/http-layer/http/src/qiongqi-config-store.ts
    - engine/packages/cli-layer/cli/src/serve.ts
    - app/main/settings.ts
    - app/main/engine-host.ts
---

## 系统概览

本仓库包含两套互补的配置体系，分别服务于 Electron 桌面端与 QiongQi Agent 引擎：

- **Electron 应用设置**：基于 `electron.app.getPath('userData')` 的本地 `settings.json`，提供用户级 UI 偏好与模型连接参数。
- **QiongQi 引擎配置**：以 Zod schema 严格校验的 `config.json`（位于 `{dataDir}/config.json`），通过 CLI 命令行、环境变量与配置文件三层合并，驱动运行时行为。

两套配置在启动时由 `app/main/engine-host.ts` 桥接：Electron 侧读取 `settings.ts` 中的 `apiKey/baseUrl/model/approvalPolicy/tokenEconomyMode`，注入到 `@qiongqi/preset-coding` 的 `createCodingAgent` 调用中，从而把桌面设置传递给引擎进程。

## 关键文件与包

- `engine/config.example.json` — 完整配置模板，覆盖 `serve` / `models` / `contextCompaction` / `capabilities` 等顶层字段。
- `engine/packages/foundation/contracts/src/qiongqi-config.ts` — 唯一权威 Schema 定义与加载器：`QIONGQI_CONFIG_FILENAME = 'config.json'`、`readQiongqiConfigFile`、`expandHomePath`、`qiongqiConfigPathForDataDir`。
- `engine/packages/http-layer/http/src/qiongqi-config-store.ts` — 运行时可写配置存储（`FileQiongqiConfigStore` / `InMemoryQiongqiConfigStore`），读写均经 Zod 校验并原子落盘。
- `engine/packages/cli-layer/cli/src/serve.ts` — CLI 选项解析与优先级合并：`--config` > `QIONGQI_*` 环境变量 > config.json；内置 `resolveApiKey` / `resolveBaseUrl` 同时兼容 `DEEPSEEK_*` 旧变量名。
- `app/main/settings.ts` — Electron 用户设置持久化（`~/.config/KCoder/settings.json`）。
- `app/main/engine-host.ts` — 将 Electron 设置映射为 `EngineConfig`，动态 import `@qiongqi/preset-coding` 启动引擎。

## 架构与约定

1. **Schema-first 设计**
   - 所有配置结构由 `@qiongqi/contracts` 中的 Zod schema 描述（`QiongqiConfigSchema`、`QiongqiServeConfigSchema`、`ModelConfigSchema` 等），任何写入路径（CLI、HTTP API、文件直写）都必须先经 schema 校验。
   - 支持 `superRefine` 跨字段约束（如 `hardThreshold >= softThreshold`、ratio 与 `contextWindowTokens` 联动）。

2. **配置来源优先级**
   - CLI flag（最高）→ `QIONGQI_*` 环境变量 → `DEEPSEEK_*` 旧环境变量（向后兼容）→ `config.json` 文件 → 代码默认值。
   - 该优先级在 `resolveApiKey` / `resolveBaseUrl` 等函数中显式实现，避免隐式覆盖。

3. **配置文件位置与命名**
   - 文件名固定为 `config.json`（常量 `QIONGQI_CONFIG_FILENAME`）。
   - 默认路径为 `{dataDir}/config.json`，`dataDir` 可通过 `--data-dir` 或 `serve.dataDir` 指定；`expandHomePath` 支持 `~/` 展开。

4. **运行时热更新**
   - `FileQiongqiConfigStore.read()` 每次读取都会重新解析并校验，若磁盘上的 JSON 与内存快照不一致则自动回写规范化后的版本（如补齐 capabilities 默认值），保证磁盘与内存一致。

5. **Electron ↔ Engine 配置桥接**
   - Electron 侧不直接读 `config.json`，而是从 `settings.ts` 提取 `apiKey/baseUrl/model/approvalPolicy/tokenEconomyMode`，作为 `startEngine(config)` 的参数传入 preset，形成“桌面设置 → 引擎运行期”的单向传递。

6. **能力开关与模型档案**
   - `capabilities.*` 子块控制 MCP、Web、Skills、Subagents、Attachments、Memory 等可选能力的启用与参数。
   - `models.profiles.<id>` 为不同 provider-model 声明上下文窗口、模态、工具调用支持等元信息，供路由与压缩策略使用。

## 开发者应遵循的规则

- **新增配置字段必须先加 Zod schema**，并在 `QiongqiConfigSchema` 中注册，禁止绕过校验直接访问。
- **敏感信息（apiKey、baseUrl）** 优先通过 CLI flag 或 `QIONGQI_*` 环境变量注入，不要硬编码进 `config.json`；Electron 侧同样遵循 `process.env.KCODER_*` 优先于默认值的原则。
- **向后兼容**：如需废弃旧环境变量（如 `DEEPSEEK_API_KEY`），应在 `resolveApiKey` 等合并逻辑中保留 fallback，而非直接删除。
- **Electron 设置扩展**：在 `AppSettings` 接口与 `DEFAULT_SETTINGS` 同步添加新字段，并通过 `saveSettings` 统一持久化，避免散落 `fs.writeFileSync`。
- **配置文件示例维护**：修改 schema 后同步更新 `engine/config.example.json`，确保文档与实现一致。