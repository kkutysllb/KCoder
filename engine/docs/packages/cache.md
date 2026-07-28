# @qiongqi/cache

> v1.1.4。cache 只能优化读取和请求前缀，不能代替 ledger、checkpoint 或 durable store。

> Cache 基础设施：不可变 prompt 前缀、LRU/TTL 缓存、工具目录指纹、遥测、用量计数。
> Layer 3 — 依赖：`@qiongqi/contracts`、`@qiongqi/ports`。被 `@qiongqi/loop` 与 `@qiongqi/services` 消费。

---

## 中文

### 1. 职责

`@qiongqi/cache` 提供缓存层的纯函数与小型类，**不依赖任何 `@qiongqi/*` 包以外的内容**（除 Node `crypto`）。其核心使命是支撑 Qiongqi 的 **Cache-First** 运营目标：

- **`ImmutablePrefix`** — 把"每次必须 byte-stable"的那部分 prompt（系统提示词 + 工具 schema + pinned 约束 + few-shots）封装为带 SHA-256 指纹 + 修订号的值对象；mutation 全部走不可变更新，让上层（`PromptBuilder`）能安全地把 prefix 单独发给模型以命中 prompt cache。
- **`buildToolCatalogFingerprint`** — 工具目录指纹，让 `PromptBuilder` 能在 step 内检测 catalog 漂移；破坏性漂移会停止该 turn 以保护 cache。
- **`LruCache` / `TtlLruCache`** — 通用 LRU / TTL 双策略缓存。
- **`CacheTelemetry` / `UsageCounter`** — 跨线程的 cache 与 token 用量累加器，是 `/v1/usage` 与 GUI "cache hit rate" 徽章的数据源。
- **`detectVolatilePrefixContent`** — 检测 prefix 里的不稳定 token（UUID、ISO 8601、hex 哈希、JWT），帮助开发者发现"动态内容泄露到 immutable prefix"的隐患。

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `ImmutablePrefix` | type | `immutable-prefix.ts` | 不可变 prompt 前缀值对象（含 fingerprint + revision）|
| `createImmutablePrefix` | function | `immutable-prefix.ts` | 工厂；初始 revision=1；工具数组按 name 排序后 canonicalize 哈希 |
| `setSystemPrompt` / `setTools` / `setPinnedConstraints` / `setFewShots` | function | `immutable-prefix.ts` | 纯 mutator；返回新 prefix，revision+1，重新计算 fingerprint |
| `verifyImmutablePrefix` | function | `immutable-prefix.ts` | 重新计算 fingerprint；不匹配则抛错；dev 模式默认开启 |
| `shouldVerifyImmutablePrefix` | function | `immutable-prefix.ts` | 谓词：`NODE_ENV !== 'production'` 或 `QIONGQI_VERIFY_IMMUTABLE_PREFIX=1` |
| `describeFingerprintDrift` | function | `immutable-prefix.ts` | 返回 `{ drift, changedFields }` — 哪些字段变化 |
| `LruCache<K, V>` | class | `lru-cache.ts` | 有界 LRU；`limit <= 0` 抛错；`get` 命中即 promote-to-MRU |
| `TtlLruCache<K, V>` | class | `ttl-lru-cache.ts` | 组合 LRU + TTL；过期视为 miss；可注入 `now()` 用于测试 |
| `TtlLruCache.sweep` | method | `ttl-lru-cache.ts` | 一次性清除所有过期项，返回清除数 |
| `PrefixVolatilityKind` | type | `prefix-volatility.ts` | `'uuid' \| 'iso8601' \| 'hex_hash' \| 'jwt'` |
| `PrefixVolatilityFinding` | type | `prefix-volatility.ts` | 单条发现：`{ field, kind, token, itemId? }` |
| `detectVolatilePrefixContent` | function | `prefix-volatility.ts` | 结构化（无 regex）扫描 prefix 文本，返回所有 finding |
| `ToolCatalogFingerprint` | type | `tool-catalog-fingerprint.ts` | `{ fingerprint, toolCount, toolNames, toolHashes }` |
| `buildToolCatalogFingerprint` | function | `tool-catalog-fingerprint.ts` | 对工具数组排序 + canonicalize + SHA-256 哈希 |
| `CacheTelemetry` | class | `cache-telemetry.ts` | per-thread hit/miss/write/invalidation 累加器 |
| `CacheTelemetry.ingest` | method | `cache-telemetry.ts` | 从 `UsageSnapshot` 提取 cacheHit/cacheMiss/cached 并累计 |
| `CacheTelemetry.snapshot` | method | `cache-telemetry.ts` | per-thread 快照（含 `hitRate`，未知时为 `null`）|
| `UsageCounter` | class | `usage-counter.ts` | per-thread token / cache / cost 累加器；`recordTokenEconomySavings` 单独记录 token economy 节省 |

