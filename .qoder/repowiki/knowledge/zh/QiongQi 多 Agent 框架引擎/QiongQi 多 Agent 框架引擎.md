---
kind: external_dependency
name: QiongQi 多 Agent 框架引擎
slug: qiongqi
category: external_dependency
category_hints:
    - vendor_identity
    - framework_behavior
scope:
    - '**'
---

### QiongQi（穷奇）
- **角色**：KCoder 的核心 AI Agent 引擎，提供多 Agent 编排、工具执行、文件操作等能力
- **集成方式**：通过 `@qiongqi/preset-coding` preset 在 Electron Main Process 内嵌启动 HTTP/SSE 服务
- **关键配置**：`sandboxMode: 'workspace-write'`（非 `'workspace'`）、`approvalPolicy`、`tokenEconomyMode`
- **通信协议**：HTTP REST + SSE 事件流，端口随机分配（18899+），使用 Bearer Token 认证
- **存储策略**：默认 JSONL 文件存储，可选 better-sqlite3 原生模块（NODE_MODULE_VERSION 不匹配时自动降级）
- **环境变量**：`KCODER_API_KEY`/`DEEPSEEK_API_KEY`、`KCODER_BASE_URL`、`KCODER_MODEL`
- **验证端点**：`/health`、`/ready`、`/v1/runtime/metrics`