# @qiongqi/tool-infra

> v1.1.4。该包提供本地工具治理；跨进程幂等、恢复和 effect 状态由 DurableEngineStore 负责。

> 工具执行通用基础设施 —— mutation queue、output accumulator、rate limit parser、result budget、command audit。
> Layer 4 — 依赖：`@qiongqi/adapter-fs`。被 `@qiongqi/services` 与 `@qiongqi/adapter-tools` 消费。

---

## 中文

### 1. 职责

`@qiongqi/tool-infra` 提供工具执行时的**横切关注点**基础设施。这些是任何 tool host 都会需要的能力，但又不属于具体工具逻辑：

- **跨进程文件锁 + 进程内 mutation queue**（`withFileMutationQueue`）—— 多进程安全的串行化文件写入
- **Output accumulator**（`OutputAccumulator`）—— bash / 长输出工具的 UTF-8 / UTF-16LE 自动检测 + tail 截断 + 可选临时文件落盘
- **Rate limit 解析**（`parseRateLimitedToolResult` / `normalizeRateLimitedToolOutput`）—— 把工具输出里的限流信息提取为结构化信号
- **Tool result budget**（`applyToolResultBudget`）—— 超大工具结果落盘到 outputs，并把模型可见内容替换为 head/tail 预览
- **Command audit**（`auditShellCommand` / `maskCommandSecrets` / `stripHeredocBodies`）—— bash 执行前分类 block/warn/allow，并在日志/错误中脱敏 secrets

阶段 1.8 与 `@qiongqi/adapter-fs` 一起从 `adapter-tools` 拆出。

### 2. 公共 API

#### FileMutationQueue

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `withFileMutationQueue<T>(filePath, fn)` | function (async) | `file-mutation-queue.ts` | 给定文件路径的 mutation 串行化队列；进程内 promise chain + 跨进程文件锁（`os.tmpdir()/kun-file-mutation-locks/<sha256>.lock`）|

**锁机制要点**（`file-mutation-queue.ts`）：

- 进程内：`fileMutationQueues: Map<string, Promise<void>>` —— 同一文件路径的 mutation 串行执行
- 跨进程：`mkdir(lockPath)` 抢占（mkdir 的原子性）；写 `owner.json` 记录 `{ pid, createdAtMs, key }`
- 锁等待：`LOCK_POLL_MS=25ms` 轮询；`LOCK_WAIT_TIMEOUT_MS=60_000ms` 超时
- 死锁恢复：`isProcessAlive(pid)` 检查 owner 是否存活；`OWNERLESS_LOCK_STALE_MS=10分钟` 兜底

#### OutputAccumulator

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `OutputAccumulatorSnapshot` | type | `output-accumulator.ts` | `{ content, truncation, fullOutputPath? }` |
| `OutputAccumulatorOptions` | type | `output-accumulator.ts` | `{ maxLines, maxBytes, tempFilePrefix }` |
| `OutputAccumulator` | class | `output-accumulator.ts` | 增量追加 buffer，UTF-8/UTF-16LE 自动识别（基于 BOM + Han 字符密度 + replacement/control/privateUse 字符比例）|

**关键方法**（`output-accumulator.ts`）：

- `append(data: Buffer)` —— 增量；超过 `maxBytes` 自动开临时文件
- `finish()` —— 终止并 flush decoder
- `snapshot({ persistIfTruncated? })` —— 取当前 tail（`truncateTail`）+ 元数据；可选择把完整内容落盘到临时文件
- `closeTempFile()` —— 关闭并 flush 临时文件流
- `getLastLineBytes()` —— 当前未完成行字节数

