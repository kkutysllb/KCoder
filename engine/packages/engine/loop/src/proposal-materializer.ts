import type { ModelProposal } from '@qiongqi/contracts'

export type MaterializableProposalContent = {
  reasoning?: string
  text?: string
}

export function materializableProposalContent(
  proposal: ModelProposal
): MaterializableProposalContent {
  if (proposal.integrity.leakedProtocolText || proposal.integrity.malformedToolCall) {
    return {}
  }

  return {
    ...(proposal.reasoning.trim() ? { reasoning: proposal.reasoning } : {}),
    ...(proposal.text.trim() ? { text: proposal.text } : {})
  }
}
