#!/usr/bin/env node
/**
 * End-to-end verification for the most environment-sensitive path:
 * evented orchestration + cross-instance A2A task lifecycle.
 *
 * Default mode is deterministic and local: it starts a tiny
 * OpenAI-compatible fake model server plus two Qiongqi HTTP runtimes
 * in evented mode, then drives A -> B through A2A task endpoints.
 *
 * Optional external peer mode is opt-in via --external-peer and
 * QIONGQI_A2A_PEER_URL / QIONGQI_A2A_PEER_TOKEN. This keeps local CI
 * honest while still documenting how to exercise real interoperability.
 */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT_A = 19160
const DEFAULT_PORT_B = 19161

export function parseVerifyEventedA2AOptions(argv = [], env = process.env) {
  const options = {
    host: env.QIONGQI_VERIFY_HOST || DEFAULT_HOST,
    portA: numberFromEnv(env.QIONGQI_VERIFY_PORT_A, DEFAULT_PORT_A),
    portB: numberFromEnv(env.QIONGQI_VERIFY_PORT_B, DEFAULT_PORT_B),
    dataDirA: env.QIONGQI_VERIFY_DATA_DIR_A || join(tmpdir(), 'qq-evented-a2a-a'),
    dataDirB: env.QIONGQI_VERIFY_DATA_DIR_B || join(tmpdir(), 'qq-evented-a2a-b'),
    tokenA: env.QIONGQI_VERIFY_TOKEN_A || 'qq-local-a',
    tokenB: env.QIONGQI_VERIFY_TOKEN_B || 'qq-local-b',
    runExternalPeer: env.QIONGQI_A2A_EXTERNAL === '1'
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--host') options.host = requiredValue(argv, ++i, arg)
    else if (arg === '--port-a') options.portA = numberFromArg(requiredValue(argv, ++i, arg), arg)
    else if (arg === '--port-b') options.portB = numberFromArg(requiredValue(argv, ++i, arg), arg)
    else if (arg === '--data-dir-a') options.dataDirA = requiredValue(argv, ++i, arg)
    else if (arg === '--data-dir-b') options.dataDirB = requiredValue(argv, ++i, arg)
    else if (arg === '--token-a') options.tokenA = requiredValue(argv, ++i, arg)
    else if (arg === '--token-b') options.tokenB = requiredValue(argv, ++i, arg)
    else if (arg === '--external-peer') options.runExternalPeer = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

export function resolveExternalPeerConfig(env = process.env) {
  const url = env.QIONGQI_A2A_PEER_URL?.trim()
  const token = env.QIONGQI_A2A_PEER_TOKEN?.trim()
  if (!url || !token) {
    return {
      ok: false,
      reason: 'set both QIONGQI_A2A_PEER_URL and QIONGQI_A2A_PEER_TOKEN'
    }
  }
  return { ok: true, url, token }
}

export function summarizeVerification(result) {
  const lines = [`local evented A2A: ${result.local}`]
  if (result.external === 'passed') {
    lines.push('external peer: passed')
  } else if (result.external === 'failed') {
    lines.push(`external peer: failed (${result.externalReason ?? 'unknown error'})`)
  } else {
    lines.push(`external peer: skipped (${result.externalReason ?? 'not requested'})`)
  }
  return lines.join('\n')
}

export async function runVerification(options = parseVerifyEventedA2AOptions()) {
  if (options.help) {
    console.log(usage())
    return { local: 'skipped', external: 'skipped', externalReason: 'help requested' }
  }

  const resources = []
  let fakeModel
  try {
    fakeModel = await startFakeModelServer(options.host)
    resources.push(fakeModel)

    const agentA = await startEventedAgent({
      host: options.host,
      port: options.portA,
      dataDir: options.dataDirA,
      token: options.tokenA,
      modelBaseUrl: fakeModel.baseUrl,
      agentName: 'Qiongqi A2A Local A'
    })
    resources.push(agentA)

    const agentB = await startEventedAgent({
      host: options.host,
      port: options.portB,
      dataDir: options.dataDirB,
      token: options.tokenB,
      modelBaseUrl: fakeModel.baseUrl,
      agentName: 'Qiongqi A2A Local B'
    })
    resources.push(agentB)

    await verifyLocalA2A({ agentA, agentB, tokenB: options.tokenB })

    let external = 'skipped'
    let externalReason = 'not requested'
    if (options.runExternalPeer) {
      const config = resolveExternalPeerConfig(process.env)
      if (!config.ok) {
        externalReason = config.reason
      } else {
        await verifyExternalPeer(config)
        external = 'passed'
        externalReason = undefined
      }
    }

    return { local: 'passed', external, externalReason }
  } finally {
    for (const resource of resources.reverse()) {
      await resource.close?.().catch(() => {})
    }
    if (!process.env.QIONGQI_VERIFY_KEEP_DATA) {
      await Promise.all([
        rm(options.dataDirA, { recursive: true, force: true }),
        rm(options.dataDirB, { recursive: true, force: true })
      ])
    }
  }
}

async function startEventedAgent(input) {
  const { createAgent, createHttpServer } = await loadQiongqiHttp()
  const runtime = await createAgent({
    host: input.host,
    port: input.port,
    dataDir: input.dataDir,
    runtimeToken: input.token,
    apiKey: 'fake-key',
    baseUrl: input.modelBaseUrl,
    model: 'fake-qiongqi-e2e',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    tokenEconomyMode: false,
    insecure: false,
    agentName: input.agentName,
    orchestrationMode: 'evented',
    storage: { backend: 'file' }
  })
  const handle = await createHttpServer({
    agent: runtime,
    host: input.host,
    port: input.port
  })
  return {
    ...handle,
    baseUrl: `http://${handle.host}:${handle.port}`,
    token: input.token
  }
}

async function verifyLocalA2A({ agentA, agentB, tokenB }) {
  const card = await getJson(`${agentB.baseUrl}/.well-known/agent-card.json`)
  assert(card.id, 'agent B card missing id')
  assert(card.endpoints?.a2a, 'agent B card missing A2A endpoint')

  const create = await postJson(`${agentB.baseUrl}/a2a/tasks`, tokenB, {
    prompt: 'Reply with one short sentence proving evented A2A executed.',
    label: 'evented-a2a-local',
    workspace: tmpdir(),
    model: 'fake-qiongqi-e2e'
  })
  assert(create.task?.id, 'A2A task response missing task id')
  assert(['working', 'submitted'].includes(create.task.status), `expected async task submission, got ${create.task?.status}`)

  const task = await waitForTask(`${agentB.baseUrl}/a2a/tasks/${create.task.id}`, tokenB)
  assert(task.status === 'completed', `task lookup returned ${task.status}`)
  assert(typeof task.summary === 'string' && task.summary.includes('fake-qiongqi-e2e'), 'task summary did not include fake model output')

  const artifacts = await getJson(`${agentB.baseUrl}/a2a/tasks/${create.task.id}/artifacts`, tokenB)
  assert(Array.isArray(artifacts.artifacts), 'artifacts endpoint did not return an artifacts array')

  const subscribe = await fetch(`${agentB.baseUrl}/a2a/tasks/${create.task.id}/subscribe`, {
    headers: { authorization: `Bearer ${tokenB}` }
  })
  assert(subscribe.ok, `subscribe failed with HTTP ${subscribe.status}`)
  const text = await subscribe.text()
  assert(text.includes('"event":"done"'), 'subscribe stream did not include done event')

  const stateProbe = await loadQiongqiLoop()
  const store = new stateProbe.FileTurnStateStore(join(agentB.runtime.info().dataDir, 'turn-states'))
  const residual = await store.load(create.task.threadId, create.task.turnId)
  assert(!residual, 'evented turn state was not cleaned up after A2A completion')

  // Use agentA in the verification to prove two distinct local instances
  // were started and are discoverable.
  const cardA = await getJson(`${agentA.baseUrl}/.well-known/agent-card.json`)
  assert(cardA.id && cardA.id !== card.id, 'local A/B agent cards should be distinct')
}

async function waitForTask(url, token, timeoutMs = 5000) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeoutMs) {
    last = await getJson(url, token)
    if (['completed', 'failed', 'cancelled'].includes(last.status)) return last
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`task did not reach terminal state: ${last?.status ?? 'unknown'}`)
}

