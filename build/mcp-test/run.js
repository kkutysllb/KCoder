'use strict'
// mcp-store 隔离单测：esbuild 单文件转译 + DSH_HOME 指向临时目录，
// 直接跑真实 YAML 读写（yaml 是纯 JS 依赖，无需 stub）。
// 用法：node build/mcp-test/run.js
const fs = require('fs')
const path = require('path')
const Module = require('module')

const DIR = __dirname
const HOME = path.join(DIR, 'home')

// 隔离 DSH_HOME：清空重建 profiles/web
fs.rmSync(HOME, { recursive: true, force: true })
const PROFILE = path.join(HOME, 'profiles', 'web')
fs.mkdirSync(PROFILE, { recursive: true })
process.env.DSH_HOME = HOME

// dsh-contract 只被用到 dshHome()/WEB_PROFILE（纯 env 读取），用最小 stub
// 经解析劫持替换，避开它的 electron import 链。
fs.writeFileSync(path.join(DIR, 'dsh-contract-stub.js'),
  "module.exports = { dshHome: () => process.env.DSH_HOME, WEB_PROFILE: 'web' }\n")
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === './dsh-contract') return path.join(DIR, 'dsh-contract-stub.js')
  return origResolve.call(this, request, ...rest)
}
const es = require(path.join(DIR, '..', '..', 'node_modules', '.pnpm', 'esbuild@0.25.12', 'node_modules', 'esbuild'))
es.buildSync({
  entryPoints: [path.join(DIR, '..', '..', 'desktop', 'main', 'mcp-store.ts')],
  format: 'cjs', target: 'node20', platform: 'node',
  outfile: path.join(DIR, 'store.js'),
})
const { mcpServers, mcpServerSave, mcpServerDelete } = require('./store.js')

let pass = 0
const fail = []
const check = (name, cond) => { if (cond) { pass++ } else { fail.push(name) } }
const PATCH = path.join(PROFILE, 'cordis.patch.yml')

// 含其他 patch 与注释的真实形态起始文件
const ORIGINAL = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries.
#
# ACP 压缩后端：禁用内置 compaction-basic
- id: compaction-basic
  disabled: true
