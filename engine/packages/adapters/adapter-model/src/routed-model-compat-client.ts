import type { ModelClient, ModelRequest, ModelStreamChunk } from '@qiongqi/ports'
import { ModelCompatClient, type ModelCompatConfig } from './model-compat-client.js'

export type RoutedModelConfig = ModelCompatConfig & {
  aliases?: string[]
}

export class RoutedModelCompatClient implements ModelClient {
  readonly provider = 'routed-model-compat'
  readonly model: string

  private readonly fallback: ModelCompatClient
  private readonly routes = new Map<string, { client: ModelCompatClient; model: string }>()

  constructor(config: {
    fallback: ModelCompatConfig
    routes?: RoutedModelConfig[]
  }) {
    this.fallback = new ModelCompatClient(config.fallback)
    this.model = config.fallback.model
    for (const route of config.routes ?? []) {
      const client = new ModelCompatClient(route)
      this.addRoute(route.model, client)
      for (const alias of route.aliases ?? []) this.addRoute(alias, client)
    }
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const route = this.routes.get(request.model.trim()) ?? this.routes.get(normalizeRouteKey(request.model))
    if (route) {
      yield* route.client.stream({ ...request, model: route.model })
      return
    }
    yield* this.fallback.stream(request)
  }

  private addRoute(model: string, client: ModelCompatClient): void {
    const key = model.trim()
    if (!key) return
    this.routes.set(key, { client, model: client.model })
    this.routes.set(normalizeRouteKey(key), { client, model: client.model })
  }
}

function normalizeRouteKey(model: string): string {
  return model.trim().toLowerCase()
}

export class DynamicRoutedModelCompatClient implements ModelClient {
  readonly provider = 'dynamic-routed-model-compat'
  readonly model: string

  private readonly fallback: () => ModelCompatConfig | Promise<ModelCompatConfig>
  private readonly routes: () => RoutedModelConfig[] | Promise<RoutedModelConfig[]>

  constructor(config: {
    fallback: ModelCompatConfig | (() => ModelCompatConfig | Promise<ModelCompatConfig>)
    routes: () => RoutedModelConfig[] | Promise<RoutedModelConfig[]>
  }) {
    if (typeof config.fallback === 'function') {
      this.fallback = config.fallback
    } else {
      const fallback = config.fallback
      this.fallback = () => fallback
    }
    const initialFallback = typeof config.fallback === 'function' ? undefined : config.fallback
    this.model = initialFallback?.model ?? 'auto'
    this.routes = config.routes
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const client = new RoutedModelCompatClient({
      fallback: await this.fallback(),
      routes: await this.routes()
    })
    yield* client.stream(request)
  }
}
