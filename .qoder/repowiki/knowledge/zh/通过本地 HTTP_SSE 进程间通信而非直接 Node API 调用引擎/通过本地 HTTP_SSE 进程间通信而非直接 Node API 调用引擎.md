---
kind: design
name: 通过本地 HTTP/SSE 进程间通信而非直接 Node API 调用引擎
source: session
category: adr
---

# 通过本地 HTTP/SSE 进程间通信而非直接 Node API 调用引擎

_来源：f6e1781 → f3cea19 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

## 背景
Electron Main 进程需要运行 QiongQi 核心引擎，但 Renderer（React）无法直接访问 Node.js API。需要在隔离的渲染进程与主进程之间建立通信机制来驱动引擎。

## 决策驱动
- 安全隔离（Renderer 无 Node 权限）
- 流式响应体验（SSE 实时推送）
- 进程崩溃隔离

## 备选方案
- **IPC + 直接调用 createCodingAgent()** _（已否决）_ — 优点：零网络开销、API 最简；缺点：Renderer 需经 Preload 暴露大量 IPC；无法利用 SSE 原生流式能力；主进程阻塞风险高
- **Main 启动本地 HTTP/SSE 服务，Renderer 通过 REST+SSE 访问** — 优点：天然支持流式事件推送；进程边界清晰；可独立测试引擎服务；符合浏览器环境习惯；缺点：增加 localhost 端口管理复杂度；存在健康检查开销

## 决策
在 Main 进程通过 `createCodingAgent()` 启动本地 HTTP/SSE 服务（127.0.0.1:PORT），Renderer 通过 `http://127.0.0.1:{port}` 使用 REST 创建线程/消息、SSE 订阅事件流进行交互。Preload 仅暴露端口号与少量窗口控制 IPC，不暴露文件系统直接访问。

## 影响
引擎与 UI 完全解耦，可独立重启引擎而不影响前端状态；SSE 提供原生流式体验；但需处理端口冲突、健康检查轮询、连接断开重连等网络层问题。