# @qiongqi/preset-coding：可选编码预设

> v1.1.1。该包是对通用引擎的可选组合，不代表核心产品，也不绑定模型厂商。

## 职责

- 注册 coding 场景的工具目录、审批策略和 workspace 能力。
- 提供 prompt/skill/tool 的默认组合，供下游覆盖。
- 保持所有执行仍通过 Durable Engine ledger、checkpoint、memory scope 和 stream。

## 接入

```ts
const preset = createCodingPreset({
  modelPolicy: {
    authorizedProfileIds: ['coding-primary', 'coding-fast'],
    preferredProfileId: 'coding-primary'
  },
  toolHost,
  workspace
})
```

预设不保存 API key，不创造隐式模型 profile，不绕过任务预算和工具 effect metadata。需要领域业务逻辑的产品应在仓库外组合，而不是修改引擎核心。
