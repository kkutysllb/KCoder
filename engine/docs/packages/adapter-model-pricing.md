# @qiongqi/adapter-model：PricingProvider

> v1.1.1。定价是可插拔 provider 能力，不是模型路由规则。

`PricingProvider` 根据 provider/model、token usage、cache usage 和时间等输入返回 `CostEntry` 所需金额；`CompositePricingProvider` 按注册顺序查询多个实现。未知价格返回 `null`，上层将 ROI 标记为 `unavailable` 或 `incomplete`，不能填入猜测价格。

## 不变量

- 定价 provider 与模型 provider 可独立替换。
- 价格表不是模型授权或默认选择依据。
- 成本币种必须显式；不同币种不自动换算。
- provider 特有的内置价格表属于可选 compatibility adapter，下游可替换或覆盖。
- 业务价值由 `ValueEvent` 提供，PricingProvider 只产生成本，不计算业务收益。

```ts
const pricing = new CompositePricingProvider([
  productPricingProvider,
  fallbackCatalogProvider
])
```