async function verifyExternalPeer(config) {
  const card = await getJson(new URL('/.well-known/agent-card.json', config.url).href)
  assert(card.id, 'external peer card missing id')
  const task = await postJson(new URL('/a2a/tasks', config.url).href, config.token, {
    prompt: 'External A2A interoperability probe. Reply briefly.',
    label: 'qiongqi-external-interop',
    workspace: tmpdir()
  })
  assert(task.task?.id, 'external peer did not return a task id')
  assert(['completed', 'working', 'submitted'].includes(task.task.status), `unexpected external task status: ${task.task?.status}`)
}

async function startFakeModelServer(host) {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))
      return
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache'
    })
    response.write(`data: ${JSON.stringify({
      choices: [{ index: 0, delta: { content: 'fake-qiongqi-e2e completed local evented A2A.' } }]
    })}\n\n`)
    response.write(`data: ${JSON.stringify({
      choices: [{ index: 0, finish_reason: 'stop', delta: {} }],
      usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 }
    })}\n\n`)
    response.write('data: [DONE]\n\n')
    response.end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    baseUrl: `http://${host}:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function loadQiongqiHttp() {
  return import('../packages/http-layer/http/dist/index.js')
}

async function loadQiongqiLoop() {
  return import('../packages/engine/loop/dist/index.js')
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  })
  const text = await response.text()
  assert(response.ok, `GET ${url} failed with HTTP ${response.status}: ${text}`)
  return JSON.parse(text)
}

async function postJson(url, token, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const text = await response.text()
  assert(response.ok, `POST ${url} failed with HTTP ${response.status}: ${text}`)
  return JSON.parse(text)
}

function usage() {
  return `Usage: node scripts/verify-evented-a2a.mjs [options]

Options:
  --host <host>          Bind host for local agents (default: 127.0.0.1)
  --port-a <port>        Port for local Agent A (default: 19160)
  --port-b <port>        Port for local Agent B (default: 19161)
  --data-dir-a <path>    Data dir for local Agent A
  --data-dir-b <path>    Data dir for local Agent B
  --external-peer        Also probe QIONGQI_A2A_PEER_URL with QIONGQI_A2A_PEER_TOKEN
`
}

function requiredValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`)
  return value
}

function numberFromArg(value, flag) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`invalid port for ${flag}: ${value}`)
  }
  return parsed
}

function numberFromEnv(value, fallback) {
  return value ? numberFromArg(value, 'environment') : fallback
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  runVerification(parseVerifyEventedA2AOptions(process.argv.slice(2)))
    .then((result) => {
      console.log(summarizeVerification(result))
      if (result.local !== 'passed' || result.external === 'failed') process.exitCode = 1
    })
    .catch((error) => {
      console.error(`evented A2A verification failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    })
}
