# @qiongqi/loop：Prompt、上下文和长任务状态

> v1.1.4。prompt 构建和压缩服从 TaskCheckpoint，不以自然语言摘要替代结构化任务事实。

v1.1 的 prompt identity 同时包含 pinned graph revision/digest、node/edge/attempt correlation 和 task model policy revision；恢复后不能因 graph 或模型策略变化复用旧请求。

## 组成

- `PromptBuilder`：按稳定前缀、当前任务状态、模型 capability 和工具目录构建请求。
- `ContextCompactor`：在模型 profile 的 soft/hard threshold 下生成压缩计划。
- `ContextCheckpointService`：写入带 provenance、source refs 和 context identity 的 durable checkpoint。
- `TaskProgressProjector`：从 task state、todo、证据和等待状态生成可读进度投影。
- `model-context-profile`：按 profileId/modelId 解析窗口和压缩阈值，不预设厂商。

## Context identity

身份至少包含 task scope、checkpoint revision、model profile revision、工具目录 fingerprint、memory revision 和策略 revision。只有身份未变化的请求才可能命中 replay/suppression；新增证据或策略变更会产生新身份。

## 压缩不变量

- 先持久化 `TaskCheckpoint`，再生成摘要。
- goal、硬约束、提交决策、失败策略、下一步、预算和 durable refs 不能只存在摘要文本中。
- hard threshold 触发时允许丢弃可重建对话，但不能丢弃结构化状态。
- checkpoint 来源不完整或校验失败时停止恢复，不回退成“新任务”。
- private Agent memory 不进入共享 prompt，除非已经显式 publish。

配置示例：

```json
{
  "contextCompaction": {
    "defaultSoftThreshold": 64000,
    "defaultHardThreshold": 96000,
    "summaryMode": "model"
  }
}
```
