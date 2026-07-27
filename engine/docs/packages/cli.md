# @qiongqi/cli：命令行入口

> v1.1.1。CLI 负责加载配置和启动通用引擎进程，不内置产品流程或固定模型。

## 命令

- `qiongqi serve`：启动 HTTP/SSE runtime、探针和 metrics。
- `qiongqi worker`：不启动 HTTP server，运行 durable outbox reconciler、remote Agent scheduler 或 worker shard。
- `qiongqi worker --once`：执行一次恢复/调度循环后退出，适合 job runner。
- `qiongqi worker --deployment-plan --json`：输出平台中立的 supervisor/shard 计划。

## 配置原则

- 模型使用 profile/provider 配置；凭证来自 secret injection 或 `credentialRef` resolver。
- `--api-key`、`--base-url`、`--model` 只属于 legacy serve shortcut，不是 Durable Engine 的模型选择接口。
- 生产状态存储使用 PostgreSQL adapter；本地 data dir 不等于多实例 durable store。
- 所有 worker 共享 store，但必须使用独立 workerId 和 lease/fence。

```bash
qiongqi serve --config ./config.json --port 8899
qiongqi worker --config ./config.json --pool-size auto
```
