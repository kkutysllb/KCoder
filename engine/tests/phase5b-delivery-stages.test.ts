import { describe, expect, it } from 'vitest'
import { CODING_DELIVERY_STAGES } from '@qiongqi/http'

/**
 * Phase 5b: 验证 coding delivery stages（5 阶段 + 真实技能 + 阶段链路）。
 */
const REAL_SKILL_IDS = new Set([
  'brainstorming', 'planning', 'goal',
  'writing-plans', 'planning-with-files', 'using-git-worktrees',
  'tdd', 'test-driven-development', 'debugging', 'frontend-design',
  'code-review', 'security-review', 'verification-before-completion', 'webapp-testing',
  'release-notes', 'finishing-a-development-branch'
])

describe('Phase 5b: CODING_DELIVERY_STAGES', () => {
  it('恰好 5 个阶段', () => {
    expect(CODING_DELIVERY_STAGES).toHaveLength(5)
  })

  it('阶段顺序: requirements → planning → implementation → review → delivery', () => {
    const ids = CODING_DELIVERY_STAGES.map((s) => s.id)
    expect(ids).toEqual(['requirements', 'planning', 'implementation', 'review', 'delivery'])
    // next_stage_id 形成链路
    expect(CODING_DELIVERY_STAGES[0]!.next_stage_id).toBe('planning')
    expect(CODING_DELIVERY_STAGES[1]!.next_stage_id).toBe('implementation')
    expect(CODING_DELIVERY_STAGES[2]!.next_stage_id).toBe('review')
    expect(CODING_DELIVERY_STAGES[3]!.next_stage_id).toBe('delivery')
    expect(CODING_DELIVERY_STAGES[4]!.next_stage_id).toBeNull()
  })

  it('每阶段字段完整（id/title/goal/recommended_skills/suggested_prompt/next_stage_id）', () => {
    for (const stage of CODING_DELIVERY_STAGES) {
      expect(typeof stage.id).toBe('string')
      expect(stage.id.length).toBeGreaterThan(0)
      expect(typeof stage.title).toBe('string')
      expect(typeof stage.goal).toBe('string')
      expect(Array.isArray(stage.recommended_skills)).toBe(true)
      expect(stage.recommended_skills.length).toBeGreaterThan(0)
      expect(typeof stage.suggested_prompt).toBe('string')
      expect(stage.next_stage_id === null || typeof stage.next_stage_id === 'string').toBe(true)
    }
  })

  it('每阶段的 recommended_skills 都真实存在（无幽灵技能）', () => {
    const ghosts: string[] = []
    for (const stage of CODING_DELIVERY_STAGES) {
      for (const skillId of stage.recommended_skills) {
        if (!REAL_SKILL_IDS.has(skillId)) ghosts.push(`${stage.id}.${skillId}`)
      }
    }
    expect(ghosts, `幽灵技能: ${ghosts.join(', ')}`).toEqual([])
  })

  it('阶段 goal/suggested_prompt 为中文（对齐 KCoder 中文定位）', () => {
    for (const stage of CODING_DELIVERY_STAGES) {
      // 至少含一个中文字符
      expect(stage.goal).toMatch(/[\u4e00-\u9fff]/)
      expect(stage.suggested_prompt).toMatch(/[\u4e00-\u9fff]/)
    }
  })
})
