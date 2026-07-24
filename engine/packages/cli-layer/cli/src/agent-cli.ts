import { createInterface } from 'node:readline/promises'
import { stdin as processStdin, stdout as processStdout } from 'node:process'
import { spawn as spawnChildProcess } from 'node:child_process'
import { LocalToolHost, buildDefaultLocalTools } from '@qiongqi/adapter-tools'
import type { TurnItem } from '@qiongqi/contracts'
import {
  modelCapabilitiesForModel,
  modelContextProfilesFromConfig
} from '@qiongqi/loop'
import type { ToolHostContext } from '@qiongqi/ports'
import { createAgent } from '@qiongqi/http'
import type { ServerRuntime } from '@qiongqi/http'
import { createCodingAgent } from '@qiongqi/preset-coding'
import {
  parseServeOptionsSafe,
  ServeExitCode
} from './serve.js'
import type { ServeOptions, ServePreset } from './cli-options.js'

type WritableLike = {
  write(chunk: string): unknown
}

type WorkerChildProcess = {
  kill(signal?: NodeJS.Signals | number): unknown
  once?(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
}

export type CliIo = {
  stdin?: NodeJS.ReadableStream
  stdout: WritableLike
  stderr: WritableLike
  env?: Record<string, string | undefined>
  cwd?: () => string
  createRuntime?: (options: ServeOptions) => Promise<ServerRuntime>
  spawnWorker?: (args: string[], shard: WorkerShard) => WorkerChildProcess
  waitForWorkerShutdown?: () => Promise<void>
  sleep?: (ms: number) => Promise<void>
}

export const QIONGQI_CLI_USAGE = `qiongqi <command> [options]

Commands:
  serve [options]            Start the local HTTP/SSE runtime
  worker [options]           Run evented_v2 remote-agent workers without HTTP
  run [options] <prompt>     Run one agent turn without the GUI
  chat [options]             Start a line-oriented terminal chat
  exec [options] <tool>      List or invoke tools directly

Common options:
  --config <path>            JSON config file
  --data-dir <path>          Root directory for Qiongqi data
  --workspace <path>         Workspace root for run/chat/exec
  --model <model>            Model id
  --approval-policy <p>      on-request | untrusted | never | auto | suggest
  --json                     Emit machine-readable JSON where supported

Exec options:
  --list-tools               Print available tools
  --args <json>              JSON object passed to the selected tool

Worker options:
  --once                     Flush outbox and remote-agent mailboxes once, then exit
  --plan                     Print worker pool shard topology without starting workers
  --deployment-plan          Print production worker deployment commands and probes
  --pool-size <n>            Number of worker shards to start or plan
  --restart-backoff-ms <n>   Worker pool child restart backoff in milliseconds
  --max-restarts <n>         Max child restarts per shard before pool exits
  --shard-index <n>          Process only this 0-based worker shard
  --shard-count <n>          Total number of worker shards
`

const VALUE_FLAGS = new Set([
  'config',
  'config-file',
  'host',
  'port',
  'data-dir',
  'dataDir',
  'runtime-token',
  'runtimeToken',
  'api-key',
  'apiKey',
  'base-url',
  'baseUrl',
  'model',
  'approval-policy',
  'sandbox-mode',
  'workspace',
  'prompt',
  'p',
  'args',
  'title',
  'shard-index',
  'shard-count',
  'worker-shard-index',
  'worker-shard-count',
  'pool-size',
  'worker-pool-size',
  'restart-backoff-ms',
  'worker-restart-backoff-ms',
  'max-restarts',
  'worker-max-restarts'
])

export type QiongqiCliCommand = 'serve' | 'worker' | 'run' | 'chat' | 'exec' | 'help'

export function splitQiongqiCliCommand(argv: readonly string[]): {
  command: QiongqiCliCommand
  args: string[]
  error?: string
} {
  const first = argv[0]
  if (!first || first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help', args: [] }
  }
  if (first === 'serve' || first === 'worker' || first === 'run' || first === 'chat' || first === 'exec') {
    return { command: first, args: [...argv.slice(1)] }
  }
  if (first.startsWith('--')) {
    return { command: 'serve', args: [...argv] }
  }
  return { command: 'help', args: [], error: `unknown command: ${first}` }
}

export async function runAgentCommand(
  command: Exclude<QiongqiCliCommand, 'serve' | 'help'>,
  argv: readonly string[],
  io: CliIo
): Promise<number> {
  switch (command) {
    case 'worker':
      return runWorker(argv, io)
    case 'run':
      return runOneShot(argv, io)
    case 'chat':
      return runChat(argv, io)
    case 'exec':
      return runExec(argv, io)
  }
}

async function runWorker(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseSharedOptions(argv, io)
  if (!parsed.ok) return writeParseError(parsed, io, 'qiongqi worker')
  if (hasFlag(argv, 'deployment-plan')) {
    const plan = buildWorkerPoolPlan(parsed.options, argv)
    if (!plan.ok) {
      io.stderr.write(`qiongqi worker: ${plan.message}\n`)
      return ServeExitCode.config
    }
    const deploymentPlan = buildWorkerDeploymentPlan(argv, plan.value)
    if (parsed.json) {
      io.stdout.write(JSON.stringify(deploymentPlan) + '\n')
    } else {
      io.stdout.write(formatWorkerDeploymentPlan(deploymentPlan))
    }
    return ServeExitCode.ok
  }
  if (hasFlag(argv, 'plan')) {
    const plan = buildWorkerPoolPlan(parsed.options, argv)
    if (!plan.ok) {
      io.stderr.write(`qiongqi worker: ${plan.message}\n`)
      return ServeExitCode.config
    }
    if (parsed.json) {
      io.stdout.write(JSON.stringify(plan.value) + '\n')
    } else {
      io.stdout.write(formatWorkerPoolPlan(plan.value))
    }
    return ServeExitCode.ok
  }
  if (stringFlag(argv, ['pool-size', 'worker-pool-size']) !== undefined) {
    const pool = buildWorkerPoolPlan(parsed.options, argv)
    if (!pool.ok) {
      io.stderr.write(`qiongqi worker: ${pool.message}\n`)
      return ServeExitCode.config
    }
    return runWorkerPool(argv, parsed, pool.value, io)
  }
  const shard = parseWorkerShard(argv)
  if (!shard.ok) {
    io.stderr.write(`qiongqi worker: ${shard.message}\n`)
    return ServeExitCode.config
  }
  const runtimeOptions = shard.value ? applyWorkerShard(parsed.options, shard.value) : parsed.options
  let runtime: ServerRuntime | undefined
  try {
    runtime = await createRuntime(runtimeOptions, io)
    const scheduler = runtime.multiAgentRemoteScheduler
    if (!scheduler) {
      io.stderr.write('qiongqi worker: evented_v2 remote agent scheduler is not configured\n')
      return ServeExitCode.config
    }
    if (hasFlag(argv, 'once')) {
      const outbox = await runtime.multiAgentOutboxReconciler?.flushOnce()
      const remote = await scheduler.flushOnce()
      if (parsed.json) {
        io.stdout.write(JSON.stringify({
          mode: 'worker',
          ...(shard.value ? { shard: shard.value } : {}),
          outbox,
          remote
        }) + '\n')
      } else {
        io.stdout.write(`qiongqi worker: processed ${remote.messagesProcessed} message(s)${shard.value ? ` on shard ${shard.value.index}/${shard.value.count}` : ''}\n`)
      }
      return ServeExitCode.ok
    }
    runtime.multiAgentOutboxReconciler?.start()
    scheduler.start()
    const snapshot = scheduler.snapshot()
    if (parsed.json) {
      io.stdout.write(JSON.stringify({
        mode: 'worker',
        ...(shard.value ? { shard: shard.value } : {}),
        snapshot
      }) + '\n')
    } else {
      io.stdout.write(`qiongqi worker running: ${snapshot.workerId}${shard.value ? ` shard ${shard.value.index}/${shard.value.count}` : ''}\n`)
    }
    await waitForWorkerShutdownSignal()
    return ServeExitCode.ok
  } catch (error) {
    io.stderr.write(`qiongqi worker: ${errorMessage(error)}\n`)
    return ServeExitCode.runtime
  } finally {
    await shutdownRuntime(runtime, io, 'qiongqi worker')
  }
}

async function runWorkerPool(
  argv: readonly string[],
  parsed: Extract<SharedOptionsResult, { ok: true }>,
  plan: WorkerPoolPlan,
  io: CliIo
): Promise<number> {
  const restartBackoff = parseWorkerPoolRestartBackoff(argv)
  if (!restartBackoff.ok) {
    io.stderr.write(`qiongqi worker: ${restartBackoff.message}\n`)
    return ServeExitCode.config
  }
  const maxRestarts = parseWorkerPoolMaxRestarts(argv)
  if (!maxRestarts.ok) {
    io.stderr.write(`qiongqi worker: ${maxRestarts.message}\n`)
    return ServeExitCode.config
  }
  const children: WorkerChildProcess[] = []
  const restartCounts = new Map<string, number>()
  let stopping = false
  let rejectSupervisorFailure: ((error: unknown) => void) | undefined
  const supervisorFailure = new Promise<never>((_resolve, reject) => {
    rejectSupervisorFailure = reject
  })
  const spawnShard = (shard: WorkerShard): void => {
    const args = workerChildArgs(argv, shard)
    const child = spawnWorkerProcess(io, args, shard)
    children.push(child)
    child.once?.('exit', (code, signal) => {
      if (stopping) return
      void (async () => {
        const shardKey = `${shard.index}/${shard.count}`
        const restartCount = (restartCounts.get(shardKey) ?? 0) + 1
        if (maxRestarts.value !== undefined && restartCount > maxRestarts.value) {
          throw new Error(`worker shard ${shardKey} exceeded max restarts (${maxRestarts.value})`)
        }
        restartCounts.set(shardKey, restartCount)
        io.stderr.write(`qiongqi worker: worker shard ${shard.index}/${shard.count} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}); restarting in ${restartBackoff.value}ms\n`)
        await sleepForWorkerSupervisor(io, restartBackoff.value)
        if (!stopping) spawnShard(shard)
      })().catch((error) => rejectSupervisorFailure?.(error))
    })
  }
  try {
    for (const shard of plan.shards) {
      spawnShard(shard)
    }
    if (parsed.json) {
      io.stdout.write(JSON.stringify({
        mode: 'worker_pool',
        poolSize: plan.poolSize,
        shards: plan.shards
      }) + '\n')
    } else {
      io.stdout.write(formatWorkerPoolRunning(plan))
    }
    await Promise.race([
      (io.waitForWorkerShutdown ?? waitForWorkerShutdownSignal)(),
      supervisorFailure
    ])
    return ServeExitCode.ok
  } catch (error) {
    io.stderr.write(`qiongqi worker: ${errorMessage(error)}\n`)
    return ServeExitCode.runtime
  } finally {
    stopping = true
    for (const child of children) child.kill('SIGTERM')
  }
}

async function runOneShot(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseSharedOptions(argv, io)
  if (!parsed.ok) return writeParseError(parsed, io, 'qiongqi run')
  const prompt = stringFlag(argv, ['prompt', 'p']) ?? positionals(argv).join(' ').trim()
  if (!prompt) {
    io.stderr.write('qiongqi run: missing prompt\n')
    return ServeExitCode.usage
  }
  let runtime: ServerRuntime | undefined
  try {
    runtime = await createRuntime(parsed.options, io)
    const thread = await runtime.threadService.create({
      title: stringFlag(argv, ['title']) ?? prompt.slice(0, 80),
      workspace: parsed.workspace,
      model: parsed.options.model,
      mode: 'agent',
      approvalPolicy: parsed.options.approvalPolicy,
      sandboxMode: parsed.options.sandboxMode
    })
    const turn = await runtime.turnService.startTurn({
      threadId: thread.id,
      request: { prompt, model: parsed.options.model, mode: 'agent' }
    })
    let streamed = false
    const unsubscribe = parsed.json ? undefined : runtime.eventBus.subscribe(thread.id, (event) => {
      if (event.kind === 'assistant_text_delta' && event.item.kind === 'assistant_text') {
        streamed = true
        io.stdout.write(event.item.text)
      }
    })
    const status = await runtime.runTurn(thread.id, turn.turnId)
    unsubscribe?.()
    const items = await runtime.sessionStore.loadItems(thread.id)
    if (parsed.json) {
      io.stdout.write(JSON.stringify({ threadId: thread.id, turnId: turn.turnId, status, items }) + '\n')
    } else {
      if (!streamed) {
        const text = assistantText(items)
        if (text) io.stdout.write(text)
      }
      io.stdout.write('\n')
    }
    return status === 'completed' ? ServeExitCode.ok : ServeExitCode.runtime
  } catch (error) {
    io.stderr.write(`qiongqi run: ${errorMessage(error)}\n`)
    return ServeExitCode.runtime
  } finally {
    await shutdownRuntime(runtime, io, 'qiongqi run')
  }
}

async function runChat(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseSharedOptions(argv, io)
  if (!parsed.ok) return writeParseError(parsed, io, 'qiongqi chat')
  let runtime: ServerRuntime | undefined
  try {
    runtime = await createRuntime(parsed.options, io)
    const thread = await runtime.threadService.create({
      title: stringFlag(argv, ['title']) ?? 'CLI chat',
      workspace: parsed.workspace,
      model: parsed.options.model,
      mode: 'agent',
      approvalPolicy: parsed.options.approvalPolicy,
      sandboxMode: parsed.options.sandboxMode
    })
    const input = io.stdin ?? processStdin
    const terminal = isTtyInput(input)
    const rl = createInterface({
      input,
      ...(terminal ? { output: processStdout } : {}),
      terminal
    })
    try {
      if (terminal) {
        for (;;) {
          let prompt: string
          try {
            prompt = await rl.question('> ')
          } catch (error) {
            if (isReadlineClosedError(error)) break
            throw error
          }
          if (!await runChatTurn({ runtime, threadId: thread.id, prompt, model: parsed.options.model, io })) {
            break
          }
        }
      } else {
        for await (const prompt of rl) {
          if (!await runChatTurn({ runtime, threadId: thread.id, prompt, model: parsed.options.model, io })) {
            break
          }
        }
      }
    } finally {
      rl.close()
    }
    return ServeExitCode.ok
  } catch (error) {
    io.stderr.write(`qiongqi chat: ${errorMessage(error)}\n`)
    return ServeExitCode.runtime
  } finally {
    await shutdownRuntime(runtime, io, 'qiongqi chat')
  }
}

async function runChatTurn(input: {
  runtime: ServerRuntime
  threadId: string
  prompt: string
  model: string
  io: CliIo
}): Promise<boolean> {
  const prompt = input.prompt.trim()
  if (!prompt || prompt === '/exit' || prompt === '/quit') return false
  const turn = await input.runtime.turnService.startTurn({
    threadId: input.threadId,
    request: { prompt, model: input.model, mode: 'agent' }
  })
  let streamed = false
  const unsubscribe = input.runtime.eventBus.subscribe(input.threadId, (event) => {
    if (event.turnId !== turn.turnId) return
    if (event.kind === 'assistant_text_delta' && event.item.kind === 'assistant_text') {
      streamed = true
      input.io.stdout.write(event.item.text)
    }
  })
  await input.runtime.runTurn(input.threadId, turn.turnId)
  unsubscribe()
  if (!streamed) {
    input.io.stdout.write(assistantText(await input.runtime.sessionStore.loadItems(input.threadId)))
  }
  input.io.stdout.write('\n')
  return true
}

async function runExec(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseSharedOptions(argv, io)
  if (!parsed.ok) return writeParseError(parsed, io, 'qiongqi exec')
  let runtime: ServerRuntime | undefined
  try {
    runtime = await createRuntime(parsed.options, io)
  } catch (error) {
    io.stderr.write(`qiongqi exec: ${errorMessage(error)}\n`)
    return ServeExitCode.runtime
  }
  const host = runtime.toolHost ?? new LocalToolHost({ tools: buildDefaultLocalTools() })
  const context = buildExecContext(parsed.options, parsed.workspace)
  const json = parsed.json
  try {
    if (hasFlag(argv, 'list-tools')) {
      const tools = await host.listTools(context)
      io.stdout.write(json ? `${JSON.stringify({ tools })}\n` : `${tools.map((tool) => tool.name).join('\n')}\n`)
      return ServeExitCode.ok
    }
    const [toolName] = positionals(argv)
    if (!toolName) {
      io.stderr.write('qiongqi exec: missing tool name (use --list-tools to inspect tools)\n')
      return ServeExitCode.usage
    }
    const argsText = stringFlag(argv, ['args']) ?? '{}'
    const args = parseJsonObject(argsText)
    if (!args.ok) {
      io.stderr.write(`qiongqi exec: ${args.message}\n`)
      return ServeExitCode.config
    }
    const result = await host.execute({
      callId: `cli_${Date.now().toString(36)}`,
      toolName,
      arguments: args.value
    }, context)
    if (json) {
      io.stdout.write(JSON.stringify(result.item) + '\n')
    } else if (result.item.kind === 'tool_result') {
      io.stdout.write(`${formatToolOutput(result.item.output)}\n`)
    } else {
      io.stdout.write(`${JSON.stringify(result.item, null, 2)}\n`)
    }
    return result.item.kind === 'tool_result' && result.item.isError ? ServeExitCode.runtime : ServeExitCode.ok
  } catch (error) {
    io.stderr.write(`qiongqi exec: ${errorMessage(error)}\n`)
    return ServeExitCode.runtime
  } finally {
    await shutdownRuntime(runtime, io, 'qiongqi exec')
  }
}

type SharedOptionsResult =
  | { ok: true; options: ServeOptions; workspace: string; json: boolean }
  | { ok: false; exitCode: number; message: string; issues?: unknown }

type WorkerShard = { index: number; count: number; agentIds: string[] }
type WorkerPoolPlan = { mode: 'worker_pool_plan'; poolSize: number; shards: WorkerShard[] }
type WorkerDeploymentPlan = {
  mode: 'worker_deployment_plan'
  supervisor: { command: string[] }
  workers: Array<{ shard: WorkerShard; command: string[] }>
  probes: {
    livenessPath: string
    readinessPath: string
    metricsPath: string
    prometheusMetricsPath: string
    eventedV2MetricsPath: string
  }
}

function parseSharedOptions(argv: readonly string[], io: CliIo): SharedOptionsResult {
  const parsed = parseServeOptionsSafe(argv, io.env ?? {})
  if (!parsed.ok) return parsed
  return {
    ok: true,
    options: parsed.options,
    workspace: stringFlag(argv, ['workspace']) ?? io.env?.QIONGQI_WORKSPACE ?? io.cwd?.() ?? process.cwd(),
    json: hasFlag(argv, 'json')
  }
}

/**
 * Resolve the runtime factory for the given preset.
 *
 * Stage 1.5: the CLI defaults to the `coding` preset so `qiongqi serve`
 * and friends produce a coding-focused agent out of the box. Callers
 * that want the plain Qiongqi runtime can pass `--preset generic` or
 * set `QIONGQI_PRESET=generic`.
 */
function resolveRuntimeFactory(
  preset: ServePreset
): (options: ServeOptions) => Promise<ServerRuntime> {
  if (preset === 'generic') return createAgent
  return createCodingAgent
}

function createRuntime(options: ServeOptions, io: CliIo): Promise<ServerRuntime> {
  if (io.createRuntime) return io.createRuntime(options)
  const factory = resolveRuntimeFactory(options.preset)
  return factory(options)
}

function parseWorkerShard(argv: readonly string[]): { ok: true; value?: WorkerShard } | { ok: false; message: string } {
  const rawIndex = stringFlag(argv, ['shard-index', 'worker-shard-index'])
  const rawCount = stringFlag(argv, ['shard-count', 'worker-shard-count'])
  if (rawIndex === undefined && rawCount === undefined) return { ok: true }
  if (rawIndex === undefined || rawCount === undefined) {
    return { ok: false, message: '--shard-index and --shard-count must be provided together' }
  }
  const index = Number(rawIndex)
  const count = Number(rawCount)
  if (!Number.isInteger(index) || !Number.isInteger(count) || count <= 0 || index < 0 || index >= count) {
    return { ok: false, message: '--shard-index must be an integer in [0, shard-count) and --shard-count must be positive' }
  }
  return { ok: true, value: { index, count, agentIds: [] } }
}

function applyWorkerShard(options: ServeOptions, shard: WorkerShard): ServeOptions {
  const peers = options.runtime?.eventedV2AgentPeers
  if (!peers || Object.keys(peers).length === 0) return options
  const agentIds = Object.keys(peers).sort()
    .filter((_agentId, position) => position % shard.count === shard.index)
  const eventedV2AgentPeers = Object.fromEntries(agentIds.map((agentId) => [agentId, peers[agentId]]))
  shard.agentIds = agentIds
  return {
    ...options,
    runtime: {
      ...options.runtime,
      eventedV2AgentPeers
    }
  }
}

function buildWorkerPoolPlan(options: ServeOptions, argv: readonly string[]): { ok: true; value: WorkerPoolPlan } | { ok: false; message: string } {
  const rawPoolSize = stringFlag(argv, ['pool-size', 'worker-pool-size'])
  if (rawPoolSize === undefined) return { ok: false, message: '--plan requires --pool-size <n>' }
  const peers = options.runtime?.eventedV2AgentPeers ?? {}
  const agentIds = Object.keys(peers).sort()
  const poolSize = rawPoolSize === 'auto' ? Math.max(1, agentIds.length) : Number(rawPoolSize)
  if (!Number.isInteger(poolSize) || poolSize <= 0) {
    return { ok: false, message: '--pool-size must be a positive integer or auto' }
  }
  return {
    ok: true,
    value: {
      mode: 'worker_pool_plan',
      poolSize,
      shards: Array.from({ length: poolSize }, (_unused, index) => ({
        index,
        count: poolSize,
        agentIds: agentIds.filter((_agentId, position) => position % poolSize === index)
      }))
    }
  }
}

function parseWorkerPoolRestartBackoff(argv: readonly string[]): { ok: true; value: number } | { ok: false; message: string } {
  const rawBackoff = stringFlag(argv, ['restart-backoff-ms', 'worker-restart-backoff-ms'])
  if (rawBackoff === undefined) return { ok: true, value: 1000 }
  const backoff = Number(rawBackoff)
  if (!Number.isInteger(backoff) || backoff < 0) {
    return { ok: false, message: '--restart-backoff-ms must be a non-negative integer' }
  }
  return { ok: true, value: backoff }
}

function parseWorkerPoolMaxRestarts(argv: readonly string[]): { ok: true; value?: number } | { ok: false; message: string } {
  const rawMaxRestarts = stringFlag(argv, ['max-restarts', 'worker-max-restarts'])
  if (rawMaxRestarts === undefined) return { ok: true }
  const maxRestarts = Number(rawMaxRestarts)
  if (!Number.isInteger(maxRestarts) || maxRestarts < 0) {
    return { ok: false, message: '--max-restarts must be a non-negative integer' }
  }
  return { ok: true, value: maxRestarts }
}

function formatWorkerPoolPlan(plan: WorkerPoolPlan): string {
  const lines = [`qiongqi worker pool plan: ${plan.poolSize} shard(s)`]
  for (const shard of plan.shards) {
    lines.push(`  shard ${shard.index}/${shard.count}: ${shard.agentIds.join(', ') || '(no agents)'}`)
  }
  return `${lines.join('\n')}\n`
}

function formatWorkerPoolRunning(plan: WorkerPoolPlan): string {
  const lines = [`qiongqi worker pool running: ${plan.poolSize} shard(s)`]
  for (const shard of plan.shards) {
    lines.push(`  shard ${shard.index}/${shard.count}: ${shard.agentIds.join(', ') || '(no agents)'}`)
  }
  return `${lines.join('\n')}\n`
}

function buildWorkerDeploymentPlan(argv: readonly string[], plan: WorkerPoolPlan): WorkerDeploymentPlan {
  return {
    mode: 'worker_deployment_plan',
    supervisor: {
      command: ['qiongqi', 'worker', ...stripWorkerDeploymentPlanFlags(argv)]
    },
    workers: plan.shards.map((shard) => ({
      shard,
      command: ['qiongqi', 'worker', ...stripWorkerSupervisorFlags(argv), '--shard-index', String(shard.index), '--shard-count', String(shard.count)]
    })),
    probes: {
      livenessPath: '/health',
      readinessPath: '/ready',
      metricsPath: '/v1/runtime/metrics',
      prometheusMetricsPath: '/v1/runtime/metrics?format=prometheus',
      eventedV2MetricsPath: '/v1/runtime/evented-v2/metrics'
    }
  }
}

function formatWorkerDeploymentPlan(plan: WorkerDeploymentPlan): string {
  const lines = [
    'qiongqi worker deployment plan:',
    `  supervisor: ${plan.supervisor.command.join(' ')}`
  ]
  for (const worker of plan.workers) {
    lines.push(`  worker shard ${worker.shard.index}/${worker.shard.count}: ${worker.command.join(' ')}`)
  }
  lines.push(`  probes: ${plan.probes.livenessPath}, ${plan.probes.readinessPath}, ${plan.probes.prometheusMetricsPath}`)
  return `${lines.join('\n')}\n`
}

function workerChildArgs(argv: readonly string[], shard: WorkerShard): string[] {
  return [
    process.argv[1] ?? 'qiongqi',
    'worker',
    ...stripWorkerSupervisorFlags(argv),
    '--shard-index',
    String(shard.index),
    '--shard-count',
    String(shard.count)
  ]
}

function spawnWorkerProcess(io: CliIo, args: string[], shard: WorkerShard): WorkerChildProcess {
  if (io.spawnWorker) return io.spawnWorker(args, shard)
  return spawnChildProcess(process.execPath, args, {
    stdio: 'inherit',
    env: process.env
  })
}

function stripWorkerSupervisorFlags(argv: readonly string[]): string[] {
  const removeValueFlags = new Set(['pool-size', 'worker-pool-size', 'restart-backoff-ms', 'worker-restart-backoff-ms', 'max-restarts', 'worker-max-restarts', 'shard-index', 'worker-shard-index', 'shard-count', 'worker-shard-count'])
  const removeBooleanFlags = new Set(['plan', 'deployment-plan', 'json'])
  return stripFlags(argv, removeValueFlags, removeBooleanFlags)
}

function stripWorkerDeploymentPlanFlags(argv: readonly string[]): string[] {
  return stripFlags(argv, new Set(), new Set(['deployment-plan', 'json']))
}

function stripFlags(
  argv: readonly string[],
  removeValueFlags: ReadonlySet<string>,
  removeBooleanFlags: ReadonlySet<string>
): string[] {
  const stripped: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      stripped.push(token)
      continue
    }
    const eq = token.indexOf('=')
    const key = eq >= 0 ? token.slice(2, eq) : token.slice(2)
    if (removeBooleanFlags.has(key)) continue
    if (removeValueFlags.has(key)) {
      if (eq < 0) index += 1
      continue
    }
    stripped.push(token)
  }
  return stripped
}

