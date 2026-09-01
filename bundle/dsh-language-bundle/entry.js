// dsh-language-bundle 胶水插件：「强制中文回答」语言指令。
//
// 零依赖纯 ESM（对齐 dsh-skills-bundle 的 out-of-tree bundle 形态，
// 可被 profile node_modules 直接 resolve，无需构建步骤）。
//
// 注入策略：注册一个全局 system-prompt section（name 'kcoder:language'，
// order 900 —— 升序拼接几乎末尾：identity(-100)/persona(0)/工具指导
// (100-190) 之后，recency 权重最高，对抗长会话英文历史的语言惯性；
// agent preset 的 dsh-persona 行只 shadow 同名 'deployment:persona'
// section，不会盖掉这个不同名的全局 section，因此指令对全部 agent
// 会话（含 PTC/标准 preset）生效。
//
// 开关不在这层实现：bundle patch 层把本行默认 disabled，KCoder 主进程
// （desktop/main/language-settings.ts）在 $DSH_HOME/cordis.patch.yml 的
// home 层按用户偏好写 `disabled: false` 覆盖——home 层被 dsh 的
// watchUserPatches 热重载，切换无需重启引擎。

/** Stable Cordis plugin name. */
export const name = 'kcoder-language'

/** 注册进 system-prompt registry（ctx key: systemPrompt）。 */
export const inject = ['systemPrompt']

/**
 * 指令文本：约束正文语言，明确「无论历史对话什么语言」以压过长会话
 * 的语言惯性（实测 order 1 的一句指令会被英文历史+海量英文工具指导
 * 稀释）；豁免代码/命令/路径，避免误伤工程产物。
 */
const DIRECTIVE = [
  'Language requirement (applies to every response in this conversation):',
  'Write ALL prose in your responses — explanations, analysis, reasoning summaries shown to the user, questions, and final answers — in Simplified Chinese (简体中文).',
  'This holds regardless of the language of earlier turns: even if previous assistant messages, tool results, or the conversation history are mostly English, your visible response text must still be Simplified Chinese.',
  'Exception: keep code, code comments (follow the language already used in the surrounding code), identifiers, file paths, shell commands, command output, and technical terms conventionally written in English (API names, library names, CLI flags) exactly as they are.',
].join('\n')

/** 注册语言指令 section；返回 disposer（cordis fiber 释放时自动回收）。 */
export function apply(ctx) {
  const dispose = ctx.systemPrompt.section({
    name: 'kcoder:language',
    order: 900,
    text: DIRECTIVE,
  })
  console.log('kcoder-language: Chinese-response directive section registered')
  return dispose
}
