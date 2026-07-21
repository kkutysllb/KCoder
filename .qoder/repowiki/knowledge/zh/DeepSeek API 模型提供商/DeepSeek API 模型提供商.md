---
kind: external_dependency
name: DeepSeek API 模型提供商
slug: deepseek
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
---

### DeepSeek API
- **角色**：默认的 LLM 模型服务提供商，通过 QiongQi 引擎间接调用
- **默认配置**：`baseUrl: 'https://api.deepseek.com'`，`model: 'deepseek-chat'`
- **认证方式**：API Key 通过环境变量注入到 QiongQi 引擎
- **可配置性**：支持自定义 `KCODER_BASE_URL` 和 `KCODER_MODEL` 环境变量切换不同模型提供商