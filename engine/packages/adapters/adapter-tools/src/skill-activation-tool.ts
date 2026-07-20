import type { ToolHostContext } from '@qiongqi/ports'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export type ActivatableSkillResult =
  | { ok: true; skill: { id: string } }
  | { ok: false; code: string }

export type ActivateSkillToolOptions = {
  resolveSkill: (skillId: string, context: ToolHostContext) => ActivatableSkillResult
  activateTurnSkill: (input: {
    threadId: string
    turnId: string
    skillId: string
  }) => Promise<void>
}

export function createActivateSkillTool(options: ActivateSkillToolOptions): LocalTool {
  return LocalToolHost.defineTool({
    name: 'activate_skill',
    description: 'Activate an enabled skill instruction package for the current turn.',
    toolKind: 'tool_call',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'The installed skill id to activate.' }
      },
      required: ['skill_id'],
      additionalProperties: false
    },
    policy: 'auto',
    execute: async (args, context) => {
      const skillId = typeof args.skill_id === 'string' ? args.skill_id.trim() : ''
      if (!skillId) {
        return {
          output: { code: 'skill_activation_rejected', reason: 'invalid_skill_id' },
          isError: true
        }
      }
      const resolved = options.resolveSkill(skillId, context)
      if (!resolved.ok) {
        return {
          output: { code: 'skill_activation_rejected', reason: resolved.code },
          isError: true
        }
      }
      await options.activateTurnSkill({
        threadId: context.threadId,
        turnId: context.turnId,
        skillId: resolved.skill.id
      })
      return { output: { code: 'skill_activated', skill_id: resolved.skill.id } }
    }
  })
}
