/**
 * @qiongqi/adapter-model — provider-agnostic model compatibility client.
 *
 * Exports the {@link ModelCompatClient} (renamed from
 * `DeepseekCompatModelClient` in stage 1.3) and the pricing provider
 * abstraction.
 */
export * from './model-compat-client.js'
export * from './routed-model-compat-client.js'
export * from './pricing/index.js'
export * from './model-error-probe.js'
export * from './provider-compatibility.js'
export * from './tool-argument-repair.js'
