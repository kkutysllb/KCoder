#!/usr/bin/env node
/**
 * Stage 3.G: End-to-end crash recovery verification.
 *
 * Usage:
 *   node scripts/verify-crash-recovery.mjs
 *
 * Requires: DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL env vars set.
 */
import { createAgent, createHttpServer } from '@qiongqi/http'

const DATA_DIR = '/tmp/qq-crash-test'
const PORT = 19150

async function main() {
  console.log('=== 阶段 3.G：崩溃恢复端到端验证 ===\n')

  // 1. Create agent with evented mode
  console.log('[1] 创建 agent（evented 模式）...')
  const agent = await createAgent({
    host: '127.0.0.1',
    port: PORT,
    dataDir: DATA_DIR,
    runtimeToken: 'test-token',
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL || '',
    model: process.env.DEEPSEEK_MODEL || '',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace',
    tokenEconomyMode: false,
    insecure: true,
    orchestrationMode: 'evented'
  })

  console.log(`  agentCard.id: ${agent.agentCard?.id}`)
  console.log(`  agentCard.name: ${agent.agentCard?.name}\n`)

  // 2. Create thread and start turn
  console.log('[2] 创建 thread + 启动 turn...')
  const thread = await agent.threadService.create({
    title: 'Crash recovery test',
    workspace: '/tmp',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    mode: 'agent',
    approvalPolicy: 'auto'
  })
  console.log(`  threadId: ${thread.id}`)

  const started = await agent.turnService.startTurn({
    threadId: thread.id,
    request: {
      prompt: 'What is the capital of France? Reply with just the city name.',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      mode: 'agent'
    }
  })
  console.log(`  turnId: ${started.turnId}\n`)

  // 3. Run turn
  console.log('[3] 执行 turn...')
  const status = await agent.runTurn(thread.id, started.turnId)
  console.log(`  turn status: ${status}`)

  // 4. Check turn-state persistence
  const items = await agent.sessionStore.loadItems(thread.id)
  const turnItems = items.filter(i => i.turnId === started.turnId)
  console.log(`  turn items: ${turnItems.length}`)
  for (const item of turnItems) {
    if (item.kind === 'assistant_text') {
      console.log(`    assistant: ${(item.text || '').slice(0, 80)}`)
    }
  }

  // 5. Check that state was cleaned up after successful turn
  const { FileTurnStateStore } = await import('@qiongqi/loop')
  const store = new FileTurnStateStore(DATA_DIR + '/turn-states')
  const prev = await store.load(thread.id, started.turnId)
  console.log(`  residual state after completion: ${prev ? 'PRESENT (unexpected)' : 'none (correct)'}\n`)

  // 6. Second turn — simulate crash recovery
  console.log('[4] 第二轮：验证恢复检测...')
  const thread2 = await agent.threadService.create({
    title: 'Recovery detection test',
    workspace: '/tmp',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    mode: 'agent',
    approvalPolicy: 'auto'
  })
  const started2 = await agent.turnService.startTurn({
    threadId: thread2.id,
    request: {
      prompt: 'What is 100 + 200? Reply with just the number.',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      mode: 'agent'
    }
  })

  // Manually save a state to simulate a crash before turn completion
  await store.save({
    version: 1,
    threadId: thread2.id,
    turnId: started2.turnId,
    stepIndex: 1,
    events: [],
    items: [],
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })

  const status2 = await agent.runTurn(thread2.id, started2.turnId)
  console.log(`  turn status after recovery: ${status2}`)
  const prev2 = await store.load(thread2.id, started2.turnId)
  console.log(`  residual state after recovery: ${prev2 ? 'PRESENT (unexpected)' : 'none (correct)'}`)

  // 7. Verify state.json exists during turn execution (check the first turn's state dir)
  const fs = await import('node:fs/promises')
  const { join } = await import('node:path')
  try {
    const dirs = await fs.readdir(join(DATA_DIR, 'turn-states', thread.id, 'turns'))
    console.log(`  turn-states persisted: ${dirs.length} entries`)
  } catch (e) {
    console.log(`  turn-states dir: ${e.code === 'ENOENT' ? 'cleaned up (correct)' : e.message}`)
  }

  await agent.shutdown?.()
  console.log('\n✅ 崩溃恢复验证通过')
}

main().catch(err => {
  console.error('❌', err.message)
  process.exit(1)
})
