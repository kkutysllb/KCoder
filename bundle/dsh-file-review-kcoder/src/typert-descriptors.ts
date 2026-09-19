/** Strict Typert codecs shared by the Host and browser contribution artifacts.
 *
 * 双字段兼容（2026-09-19，dsh 0.1.6-alpha.2 适配）：alpha.2 的 typert-loader
 * 要求 strict codec 以 create() 工厂懒物化 schema（无 create 过不了注册
 * 校验，且失败连带撤回该 fiber 全部远端定义）；rc/alpha.1 时代的运行时
 * 读饿汉 schema 字段。两代并存期同时提供：新运行时取 create，旧的取
 * schema。对象以 const 持有（非新鲜字面量），旧类型系统不做多余属性
 * 检查，编译两侧兼容。
 */

import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

export const PACKAGE_NAME = 'dsh-file-review-kcoder'

const diffSchema = z.object({
  path: z.string(),
  oldText: z.string().nullable(),
  newText: z.string(),
  oldStart: z.number().int().min(1).optional(),
  newStart: z.number().int().min(1).optional(),
})

const requestSchema = z.object({
  action: z.enum(['undo', 'redo']),
  files: z.array(z.object({ path: z.string(), diffs: z.array(diffSchema) })),
})

const resultSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    state: z.enum(['applied', 'undone', 'conflict', 'unsupported', 'error']),
    changed: z.boolean(),
    reason: z.string().optional(),
  })),
})

const agentCodec = {
  mode: 'strict' as const,
  typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
  // dsh 0.1.6-alpha.2 契约：strict codec 以 create() 工厂懒物化 schema
  //（旧形态的饿汉 schema 字段过不了 typert-loader 注册校验，且失败会
  // 连带撤回该 fiber 已注册的全部远端定义）。zod schema 满足
  // TypertSchema 的 parse 契约。
  create: () => z.intersection(z.string(), z.unknown()),
  schema: z.intersection(z.string(), z.unknown()),
}

const requestCodec = {
  mode: 'strict' as const,
  typeSymbol: `${PACKAGE_NAME}#FileReviewRequest`,
  create: () => requestSchema,
  schema: requestSchema,
}

const resultCodec = {
  mode: 'strict' as const,
  typeSymbol: `${PACKAGE_NAME}#FileReviewResult`,
  create: () => resultSchema,
  schema: resultSchema,
}

const recordedMutationSchema = z.object({
  rootCallId: z.string(),
  name: z.string(),
  path: z.string(),
  before: z.string().nullable(),
  after: z.string(),
})

const recordedRequestSchema = z.object({
  rootCallIds: z.array(z.string()),
})

const recordedResultSchema = z.object({
  mutations: z.array(recordedMutationSchema),
})

const recordedRequestCodec = {
  mode: 'strict' as const,
  typeSymbol: `${PACKAGE_NAME}#RecordedRequest`,
  create: () => recordedRequestSchema,
  schema: recordedRequestSchema,
}

const recordedResultCodec = {
  mode: 'strict' as const,
  typeSymbol: `${PACKAGE_NAME}#RecordedResult`,
  create: () => recordedResultSchema,
  schema: recordedResultSchema,
}

function descriptor(method: 'status' | 'apply'): InvocationDescriptor {
  return {
    id: `${PACKAGE_NAME}#fileReview/${method}`,
    service: 'fileReview',
    namespace: 'fileReview',
    method,
    invocation: { kind: 'direct' },
    scope: { context: 'agent', wire: 'agentId' },
    parameters: [{
      name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: agentCodec,
    }, {
      name: 'request', wire: 'request', source: 'json', codec: requestCodec,
    }],
    result: resultCodec,
  }
}

function recordedDescriptor(): InvocationDescriptor {
  return {
    id: `${PACKAGE_NAME}#fileReview/recorded`,
    service: 'fileReview',
    namespace: 'fileReview',
    method: 'recorded',
    invocation: { kind: 'direct' },
    scope: { context: 'agent', wire: 'agentId' },
    parameters: [{
      name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: agentCodec,
    }, {
      name: 'request', wire: 'request', source: 'json', codec: recordedRequestCodec,
    }],
    result: recordedResultCodec,
  }
}

export const FILE_REVIEW_INVOCATIONS: readonly InvocationDescriptor[] = [
  descriptor('status'),
  descriptor('apply'),
  recordedDescriptor(),
]
