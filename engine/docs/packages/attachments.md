# @qiongqi/attachments

> v1.1.1。artifact/attachment 通过 durable reference 进入 checkpoint 和 outcome，不内嵌大二进制。

> 附件存储：图像二进制剥离、MIME 校验、文本回退、作用域授权、虚拟路径解析。
> Layer 3 — 依赖：`@qiongqi/contracts`（仅 Zod 类型与配置）。被 `@qiongqi/http` 消费。

---

## 中文

### 1. 职责

`@qiongqi/attachments` 提供附件（image）存储的**纯文件实现** `FileAttachmentStore`。其设计核心：

- **图像二进制剥离** — 仅支持 PNG / JPEG / WebP；其他 MIME 在 `create` 阶段直接抛错
- **去重** — 内容 SHA-256 哈希作为 id 的一部分（`att_<24-hex>`），相同内容自动合并 scope 列表
- **作用域授权** — 附件可被限定到特定 `threadId` / `workspace`；`resolveContent` 在未授权时抛错
- **文本回退** — 为视觉通道不达的环境提供 base64 文本形式的压缩回退
- **虚拟路径** — `VirtualPathResolver` 把 `/mnt/qiongqi/{workspace,uploads,outputs,artifacts}` 映射到 thread-local 物理目录，并拒绝路径穿越

`AttachmentStore` 接口是**唯一的 contract**；其他实现（如未来 S3 适配）只需实现该接口。

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `AttachmentContent` | type | `attachment-store.ts` | `AttachmentMetadata` + `data: Buffer` |
| `AttachmentStore` | interface | `attachment-store.ts` | 端口契约：create / get / resolveContent / textFallbackPolicy / diagnostics |
| `FileAttachmentStore` | class | `attachment-store.ts` | 文件系统实现（`<rootDir>/<id>.bin` + `<id>.json`）|
| `VirtualPathResolver` | class | `virtual-path.ts` | thread-local virtual mount 解析与反向映射 |

#### `AttachmentStore.create` 参数

```typescript
{
  name: string
  data: Buffer
  mimeType?: string        // 可选；若提供则必须与检测出的图像 MIME 匹配
  textFallback?: AttachmentTextFallback  // 视觉通道不可用时的 base64 回退
  threadId?: string         // 授权作用域
  workspace?: string
}
```

### 3. 关键不变量

- **三 MIME 硬限制**：`detectImage` 仅识别 PNG / JPEG / WebP（`attachment-store.ts:182-193`）；其他格式在 `create` 阶段抛 `unsupported image MIME type`。
- **声明 MIME 必须匹配内容**：`create` 时若调用者传 `mimeType` 但与二进制检测结果不一致，抛 `declared MIME type does not match image content`。
- **白名单二次校验**：即使二进制是 PNG，最终也必须通过 `config.allowedMimeTypes` 校验（`attachment-store.ts:51`）。
- **大小 + 维度双重限制**：`maxImageBytes`（默认 5MB）和 `maxImageDimension`（默认 4096px）任一超限即拒绝。
- **去重 = 同内容合并 scope**：相同哈希的二次上传**不会**创建新条目，而是在 `threadIds` / `workspaces` 数组中追加作用域（`attachment-store.ts:64-73`）。
- **作用域授权**：`resolveContent` 校验：若附件已绑定作用域，仅在调用方 scope 与之匹配时返回；未绑定任何作用域的附件视为公共（任何 scope 都可访问）。
- **文本回退独立校验**：`textFallback.mimeType` 必须也在白名单内，base64 字节数受 `textFallbackMaxBase64Bytes` 限制（默认 512KB），维度受 `textFallbackMaxImageDimension` 限制（默认 1280px）。
- **诊断非阻塞**：`diagnostics()` 解析失败的单文件返回 `null` 而不抛错，最终 `records.filter(Boolean)`。
- **虚拟路径先 decode 后 containment 检查**：`../` 与 `%2e%2e` 都会被拒绝；返回 physical path 时使用 canonical path，兼容 macOS `/var` 与 `/private/var` 差异。
- **虚拟路径只表达 thread-local 文件**：workspace/uploads/outputs/artifacts 都是逻辑 mount，不暴露真实数据目录给模型或上层产品壳。

### 4. 行为规约

来自 `tests/attachment-store.test.ts` 的 `it()` 行为描述：

- `rejects unsupported MIME types at create time` — 非 PNG/JPEG/WebP 抛错
- `enforces the byte and dimension limits` — 超过 `maxImageBytes` 或 `maxImageDimension` 拒绝
- `merges scopes when the same content is uploaded twice` — 同内容二次上传合并 `threadIds` / `workspaces`
- `rejects unauthorized content resolution` — 未授权的 `resolveContent` 抛错
- `validates the text fallback against the same MIME/byte/dimension limits` — textFallback 独立校验
- `returns null for missing attachments on get` — 不存在的 id 返回 `null`（不抛错）
- `survives malformed metadata on diagnostics` — `diagnostics()` 容错（损坏的 JSON 跳过）
- `VirtualPathResolver resolves workspace/uploads/outputs/artifacts mounts`
- `VirtualPathResolver rejects traversal and percent-encoded traversal`
- `VirtualPathResolver converts physical paths inside mounts back to virtual paths`

### 5. 使用示例

```typescript
import { FileAttachmentStore } from '@qiongqi/attachments'

const store = new FileAttachmentStore({
  rootDir: '/var/qiongqi/attachments',
  config: {
    enabled: true,
    maxImageBytes: 5_242_880,
    maxImageDimension: 4096,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    textFallbackMaxBase64Bytes: 524_288,
    textFallbackMaxImageDimension: 1280,
    textFallbackPreferredMimeType: 'image/webp',
  },
})

// 1. 创建
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, /* ... */])
const metadata = await store.create({
  name: 'screenshot.png',
  data: png,
  threadId: 'thread_abc',
})
console.log(metadata.id) // 'att_<24-hex>'

// 2. 同内容二次上传 → 合并 scope
await store.create({ name: 'screenshot.png', data: png, workspace: '/work' })
// metadata.threadIds: ['thread_abc'], workspaces: ['/work']

// 3. 解析（需授权）
const { data } = await store.resolveContent(metadata.id, { threadId: 'thread_abc' })
// 未授权 → throws 'attachment is not authorized for this turn'

// 4. 诊断
const diag = await store.diagnostics()
// { enabled, rootDir, count, totalBytes }
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 3 基础设施）
- 消费方：`@qiongqi/http` 的 `/v1/attachments` 路由（POST 上传 / GET 元数据 / GET 内容）
- 源文件：[`attachment-store.ts`](../../packages/infrastructure/attachments/src/attachment-store.ts)
- 测试：[`../../tests/attachment-store.test.ts`](../../tests/attachment-store.test.ts)

---
