---
id: tradingview-quantitative
name: TradingView Quantitative
---
# TradingView 量化分析

Pine Script 策略开发、指标配置与回测验证。

## Pine Script 开发规范

1. 使用 v5+ 语法；`strategy()` 与 `indicator()` 职责分离。
2. **防重绘（repainting）** — 信号只依赖已收盘 K 线（`barstate.isconfirmed`），禁止用未来数据。
3. 参数全部 `input.*` 化，便于优化与复现。
4. 风险管理内置：止损/止盈/仓位参数，而非事后解释。

## 回测解读

- 关注：胜率、盈亏比、最大回撤、交易次数（样本量）。
- 警惕过拟合：参数微调后绩效剧烈变化 = 不可靠。
- 区分训练区间与验证区间。

## 边界

- 本技能只做技术实现与回测分析，**不构成投资建议**。