`
fs.writeFileSync(PATCH, ORIGINAL, 'utf8')

const stdioEntry = (over = {}) => ({
  id: '', serverName: 'verify', transport: 'stdio', enabled: true,
  command: 'node', args: ['server.js'], env: { TOKEN: 'abc' }, cwd: '/tmp/w',
  url: '', headers: {}, toolCallTimeoutMs: 30000, ...over,
})

async function main() {
  // ========== 场景 A：新增 + 读回 ==========
  let r = mcpServerSave(stdioEntry())
  check('A1 新增成功', r.ok)
  let list = mcpServers()
  check('A2 读回 1 条', list.length === 1)
  const a = list[0]
  check('A3 id 自动派生 mcp-<serverName>', a.id === 'mcp-verify')
  check('A4 字段往返', a.serverName === 'verify' && a.transport === 'stdio' && a.command === 'node'
    && a.args.join(',') === 'server.js' && a.env.TOKEN === 'abc' && a.cwd === '/tmp/w'
    && a.toolCallTimeoutMs === 30000 && a.enabled)
  let text = fs.readFileSync(PATCH, 'utf8')
  check('A5 其他 patch 保留（compaction 禁用行）', text.includes('id: compaction-basic'))
  check('A6 文件头注释保留', text.includes('# Your patch layer'))
  check('A7 中文注释保留', text.includes('ACP 压缩后端'))
  check('A8 insert 形态', /- insert:/.test(text) && /['"]@deepseek-ai\/dsh-mcp-client['"]/.test(text))

  // ========== 场景 B：改写（就地）+ 启停 ==========
  r = mcpServerSave({ ...a, enabled: false, args: ['server.js', '--flag'], toolCallTimeoutMs: null })
  check('B1 改写成功', r.ok)
  list = mcpServers()
  check('B2 仍 1 条（就地未重复）', list.length === 1)
  check('B3 disabled 生效', list[0].enabled === false)
  check('B4 空集合字段省略（args 更新/timeout 省略）', list[0].args.length === 2 && list[0].toolCallTimeoutMs === null)
  text = fs.readFileSync(PATCH, 'utf8')
  check('B5 disabled: true 落盘', /disabled:\s*true/.test(text))
  check('B6 compaction 行仍在', text.includes('id: compaction-basic'))

  // ========== 场景 C：唯一性校验 ==========
  r = mcpServerSave(stdioEntry({ serverName: 'other' }))
  check('C1 第二个服务器可加', r.ok)
  r = mcpServerSave(stdioEntry({ serverName: 'verify', id: 'mcp-verify-x' }))
  check('C2 serverName 重复被拒', !r.ok && /名称 verify/.test(r.error))
  r = mcpServerSave(stdioEntry({ serverName: 'third', id: 'mcp-verify' }))
  check('C3 id 重复被拒', !r.ok && /id mcp-verify/.test(r.error))

  // ========== 场景 D：字段校验 ==========
  r = mcpServerSave(stdioEntry({ serverName: 'bad name!' }))
  check('D1 非法 serverName 被拒', !r.ok)
  r = mcpServerSave(stdioEntry({ serverName: 'nocmd', command: '' }))
  check('D2 stdio 缺命令被拒', !r.ok)
  r = mcpServerSave({ ...stdioEntry({ serverName: 'h1' }), transport: 'streamable-http', command: '' })
  check('D3 http 缺 URL 被拒', !r.ok)

  // ========== 场景 E：http 条目往返 ==========
  r = mcpServerSave({ ...stdioEntry({ serverName: 'web' }), transport: 'streamable-http', command: '', args: [], env: {}, cwd: '', url: 'http://127.0.0.1:3000/mcp', headers: { Authorization: 'Bearer t=x' } })
  check('E1 http 保存成功', r.ok)
  const web = mcpServers().find((s) => s.serverName === 'web')
  check('E2 http 往返', web !== undefined && web.transport === 'streamable-http' && web.url === 'http://127.0.0.1:3000/mcp'
    && web.headers.Authorization === 'Bearer t=x')

  // ========== 场景 F：删除 ==========
  r = mcpServerDelete('mcp-verify')
  check('F1 删除成功', r.ok)
  list = mcpServers()
  check('F2 列表只剩 other/web', list.length === 2 && !list.some((s) => s.serverName === 'verify'))
  text = fs.readFileSync(PATCH, 'utf8')
  check('F3 compaction 行穿过删除仍在', text.includes('id: compaction-basic'))
  r = mcpServerDelete('mcp-verify')
  check('F4 幂等删除（不存在也 ok）', r.ok)
  // 删完所有 mcp 条目：insert 项应清空，不留空 insert 噪音
  mcpServerDelete('mcp-other')
  mcpServerDelete('mcp-web')
  text = fs.readFileSync(PATCH, 'utf8')
  check('F5 全删后无 insert 残留', !text.includes('insert'))

  // ========== 场景 G：坏 YAML 防御 ==========
  fs.writeFileSync(PATCH, '原始内容\n  坏缩进: [\n', 'utf8')
  r = mcpServerSave(stdioEntry())
  check('G1 坏 YAML 保存被拒', !r.ok)
  const snapshot = fs.readFileSync(PATCH, 'utf8')
  check('G2 坏文件未被写回', snapshot.includes('坏缩进'))
  check('G3 坏文件读取返回空数组不抛', Array.isArray(mcpServers()))

  // ========== 场景 H：手编混合形态（一个 insert 多实例）读取 ==========
  fs.writeFileSync(PATCH, `# 手编
- id: compaction-basic
  disabled: true
- insert:
    - id: mcp-a
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: a
        transport: stdio
        command: npx
    - id: mcp-b
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: b
        transport: streamable-http
        url: http://x/mcp
`, 'utf8')
  list = mcpServers()
  check('H1 混合形态读出 2 条', list.length === 2 && list.some((s) => s.serverName === 'a') && list.some((s) => s.serverName === 'b'))
  r = mcpServerSave(stdioEntry({ serverName: 'a', id: 'mcp-a', command: 'node' }))
  check('H2 混合形态内就地改写', r.ok)
  const after = mcpServers()
  check('H3 改写后仍 2 条', after.length === 2 && after.find((s) => s.serverName === 'a').command === 'node')
  text = fs.readFileSync(PATCH, 'utf8')
  check('H4 同 insert 内 b 未受损', text.includes('serverName: b'))

  console.log(`\nPASS ${pass} / FAIL ${fail.length}`)
  if (fail.length > 0) { console.log('FAILURES:', fail); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) })
