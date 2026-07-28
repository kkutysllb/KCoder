# @qiongqi/services：Usage、cost 与 ROI 投影

> v1.1.4。`UsageService` 提供 thread/task 查询；durable cost/value 与 graph ROI 由 `EngineValueLedger` 聚合。

## 计量面

- provider actual usage：tokens、cache、cost 和 immutable profile ref；
- graph attribution：graph revision/run，可选 node/edge/attempt；
- business value：amount、currency、confidence 和 durable evidence refs；
- engine efficiency：logical/physical/replayed/suppressed attempt 与 avoided waste；
- graph snapshot：`byNode`、`byEdge`、fan-out、retry amplification、suppressed attempts、avoided cost、critical path。

`recordCost()` 和 `recordValue()` 原子追加 ledger，随后返回并发布 `roi.snapshot`。只有成本与价值币种一致且已有正成本时才计算 ratio；缺少业务 evidence 时状态为 `incomplete`，币种冲突或成本不可计算时为 `unavailable`。

外部等待时间不计入执行 critical path。服务层不得根据 token、suppression 或 artifact 数量伪造业务收益。
