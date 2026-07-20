import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '@qiongqi/adapter-storage'
import {
  expandHomePath,
  QIONGQI_CONFIG_FILENAME,
  QiongqiConfigSchema,
  type QiongqiConfig
} from '@qiongqi/contracts'
import type { QiongqiServeRuntimeOptions } from './runtime-factory.js'
import type { QiongqiConfigStore } from './routes/server-runtime.js'

export class FileQiongqiConfigStore implements QiongqiConfigStore {
  private current: QiongqiConfig
  private readonly path: string

  constructor(options: {
    path?: string
    initial: QiongqiConfig
  }) {
    this.path = expandHomePath(options.path ?? join(options.initial.serve?.dataDir ?? process.cwd(), QIONGQI_CONFIG_FILENAME))
    this.current = QiongqiConfigSchema.parse(options.initial)
  }

  async read(): Promise<QiongqiConfig> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      const parsed = QiongqiConfigSchema.parse(raw)
      this.current = parsed
      const normalized = normalizeBuiltInCapabilitiesForDisk(raw, parsed)
      if (!sameJson(raw, normalized)) {
        await atomicWriteFile(this.path, `${JSON.stringify(normalized, null, 2)}\n`)
      }
      return parsed
    } catch (error) {
      if (isNotFound(error)) return this.current
      throw error
    }
  }

  async write(config: QiongqiConfig): Promise<QiongqiConfig> {
    const parsed = QiongqiConfigSchema.parse(config)
    await atomicWriteFile(this.path, `${JSON.stringify(parsed, null, 2)}\n`)
    this.current = parsed
    return parsed
  }

  snapshot(): QiongqiConfig {
    return cloneConfig(this.current)
  }
}

export class InMemoryQiongqiConfigStore implements QiongqiConfigStore {
  private current: QiongqiConfig

  constructor(initial: QiongqiConfig) {
    this.current = QiongqiConfigSchema.parse(initial)
  }

  read(): QiongqiConfig {
    return cloneConfig(this.current)
  }

  write(config: QiongqiConfig): QiongqiConfig {
    this.current = QiongqiConfigSchema.parse(config)
    return cloneConfig(this.current)
  }

  snapshot(): QiongqiConfig {
    return cloneConfig(this.current)
  }
}

export function qiongqiConfigFromRuntimeOptions(options: QiongqiServeRuntimeOptions): QiongqiConfig {
  return QiongqiConfigSchema.parse({
    serve: {
      host: options.host,
      port: options.port,
      dataDir: options.dataDir,
      runtimeToken: options.runtimeToken,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      endpointFormat: options.endpointFormat,
      model: options.model,
      approvalPolicy: options.approvalPolicy,
      sandboxMode: options.sandboxMode,
      tokenEconomyMode: options.tokenEconomyMode,
      ...(options.tokenEconomy ? { tokenEconomy: options.tokenEconomy } : {}),
      insecure: options.insecure,
      ...(options.storage ? { storage: options.storage } : {}),
      ...(options.observability ? { observability: options.observability } : {})
    },
    ...(options.models ? { models: options.models } : {}),
    ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.capabilities ? { capabilities: options.capabilities } : {})
  })
}

function cloneConfig(config: QiongqiConfig): QiongqiConfig {
  return QiongqiConfigSchema.parse(JSON.parse(JSON.stringify(config)))
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function normalizeBuiltInCapabilitiesForDisk(raw: unknown, parsed: QiongqiConfig): unknown {
  if (!isRecord(raw)) return raw
  const rawCapabilities = raw.capabilities
  if (!isRecord(rawCapabilities) || !Object.prototype.hasOwnProperty.call(rawCapabilities, 'attachments')) {
    return raw
  }
  const nextCapabilities = {
    ...rawCapabilities,
    attachments: parsed.capabilities.attachments
  }
  return {
    ...raw,
    capabilities: nextCapabilities
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
