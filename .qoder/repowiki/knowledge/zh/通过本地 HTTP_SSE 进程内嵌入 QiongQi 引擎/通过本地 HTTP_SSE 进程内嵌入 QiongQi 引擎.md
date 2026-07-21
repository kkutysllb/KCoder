---
kind: design
name: 通过本地 HTTP/SSE 进程内嵌入 QiongQi 引擎
source: session
category: adr
---

# 通过本地 HTTP/SSE 进程内嵌入 QiongQi 引擎

_来源：f00d382 → 9ebea10 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
KCoder 作为桌面应用需要与 QiongQi 编码引擎交互，但引擎是独立的 monorepo，存在进程间通信、生命周期管理、端口分配等架构选择。

## 决策驱动
- 进程隔离避免崩溃传播
- HTTP/SSE 协议便于 React 前端直接消费流式响应
- engine/ 目录保持完整 monorepo 以便独立构建和升级

## 备选方案
- **进程内 require 调用** _（已否决）_ — 优点：零网络开销，共享内存；缺点：引擎崩溃会拖垮整个 Electron 主进程；无法利用 SSE 流式特性；难以独立升级引擎版本
- **外部独立进程 + IPC 桥接** _（已否决）_ — 优点：完全隔离；缺点：需要在主进程和渲染进程之间再套一层 IPC 转发，增加复杂度且失去 SSE 原生能力
- **localhost HTTP/SSE 子进程** — 优点：Electron Main 启动 createCodingAgent() 监听 127.0.0.1:{port}，Renderer 直接用 fetch/SSE 客户端访问，天然支持流式事件；端口随机分配避免冲突；优雅退出时关闭子进程；缺点：多一次本地网络往返（可忽略）；需处理端口占用和健康检查

## 决策
在 Main 进程通过 @qiongqi/preset-coding 的 createCodingAgent() 以子进程方式启动引擎，监听 localhost 随机端口，Renderer 通过 http://127.0.0.1:{port} 使用 REST + SSE 通信，Preload 仅暴露端口号和少量安全 IPC。

## 影响
引擎与 UI 解耦，引擎升级只需替换 engine/ 目录并重新构建；SSE 流式响应可直接在 React 中订阅；需要实现健康检查轮询和优雅退出逻辑；打包时需将 engine/ 作为 extraResources 或 asar 包含。