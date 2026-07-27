import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QIONGQI_CLI_USAGE, runAgentCommand, splitQiongqiCliCommand } from '@qiongqi/cli'
import { ServeExitCode } from '@qiongqi/cli'
import type { ServerRuntime } from '@qiongqi/http'

describe('Qiongqi agent CLI text', () => {
  it('uses qiongqi naming in the top-level usage text', () => {
    expect(QIONGQI_CLI_USAGE).toContain('qiongqi <command> [options]')
    expect(QIONGQI_CLI_USAGE).not.toContain('kun <command>')
  })

  it('uses qiongqi naming in command errors', async () => {
    let stderr = ''

    const code = await runAgentCommand('run', ['--data-dir', '/tmp/qiongqi-data', '--api-key', 'test-key', '--base-url', 'https://example.invalid/v1'], {
      stdout: { write: () => undefined },
      stderr: { write: (chunk) => { stderr += chunk } },
      env: {},
      cwd: () => '/tmp/workspace'
    })

    expect(code).toBe(64)
    expect(stderr).toContain('qiongqi run: missing prompt')
    expect(stderr).not.toContain('kun run')
  })

  it('recognizes the evented_v2 worker command', () => {
    expect(splitQiongqiCliCommand(['worker', '--once'])).toEqual({
      command: 'worker',
      args: ['--once']
    })
  })

  it('runs an evented_v2 worker flush once without starting the HTTP server', async () => {
    let stdout = ''
    let outboxFlushes = 0
    let remoteFlushes = 0
    let shutdowns = 0
    const runtime = {
      multiAgentOutboxReconciler: {
        flushOnce: async () => {
          outboxFlushes += 1
          return { runIds: ['mar_1'], runsFlushed: 1, startedAt: '2026-07-21T00:00:00.000Z', finishedAt: '2026-07-21T00:00:00.001Z' }
        },
        start: () => undefined,
        stop: () => undefined,
        isRunning: () => false
      },
      multiAgentRemoteScheduler: {
        flushOnce: async () => {
          remoteFlushes += 1
          return { agentIds: ['researcher'], agentsChecked: 1, messagesProcessed: 1, messageIds: ['msg_1'], startedAt: '2026-07-21T00:00:00.000Z', finishedAt: '2026-07-21T00:00:00.001Z' }
        },
        start: () => undefined,
        stop: () => undefined,
        isRunning: () => false,
        snapshot: () => ({ workerId: 'worker_a', status: 'stopped', health: 'ok', agentIds: ['researcher'] })
      },
      shutdown: async () => {
        shutdowns += 1
      }
    } as unknown as ServerRuntime

    const code = await runAgentCommand('worker', [
      '--once',
      '--json',
      '--data-dir', '/tmp/qiongqi-data',
      '--api-key', 'test-key',
      '--base-url', 'https://example.invalid/v1'
    ], {
      stdout: { write: (chunk) => { stdout += chunk } },
      stderr: { write: () => undefined },
      env: {},
      cwd: () => '/tmp/workspace',
      createRuntime: async () => runtime
    })

    expect(code).toBe(ServeExitCode.ok)
    expect(outboxFlushes).toBe(1)
    expect(remoteFlushes).toBe(1)
    expect(shutdowns).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({
      mode: 'worker',
      outbox: { runsFlushed: 1 },
      remote: { messagesProcessed: 1 }
    })
  })

  it('shards evented_v2 worker peer bindings before creating the runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-worker-shard-'))
    const configPath = join(root, 'config.json')
    let stdout = ''
    let capturedOptions: unknown
    const runtime = {
      multiAgentOutboxReconciler: {
        flushOnce: async () => ({ runIds: [], runsFlushed: 0, startedAt: '2026-07-21T00:00:00.000Z', finishedAt: '2026-07-21T00:00:00.001Z' }),
        start: () => undefined,
        stop: () => undefined,
        isRunning: () => false
      },
      multiAgentRemoteScheduler: {
        flushOnce: async () => ({ agentIds: ['researcher', 'writer'], agentsChecked: 2, messagesProcessed: 0, messageIds: [], startedAt: '2026-07-21T00:00:00.000Z', finishedAt: '2026-07-21T00:00:00.001Z' }),
        start: () => undefined,
        stop: () => undefined,
        isRunning: () => false,
        snapshot: () => ({ workerId: 'worker_a', status: 'stopped', health: 'ok', agentIds: ['researcher', 'writer'] })
      },
      shutdown: async () => undefined
    } as unknown as ServerRuntime
    await writeFile(configPath, JSON.stringify({
      serve: {
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'test-key'
      },
      runtime: {
        eventedV2AgentPeers: {
          planner: 'peer_planner',
          researcher: 'peer_researcher',
          reviewer: 'peer_reviewer',
          writer: 'peer_writer'
        }
      }
    }), 'utf8')

    try {
      const code = await runAgentCommand('worker', [
        '--once',
        '--json',
        '--config', configPath,
        '--shard-index', '1',
        '--shard-count', '2',
        '--data-dir', '/tmp/qiongqi-data'
      ], {
        stdout: { write: (chunk) => { stdout += chunk } },
        stderr: { write: () => undefined },
        env: {},
        cwd: () => '/tmp/workspace',
        createRuntime: async (options) => {
          capturedOptions = options
          return runtime
        }
      })

      expect(code).toBe(ServeExitCode.ok)
      expect((capturedOptions as { runtime?: { eventedV2AgentPeers?: unknown } }).runtime?.eventedV2AgentPeers).toEqual({
        researcher: 'peer_researcher',
        writer: 'peer_writer'
      })
      expect(JSON.parse(stdout)).toMatchObject({
        mode: 'worker',
        shard: { index: 1, count: 2, agentIds: ['researcher', 'writer'] }
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('plans an evented_v2 worker pool without creating runtimes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-worker-pool-'))
    const configPath = join(root, 'config.json')
    let stdout = ''
    let runtimeCreations = 0
    await writeFile(configPath, JSON.stringify({
      serve: {
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'test-key'
      },
      runtime: {
        eventedV2AgentPeers: {
          planner: 'peer_planner',
          researcher: 'peer_researcher',
          reviewer: 'peer_reviewer',
          writer: 'peer_writer'
        }
      }
    }), 'utf8')

    try {
      const code = await runAgentCommand('worker', [
        '--plan',
        '--json',
        '--config', configPath,
        '--pool-size', '2',
        '--data-dir', '/tmp/qiongqi-data'
      ], {
        stdout: { write: (chunk) => { stdout += chunk } },
        stderr: { write: () => undefined },
        env: {},
        cwd: () => '/tmp/workspace',
        createRuntime: async () => {
          runtimeCreations += 1
          throw new Error('must not create runtime for pool planning')
        }
      })

      expect(code).toBe(ServeExitCode.ok)
      expect(runtimeCreations).toBe(0)
      expect(JSON.parse(stdout)).toEqual({
        mode: 'worker_pool_plan',
        poolSize: 2,
        shards: [
          { index: 0, count: 2, agentIds: ['planner', 'reviewer'] },
          { index: 1, count: 2, agentIds: ['researcher', 'writer'] }
        ]
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('plans an automatically sized evented_v2 worker pool from peer bindings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-worker-pool-auto-'))
    const configPath = join(root, 'config.json')
    let stdout = ''
    let runtimeCreations = 0
    await writeFile(configPath, JSON.stringify({
      serve: {
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'test-key'
      },
      runtime: {
        eventedV2AgentPeers: {
          planner: 'peer_planner',
          researcher: 'peer_researcher',
          reviewer: 'peer_reviewer'
        }
      }
    }), 'utf8')

    try {
      const code = await runAgentCommand('worker', [
        '--plan',
        '--json',
        '--config', configPath,
        '--pool-size', 'auto',
        '--data-dir', '/tmp/qiongqi-data'
      ], {
        stdout: { write: (chunk) => { stdout += chunk } },
        stderr: { write: () => undefined },
        env: {},
        cwd: () => '/tmp/workspace',
        createRuntime: async () => {
          runtimeCreations += 1
          throw new Error('must not create runtime for automatic pool planning')
        }
      })

      expect(code).toBe(ServeExitCode.ok)
      expect(runtimeCreations).toBe(0)
      expect(JSON.parse(stdout)).toEqual({
        mode: 'worker_pool_plan',
        poolSize: 3,
        shards: [
          { index: 0, count: 3, agentIds: ['planner'] },
          { index: 1, count: 3, agentIds: ['researcher'] },
          { index: 2, count: 3, agentIds: ['reviewer'] }
        ]
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('prints a production deployment plan for an evented_v2 worker pool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-worker-deployment-plan-'))
    const configPath = join(root, 'config.json')
    let stdout = ''
    let runtimeCreations = 0
    await writeFile(configPath, JSON.stringify({
      serve: {
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'test-key'
      },
      runtime: {
        eventedV2AgentPeers: {
          planner: 'peer_planner',
          researcher: 'peer_researcher'
        }
      }
    }), 'utf8')

    try {
      const code = await runAgentCommand('worker', [
        '--deployment-plan',
        '--json',
        '--config', configPath,
        '--pool-size', 'auto',
        '--restart-backoff-ms', '500',
        '--max-restarts', '3',
        '--data-dir', '/tmp/qiongqi-data'
      ], {
        stdout: { write: (chunk) => { stdout += chunk } },
        stderr: { write: () => undefined },
        env: {},
        cwd: () => '/tmp/workspace',
        createRuntime: async () => {
          runtimeCreations += 1
          throw new Error('must not create runtime for deployment planning')
        }
      })

      expect(code).toBe(ServeExitCode.ok)
      expect(runtimeCreations).toBe(0)
      expect(JSON.parse(stdout)).toEqual({
        mode: 'worker_deployment_plan',
        supervisor: {
          command: ['qiongqi', 'worker', '--config', configPath, '--pool-size', 'auto', '--restart-backoff-ms', '500', '--max-restarts', '3', '--data-dir', '/tmp/qiongqi-data']
        },
        workers: [
          {
            shard: { index: 0, count: 2, agentIds: ['planner'] },
            command: ['qiongqi', 'worker', '--config', configPath, '--data-dir', '/tmp/qiongqi-data', '--shard-index', '0', '--shard-count', '2']
          },
          {
            shard: { index: 1, count: 2, agentIds: ['researcher'] },
            command: ['qiongqi', 'worker', '--config', configPath, '--data-dir', '/tmp/qiongqi-data', '--shard-index', '1', '--shard-count', '2']
          }
        ],
        probes: {
          livenessPath: '/health',
          readinessPath: '/ready',
          metricsPath: '/v1/runtime/metrics',
          prometheusMetricsPath: '/v1/runtime/metrics?format=prometheus',
          eventedV2MetricsPath: '/v1/runtime/evented-v2/metrics'
        }
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('starts an evented_v2 worker pool by spawning one worker per shard', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-worker-supervisor-'))
    const configPath = join(root, 'config.json')
    const spawned: Array<{ args: string[]; killed: boolean }> = []
    let stdout = ''
    let runtimeCreations = 0
    await writeFile(configPath, JSON.stringify({
      serve: {
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'test-key'
      },
      runtime: {
        eventedV2AgentPeers: {
          planner: 'peer_planner',
          researcher: 'peer_researcher',
          reviewer: 'peer_reviewer',
          writer: 'peer_writer'
        }
      }
    }), 'utf8')

    try {
      const code = await runAgentCommand('worker', [
        '--json',
        '--config', configPath,
        '--pool-size', '2',
        '--data-dir', '/tmp/qiongqi-data'
      ], {
        stdout: { write: (chunk) => { stdout += chunk } },
        stderr: { write: () => undefined },
        env: {},
        cwd: () => '/tmp/workspace',
        createRuntime: async () => {
          runtimeCreations += 1
          throw new Error('pool supervisor must not create runtime directly')
        },
        spawnWorker: (args) => {
          const child = { args: [...args], killed: false }
          spawned.push(child)
          return {
            kill: () => {
              child.killed = true
            }
          }
        },
        waitForWorkerShutdown: async () => undefined
      })

      expect(code).toBe(ServeExitCode.ok)
      expect(runtimeCreations).toBe(0)
      expect(spawned).toMatchObject([
        { args: expect.arrayContaining(['worker', '--config', configPath, '--data-dir', '/tmp/qiongqi-data', '--shard-index', '0', '--shard-count', '2']) },
        { args: expect.arrayContaining(['worker', '--config', configPath, '--data-dir', '/tmp/qiongqi-data', '--shard-index', '1', '--shard-count', '2']) }
      ])
      expect(spawned.every((child) => child.killed)).toBe(true)
      expect(JSON.parse(stdout)).toMatchObject({
        mode: 'worker_pool',
        poolSize: 2,
        shards: [
          { index: 0, count: 2, agentIds: ['planner', 'reviewer'] },
          { index: 1, count: 2, agentIds: ['researcher', 'writer'] }
        ]
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an invalid evented_v2 worker pool size before creating runtimes', async () => {
    let stderr = ''
    let runtimeCreations = 0

    const code = await runAgentCommand('worker', [
      '--pool-size', '0',
      '--data-dir', '/tmp/qiongqi-data',
      '--api-key', 'test-key',
      '--base-url', 'https://example.invalid/v1'
    ], {
      stdout: { write: () => undefined },
      stderr: { write: (chunk) => { stderr += chunk } },
      env: {},
      cwd: () => '/tmp/workspace',
      createRuntime: async () => {
        runtimeCreations += 1
        throw new Error('invalid worker pool size must not create runtime')
      }
    })

    expect(code).toBe(ServeExitCode.config)
    expect(runtimeCreations).toBe(0)
    expect(stderr).toContain('--pool-size must be a positive integer')
  })

  it('restarts an evented_v2 worker shard after an unexpected child exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-worker-supervisor-restart-'))
    const configPath = join(root, 'config.json')
    type FakeChild = {
      args: string[]
      killed: boolean
      exitListener?: (code: number | null, signal: NodeJS.Signals | null) => void
    }
    const spawned: FakeChild[] = []
    const sleepCalls: number[] = []
    let stderr = ''
    let releaseShutdown = () => undefined
    const shutdown = new Promise<void>((resolve) => {
      releaseShutdown = resolve
    })
    await writeFile(configPath, JSON.stringify({
      serve: {
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'test-key'
      },
      runtime: {
        eventedV2AgentPeers: {
          planner: 'peer_planner',
          researcher: 'peer_researcher'
        }
      }
    }), 'utf8')

    try {
      const command = runAgentCommand('worker', [
        '--config', configPath,
        '--pool-size', '1',
        '--data-dir', '/tmp/qiongqi-data'
      ], {
        stdout: { write: () => undefined },
        stderr: { write: (chunk) => { stderr += chunk } },
        env: {},
        cwd: () => '/tmp/workspace',
        spawnWorker: (args) => {
          const child: FakeChild = { args: [...args], killed: false }
          spawned.push(child)
          return {
            kill: () => {
              child.killed = true
            },
            once: (event: string, listener: (code: number | null, signal: NodeJS.Signals | null) => void) => {
              if (event === 'exit') child.exitListener = listener
            }
          }
        },
        waitForWorkerShutdown: async () => shutdown,
        sleep: async (ms: number) => {
          sleepCalls.push(ms)
        }
      })

      expect(spawned).toHaveLength(1)
      spawned[0]?.exitListener?.(1, null)
      await Promise.resolve()
      await Promise.resolve()
      releaseShutdown()

      const code = await command
      expect(code).toBe(ServeExitCode.ok)
      expect(spawned).toHaveLength(2)
      expect(spawned[1]?.args).toEqual(spawned[0]?.args)
      expect(sleepCalls).toEqual([1000])
      expect(stderr).toContain('worker shard 0/1 exited')
      expect(spawned.every((child) => child.killed)).toBe(true)
    } finally {
      releaseShutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('stops an evented_v2 worker pool when a shard exceeds max restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qiongqi-worker-supervisor-max-restarts-'))
    const configPath = join(root, 'config.json')
    type FakeChild = {
      killed: boolean
      exitListener?: (code: number | null, signal: NodeJS.Signals | null) => void
    }
    const spawned: FakeChild[] = []
    let stderr = ''
    let releaseShutdown = () => undefined
    const shutdown = new Promise<void>((resolve) => {
      releaseShutdown = resolve
    })
    await writeFile(configPath, JSON.stringify({
      serve: {
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'test-key'
      },
      runtime: {
        eventedV2AgentPeers: {
          planner: 'peer_planner'
        }
      }
    }), 'utf8')

    try {
      const command = runAgentCommand('worker', [
        '--config', configPath,
        '--pool-size', '1',
        '--restart-backoff-ms', '0',
        '--max-restarts', '1',
        '--data-dir', '/tmp/qiongqi-data'
      ], {
        stdout: { write: () => undefined },
        stderr: { write: (chunk) => { stderr += chunk } },
        env: {},
        cwd: () => '/tmp/workspace',
        spawnWorker: () => {
          const child: FakeChild = { killed: false }
          spawned.push(child)
          return {
            kill: () => {
              child.killed = true
            },
            once: (event: string, listener: (code: number | null, signal: NodeJS.Signals | null) => void) => {
              if (event === 'exit') child.exitListener = listener
            }
          }
        },
        waitForWorkerShutdown: async () => shutdown,
        sleep: async () => undefined
      })

      expect(spawned).toHaveLength(1)
      spawned[0]?.exitListener?.(1, null)
      await Promise.resolve()
      await Promise.resolve()
      expect(spawned).toHaveLength(2)
      spawned[1]?.exitListener?.(1, null)
      await Promise.resolve()
      await Promise.resolve()
      releaseShutdown()

      const code = await command
      expect(code).toBe(ServeExitCode.runtime)
      expect(spawned.every((child) => child.killed)).toBe(true)
      expect(stderr).toContain('worker shard 0/1 exceeded max restarts (1)')
    } finally {
      releaseShutdown()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an invalid evented_v2 worker pool max restart budget', async () => {
    let stderr = ''
    let runtimeCreations = 0

    const code = await runAgentCommand('worker', [
      '--pool-size', '1',
      '--max-restarts', '-1',
      '--data-dir', '/tmp/qiongqi-data',
      '--api-key', 'test-key',
      '--base-url', 'https://example.invalid/v1'
    ], {
      stdout: { write: () => undefined },
      stderr: { write: (chunk) => { stderr += chunk } },
      env: {},
      cwd: () => '/tmp/workspace',
      createRuntime: async () => {
        runtimeCreations += 1
        throw new Error('invalid worker pool restart budget must not create runtime')
      }
    })

    expect(code).toBe(ServeExitCode.config)
    expect(runtimeCreations).toBe(0)
    expect(stderr).toContain('--max-restarts must be a non-negative integer')
  })
})
