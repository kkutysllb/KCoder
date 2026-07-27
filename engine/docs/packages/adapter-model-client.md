# @qiongqi/adapter-model：模型 provider 适配

> v1.1.1。核心路径通过 `ModelProfileRegistry` 和 `ModelProvider` 解耦模型；本包不规定默认厂商或默认 model id。

## 支持面

- `chat_completions`：OpenAI-compatible 请求/流式格式。
- `responses`：Responses 风格事件流。
- `messages`：Anthropic-compatible messages/stream 格式。
- 统一输出文本 delta、tool call、usage、finish reason 和 provider error。
- profile 的 `providerId`、`modelId`、endpoint format、capability 和 `credentialRef` 独立版本化。

## 接入流程

1. 下游实现或实例化一个 `ModelProvider`。
2. 将 provider 和 `ModelProfile` 注册到 `ModelProfileRegistry`。
3. 任务只提交授权 profile 列表和首选/候选策略。
4. graph node 可通过版本化 `modelPolicyRef` 进一步收窄策略。
5. registry 做 strict/degrade capability negotiation，并返回 immutable profile revision。

```ts
registry.register(profile, provider)
const route = registry.resolve({
  authorizedProfileIds: ['primary', 'fast'],
  preferredProfileId: 'primary',
  candidateProfileIds: ['primary', 'fast'],
  capabilityMode: 'strict'
}, { streaming: true, toolCalling: true })
```

## 不变量

- 不从 host、模型名称或环境变量猜测核心任务路由。
- API key 不进入 profile、checkpoint、ledger 或 stream payload；只保存 `credentialRef`。
- 任务切换 profile 必须增加 policy revision；已开始的 operation 保持原 profile revision。
- provider 返回后、ledger commit 前发生失败时进入 `uncertain`，不能自动重发。
- private reasoning 只有四项 reasoning policy 明确允许时才可采集和发布。

旧兼容 client/定价 helper 只服务遗留调用方，不是 Durable Engine facade 的默认路径。
