#!/usr/bin/env node
import process from 'node:process'
import {
  parseServeOptionsSafe,
  qiongqiRuntimeStartupInfo,
  SERVE_USAGE,
  ServeExitCode
} from './serve.js'
import {
  QIONGQI_CLI_USAGE,
  runAgentCommand,
  splitQiongqiCliCommand
} from './agent-cli.js'
import { createAgent, createHttpServer, createOpenTelemetryRuntime } from '@qiongqi/http'
import type { ServerRuntime } from '@qiongqi/http'
import { createCodingAgent } from '@qiongqi/preset-coding'
import type { ServePreset } from './cli-options.js'
import type { ServeOptions } from './cli-options.js'

export const QIONGQI_READY_PREFIX = 'QIONGQI_READY '

/**
 * Resolve the runtime factory for the given preset.
 *
 * Mirrors {@link resolveRuntimeFactory} in agent-cli.ts but kept
 * local so the serve entrypoint has no dependency on the run/chat/exec
 * dispatcher. Both resolve to the same factories.
 */
function resolveServeRuntimeFactory(
  preset: ServePreset
): (options: ServeOptions) => Promise<ServerRuntime> {
  if (preset === 'generic') return createAgent
  return createCodingAgent
}

/**
 * Serve-mode command. Kept separate from the dispatcher so GUI startup
 * still has the exact same QIONGQI_READY handshake behavior.
 *
 * Stage 1.5: defaults to the `coding` preset via
 * {@link resolveServeRuntimeFactory}. Pass `--preset generic` for the
 * plain Qiongqi runtime.
 */
async function serveMain(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(SERVE_USAGE)
    return ServeExitCode.ok
  }
  const parsed = parseServeOptionsSafe(argv, process.env)
  if (!parsed.ok) {
    process.stderr.write(`qiongqi serve: ${parsed.message}\n`)
    if (parsed.issues) {
      process.stderr.write(`${JSON.stringify(parsed.issues, null, 2)}\n`)
    }
    return parsed.exitCode
  }
  const factory = resolveServeRuntimeFactory(parsed.options.preset)
  const runtime = await factory(parsed.options)
  const telemetry = createOpenTelemetryRuntime(parsed.options.observability?.openTelemetry)
  const handle = await createHttpServer({
    agent: runtime,
    host: parsed.options.host,
    port: parsed.options.port,
    telemetry
  })
  const info = handle.runtime.info()
  const startupInfo = qiongqiRuntimeStartupInfo({
    host: handle.host,
    port: handle.port,
    info
  })
  process.stdout.write(`${QIONGQI_READY_PREFIX}${JSON.stringify(startupInfo)}\n`)
  await new Promise<void>((resolve) => {
    const stop = () => {
      void handle.close().finally(resolve)
    }
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
  })
  return ServeExitCode.ok
}

export async function main(argv: readonly string[]): Promise<number> {
  const command = splitQiongqiCliCommand(argv)
  if (command.command === 'help') {
    if (command.error) {
      process.stderr.write(`qiongqi: ${command.error}\n`)
      process.stderr.write(QIONGQI_CLI_USAGE)
      return ServeExitCode.usage
    }
    process.stdout.write(QIONGQI_CLI_USAGE)
    return ServeExitCode.ok
  }
  if (command.command === 'serve') {
    return serveMain(command.args)
  }
  return runAgentCommand(command.command, command.args, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: () => process.cwd()
  })
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exit(code)
  },
  (error) => {
    process.stderr.write(`qiongqi serve: ${String(error)}\n`)
    process.exit(ServeExitCode.runtime)
  }
)