#### ToolRateLimit

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `ParsedRateLimit` | type | `tool-rate-limit.ts` | `{ rateLimited, message, retryAfterSeconds? }` |
| `parseRateLimitedToolResult(output: unknown)` | function | `tool-rate-limit.ts` | 从工具 output 中提取限流信号（regex 匹配 `rate[- ]?limit` / `too many requests` / `quota exceeded` / `429` 等）|
| `normalizeRateLimitedToolOutput(output: unknown)` | function | `tool-rate-limit.ts` | 若匹配则包装为 `{ code: 'rate_limited', rate_limited: true, error, retry_after_seconds?, original }` 并标记 `isError: true` |
| `applyToolResultBudget(input)` | function | `tool-result-budget.ts` | byte-budget 检查；超限时写入 `outputDir` 并返回模型可见预览 |
| `auditShellCommand(command)` | function | `command-audit.ts` | shell 命令风险分类：`allow` / `warn` / `block` |
| `maskCommandSecrets(command)` | function | `command-audit.ts` | 脱敏 API key、token、password、Bearer token 等常见 secret |
| `stripHeredocBodies(command)` | function | `command-audit.ts` | 用占位符替换 heredoc body，避免长脚本/secret 污染审计 |

### 3. 关键不变量

- **跨进程锁的原子性来自 `mkdir`**：源码注释 "EEXIST" 检查配合 `isExistingPathError` 实现乐观锁；`mkdir` 在 POSIX 文件系统上是原子的（`file-mutation-queue.ts:29-37, 99-131`）。
- **owner 死锁检测用 `process.kill(pid, 0)`**：返回 `EPERM` 也算存活（其他用户进程可能属于同一用户）；返回 `ESRCH` 视为已死（`file-mutation-queue.ts:38-50`）。
- **进程内队列的注册阶段也串行化**：`registrationQueue` 链式 promise 防止 race condition（`file-mutation-queue.ts:6-7, 145-167`）。
- **`OutputAccumulator` 在 `append` 时检测 encoding**：前 32 字节或 `final=true` 时强制确定 encoding；超过 `maxBytes` 自动开 temp file（`output-accumulator.ts:113-118, 296-302`）。
- **UTF-16LE 启发式**：基于 (1) BOM、(2) Han 字符密度 ≥60%、(3) UTF-8 视图出现 replacement 字符 —— 防止把含汉字的 UTF-8 误判为 UTF-16LE（`output-accumulator.ts:99-111`）。
- **`maxRollingBytes = max(maxBytes * 2, 1)`**：内部 tail 缓冲最多保留 2x maxBytes，超出时 trim 到 UTF-8 字符边界（`output-accumulator.ts:152, 269-282`）。
- **Rate limit regex 容错**：`\b` 词边界 + 不区分大小写 + 多种别名（`rate limit` / `rate-limit` / `ratelimited` / `too many requests` / `quota exceeded` / `429`）（`tool-rate-limit.ts:7-8`）。
- **Retry-After 单位转换**：ms / s / sec / seconds / m / min / minutes —— 都正确转换为秒（向上取整）（`tool-rate-limit.ts:9-10, 60-69`）。
- **`compactRateLimitMessage` 上限 360 字符**：超长消息截断并加 `...`，避免模型上下文被巨型错误消息污染（`tool-rate-limit.ts:71-75`）。
- **Tool result budget 不丢完整结果**：小输出保持 inline；超限输出写入 `outputDir`，返回包含 `persistedPath`、`originalBytes`、`omittedBytes` 的结构化结果和 head/tail 预览。
- **Command audit fail-closed**：危险命令在 `bash` spawn 前被拦截；warn 命令继续执行但 payload 带 `audit` 元数据；错误和 audit payload 使用 masked command。

### 4. 行为规约

来自 `tests/file-mutation-queue.test.ts` / `tests/output-accumulator.test.ts`：

#### FileMutationQueue

- `serializes concurrent mutations to the same file within a single process`
- `serializes mutations across processes via the tmpdir lock directory`
- `cleans up the lock directory on completion (rm -rf)`
- `recovers from a dead owner by removing the stale lock and retrying`
- `times out after LOCK_WAIT_TIMEOUT_MS if the lock cannot be acquired`
- `uses realpath when the target file exists, falls back to resolve for missing files`

