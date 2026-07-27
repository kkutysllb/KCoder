# @qiongqi/http — Transport

> v1.1.1。SSE 使用 `streamId + seq` 续传和 subscriber ack；连接生命周期不等于任务生命周期。

> HTTP 传输原语：Router / SSE / Auth / Response / Node HTTP server / 读 body / A2A HTTP transport。
> Layer 8 — 依赖：`@qiongqi/contracts`、`@qiongqi/ports`、`@qiongqi/delegation`。

---

## 中文

### 1. 职责

`@qiongqi/http` 包的"传输层"基础设施。这些是**所有** HTTP 端点共享的横切关注点：

- **`Router`** —— 极简 `:param` 路由器，方法+路径+handler 注册
- **`encodeSseEvent`** —— SSE 事件编码（`id: <seq>\nevent: <kind>\ndata: <JSON>\n\n`）
- **`bearerToken` / `isAuthorized`** —— Bearer token 鉴权
- **`jsonResponse` / `dispatchRequest`** —— JSON 响应 + 路由器派发
- **`startNodeHttpServer`** —— Node.js `http.Server` 适配器（Web Fetch ↔ Node IncomingMessage 互转）
- **`readJsonBody`** —— 容错 JSON 解析
- **`HttpPeerTransport`** —— `RemotePeerTransport` 的 HTTP 实现（Stage 2 A2A）

### 2. 公共 API

| 导出 | 类型 | 来源文件 | 一句话 |
|------|------|---------|--------|
| `Router` | class | `router.ts` | 极简路由器 |
| `RouteContext` / `RouteHandler` | type | `router.ts` | 路由上下文 + 处理器 |
| `encodeSseEvent(event)` | function | `sse.ts` | SSE 事件编码 |
| `bearerToken(headers)` | function | `auth.ts` | 从 `Authorization: Bearer` 取 token |
| `isAuthorized(headers, expected, insecure?)` | function | `auth.ts` | 鉴权判定 |
| `JsonResponse` | type | `response.ts` | `{ status, headers, body }` |
| `jsonResponse(body, status?)` | function | `response.ts` | 构造 JSON 响应 |
| `HttpServerOptions` / `dispatchRequest(router, request)` | function | `http-server.ts` | 派发请求到路由 |
| `startNodeHttpServer({ router, host, port, accessLog? })` | function (async) | `node-http-server.ts` | 启动 Node HTTP 服务器，可注入结构化 access log sink |
| `NodeHttpServerHandle` | type | `node-http-server.ts` | `{ server, host, port, close() }` |
| `readJsonBody(request)` | function (async) | `read-json-body.ts` | 读 + 解析 JSON body（容错）|
| `ReadJsonBodyResult` | type | `read-json-body.ts` | `{ ok: true; value } \| { ok: false; response }` |
| `HttpPeerTransport` | class | `http-peer-transport.ts` | A2A HTTP 传输 |
| `A2ATaskStatus` / `A2ATaskRecord` | zod schema | `a2a-task-model.ts` | A2A 任务记录（Stage 4）|
| `FileA2ATaskStore` | class | `a2a-task-store.ts` | `<dataDir>/a2a-tasks/<id>.json` 持久化 |

### 3. 关键不变量

- **Router 注册顺序敏感**：第一个 `(method, path)` 匹配的路由胜出（`router.ts:32-53`）。
- **`:param` 解码**：`decodeURIComponent` 用于捕获参数。
- **SSE 格式固定**：`id: <seq>\nevent: <kind>\ndata: <JSON>\n\n`（`sse.ts:4`）。
- **鉴权 bypass 通过 `insecure`**：`insecure=true` 跳过 token 校验（`auth.ts:8-11`）；仅本地开发用。
- **`bearerToken` 大小写不敏感**：regex `/^Bearer\s+(.+)$/i`。
- **JSON 响应 200 + `application/json`**：`jsonResponse` 默认 200 + `content-type: application/json; charset=utf-8`（`response.ts:7-12`）。
- **404 默认**：`dispatchRequest` 未匹配路由返回 `{ code: 'not_found', message: 'route not found' }`（`http-server.ts:19-24`）。
- **500 默认**：`handleNodeRequest` 捕获错误返回 500 + `{ code: 'internal_error', message }`（`node-http-server.ts:50-58`）。
- **Node HTTP 适配用 Web Fetch 抽象**：`toFetchRequest` 把 `IncomingMessage` → `Request`（含 body stream），`writeFetchResponse` 把 `Response` → `ServerResponse` 流式写。
- **`Readable.toWeb` 用 `duplex: 'half'`** —— Node 18+ 的 half-duplex stream 转换（`node-http-server.ts:78-81`）。
- **A2A 任务 5 状态**：`submitted` / `working` / `completed` / `failed` / `cancelled`（`a2a-task-model.ts:7`）。
- **`A2ATaskRecord` 用 `.strict()`**：额外字段会被 Zod 拒绝（`a2a-task-model.ts:30`）。
- **HttpPeerTransport token 通过 `getToken(cardId)` 解析** —— 支持 per-peer 不同 token（`http-peer-transport.ts:34-37`）。
- **`getToken` 返回 undefined → 不带 Authorization** —— 信任模式下不发 header。

