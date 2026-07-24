import type { AgentTranscript } from '@qiongqi/contracts'

/**
 * Agent 对话记录存储端口。
 * 执行投影适配器通过 transcriptRef 加载 agent 的完整对话历史。
 * 来源：KWorks ports-layer（AgentTranscriptStore）。
 */
export interface AgentTranscriptStore {
  load(transcriptRef: string): Promise<AgentTranscript | undefined>
  save(transcript: AgentTranscript): Promise<void>
  update(
    transcriptRef: string,
    mutate: (current: AgentTranscript) => AgentTranscript | Promise<AgentTranscript>
  ): Promise<AgentTranscript>
}
