import { copyFile, mkdir, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { auditShellCommand, OutputAccumulator, type CommandAuditResult } from '@qiongqi/tool-infra'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from '@qiongqi/adapter-fs'
import type { BashLocalToolOptions, TextSlice, TruncateMode } from './builtin-tool-types.js'
import { DEFAULT_BASH_TIMEOUT_SECONDS } from './builtin-tool-types.js'
import {
  describeKind,
  normalizePositiveInteger,
  shellCommandArgs,
  shellRuntimeInfo,
  terminateSpawnTree,
  waitForSpawnExit,
  withToolBoundary,
  workspaceRoot
} from './builtin-tool-utils.js'

const DEFAULT_BASH_YIELD_SECONDS = 10
const MAX_BASH_YIELD_SECONDS = 60
const SESSION_EXIT_FLUSH_MS = 50
const STOP_GRACE_MS = 1000
const FINISHED_SESSION_RETENTION_MS = 10 * 60 * 1000

type BashSessionStatus = 'running' | 'completed' | 'stopped' | 'failed'

type BashSession = {
  id: string
  command: string
  cwd: string
  shell: string
  child: ChildProcessWithoutNullStreams
  output: OutputAccumulator
  startedAt: string
  finishedAt?: string
  exitCode: number | null
  status: BashSessionStatus
  error?: string
  stopRequested: boolean
  finalized: boolean
  exitWaiters: Set<() => void>
}

type BashPayload = {
  command: string
  cwd: string
  shell: string
  exit_code: number | null
  output: string
  full_output_path: string | null
  result_files?: BashResultFile[]
  truncation: null | {
    total_lines: number
    output_lines: number
    total_bytes: number
    output_bytes: number
    truncated_by: string | null
    last_line_partial: boolean
  }
  session_id?: string
  status?: BashSessionStatus
  started_at?: string
  finished_at?: string
  pid?: number
  partial?: boolean
  stop_sent?: boolean
  error?: string
  audit?: {
    decision: CommandAuditResult['decision']
    reasons: string[]
    command: string
  }
}

type BashResultFile = {
  path: string
  relative_path: string
  source_path?: string
}

const bashSessions = new Map<string, BashSession>()

async function bashExecute(
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutSeconds: number,
  environment: Readonly<Record<string, string>> | undefined,
  onUpdate?: (update: { output: unknown; isError?: boolean }) => Promise<void> | void,
  execOperation?: (
    command: string,
    cwd: string,
    options: { signal: AbortSignal; timeoutSeconds: number; onData?: (data: Buffer) => void }
  ) => Promise<{ exitCode: number | null; shell?: string }>
): Promise<{
  output: string
  exitCode: number | null
  shell: string
  truncated: TextSlice
  fullOutputPath?: string
}> {
  await mkdir(cwd, { recursive: true })
  const shellRuntime = shellRuntimeInfo()
  let resultShell = shellRuntime.name
  const child = execOperation
    ? null
    : spawn(shellRuntime.shell, shellCommandArgs(shellRuntime, command), {
        cwd,
        env: { ...process.env, ...(environment ?? {}) },
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
  let timedOut = false
  let settled = false
  const output = new OutputAccumulator({
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
    tempFilePrefix: 'kun-bash'
  })
  let updateDirty = false
  let updateTimer: NodeJS.Timeout | undefined
  let lastUpdateAt = 0
  const handleData = (chunk: Buffer) => {
    output.append(chunk)
    scheduleUpdate()
  }
  const emitUpdate = async () => {
    if (!onUpdate || !updateDirty) return
    updateDirty = false
    lastUpdateAt = Date.now()
    const snapshot = output.snapshot({ persistIfTruncated: true })
    await onUpdate({
      output: {
        command,
        cwd,
        shell: resultShell,
        exit_code: null,
        output: snapshot.content,
        full_output_path: snapshot.fullOutputPath ?? null,
        truncation: snapshot.truncation.truncated
          ? {
              total_lines: snapshot.truncation.totalLines,
              output_lines: snapshot.truncation.outputLines,
              total_bytes: snapshot.truncation.totalBytes,
              output_bytes: snapshot.truncation.outputBytes,
              truncated_by: snapshot.truncation.truncatedBy ?? null,
              last_line_partial: snapshot.truncation.lastLinePartial === true
            }
          : null,
        partial: true
      }
    })
  }
  const scheduleUpdate = () => {
    if (!onUpdate) return
    updateDirty = true
    const delay = 100 - (Date.now() - lastUpdateAt)
    if (delay <= 0) {
      void emitUpdate()
      return
    }
    if (updateTimer) return
    updateTimer = setTimeout(() => {
      updateTimer = undefined
      void emitUpdate()
    }, delay)
  }
  const kill = () => {
    if (settled) return
    if (!child) return
    terminateSpawnTree(child)
  }
  const timer = setTimeout(() => {
    timedOut = true
    kill()
  }, timeoutSeconds * 1000)
  const onAbort = () => kill()
  let exitCode: number | null
  if (execOperation) {
    try {
      const result = await execOperation(command, cwd, {
        signal,
        timeoutSeconds,
        onData: handleData
      })
      exitCode = result.exitCode
      resultShell = result.shell ?? resultShell
    } finally {
      settled = true
      clearTimeout(timer)
      if (updateTimer) clearTimeout(updateTimer)
    }
  } else {
    if (!child) throw new Error('shell process failed to start')
    signal.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer | string) => {
      handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    exitCode = await waitForSpawnExit(child).finally(() => {
      settled = true
      clearTimeout(timer)
      if (updateTimer) clearTimeout(updateTimer)
      signal.removeEventListener('abort', onAbort)
    })
  }

  if (signal.aborted) {
    throw new Error('command aborted')
  }
  if (timedOut) {
    throw new Error(`command timed out after ${timeoutSeconds} seconds`)
  }

  output.finish()
  await emitUpdate()
  const snapshot = output.snapshot({ persistIfTruncated: true })
  await output.closeTempFile()
  const truncated: TextSlice = {
    text: snapshot.content,
    truncated: snapshot.truncation.truncated,
    totalLines: snapshot.truncation.totalLines,
    shownLines: snapshot.truncation.outputLines,
    totalBytes: snapshot.truncation.totalBytes,
    shownBytes: snapshot.truncation.outputBytes,
    firstLineExceedsLimit: snapshot.truncation.firstLineExceedsLimit,
    truncatedBy: snapshot.truncation.truncatedBy ?? undefined,
    lastLinePartial: snapshot.truncation.lastLinePartial
  }
  return {
    output: snapshot.content,
    exitCode,
    shell: resultShell,
    truncated,
    fullOutputPath: snapshot.fullOutputPath
  }
}

function createOutputAccumulator(): OutputAccumulator {
  return new OutputAccumulator({
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
    tempFilePrefix: 'kun-bash'
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nextSessionId(): string {
  return `bash_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function textSliceFromSnapshot(snapshot: ReturnType<OutputAccumulator['snapshot']>): TextSlice {
  return {
    text: snapshot.content,
    truncated: snapshot.truncation.truncated,
    totalLines: snapshot.truncation.totalLines,
    shownLines: snapshot.truncation.outputLines,
    totalBytes: snapshot.truncation.totalBytes,
    shownBytes: snapshot.truncation.outputBytes,
    firstLineExceedsLimit: snapshot.truncation.firstLineExceedsLimit,
    truncatedBy: snapshot.truncation.truncatedBy ?? undefined,
    lastLinePartial: snapshot.truncation.lastLinePartial
  }
}

function truncationPayload(truncated: TextSlice): BashPayload['truncation'] {
  return truncated.truncated
    ? {
        total_lines: truncated.totalLines,
        output_lines: truncated.shownLines,
        total_bytes: truncated.totalBytes,
        output_bytes: truncated.shownBytes,
        truncated_by: truncated.truncatedBy ?? null,
        last_line_partial: truncated.lastLinePartial === true
      }
    : null
}

async function resultPayload(input: {
  command: string
  cwd: string
  shell: string
  exitCode: number | null
  output: string
  truncated: TextSlice
  fullOutputPath?: string
}): Promise<BashPayload> {
  const resultFiles = await materializeResultFiles(input.command, input.cwd)
  return {
    command: input.command,
    cwd: input.cwd,
    shell: input.shell,
    exit_code: input.exitCode,
    output: appendTruncationNotice(input.output, input.truncated, 'tail'),
    full_output_path: input.fullOutputPath ?? null,
    ...(resultFiles.length > 0 ? { result_files: resultFiles } : {}),
    truncation: truncationPayload(input.truncated)
  }
}

async function finalizeSessionOutput(session: BashSession): Promise<void> {
  if (session.finalized) return
  await sleep(SESSION_EXIT_FLUSH_MS)
  session.output.finish()
  await session.output.closeTempFile()
  session.finalized = true
}

async function sessionPayload(
  session: BashSession,
  options: { stopSent?: boolean } = {}
): Promise<BashPayload> {
  if (session.status !== 'running') {
    await finalizeSessionOutput(session)
  }
  const snapshot = session.output.snapshot({ persistIfTruncated: true })
  const truncated = textSliceFromSnapshot(snapshot)
  const resultFiles =
    session.status === 'running' ? [] : await materializeResultFiles(session.command, session.cwd)
  return {
    command: session.command,
    cwd: session.cwd,
    shell: session.shell,
    exit_code: session.exitCode,
    output: appendTruncationNotice(snapshot.content, truncated, 'tail'),
    full_output_path: snapshot.fullOutputPath ?? null,
    ...(resultFiles.length > 0 ? { result_files: resultFiles } : {}),
    truncation: truncationPayload(truncated),
    session_id: session.id,
    status: session.status,
    started_at: session.startedAt,
    ...(session.finishedAt ? { finished_at: session.finishedAt } : {}),
    ...(typeof session.child.pid === 'number' ? { pid: session.child.pid } : {}),
    ...(session.status === 'running' ? { partial: true } : {}),
    ...(options.stopSent ? { stop_sent: true } : {}),
    ...(session.error ? { error: session.error } : {})
  }
}

async function materializeResultFiles(command: string, cwd: string): Promise<BashResultFile[]> {
  const files: BashResultFile[] = []
  const seen = new Set<string>()
  for (const rawPath of extractResultFilePaths(command)) {
    const sourcePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath)
    if (seen.has(sourcePath)) continue
    seen.add(sourcePath)
    const info = await stat(sourcePath).catch(() => null)
    if (!info?.isFile()) continue

    const sourceInsideWorkspace = isInside(cwd, sourcePath)
    if (!sourceInsideWorkspace && !isMaterializableExternalPath(sourcePath)) continue

    const targetPath = sourceInsideWorkspace ? sourcePath : resolve(cwd, basename(sourcePath))
    if (targetPath !== sourcePath) {
      await copyFile(sourcePath, targetPath)
    }
    files.push({
      path: targetPath,
      relative_path: relative(cwd, targetPath) || '.',
      ...(targetPath !== sourcePath ? { source_path: sourcePath } : {})
    })
  }
  return files
}

function extractResultFilePaths(command: string): string[] {
  const paths: string[] = []
  const redirectPattern = /(?:^|[\s;|&])\d?>{1,2}\s*(?:"([^"]+)"|'([^']+)'|([^\s'";|&<>]+))/g
  const teePattern = /(?:^|[\s;|&])tee(?:\s+-a)?\s+(?:"([^"]+)"|'([^']+)'|([^\s'";|&<>]+))/g
  collectShellPathMatches(command, redirectPattern, paths)
  collectShellPathMatches(command, teePattern, paths)
  collectScriptWritePaths(command, paths)
  return paths.filter(hasResultFileExtension)
}

/**
 * Reports written from a short Python/Node script do not pass through a shell
 * redirect. Recognize only explicit write APIs and temporary output roots so
 * ordinary input paths are not promoted to deliverables.
 */
function collectScriptWritePaths(command: string, paths: string[]): void {
  if (!/\b(?:open|write_text|write_bytes|writeFile|writeFileSync)\s*\(/i.test(command)) {
    return
  }
  const temporaryPathPattern = /(?:\/tmp\/|\/private\/tmp\/|\/var\/tmp\/|\/var\/folders\/)[^\s'"`;|&<>\\]+/gi
  let match: RegExpExecArray | null
  while ((match = temporaryPathPattern.exec(command)) !== null) {
    const path = match[0].replace(/[),.:]+$/, '')
    if (path) paths.push(path)
  }
}

function collectShellPathMatches(command: string, pattern: RegExp, paths: string[]): void {
  let match: RegExpExecArray | null
  while ((match = pattern.exec(command)) !== null) {
    const path = match[1] ?? match[2] ?? match[3]
    if (path?.trim()) paths.push(path.trim())
  }
}

function hasResultFileExtension(path: string): boolean {
  return /\.(?:md|html?|csv|json|txt|xlsx?|pdf|png|jpe?g|svg)$/i.test(path)
}

function isMaterializableExternalPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  const tmpRoot = resolve(tmpdir()).replace(/\\/g, '/')
  return (
    normalized.startsWith('/tmp/') ||
    normalized.startsWith('/private/tmp/') ||
    normalized.startsWith('/var/tmp/') ||
    normalized.startsWith('/var/folders/') ||
    (tmpRoot !== '/' && normalized.startsWith(`${tmpRoot}/`))
  )
}

function isInside(root: string, absolutePath: string): boolean {
  const rel = relative(root, absolutePath)
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !resolve(rel).startsWith('/..'))
}

function scheduleSessionCleanup(session: BashSession): void {
  const timer = setTimeout(() => {
    if (session.status !== 'running') bashSessions.delete(session.id)
  }, FINISHED_SESSION_RETENTION_MS)
  timer.unref?.()
}

function settleSession(
  session: BashSession,
  status: Exclude<BashSessionStatus, 'running'>,
  exitCode: number | null,
  error?: string
): void {
  if (session.status !== 'running') return
  session.status = status
  session.exitCode = exitCode
  session.finishedAt = new Date().toISOString()
  if (error) session.error = error
  for (const waiter of session.exitWaiters) waiter()
  session.exitWaiters.clear()
  scheduleSessionCleanup(session)
}

function waitForSessionExitOrDelay(session: BashSession, ms: number): Promise<boolean> {
  if (session.status !== 'running') return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      session.exitWaiters.delete(onExit)
      resolve(false)
    }, Math.max(0, ms))
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    session.exitWaiters.add(onExit)
  })
}

