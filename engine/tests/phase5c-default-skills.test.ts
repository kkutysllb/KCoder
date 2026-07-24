import { describe, expect, it } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_WORK_MODES } from '@qiongqi/contracts'

/**
 * Phase 5c: 验证 coding 模式 defaultSkillIds 全部对应真实存在的技能目录。
 * 这是从 KWorks 遗留的"幽灵技能引用"清理的回归守护。
 */
const skillsDir = join(process.cwd(), 'skills')

describe('Phase 5c: coding 模式 defaultSkillIds 无幽灵技能', () => {
  it('所有 defaultSkillIds 都对应 engine/skills/ 下的真实目录', () => {
    const skillIds = DEFAULT_WORK_MODES.coding.defaultSkillIds
    expect(skillIds.length).toBeGreaterThan(0)
    const existing = new Set(readdirSync(skillsDir).filter((name) => existsSync(join(skillsDir, name, 'skill.json'))))
    const ghosts = skillIds.filter((id) => !existing.has(id))
    expect(ghosts, `幽灵技能（无对应目录）: ${ghosts.join(', ')}`).toEqual([])
  })

  it('core 编码技能都在列表中（brainstorming/tdd/systematic-debugging/code-review/refactoring）', () => {
    const ids = new Set(DEFAULT_WORK_MODES.coding.defaultSkillIds)
    expect(ids.has('brainstorming')).toBe(true)
    expect(ids.has('tdd')).toBe(true)
    expect(ids.has('systematic-debugging')).toBe(true)
    expect(ids.has('code-review')).toBe(true)
    expect(ids.has('refactoring')).toBe(true)
    expect(ids.has('verification-before-completion')).toBe(true)
  })

  it('旧的幽灵技能已全部移除（architecture/api-design/database/implement/debug/spec-driven-development 等）', () => {
    const ids = new Set(DEFAULT_WORK_MODES.coding.defaultSkillIds)
    const removed = ['architecture', 'api-design', 'database', 'implement', 'debug', 'spec-driven-development', 'typescript', 'task-decomposition', 'deployment', 'refactor', 'ci-cd']
    const stillPresent = removed.filter((id) => ids.has(id))
    expect(stillPresent, `未清理的幽灵技能: ${stillPresent.join(', ')}`).toEqual([])
  })
})
