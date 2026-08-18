// 预览抽屉 markdown 渲染器冒烟：从 preview.ts 源文本提取纯函数
// （escapeHtml/inlineMd/renderMarkdown，hljs 以 stub 注入——断言样本
// 只走无语言路径），经 ts.transpileModule 剥类型后在 node 里跑行为
// 断言。渲染逻辑回归的最低门槛。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'desktop/renderer/src/views/preview.ts'), 'utf8')
const start = src.indexOf('function escapeHtml')
const end = src.indexOf('function basename')
if (start < 0 || end < 0 || end <= start) {
  console.error('FAIL: 未能在 preview.ts 中定位渲染函数区（escapeHtml…basename）')
  process.exit(1)
}
const js = ts.transpileModule(src.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
const factory = new Function('hljs', js + '\nreturn { inlineMd, renderMarkdown }')
const { inlineMd, renderMarkdown } = factory({ getLanguage: () => null })

const md = (s) => renderMarkdown(s).html
const fails = []
let n = 0
const ok = (name, cond) => {
  n++
  if (!cond) fails.push(name)
}

// ---- setext 标题（新）：段落 + ===/--- 下划线 ----
ok('setext h1', md('标题甲\n===\n') === '<h1>标题甲</h1>')
ok('setext h2', md('标题乙\n---\n') === '<h2>标题乙</h2>')
ok('setext 不吃独立 hr', md('段落\n\n---\n\n段落2').includes('<hr>') && !md('段落\n\n---\n\n段落2').includes('<h2>段落</h2>'))

// ---- 图片（新）----
ok('图片 http', md('![图标](https://a.com/x.png)').includes('<img src="https://a.com/x.png"'))
ok('图片相对', md('![i](./x.png)').includes('<img src="./x.png"'))
ok('图片协议白名单', !md('![i](javascript:alert(1))').includes('<img'))

// ---- 链接（回归 + 白名单修复点）----
ok('锚点链接', md('[目录](#sec)').includes('<a href="#sec"'))
ok('http 链接', md('[文字](https://a.com)').includes('<a href="https://a.com"'))
ok('javascript: 拒绝', !md('[点我](javascript:alert(1))').includes('href="javascript'))

// ---- autolink（新）----
const auto = md('看 https://a.com/x 详情')
ok('裸链接成链', auto.includes('<a href="https://a.com/x" target="_blank" rel="noreferrer">https://a.com/x</a>'))
const once = md('[t](https://a.com)')
ok('autolink 不二次包裹', (once.match(/<a /g) ?? []).length === 1)
ok('全角括号内成链', md('（https://a.com）').includes('<a href="https://a.com"'))

// ---- 强调（新 + 回归）----
ok('粗斜体', inlineMd('***重点***') === '<strong><em>重点</em></strong>')
ok('粗体', inlineMd('**粗**') === '<strong>粗</strong>')
ok('斜体', inlineMd('文 *斜* 文') === '文 <em>斜</em> 文')
ok('删除线', inlineMd('~~删~~') === '<del>删</del>')
ok('粗体内代码', inlineMd('**用 `npm i` 装**') === '<strong>用 <code>npm i</code> 装</strong>')

// ---- 块级回归 ----
ok('atx 标题', md('## 二级') === '<h2>二级</h2>')
ok('任务勾选', md('- [x] 完成').includes('data-x="1"') && md('- [x] 完成').includes('pv-task'))
ok('任务未勾选', !md('- [ ] 待办').includes('data-x="1"'))
ok('表格', md('|a|b|\n|---|---|\n|1|2|').includes('<table><thead><tr><th>a</th>'))
ok('引用', md('> 引用文字').includes('<blockquote>'))
ok('有序列表', md('1. 第一').includes('<ol>'))
ok('无序列表', md('- 项').includes('<ul>'))
ok('未闭合围栏兜底', md('```\ncode').includes('<pre><code class="hljs">code</code></pre>'))
ok('围栏内语法原样', md('```\n**x**\n```').includes('**x**'))
ok('XSS 转义', !md('<script>alert(1)</script>').includes('<script>'))

if (fails.length > 0) {
  console.error(`FAIL (${fails.length}/${n}): ${fails.join(' | ')}`)
  process.exit(1)
}
console.log(`smoke-md: PASS (${n}/${n})`)
