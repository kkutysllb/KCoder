import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QiongqiCapabilitiesConfig } from '@qiongqi/contracts'
import { createThreadRecord } from '@qiongqi/domain'
import type { ModelClient, ModelRequest } from '@qiongqi/ports'
import { SkillPluginHost } from '@qiongqi/skills'
import { buildDefaultLocalTools } from '@qiongqi/adapter-tools'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

describe('work mode skill runtime filtering', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'work-mode-skills-'))
    await writeV1Skill('task-skill', 'Task Skill', 'Task instructions')
    await writeV1Skill('coding-skill', 'Coding Skill', 'Coding instructions')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('filters SkillPluginHost activations by effective skill IDs', async () => {
    const host = await SkillPluginHost.create(config().skills)

    expect(host.resolveTurn({
      prompt: 'please use the shared trigger',
      workspace: root,
      effectiveSkillIds: ['task-skill']
    }).activeSkillIds).toEqual(['task-skill'])

    expect(host.resolveTurn({
      prompt: 'please use the shared trigger',
      workspace: root,
      effectiveSkillIds: ['coding-skill']
    }).activeSkillIds).toEqual(['coding-skill'])
  })

  it('stores the inherited or requested workModeId on started turns', async () => {
    const h = makeHarness(silentModel())
    await h.threadStore.upsert(createThreadRecord({
      id: h.threadId,
      title: 'demo',
      workspace: root,
      model: 'fake',
      workModeId: 'coding'
    }))

    const inherited = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'please use the shared trigger' }
    })
    expect((await h.turns.getTurn(h.threadId, inherited.turnId))?.workModeId).toBe('coding')

    const requested = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: 'please use the shared trigger', workModeId: 'office' }
    })
    expect((await h.turns.getTurn(h.threadId, requested.turnId))?.workModeId).toBe('office')
  })

  it('injects only the active work mode skills when building a model request', async () => {
    const skillPluginHost = await SkillPluginHost.create(config().skills)
    let seenRequest: ModelRequest | undefined
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, {
      skillPluginHost,
      tools: buildDefaultLocalTools()
    })
    await bootstrapThread(h, {
      workspace: root,
      request: { prompt: 'please use the shared trigger', workModeId: 'coding' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    const joinedInstructions = seenRequest?.contextInstructions?.join('\n') ?? ''
    expect(joinedInstructions).toContain('Coding instructions')
    expect(joinedInstructions).not.toContain('Task instructions')
    expect((await h.turns.getTurn(h.threadId, h.turnId))?.activeSkillIds).toEqual(['coding-skill'])
  })

  it('advertises only the current work mode skill catalog when no skill activates', async () => {
    const skillPluginHost = await SkillPluginHost.create(config().skills)
    let seenRequest: ModelRequest | undefined
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, {
      skillPluginHost,
      tools: buildDefaultLocalTools()
    })
    await bootstrapThread(h, {
      workspace: root,
      request: { prompt: 'what skills are available?', workModeId: 'coding' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    const joinedInstructions = seenRequest?.contextInstructions?.join('\n') ?? ''
    expect(joinedInstructions).toContain('Available Skills')
    expect(joinedInstructions).toContain('Coding Skill (coding-skill)')
    expect(joinedInstructions).not.toContain('Task Skill (task-skill)')
    expect((await h.turns.getTurn(h.threadId, h.turnId))?.activeSkillIds).toEqual([])
  })

  it('injects an explicitly activated skill on the next prompt build', async () => {
    const skillPluginHost = await SkillPluginHost.create(config().skills)
    let seenRequest: ModelRequest | undefined
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, {
      skillPluginHost,
      tools: buildDefaultLocalTools()
    })
    await bootstrapThread(h, {
      workspace: root,
      request: { prompt: 'ordinary request', workModeId: 'coding' }
    })
    await h.turns.updateTurnMetadata(h.threadId, h.turnId, {
      explicitSkillIds: ['coding-skill']
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    expect(seenRequest?.contextInstructions?.join('\n')).toContain('Coding instructions')
    expect((await h.turns.getTurn(h.threadId, h.turnId))?.activeSkillIds).toEqual(['coding-skill'])
  })

  it('does not force create_plan for work mode and skill catalog questions in plan execution mode', async () => {
    const skillPluginHost = await SkillPluginHost.create(config().skills)
    let seenRequest: ModelRequest | undefined
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, {
      skillPluginHost,
      tools: buildDefaultLocalTools()
    })
    await bootstrapThread(h, {
      workspace: root,
      request: {
        prompt: '我现在在哪种工作模式？有哪些技能可以调用？',
        mode: 'plan',
        workModeId: 'coding'
      }
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    const joinedInstructions = seenRequest?.contextInstructions?.join('\n') ?? ''
    expect(seenRequest?.requiredToolName).toBeUndefined()
    expect(joinedInstructions).toContain('Current Work Mode')
    expect(joinedInstructions).toContain('id: coding')
    expect(joinedInstructions).toContain('Available Skills')
    expect(joinedInstructions).toContain('Coding Skill (coding-skill)')
    expect(joinedInstructions).not.toContain('Task Skill (task-skill)')
  })

  it('tells the model which work mode is currently selected', async () => {
    const skillPluginHost = await SkillPluginHost.create(config().skills)
    let seenRequest: ModelRequest | undefined
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { skillPluginHost })
    await bootstrapThread(h, {
      workspace: root,
      request: { prompt: 'what work mode am I using?', workModeId: 'coding' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    const joinedInstructions = seenRequest?.contextInstructions?.join('\n') ?? ''
    expect(joinedInstructions).toContain('Current Work Mode')
    expect(joinedInstructions).toContain('id: coding')
    expect(joinedInstructions).toContain('name: Coding')
    expect(joinedInstructions).toContain('user-selected work mode')
    expect(joinedInstructions).toContain('single-agent runtime')
  })

  it('tells the model about custom user-created work modes', async () => {
    const skillPluginHost = await SkillPluginHost.create(customConfig().skills)
    let seenRequest: ModelRequest | undefined
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request) {
        seenRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { skillPluginHost })
    await bootstrapThread(h, {
      workspace: root,
      request: { prompt: 'what work mode am I using?', workModeId: 'stock-quant' }
    })

    await h.loop.runTurn(h.threadId, h.turnId)

    const joinedInstructions = seenRequest?.contextInstructions?.join('\n') ?? ''
    expect(joinedInstructions).toContain('Current Work Mode')
    expect(joinedInstructions).toContain('id: stock-quant')
    expect(joinedInstructions).toContain('name: 股票量化')
    expect(joinedInstructions).toContain('Coding Skill (coding-skill)')
    expect(joinedInstructions).not.toContain('Task Skill (task-skill)')
  })

  function config() {
    return QiongqiCapabilitiesConfig.parse({
      skills: {
        enabled: true,
        roots: [root],
        lockedSkillIds: [],
        workModes: {
          defaultModeId: 'office',
          modes: {
            task: {
              id: 'office',
              name: 'Task',
              builtin: true,
              editable: true,
              defaultSkillIds: ['task-skill']
            },
            coding: {
              id: 'coding',
              name: 'Coding',
              builtin: true,
              editable: true,
              defaultSkillIds: ['coding-skill']
            }
          }
        }
      }
    })
  }

  function customConfig() {
    return QiongqiCapabilitiesConfig.parse({
      skills: {
        enabled: true,
        roots: [root],
        lockedSkillIds: [],
        workModes: {
          defaultModeId: 'office',
          modes: {
            task: {
              id: 'office',
              name: 'Task',
              builtin: true,
              editable: true,
              defaultSkillIds: ['task-skill']
            },
            'stock-quant': {
              id: 'stock-quant',
              name: '股票量化',
              description: '证券量化研究工作模式',
              builtin: false,
              editable: true,
              defaultSkillIds: ['coding-skill']
            }
          }
        }
      }
    })
  }

  async function writeV1Skill(id: string, name: string, instructions: string): Promise<void> {
    const dir = join(root, id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'skill.json'), JSON.stringify({
      specVersion: '1.0',
      id,
      name,
      activation: {
        autoActivate: true,
        promptPatterns: ['shared trigger']
      }
    }), 'utf8')
    await writeFile(join(dir, 'SKILL.md'), instructions, 'utf8')
  }

  function silentModel(): ModelClient {
    return {
      provider: 'silent',
      model: 'silent',
      async *stream() {
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
  }
})
