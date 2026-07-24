import type { ChildRunRecord } from '@qiongqi/contracts'

/**
 * 子 agent 委派记录存储端口。
 * 执行投影适配器通过 parentThreadId 列出子 agent 运行，构建委派树。
 * 来源：KWorks ports-layer（DelegationRunStore）。
 */
export interface DelegationRunStore {
  upsert(record: ChildRunRecord): Promise<void>
  list(parentThreadId?: string): Promise<ChildRunRecord[]>
  deleteByThread(threadId: string): Promise<void>
}
