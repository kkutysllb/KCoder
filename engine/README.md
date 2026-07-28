# Qiongqi Durable Engine

Qiongqi 是纯引擎代码，不包含产品页面、业务流程或厂商策略。当前版本是 **v1.1.4**：模型诊断不再误报合法的 assistant tool-call-only 消息，stderr 只输出结构元数据，不记录 system/user 内容、reasoning、工具参数或工具结果；v1.1.3 的 governed graph、权威恢复与 Kernel 真流式能力保持不变。

- 中文文档：[README.zh.md](./README.zh.md)
- English documentation：[README.en.md](./README.en.md)
- 架构：[docs/architecture.zh.md](./docs/architecture.zh.md)
- 部署：[docs/deployment.zh.md](./docs/deployment.zh.md)
- v1.1 迁移：[docs/migrations/engine-v1.1.md](./docs/migrations/engine-v1.1.md)
- v1.1.4 发布说明：[docs/releases/v1.1.4.md](./docs/releases/v1.1.4.md)
- 逐包文档：[docs/packages/README.md](./docs/packages/README.md)

本文件只保留项目入口，详细内容以双语 README 和技术文档为准。
