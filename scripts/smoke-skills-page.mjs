/**
 * 技能设置注入脚本冒烟：从 skills-settings.ts 提取 PAGE_JS 模板字符串，
 * 按模板字符串语义解析后做纯语法校验（new Function，不执行），并抽查
 * 关键转义点。桌面壳手工冒烟用：node scripts/smoke-skills-page.mjs
 */
import { readFileSync } from 'node:fs'

const BT = String.fromCharCode(96) // 反引号（避免与本脚本模板字符串互扰）
const src = readFileSync('desktop/main/skills-settings.ts', 'utf8')

const decl = 'const PAGE_JS = ' + BT
const open = src.indexOf(decl)
if (open < 0) throw new Error('PAGE_JS 声明未找到')
const from = open + decl.length
// 结尾锚：独立行的 IIFE 收口 + 结尾反引号（收口行内无其他反引号）
const tail = src.indexOf('\n})()' + BT, from)
if (tail < 0) throw new Error('PAGE_JS 结尾未找到')
const endTick = src.indexOf(BT, tail + 1)
const template = src.slice(from, endTick) // 纯内容（不含两端反引号）

// 按模板字符串语义解析（eval 字面量；处理反斜杠/换行转义）
const pageJs = eval(BT + template + BT)
new Function(pageJs) // 语法校验（不执行）

console.log('PAGE_JS syntax OK,', pageJs.length, 'chars')
// 抽查 1：代码围栏正则落成页面脚本里的 \` 形态（页面正则合法转义）
console.log('code-fence regex ok:', pageJs.includes('\\`\\`\\`'))
// 抽查 2：内联 code 正则（单反引号对）出现在脚本里
const inlineRe = pageJs.split('\n').filter((l) => l.includes('\\`([^\\`]+)\\`'))
console.log('inline-code regex lines:', inlineRe.length)
// 抽查 3：导航按钮标签已是中文「技能」字面量
const label = pageJs.split('\n').find((l) => l.includes('label.textContent'))
console.log('label line:', label ? label.trim() : '(missing!)')