function sleepForWorkerSupervisor(io: CliIo, ms: number): Promise<void> {
  if (io.sleep) return io.sleep(ms)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function shutdownRuntime(
  runtime: ServerRuntime | undefined,
  io: CliIo,
  label: string
): Promise<void> {
  if (!runtime?.shutdown) return
  try {
    await runtime.shutdown()
  } catch (error) {
    io.stderr.write(`${label}: shutdown failed: ${errorMessage(error)}\n`)
  }
}

function buildExecContext(options: ServeOptions, workspace: string): ToolHostContext {
  const modelProfiles = modelContextProfilesFromConfig({
    contextCompaction: options.contextCompaction,
    models: options.models
  })
  return {
    threadId: 'cli_exec',
    turnId: 'cli_exec',
    workspace,
    threadMode: 'agent',
    model: modelCapabilitiesForModel(options.model, modelProfiles),
    memoryPolicy: { enabled: false },
    delegationPolicy: { enabled: false },
    approvalPolicy: options.approvalPolicy,
    abortSignal: new AbortController().signal,
    awaitApproval: async () => (options.approvalPolicy === 'auto' ? 'allow' : 'deny')
  }
}

function writeParseError(
  parsed: Extract<SharedOptionsResult, { ok: false }>,
  io: CliIo,
  label: string
): number {
  io.stderr.write(`${label}: ${parsed.message}\n`)
  if (parsed.issues) {
    io.stderr.write(`${JSON.stringify(parsed.issues, null, 2)}\n`)
  }
  return parsed.exitCode
}

function assistantText(items: readonly TurnItem[]): string {
  return items
    .filter((item): item is Extract<TurnItem, { kind: 'assistant_text' }> => item.kind === 'assistant_text')
    .map((item) => item.text)
    .join('\n')
}

function parseJsonObject(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: '--args must be a JSON object' }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (error) {
    return { ok: false, message: `invalid --args JSON: ${errorMessage(error)}` }
  }
}