function stopSession(session: BashSession): void {
  if (session.status !== 'running') return
  session.stopRequested = true
  terminateSpawnTree(session.child)
}

function normalizeYieldSeconds(value: unknown): number {
  const raw = normalizePositiveInteger(value, DEFAULT_BASH_YIELD_SECONDS)
  return Math.max(1, Math.min(MAX_BASH_YIELD_SECONDS, raw))
}

function sessionById(sessionId: unknown): BashSession | null {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  return id ? bashSessions.get(id) ?? null : null
}

async function startBashSession(
  input: {
    command: string
    cwd: string
    signal: AbortSignal
    timeoutSeconds: number
    yieldSeconds: number
    environment?: Readonly<Record<string, string>>
  },
  onUpdate?: (update: { output: unknown; isError?: boolean }) => Promise<void> | void
): Promise<{ payload: BashPayload; isError?: boolean }> {
  await mkdir(input.cwd, { recursive: true })
  const shellRuntime = shellRuntimeInfo()
  const child = spawn(shellRuntime.shell, shellCommandArgs(shellRuntime, input.command), {
    cwd: input.cwd,
    env: { ...process.env, ...(input.environment ?? {}) },
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  const session: BashSession = {
    id: nextSessionId(),
    command: input.command,
    cwd: input.cwd,
    shell: shellRuntime.name,
    child,
    output: createOutputAccumulator(),
    startedAt: new Date().toISOString(),
    exitCode: null,
    status: 'running',
    stopRequested: false,
    finalized: false,
    exitWaiters: new Set()
  }
  bashSessions.set(session.id, session)

  let updateDirty = false
  let updateTimer: NodeJS.Timeout | undefined
  let lastUpdateAt = 0
  let liveUpdates = true
  const emitUpdate = async () => {
    if (!liveUpdates || !onUpdate || !updateDirty) return
    updateDirty = false
    lastUpdateAt = Date.now()
    await onUpdate({ output: await sessionPayload(session) })
  }
  const scheduleUpdate = () => {
    if (!liveUpdates || !onUpdate) return
    updateDirty = true
    const delay = 100 - (Date.now() - lastUpdateAt)
    if (delay <= 0) {
      void emitUpdate()
      return
    }
    if (updateTimer) return
    updateTimer = setTimeout(() => {
      updateTimer = undefined
      void emitUpdate()
    }, delay)
  }
  const handleData = (chunk: Buffer | string) => {
    if (session.finalized) return
    session.output.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    scheduleUpdate()
  }
  child.stdout.on('data', handleData)
  child.stderr.on('data', handleData)
  child.once('error', (error) => {
    settleSession(session, 'failed', null, error.message)
  })
  child.once('exit', (code) => {
    settleSession(session, session.stopRequested ? 'stopped' : 'completed', code)
  })

  const onAbort = () => stopSession(session)
  input.signal.addEventListener('abort', onAbort, { once: true })
  const timeoutMs = input.timeoutSeconds * 1000
  const yieldMs = Math.min(input.yieldSeconds * 1000, timeoutMs)
  const exited = await waitForSessionExitOrDelay(session, yieldMs)
  input.signal.removeEventListener('abort', onAbort)
  if (updateTimer) clearTimeout(updateTimer)

  if (input.signal.aborted) {
    liveUpdates = false
    stopSession(session)
    throw new Error('command aborted')
  }
  if (!exited && timeoutMs <= yieldMs) {
    liveUpdates = false
    stopSession(session)
    await waitForSessionExitOrDelay(session, STOP_GRACE_MS)
    throw new Error(`command timed out after ${input.timeoutSeconds} seconds`)
  }

  if (exited) {
    await emitUpdate()
    liveUpdates = false
    const payload = await sessionPayload(session)
    if (session.status === 'failed') return { payload, isError: true }
    return { payload, isError: session.exitCode !== null && session.exitCode !== 0 }
  }

  await emitUpdate()
  liveUpdates = false
  return { payload: await sessionPayload(session) }
}

function appendTruncationNotice(text: string, truncated: TextSlice, mode: TruncateMode): string {
  if (!truncated.truncated) return text
  const prefix = text.trimEnd()
  const notice = truncated.firstLineExceedsLimit
    ? `[first line exceeds ${formatSize(DEFAULT_MAX_BYTES)}; refine the read range or use bash for a byte-limited slice]`
    : `[truncated: showing ${describeKind(mode)} ${truncated.shownLines} of ${truncated.totalLines} lines, ${truncated.shownBytes} of ${truncated.totalBytes} bytes]`
  return prefix ? `${prefix}\n\n${notice}` : notice
}

export function createBashLocalTool(options: BashLocalToolOptions = {}): LocalTool {
  const bashOps = options.operations
  const shellRuntime = shellRuntimeInfo()
  return LocalToolHost.defineTool({
    name: 'bash',
    description: `Execute a shell command in the workspace using the host platform shell. Current shell: ${shellRuntime.name}. Use ${shellRuntime.syntax} syntax. Return combined stdout and stderr. Long-running commands return a session_id; use action="poll" to block up to yield_seconds (default ${DEFAULT_BASH_YIELD_SECONDS}s, max ${MAX_BASH_YIELD_SECONDS}s) waiting for more output or process exit, action="write" with input to send stdin, or action="stop" to terminate the session.`,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'number' },
        yield_seconds: { type: 'number' },
        action: {
          type: 'string',
          enum: ['run', 'poll', 'write', 'stop']
        },
        session_id: { type: 'string' },
        input: { type: 'string' }
      },
      required: [],
      additionalProperties: false
    },
    policy: 'on-request',
    toolKind: 'command_execution',
    capabilityClass: 'command_execution',
    execute: async (args, context, onUpdate) => withToolBoundary(async () => {
      const action = typeof args.action === 'string' ? args.action.trim() : ''
      if (action && action !== 'run') {
        if (action !== 'poll' && action !== 'write' && action !== 'stop') {
          return { output: { error: `unsupported bash session action: ${action}` }, isError: true }
        }
        const session = sessionById(args.session_id)
        if (!session) {
          return { output: { error: 'bash session not found', session_id: args.session_id ?? null }, isError: true }
        }
        if (action === 'write') {
          if (session.status !== 'running') {
            return { output: await sessionPayload(session), isError: true }
          }
          const input = typeof args.input === 'string' ? args.input : ''
          session.child.stdin.write(input)
          await waitForSessionExitOrDelay(session, normalizeYieldSeconds(args.yield_seconds) * 1000)
          const payload = await sessionPayload(session)
          return { output: payload, isError: payload.status === 'failed' }
        }
        if (action === 'stop') {
          stopSession(session)
          await waitForSessionExitOrDelay(session, STOP_GRACE_MS)
          const payload = await sessionPayload(session, { stopSent: true })
          return { output: payload, isError: session.status === 'running' || session.status === 'failed' }
        }
        await waitForSessionExitOrDelay(session, normalizeYieldSeconds(args.yield_seconds) * 1000)
        return { output: await sessionPayload(session), isError: session.status === 'failed' }
      }

      const command = typeof args.command === 'string' ? args.command : ''
      if (!command.trim()) return { output: { error: 'command is required' }, isError: true }
      const audit = auditShellCommand(command)
      if (audit.decision === 'block') {
        return {
          output: {
            command: audit.maskedCommand,
            error: 'command blocked by audit policy',
            audit: {
              decision: audit.decision,
              reasons: audit.reasons,
              command: audit.maskedCommand
            }
          },
          isError: true
        }
      }
      const timeout = normalizePositiveInteger(
        args.timeout,
        options.defaultTimeoutSeconds ?? DEFAULT_BASH_TIMEOUT_SECONDS
      )
      const yieldSeconds = normalizeYieldSeconds(args.yield_seconds)
      const cwd = workspaceRoot(context.workspace)
      try {
        if (!bashOps?.exec) {
          const result = await startBashSession(
            {
              command,
              cwd,
              signal: context.abortSignal,
              timeoutSeconds: timeout,
              yieldSeconds,
              environment: context.environment
            },
            onUpdate
          )
          return {
            output: withAudit(result.payload, audit),
            isError: result.isError
          }
        }
        const result = await bashExecute(
          command,
          cwd,
          context.abortSignal,
          timeout,
          context.environment,
          onUpdate,
          bashOps.exec
        )
        const payload = await resultPayload({
          command,
          cwd,
          shell: result.shell,
          exitCode: result.exitCode ?? 0,
          output: result.output,
          truncated: result.truncated,
          fullOutputPath: result.fullOutputPath
        })
        if (result.exitCode && result.exitCode !== 0) {
          return {
            output: withAudit(payload, audit),
            isError: true
          }
        }
        return {
          output: withAudit(payload, audit)
        }
      } catch (error) {
        return {
          output: {
            command,
            cwd,
            error: error instanceof Error ? error.message : String(error)
          },
          isError: true
        }
      }
    })
  })
}

function withAudit(payload: BashPayload, audit: CommandAuditResult): BashPayload {
  if (audit.decision === 'allow') return payload
  return {
    ...payload,
    command: audit.maskedCommand,
    audit: {
      decision: audit.decision,
      reasons: audit.reasons,
      command: audit.maskedCommand
    }
  }
}

export const createBashTool = createBashLocalTool
export const createBashToolDefinition = createBashLocalTool
