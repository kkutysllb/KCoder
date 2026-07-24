import { describe, expect, it } from 'vitest'
import { CODING_SYSTEM_PROMPT } from '@qiongqi/preset-coding'

/**
 * Phase 5a: 验证补全后的 coding-system-prompt 包含场景编排 + 递归分析块，
 * 且每条场景链引用的技能都真实存在于 KCoder skills/ 目录。
 */
const REAL_SKILL_IDS = new Set([
  'brainstorming', 'planning', 'writing-plans', 'planning-with-files', 'pi-planning-with-files',
  'goal', 'todo',
  'tdd', 'test-driven-development', 'systematic-debugging', 'debugging', 'bug-hunt', 'refactoring',
  'code-review', 'review', 'security-review', 'verification', 'verification-before-completion',
  'frontend-design', 'frontend-polish', 'vercel-react-best-practices', 'vercel-composition-patterns',
  'vercel-react-view-transitions', 'web-artifacts-builder', 'webapp-testing', 'web-design-guidelines',
  'git-worktrees', 'using-git-worktrees', 'deploy', 'deploy-to-vercel', 'finishing-a-development-branch',
  'release-notes', 'doc-coauthoring', 'internal-comms', 'slidev',
  'requesting-code-review', 'receiving-code-review'
])

describe('Phase 5a: coding-system-prompt 场景编排 + 递归分析', () => {
  it('包含 Scenario orchestration 块', () => {
    expect(CODING_SYSTEM_PROMPT).toContain('Scenario orchestration:')
  })

  it('包含 Recursive analysis 块', () => {
    expect(CODING_SYSTEM_PROMPT).toContain('Recursive analysis:')
  })

  it('场景链涵盖新功能/Bug修复/重构/代码审查/前端/DevOps 等典型场景', () => {
    expect(CODING_SYSTEM_PROMPT).toContain('New feature')
    expect(CODING_SYSTEM_PROMPT).toContain('Bug fix')
    expect(CODING_SYSTEM_PROMPT).toContain('Refactor')
    expect(CODING_SYSTEM_PROMPT).toContain('Code review')
    expect(CODING_SYSTEM_PROMPT).toContain('Frontend')
    expect(CODING_SYSTEM_PROMPT).toContain('DevOps')
  })

  it('提示词中通过箭头链引用的技能都真实存在（无幽灵技能）', () => {
    // 只提取 → 之后的技能 token（每个 token 是 skill-id：小写字母+连字符，含 / 或 → 分隔）
    const scenarioSection = CODING_SYSTEM_PROMPT.slice(
      CODING_SYSTEM_PROMPT.indexOf('Scenario orchestration:'),
      CODING_SYSTEM_PROMPT.indexOf('Recursive analysis:')
    )
    const referenced = new Set<string>()
    for (const line of scenarioSection.split('\n')) {
      if (!line.includes('→')) continue
      // 取 → 之后的部分，按 → 和 / 和空格 拆分，保留形如 skill-id 的 token
      const afterArrow = line.slice(line.indexOf('→') + 1)
      for (const raw of afterArrow.split(/[→/\s,()]+/)) {
        const token = raw.trim().toLowerCase()
        // skill-id 模式：至少 3 字符，只含小写字母和连字符，且以字母开头
        if (!/^[a-z][a-z]+(-[a-z]+)+$|^[a-z][a-z]{2,}$/.test(token)) continue
        // 排除方法论词（非技能）
        if (['reproduce', 'hypothesize', 'behavior', 'preserving', 'locate', 'root', 'cause'].includes(token)) continue
        referenced.add(token)
      }
    }
    const ghosts = [...referenced].filter((id) => !REAL_SKILL_IDS.has(id))
    expect(ghosts, `幽灵技能引用: ${ghosts.join(', ')}`).toEqual([])
  })

  it('包含主动使用技能的指引', () => {
    expect(CODING_SYSTEM_PROMPT).toContain('skills available in the current work mode')
  })

  it('递归分析块引用 goal/todo 作为决策追踪工具（真实技能）', () => {
    const recursiveSection = CODING_SYSTEM_PROMPT.slice(
      CODING_SYSTEM_PROMPT.indexOf('Recursive analysis:'),
      CODING_SYSTEM_PROMPT.indexOf('Tool behaviour:')
    )
    expect(recursiveSection).toContain('goal')
    expect(recursiveSection).toContain('todo')
  })
})