function positionals(argv: readonly string[]): string[] {
  const out: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      out.push(...argv.slice(index + 1))
      break
    }
    if (token.startsWith('--')) {
      const flag = token.slice(2).split('=')[0] ?? ''
      if (!token.includes('=') && VALUE_FLAGS.has(flag)) index += 1
      continue
    }
    if (token.startsWith('-') && token.length > 1) {
      const flag = token.slice(1)
      if (VALUE_FLAGS.has(flag)) index += 1
      continue
    }
    out.push(token)
  }
  return out
}

function stringFlag(argv: readonly string[], names: readonly string[]): string | undefined {
  const nameSet = new Set(names)
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      const key = eq >= 0 ? token.slice(2, eq) : token.slice(2)
      if (nameSet.has(key)) {
        return eq >= 0 ? token.slice(eq + 1) : argv[index + 1]
      }
    } else if (token.startsWith('-') && nameSet.has(token.slice(1))) {
      return argv[index + 1]
    }
  }
  return undefined
}

function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.some((token) => token === `--${name}` || token === `--${name}=true`)
}

function waitForWorkerShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.off('SIGTERM', stop)
      process.off('SIGINT', stop)
      resolve()
    }
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
  })
}

function formatToolOutput(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output, null, 2)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isTtyInput(input: NodeJS.ReadableStream): boolean {
  return Boolean((input as NodeJS.ReadStream).isTTY)
}

function isReadlineClosedError(error: unknown): boolean {
  return error instanceof Error && error.message === 'readline was closed'
}
