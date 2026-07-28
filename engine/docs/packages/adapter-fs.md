# @qiongqi/adapter-fs

> v1.1.4。仅提供文件系统 I/O，不参与 durable transaction 或多实例一致性。

> 纯 FS I/O 工具 —— 无 Agent 概念。从 `adapter-tools` 拆出（阶段 1.8）。
> Layer 3 — 依赖：仅 `diff`（外部）。被 `@qiongqi/tool-infra` 与 `@qiongqi/adapter-tools` 消费。

---

## 中文

### 1. 职责

`@qiongqi/adapter-fs` 提供**纯文件系统 I/O 工具**。它**不**包含任何 Agent / Turn / Tool 概念 —— 也不依赖 `@qiongqi/contracts` 之外的 `@qiongqi/*` 包。设计目标：

- 让 `adapter-tools` 拆出"非 Agent 概念"部分后保留为可被任何上层复用的纯工具
- `edit-diff` 的 fuzzy match 允许处理行尾空白、Unicode 引号/连字符、NFKC 归一化等常见编辑场景
- `truncate` 的 head/tail 截断尊重 UTF-8 多字节字符边界，不切坏字符

阶段 1.8 与 `@qiongqi/tool-infra` 一起从 `adapter-tools` 拆出。

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `Edit` | interface | `edit-diff.ts` | 单条编辑：`{ oldText, newText }` |
| `FuzzyMatchResult` | interface | `edit-diff.ts` | `{ found, index, matchLength, usedFuzzyMatch, contentForReplacement }` |
| `AppliedEditsResult` | interface | `edit-diff.ts` | `{ baseContent, newContent }` |
| `EditDiffResult` | interface | `edit-diff.ts` | `{ diff, firstChangedLine? }` |
| `EditDiffError` | interface | `edit-diff.ts` | `{ error: string }`（错误返回而非抛错）|
| `detectLineEnding` | function | `edit-diff.ts` | 检测 `'\r\n'` vs `'\n'`（基于首次出现位置）|
| `normalizeToLF` / `restoreLineEndings` | function | `edit-diff.ts` | `\r\n` ↔ `\n` 互转 |
| `stripBom` | function | `edit-diff.ts` | 剥 UTF-8 BOM；返回 `{ bom, text }` |
| `normalizeForFuzzyMatch` | function | `edit-diff.ts` | NFKC + trimEnd + Unicode 引号/连字符/空格归一化 |
| `fuzzyFindText` | function | `edit-diff.ts` | 先 exact 找，找不到再归一化后找；返回 `FuzzyMatchResult` |
| `applyEditsToNormalizedContent` | function | `edit-diff.ts` | 批量应用 edits；空 oldText / 找不到 / 多次出现 / 编辑重叠都抛错 |
| `firstChangedLine` | function | `edit-diff.ts` | 返回首个不同行的 1-based 行号 |
| `generateDisplayDiff` | function | `edit-diff.ts` | 渲染带行号、上下文省略的 diff 字符串（默认 4 行上下文）|
| `generateDiffString` | function | `edit-diff.ts` | `{ diff, firstChangedLine }` 组合 |
| `generateUnifiedPatch` | function | `edit-diff.ts` | 经典 unified diff（`diff` 库的 `createTwoFilesPatch`）|
| `computeEditsDiff` / `computeEditDiff` | function (async) | `edit-diff.ts` | 读文件 + 应用 edits + 渲染 diff；失败返回 `EditDiffError` 而非抛错 |
| `DEFAULT_MAX_LINES` | const | `truncate.ts` | `2000` |
| `DEFAULT_MAX_BYTES` | const | `truncate.ts` | `50 * 1024`（50KB）|
| `TruncationResult` | type | `truncate.ts` | `{ content, truncated, truncatedBy, totalLines, totalBytes, outputLines, outputBytes, lastLinePartial, firstLineExceedsLimit, maxLines, maxBytes }` |
| `TruncationOptions` | type | `truncate.ts` | `{ maxLines?, maxBytes? }`（默认 2000 行 / 50KB）|
| `formatSize` | function | `truncate.ts` | `1024B` / `1.5KB` / `12.3MB` 自适应 |
| `truncateHead` | function | `truncate.ts` | 从头开始保留 maxLines/maxBytes；超长返回 `truncated: true, truncatedBy: 'lines' \| 'bytes'` |
| `truncateTail` | function | `truncate.ts` | 从尾向前保留；超长时若 maxBytes 太短可能部分切最后一行（`lastLinePartial: true`）|
| `FsStats` | type | `fs-types.ts` | `= NonNullable<Awaited<ReturnType<typeof stat>>>` |
| `ShellConfig` | type | `fs-types.ts` | `{ shell, args }` |
| `TruncateMode` | type | `fs-types.ts` | `'head' \| 'tail'` |
| `TextSlice` | type | `fs-types.ts` | 类似 `TruncationResult` 的简化版 |
| `ListEntry` | type | `fs-types.ts` | `ls` 风格条目：`{ path, relative_path, name, kind: 'file' \| 'directory' \| 'symlink' \| 'other', size }` |
| `GrepMatch` | type | `fs-types.ts` | `grep` 风格匹配：`{ path, relative_path, line, column, text, context_before?, context_after? }` |
| `EditInstruction` | type | `fs-types.ts` | 与 `Edit` 同义；为兼容旧 API 保留 |

