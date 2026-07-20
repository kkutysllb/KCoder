import type { RuntimeEvent } from '@qiongqi/contracts'

export function encodeSseEvent(event: RuntimeEvent): string {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}