### 4. 行为规约

来自 `tests/http-server.test.ts` / `tests/`:（routes 通过集成测覆盖）

- `Router.match returns undefined for unknown method+path`
- `Router.match decodes :param placeholders`
- `Router.add appends to the route list (registration order)`
- `encodeSseEvent produces id: <seq>\nevent: <kind>\ndata: <JSON>\n\n`
- `bearerToken returns null when Authorization header is absent`
- `bearerToken is case-insensitive on "Bearer"`
- `isAuthorized returns true when insecure is set`
- `isAuthorized returns true only when bearer matches expectedToken`
- `jsonResponse defaults to status 200 and content-type application/json; charset=utf-8`
- `dispatchRequest returns 404 with code: 'not_found' for unknown routes`
- `startNodeHttpServer binds to the given host:port and closes cleanly`
- `readJsonBody returns { ok: true, value: {} } for empty body`
- `readJsonBody returns 400 with code: 'validation_error' for malformed JSON`
- `A2ATaskRecord.strict() rejects extra fields`
- `FileA2ATaskStore.upsert writes <rootDir>/<id>.json`
- `FileA2ATaskStore.list returns [] for missing directory`
- `HttpPeerTransport sends POST to card.endpoints.a2a ?? '/a2a'`
- `HttpPeerTransport throws on non-2xx response with body excerpt`
- `HttpPeerTransport uses fetchImpl for testability`

### 5. 使用示例

```typescript
import {
  Router, encodeSseEvent, bearerToken, isAuthorized,
  jsonResponse, dispatchRequest, startNodeHttpServer,
  readJsonBody, HttpPeerTransport,
} from '@qiongqi/http'

// 1. 路由
const router = new Router()
router.add('GET', '/v1/threads', async () => jsonResponse({ threads: [] }))
router.add('GET', '/v1/threads/:id', async (req, ctx) => {
  return jsonResponse({ id: ctx.params.id })
})

// 2. 启动 Node 服务器
const handle = await startNodeHttpServer({
  router,
  host: '127.0.0.1',
  port: 8899,
  accessLog: (entry) => console.log(JSON.stringify(entry))
})

// 3. SSE
function sseHandler(events: RuntimeEvent[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encodeSseEvent(event))
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}

// 4. 鉴权
const token = bearerToken(request.headers)
if (!isAuthorized(request.headers, expectedToken, insecure)) {
  return jsonResponse({ code: 'unauthorized', message: 'invalid token' }, 401)
}

// 5. JSON body
const result = await readJsonBody(request)
if (!result.ok) return result.response
const { threadId } = result.value as { threadId: string }

// 6. A2A peer transport
const transport = new HttpPeerTransport({
  getToken: (cardId) => options.runtimeToken,
})
const artifact = await transport.invokeRemote(card, task, controller.signal)
```

### 6. 关联文档

- 架构文档：[`../architecture.zh.md#3-包结构`](../architecture.zh.md#3-包结构)（§3.3 Layer 8 HTTP 服务层）
- 消费方：`@qiongqi/http/routes/*` 全部依赖本子模块
- 源文件：[`router.ts`](../../packages/http-layer/http/src/router.ts)、[`sse.ts`](../../packages/http-layer/http/src/sse.ts)、[`auth.ts`](../../packages/http-layer/http/src/auth.ts)、[`response.ts`](../../packages/http-layer/http/src/response.ts)、[`http-server.ts`](../../packages/http-layer/http/src/http-server.ts)、[`node-http-server.ts`](../../packages/http-layer/http/src/node-http-server.ts)、[`read-json-body.ts`](../../packages/http-layer/http/src/read-json-body.ts)、[`http-peer-transport.ts`](../../packages/http-layer/http/src/http-peer-transport.ts)、[`a2a-task-model.ts`](../../packages/http-layer/http/src/a2a-task-model.ts)、[`a2a-task-store.ts`](../../packages/http-layer/http/src/a2a-task-store.ts)
- 测试：[`../../tests/http-server.test.ts`](../../tests/http-server.test.ts)（37 个用例）