### 3. 关键不变量

- **零 Agent 概念**：本包不导入 `@qiongqi/contracts` / `@qiongqi/domain` / `@qiongqi/ports` —— 整个包可被任意 Node.js 项目复用。
- **Fuzzy match 不破坏字符**：`normalizeForFuzzyMatch` 使用 NFKC + `trimEnd` 处理行尾空白，归一化全角引号、连字符、空白（`edit-diff.ts:61-71`）。
- **Edit 错误显式抛错**：空 oldText / 找不到 / 多次出现 / 编辑区域重叠都会抛带位置信息的 `Error`，不静默返回（`edit-diff.ts:113-198`）。
- **BOM 处理独立**：`stripBom` 返回 `{ bom, text }` 让调用方决定是否还原（`edit-diff.ts:57-59`）。
- **`computeEditsDiff` 失败返回错误对象**而非抛错，便于上层决定是否重试；其他 helper 仍抛错（`edit-diff.ts:348-365`）。
- **`truncateHead` / `truncateTail` UTF-8 字符安全**：`Buffer.from(text, 'utf8')` + 字节切片后转回 `utf8`，不会切碎多字节字符。
- **`firstLineExceedsLimit` 标志**：`truncateHead` 遇到首行超过 maxBytes 直接返回空（`truncate.ts:69-84`）。
- **`lastLinePartial` 标志**：`truncateTail` 字节不够时切最后一行（`truncate.ts:148-153`）。
- **`DEFAULT_MAX_LINES=2000` / `DEFAULT_MAX_BYTES=50KB`**：默认限制适合模型上下文；可在 `TruncationOptions` 覆盖。

### 4. 行为规约

来自 `tests/builtin-tools.test.ts`（通过 `@qiongqi/adapter-tools` 的 `read` / `edit` / `write` 间接覆盖）以及该包 barrel re-export 行为：

- `applyEditsToNormalizedContent throws on empty oldText`
- `applyEditsToNormalizedContent throws on missing oldText (with file path + edit index)`
- `applyEditsToNormalizedContent throws on duplicate oldText (occurrence count included in error)`
- `applyEditsToNormalizedContent throws on overlapping edits`
- `applyEditsToNormalizedContent throws when the replacement produces identical content (no change)`
- `fuzzyFindText falls back to NFKC normalization + Unicode quote/space/hyphen canonicalization`
- `detectLineEnding returns '\r\n' when CRLF appears before any LF`
- `truncateHead returns the original content when totalLines/maxBytes are within limits`
- `truncateHead returns empty + firstLineExceedsLimit when the first line exceeds maxBytes`
- `truncateTail sets lastLinePartial when the first retained line is cut at a byte boundary`
- `formatSize adapts units: <1KB → B, <1MB → KB, else MB`

### 5. 使用示例

```typescript
import {
  fuzzyFindText,
  applyEditsToNormalizedContent,
  generateDiffString,
  truncateHead,
  truncateTail,
  formatSize,
} from '@qiongqi/adapter-fs'

// 1. Fuzzy match + 批量 edit
const content = 'function foo() {\n  return 1\n}\n'
const result = applyEditsToNormalizedContent(content, [
  { oldText: 'return 1', newText: 'return 42' },
  { oldText: 'function foo()', newText: 'function bar()' },
], 'src/index.ts')
console.log(result.newContent) // 'function bar() {\n  return 42\n}\n'

// 2. 渲染 diff
const { diff, firstChangedLine } = generateDiffString(content, result.newContent)
console.log(diff)
console.log('First changed line:', firstChangedLine)

// 3. 截断
const big = '...50KB text...'
const head = truncateHead(big, { maxLines: 100, maxBytes: 10_000 })
console.log(head.truncated, head.truncatedBy, head.outputBytes)
const tail = truncateTail(big, { maxLines: 50 })
console.log(tail.lastLinePartial)

// 4. Format
console.log(formatSize(2048))     // '2.0KB'
console.log(formatSize(5_242_880)) // '5.0MB'
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 3 基础设施）
- 消费方：`@qiongqi/adapter-tools` 的 `read` / `edit` / `write` 工具 + `bash` 工具的 stdout/stderr 处理
- 源文件：[`edit-diff.ts`](../../packages/infrastructure/adapter-fs/src/edit-diff.ts)、[`truncate.ts`](../../packages/infrastructure/adapter-fs/src/truncate.ts)、[`fs-types.ts`](../../packages/infrastructure/adapter-fs/src/fs-types.ts)
- 测试：主要通过 `tests/builtin-tools.test.ts` 间接覆盖（`adapter-tools` 重新导出本包所有内容）
