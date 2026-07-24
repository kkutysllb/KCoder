import {
  TurnExecutionNotFound,
  type TurnExecutionProjectionServiceContract
} from '@qiongqi/services'
import { ERRORS } from './runtime-error.js'

/**
 * GET /v1/threads/:id/turns/:turnId/execution 处理器 — 返回 turn 的执行投影视图。
 * 支持 ETag 条件请求（If-None-Match → 304）。
 * 来源：KWorks routes/turn-execution.ts（getTurnExecution）。
 */
export async function getTurnExecution(
  projection: TurnExecutionProjectionServiceContract | undefined,
  threadId: string,
  turnId: string,
  request: Request
): Promise<Response | ReturnType<typeof ERRORS.unavailable> | ReturnType<typeof ERRORS.notFound>> {
  if (!projection) return ERRORS.unavailable('turn execution projection is not available')
  try {
    const view = await projection.get({ threadId, turnId })
    const etag = `"${view.revision}"`
    const headers = {
      ETag: etag,
      'Cache-Control': 'private, no-cache',
      Vary: 'Authorization, Cookie'
    }
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers })
    }
    return Response.json(view, { status: 200, headers })
  } catch (error) {
    if (error instanceof TurnExecutionNotFound) return ERRORS.notFound()
    throw error
  }
}