### 3. 关键不变量

- **不可变 mutator**：所有 `setXxx(prefix, value)` 函数都返回**新** `ImmutablePrefix` 对象，原对象不变。源代码注释："Each mutator invalidates the fingerprint and the next read recomputes it."（`immutable-prefix.ts:5-8`）
- **Tool schema canonicalize**：`normalizeTools` 把所有 `inputSchema` 递归按 key 排序后哈希，消除字段顺序噪声（`immutable-prefix.ts:37-52`）。
- **Few-shot id 排除**：`fewShotCacheShape` 显式忽略 `id`、`createdAt` 等"不发给模型"的字段，避免这些字段的不稳定性影响 fingerprint。
- **Dev 模式默认开启 prefix 验证**：`shouldVerifyImmutablePrefix` 在 `NODE_ENV !== 'production'` 时返回 `true`；生产环境默认关闭（避免每次请求都重哈希），可通过 `QIONGQI_VERIFY_IMMUTABLE_PREFIX=1` 显式启用。
- **LruCache 不抛 miss 错**：`get` 返回 `undefined` 而非抛错；只接受 `limit > 0`（`lru-cache.ts:14-18`）。
- **TtlLruCache 过期即 miss**：`get` 命中后若 `expiresAt <= now()` 立即删除并返回 `undefined`；`has` 走相同路径（`ttl-lru-cache.ts:34-42`）。
- **Volatility 检测无 regex**：源码注释明确："Intentionally no regex: UUIDs, dashless UUIDs, MD5/SHA hashes, ISO dates, and JWT-looking strings have overlapping shapes. Keep this as structured token parsing so false positives are easier to debug."（`prefix-volatility.ts:17-23`）
- **UsageCounter 永不抛**：未提供字段回退为零；`cacheHitRate` 在无 cache 遥测时**保留为 `null`**（明确"未知"而非猜测为零）——源代码注释："The counter never throws; missing values fall back to zero/empty."（`usage-counter.ts:4-8`）
- **Cost 字段 undefined 保持 undefined**：`addUsage` / `record` 不会把 `undefined` 的 cost 字段当成 0；只有当 current 与 delta 至少有一方有值时才求和（`usage-counter.ts:48-73, 173-201`）。

### 4. 行为规约

来自 `tests/cache.test.ts` 的 `it()` 行为描述（按子模块分组）：

#### ImmutablePrefix

- `produces a stable fingerprint when the prefix does not change` — 重复 `createImmutablePrefix` + 相同输入应得到完全相同的 `fingerprint`
- `drifts the fingerprint when the system prompt changes` / `drifts the fingerprint when tools change` / `drifts the fingerprint when pinned constraints change` / `drifts the fingerprint when few-shots change` — 任一字段变化都使 fingerprint 不同
- `canonicalizes tool schemas so ordering noise does not perturb the prefix` — `inputSchema` 字段顺序不影响 fingerprint
- `ignores volatile few-shot ids that are not sent to the model` — 调换 few-shot 的 `id` / `createdAt` 不影响 fingerprint（这些字段不参与哈希）
- `throws when the prefix is mutated without an explicit mutator` — 任何绕过 `setXxx` 的对象变更（如 `prefix.systemPrompt = 'x'`）配合 `verifyImmutablePrefix` 会抛错
- `does not create an intermediate invalid fingerprint during mutate` — `mutate` 一次性返回新对象，无中间态泄露
- `verifies immutable prefixes by default outside production` — `verifyImmutablePrefix` 在 dev 模式抛错，生产环境不抛
- `detects volatile cache-prefix tokens with structured parsers` — `detectVolatilePrefixContent` 命中 `uuid` / `iso8601` / `hex_hash` / `jwt` 任意一种都返回 finding
- `does not mistake dashless UUID-shaped hashes for canonical UUIDs` — 32 位 hex 哈希（无连字符）不会被误判为 UUID

