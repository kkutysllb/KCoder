import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyToolResultBudget } from '@qiongqi/tool-infra'
import { CapabilityRegistry, LocalToolHost } from '@qiongqi/adapter-tools'
import type { ToolHostContext } from '@qiongqi/ports'

function baseContext(outputDir: string): ToolHostContext {
  return {
    threadId: 'thread_budget',
    turnId: 'turn_budget',
    workspace: outputDir,
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    outputBudget: {
      outputDir,
      maxInlineBytes: 40,
      previewHeadBytes: 12,
      previewTailBytes: 12
    }
  }
}

describe('tool result budget', () => {
  it('keeps small text inline', async () => {
    const result = await applyToolResultBudget({
      toolName: 'grep',
      content: 'short output',
      maxInlineBytes: 100,
      outputDir: tmpdir()
    })

    expect(result.externalized).toBe(false)
    expect(result.modelVisibleText).toBe('short output')
  })

  it('externalizes oversized text and keeps a head/tail preview', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qiongqi-budget-'))
    try {
      const result = await applyToolResultBudget({
        toolName: 'bash',
        content: `head-${'x'.repeat(200)}-tail`,
        maxInlineBytes: 40,
        previewHeadBytes: 12,
        previewTailBytes: 12,
        outputDir: dir
      })

      expect(result.externalized).toBe(true)
      expect(result.persistedPath).toContain(dir)
      expect(result.modelVisibleText).toContain('output omitted')
      expect(result.modelVisibleText).toContain('head-')
      expect(result.modelVisibleText).toContain('-tail')
      expect(await readFile(result.persistedPath!, 'utf8')).toContain('head-')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('applies the budget inside LocalToolHost for oversized string outputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qiongqi-budget-host-'))
    try {
      const host = new LocalToolHost({
        registry: CapabilityRegistry.fromLocalTools([
          LocalToolHost.defineTool({
            name: 'loud',
            description: 'Return a long string.',
            inputSchema: { type: 'object', properties: {} },
            policy: 'auto',
            execute: async () => ({ output: `head-${'x'.repeat(200)}-tail` })
          })
        ])
      })

      const result = await host.execute(
        {
          callId: 'call_budget',
          toolName: 'loud',
          arguments: {}
        },
        baseContext(dir)
      )

      expect(result.item.kind).toBe('tool_result')
      if (result.item.kind !== 'tool_result') return
      expect(result.item.output).toMatchObject({
        externalized: true,
        toolName: 'loud'
      })
      expect(JSON.stringify(result.item.output)).toContain('output omitted')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
