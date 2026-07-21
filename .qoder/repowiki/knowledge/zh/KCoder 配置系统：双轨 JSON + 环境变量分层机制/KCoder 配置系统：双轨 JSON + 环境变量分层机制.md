---
kind: configuration_system
name: KCoder 配置系统：双轨 JSON + 环境变量分层机制
category: configuration_system
scope:
    - '**'
source_files:
    - engine/packages/foundation/contracts/src/qiongqi-config.ts
    - engine/packages/http-layer/http/src/qiongqi-config-store.ts
    - engine/config.example.json
    - app/main/settings.ts
    - app/main/engine-host.ts
---

## 配置系统概览

KCoder 采用**双轨配置架构**，将应用级用户设置与 QiongQi 引擎运行时配置分离管理，通过 Electron main 进程启动时合并加载。

### 1. 引擎运行时配置（QiongQi Engine）

**核心文件：**
- `engine/packages/foundation/contracts/src/qiongqi-config.ts` — Zod Schema 定义与配置文件读取逻辑
- `engine/packages/http-layer/http/src/qiongqi-config-store.ts` — 持久化配置存储实现
- `engine/config.example.json` — 完整配置示例模板

**配置来源优先级：**
1. **命令行参数** (`--config <path>`)
2. **dataDir 下的 config.json**（默认 `~/.qiongqi/data/config.json`）
3. **内存初始配置**（由 Electron main 进程注入）
4. **环境变量**（`KCODER_API_KEY`、`KCODER_BASE_URL`、`KCODER_MODEL` 等）
5. **硬编码默认值**

**关键特性：**
- 使用 Zod 进行严格的 JSON Schema 验证，所有字段类型安全
- 支持 `~` 路径展开和跨平台路径处理
- 原子写入保证配置更新的安全性
- 内置能力（capabilities）自动规范化后写回磁盘
- 支持热重载：运行时可读写配置并持久化

**配置结构层次：**
```json
{
  "serve": { /* HTTP 服务、模型、沙箱模式 */ },
  "models": { /* 模型 profile 定义 */ },
  "contextCompaction": { /* 上下文压缩策略 */ },
  "runtime": { /* 运行时调优参数 */ },
  "capabilities": { /* MCP/Web/Skills 等功能开关 */ }
}
```

### 2. 应用级用户设置（Electron App Settings）

**核心文件：**
- `app/main/settings.ts` — 用户偏好设置管理
- 存储位置：`~/.kcoder/settings.json`

**管理功能：**
- 模型 API 密钥、基础 URL、模型名称
- 审批策略（auto/on-request/always）
- Token 经济模式开关
- UI 主题、字体大小等界面偏好
- 默认工作区路径

**设计特点：**
- 简单的 JSON 文件存储，无外部依赖
- 缓存机制避免重复 I/O
- 增量保存（merge 而非覆盖）
- 自动创建目录结构

### 3. 环境变量覆盖层

**关键环境变量：**
- `KCODER_API_KEY` / `DEEPSEEK_API_KEY` — API 密钥
- `KCODER_BASE_URL` — 模型服务基础 URL
- `KCODER_MODEL` — 默认模型名称
- `CORS_ORIGINS` — CORS 白名单（开发环境自动设为 `*`）
- `ELECTRON_RENDERER_URL` — 渲染进程开发地址
- `NODE_ENV` — 运行环境标识

**加载时机：**
- Electron main 进程启动时从环境变量读取
- 优先于配置文件中的对应字段
- 为 CI/CD 和容器化部署提供便利

### 4. 配置生命周期

**启动流程：**
1. Electron main 进程读取环境变量构建默认配置
2. 尝试加载 `~/.kcoder/engine-data/config.json`（如果存在）
3. 合并配置并启动 QiongQi HTTP 服务器
4. 渲染进程通过 preload 脚本访问 engine API

**运行时更新：**
- 用户通过 Settings Panel 修改设置
- 调用 `saveSettings()` 持久化到 `~/.kcoder/settings.json`
- 引擎配置可通过 HTTP API 动态更新并持久化

### 开发者规范

1. **新增配置项**：在 `qiongqi-config.ts` 中扩展 Zod Schema，保持向后兼容
2. **敏感信息**：优先使用环境变量，避免硬编码到配置文件
3. **路径处理**：始终使用 `expandHomePath()` 处理用户路径
4. **配置验证**：所有配置必须通过 Zod Schema 验证后才能使用
5. **默认值**：为新配置项提供合理的默认值，确保渐进式升级
6. **测试覆盖**：为新配置路径添加单元测试，特别是边界条件