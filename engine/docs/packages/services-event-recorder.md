# @qiongqi/services：事件记录

> v1.1.4。`RuntimeEventRecorder` 维护兼容 runtime-event 投影；v1 durable 事实事件由 `EngineStreamPublisher` 和 `DurableEngineStore` 提交。

## 边界

- RuntimeEventRecorder 负责 Zod 校验、thread seq、event bus fan-out 和 legacy event replay。
- Engine stream 负责跨进程 durable `streamId + seq`、channel policy、subscriber ack 和断线续传。
- event bus 是通知，不是事实源；listener 失败不回滚已提交 store transaction。
- checkpoint、ledger、outbox、ROI 等引擎事件必须先提交 durable store，再生成兼容投影。