#### ToolCatalogFingerprint

- `stays stable across tool order and schema key order noise` — 工具数组顺序 + `inputSchema` 字段顺序都不影响 fingerprint
- `changes when a model-bound tool description changes` — `description` 变化 → fingerprint 变化

#### LruCache

- `promotes entries on get and evicts in LRU order` — `get` 命中即 promote 到 MRU；满时驱逐最久未用
- `returns the evicted entry from set` — `set` 返回被驱逐的 value
- `clears and deletes entries` — `clear` / `delete` 工作
- `rejects an invalid limit` — `limit <= 0` 抛错

#### TtlLruCache

- `expires entries after the ttl window` — TTL 过期后 `get` 返回 `undefined`
- `sweeps expired entries` — `sweep()` 一次性清除所有过期项

### 5. 使用示例

```typescript
import {
  createImmutablePrefix,
  setTools,
  verifyImmutablePrefix,
  buildToolCatalogFingerprint,
  CacheTelemetry,
} from '@qiongqi/cache'

// 1. 创建不可变 prefix
const prefix = createImmutablePrefix({
  systemPrompt: 'You are a coding assistant.',
  tools: [
    { name: 'read', description: '...', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'bash', description: '...', inputSchema: { type: 'object', properties: { command: { type: 'string' } } } },
  ],
  pinnedConstraints: ['system: preserve user intent across compaction'],
})

// 2. mutator 返回新对象
const next = setTools(prefix, [...prefix.tools, { name: 'grep', description: '...', inputSchema: {} }])
console.log(next.revision) // 2
console.log(prefix.revision) // 1（原对象未变）

// 3. 工具目录指纹
const fingerprint = buildToolCatalogFingerprint(next.tools)
console.log(fingerprint.toolCount, fingerprint.fingerprint)

// 4. 验证 prefix 未被外部修改
verifyImmutablePrefix(next) // dev 模式抛错如果 next.tools 字段被外部直接篡改

// 5. Cache telemetry
const telemetry = new CacheTelemetry()
telemetry.recordHit('thread_1', 1500)
telemetry.recordMiss('thread_1', 200)
console.log(telemetry.snapshot('thread_1').hitRate) // 0.882...
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#4-关键架构决策`](../architecture.zh.md#4-关键架构决策)（§4.6 Cache-First 三层契约）
- 消费方：`@qiongqi/loop` 的 `PromptBuilder` 用 `ImmutablePrefix` + `buildToolCatalogFingerprint`；`@qiongqi/services` 的 `UsageService` 用 `CacheTelemetry` + `UsageCounter`
- 源文件：[`immutable-prefix.ts`](../../packages/infrastructure/cache/src/immutable-prefix.ts)、[`tool-catalog-fingerprint.ts`](../../packages/infrastructure/cache/src/tool-catalog-fingerprint.ts)、[`prefix-volatility.ts`](../../packages/infrastructure/cache/src/prefix-volatility.ts)、[`cache-telemetry.ts`](../../packages/infrastructure/cache/src/cache-telemetry.ts)、[`usage-counter.ts`](../../packages/infrastructure/cache/src/usage-counter.ts)
- 测试：[`../../tests/cache.test.ts`](../../tests/cache.test.ts)（20 个用例）

---
