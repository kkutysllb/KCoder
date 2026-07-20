/**
 * Mid-turn steering queue. Each turn owns an independent buffer so concurrent
 * users and tasks cannot overwrite or drain one another's pending input.
 */
export class SteeringQueue {
  private readonly buffers = new Map<string, string[]>()

  setTurn(turnId: string | null): void {
    if (turnId && !this.buffers.has(turnId)) this.buffers.set(turnId, [])
  }

  enqueue(turnId: string, text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    const buffer = this.buffers.get(turnId) ?? []
    buffer.push(trimmed)
    this.buffers.set(turnId, buffer)
  }

  drain(turnId: string): string[] {
    const buffer = this.buffers.get(turnId)
    if (!buffer?.length) return []
    this.buffers.set(turnId, [])
    return [...buffer]
  }

  peek(turnId: string): string[] {
    return [...(this.buffers.get(turnId) ?? [])]
  }

  clear(turnId?: string): void {
    if (turnId) this.buffers.delete(turnId)
    else this.buffers.clear()
  }
}
