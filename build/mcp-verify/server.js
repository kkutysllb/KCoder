#!/usr/bin/env node
'use strict'
// 最小 stdio MCP 服务器（newline-delimited JSON-RPC）：提供 echo 工具。
// 用途：验证 dsh-mcp-client 插件把外部 MCP 工具注册为 mcp__<serverName>__echo。
const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin })
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

rl.on('line', (line) => {
  if (line.trim() === '') return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  // JSON-RPC notification（无 id）无需响应
  if (msg.id === undefined) {
    if (msg.method === 'notifications/initialized') {
      process.stderr.write('[mcp-verify-server] initialized\n')
    }
    return
  }
  const { id, method } = msg
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'verify', version: '0.0.1' },
    } })
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: [{
      name: 'echo',
      description: 'Echo the given text back (MCP bridge verification)',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    }] } })
  } else if (method === 'tools/call') {
    const text = msg.params?.arguments?.text ?? '(no text)'
    process.stderr.write(`[mcp-verify-server] tools/call echo: ${String(text)}\n`)
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `echo: ${String(text)}` }] } })
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} })
  } else {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method: ${String(method)}` } })
  }
})
process.stderr.write('[mcp-verify-server] started\n')
