/**
 * 技能设置注入脚本冒烟：从 skills-settings.ts 提取 PAGE_JS 模板字符串，
 * 按模板字符串语义解析后做纯语法校验（new Function，不执行），并抽查
 * 关键转义点 + **退役面不得回流**。桌面壳手工冒烟用：
 * node scripts/smoke-skills-page.mjs
 *
 * 环境变量：KCODER_SKILLS_TS 覆盖被检源文件路径（负对照用——指向一份
 * 故意改坏的副本，验证本脚本真能红；缺省 desktop/main/skills-settings.ts）。
 */
import { readFileSync } from 'node:fs'

const BT = String.fromCharCode(96) // 反引号（避免与本脚本模板字符串互扰）
const TS_PATH = process.env.KCODER_SKILLS_TS ?? 'desktop/main/skills-settings.ts'
const src = readFileSync(TS_PATH, 'utf8')

const decl = 'const PAGE_JS = ' + BT
const open = src.indexOf(decl)
if (open < 0) throw new Error('PAGE_JS 声明未找到')
const from = open + decl.length
// 结尾锚：独立行的 IIFE 收口 + 结尾反引号（收口行内无其他反引号）
const tail = src.indexOf('\n})()' + BT, from)
if (tail < 0) throw new Error('PAGE_JS 结尾未找到')
const endTick = src.indexOf(BT, tail + 1)
const template = src.slice(from, endTick) // 纯内容（不含两端反引号）

// 2026-10-05 起 PAGE_JS 里**不再有主进程侧模板插值**：原先唯一的
// `${JSON.stringify(MEDIA_MODEL_GROUPS)}` 随「多媒体模型」分区退役一并移除
// （见 skills-settings.ts 模块头）。因此本脚本可以直接 eval 原文——此前它
// 自 v0.5.9 起因缺同名常量以 ReferenceError 挂起（release/audit-v0.6.19.md 有档），
// v0.6.24 靠从 media-models.ts 抽常量救回，现在那份夹具连同源文件一起消失。
// 若将来 PAGE_JS 再引入插值，这里的 eval 会立刻报未定义引用——即自带回归哨兵。
// 按模板字符串语义解析（eval 字面量；处理反斜杠/换行转义）
// oxlint-disable-next-line no-eval -- 测试夹具:按模板字符串语义还原页面注入源码
const pageJs = eval(BT + template + BT)
new Function(pageJs) // 语法校验（不执行）

const fails = []
console.log('PAGE_JS syntax OK,', pageJs.length, 'chars')
// 抽查 1：代码围栏正则落成页面脚本里的 \` 形态（页面正则合法转义）
if (!pageJs.includes('\\`\\`\\`')) fails.push('code-fence 正则未落成页面合法转义')
// 抽查 2：内联 code 正则（单反引号对）出现在脚本里
const inlineRe = pageJs.split('\n').filter((l) => l.includes('\\`([^\\`]+)\\`'))
if (inlineRe.length === 0) fails.push('内联 code 正则缺失')
// 抽查 3：导航按钮标签已是中文「技能」字面量
const label = pageJs.split('\n').find((l) => l.includes('label.textContent'))
if (label === undefined) fails.push('导航按钮标签改写行缺失')

/**
 * 退役面不得回流（2026-10-05）：六个非编码技能与「多媒体模型」分区已
 * 退役，其页面侧标识符一个都不该再出现在注入脚本里。这是**源码级**断言
 * （不依赖 DOM 渲染），与姊妹脚本 smoke-skills-dom 的运行时断言互补。
 * 负对照：`KCODER_SKILLS_TS=<改坏的副本>` 必须让本脚本红。
 */
const RETIRED_TOKENS = [
  'dsk-media-',           // 媒体分区容器/按钮/提示类
  'dsk-mg',               // 媒体分组卡
  'dsk-mf-',              // 媒体字段行/输入框
  'media-save',           // 页面 → 主进程保存载荷 op
  '__dshSkillsMediaValues',
  '__dshSkillsMediaSaved',
]
const leaked = RETIRED_TOKENS.filter((t) => pageJs.includes(t))
if (leaked.length > 0) fails.push(`退役面标识符回流：${leaked.join('、')}`)
// 反向：现役三件必须在位（防止「删多了」把面板本体一起删掉）
for (const t of ['dsk-row', 'dsk-badge', '__dshSkillsSync', '__dshSkillsToggled']) {
  if (!pageJs.includes(t)) fails.push(`现役标识符缺失：${t}`)
}

console.log('label line:', label ? label.trim() : '(missing!)')
console.log('retired-token leak:', leaked.length === 0 ? 'none' : leaked.join('、'))
if (fails.length > 0) {
  console.error('FAIL:\n' + fails.map((f) => '  - ' + f).join('\n'))
  process.exitCode = 1
} else {
  console.log('ALL PASS（语法 + 转义抽查 + 退役面零回流 + 现役面在位）')
}