#### OutputAccumulator

- `accumulates output chunks into a tail buffer that respects maxBytes and maxLines`
- `detects UTF-16LE via BOM, odd-byte null density, or Han-character density`
- `does not misclassify Han-heavy UTF-8 as UTF-16LE (requires replacement/control/privateUse signals)`
- `opens a temp file when the accumulated output exceeds maxBytes`
- `replays raw chunks to the temp file when ensureTempFile is called later`
- `snapshot.persistIfTruncated writes the full output to disk before returning the truncated tail`
- `getLastLineBytes reports the in-progress line size for partial-line tracking`

#### ToolRateLimit

- `parseRateLimitedToolResult returns null when no rate-limit keyword is found`
- `parseRateLimitedToolResult extracts retryAfterSeconds from "retry after", "try again in", "wait" patterns`
- `parseRateLimitedToolResult converts ms/s/min units to seconds (ceiling)`
- `normalizeRateLimitedToolOutput preserves the original output under "original" key`
- `compactRateLimitMessage truncates to 360 chars and adds ellipsis`

#### ToolResultBudget / CommandAudit

- `applyToolResultBudget keeps small text inline`
- `applyToolResultBudget externalizes oversized text and keeps a head/tail preview`
- `LocalToolHost applies outputBudget to oversized string outputs`
- `auditShellCommand blocks destructive delete, pipe-to-shell, base64 decode pipe execution, and fork bombs`
- `auditShellCommand warns on /dev/tcp, environment dumps, broad process signals, and recursive permission changes`
- `maskCommandSecrets redacts secret assignments and bearer tokens`
- `stripHeredocBodies removes heredoc bodies before length-sensitive classification`

### 5. 使用示例

```typescript
import { withFileMutationQueue } from '@qiongqi/tool-infra'
import { OutputAccumulator } from '@qiongqi/tool-infra'
import { parseRateLimitedToolResult } from '@qiongqi/tool-infra'
import { spawn } from 'node:child_process'

// 1. 文件 mutation 串行化（进程内 + 跨进程）
await withFileMutationQueue('/work/.qiongqi/state.json', async () => {
  await fs.writeFile('/work/.qiongqi/state.json', newState)
})

// 2. 收集 bash 长输出
const acc = new OutputAccumulator({
  maxLines: 2000,
  maxBytes: 50_000,
  tempFilePrefix: 'bash-output',
})
const proc = spawn('bash', ['-c', 'big-command'])
proc.stdout.on('data', (chunk) => acc.append(chunk))
proc.stderr.on('data', (chunk) => acc.append(chunk))
proc.on('close', () => {
  acc.finish()
  const snap = acc.snapshot({ persistIfTruncated: true })
  console.log(snap.content.slice(0, 1000))
  if (snap.fullOutputPath) console.log('Full output:', snap.fullOutputPath)
  await acc.closeTempFile()
})

// 3. 解析 rate limit
const output = { error: 'rate limited; retry after 30 seconds' }
const parsed = parseRateLimitedToolResult(output)
if (parsed) {
  console.log(parsed.rateLimited, parsed.retryAfterSeconds) // true, 30
}
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 4 引擎层）
- 消费方：`@qiongqi/services/thread-service.ts` 使用 `withFileMutationQueue`；`@qiongqi/adapter-tools/bash.ts` 使用 `OutputAccumulator` + `parseRateLimitedToolResult`
- 源文件：[`file-mutation-queue.ts`](../../packages/infrastructure/tool-infra/src/file-mutation-queue.ts)、[`output-accumulator.ts`](../../packages/infrastructure/tool-infra/src/output-accumulator.ts)、[`tool-rate-limit.ts`](../../packages/infrastructure/tool-infra/src/tool-rate-limit.ts)
- 测试：[`../../tests/file-mutation-queue.test.ts`](../../tests/file-mutation-queue.test.ts)、[`../../tests/output-accumulator.test.ts`](../../tests/output-accumulator.test.ts)
