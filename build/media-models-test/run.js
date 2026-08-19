'use strict'
// media-models 隔离单测：esbuild 单文件转译 + 解析劫持 stub 掉 electron
// （media-models → dsh-contract → electron 链），DSH_HOME 指向临时目录，
// 测 env 读写/白名单/解析容错与 spawn 透传语义。
// 用法：node build/media-models-test/run.js
const fs = require('fs')
const path = require('path')
const os = require('os')
const Module = require('module')

const DIR = __dirname

// 最小 stub：dsh-contract 顶层只解构 app（bundledRuntimeArchive 等未用路径）
fs.writeFileSync(path.join(DIR, 'electron-stub.js'), 'module.exports = { app: {} }\n')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return path.join(DIR, 'electron-stub.js')
  return origResolve.call(this, request, ...rest)
}
const es = require(path.join(DIR, '..', '..', 'node_modules', '.pnpm', 'esbuild@0.25.12', 'node_modules', 'esbuild'))
es.buildSync({
  entryPoints: [path.join(DIR, '..', '..', 'desktop', 'main', 'media-models.ts')],
  format: 'cjs', target: 'node20', platform: 'node', bundle: true, external: ['electron'],
  outfile: path.join(DIR, 'media-models.js'),
})
const { MEDIA_MODEL_GROUPS, mediaModelEnvPath, readMediaModelEnv, writeMediaModelEnv, mediaSpawnEnv } = require('./media-models.js')

// 环境隔离：DSH_HOME → 临时目录（dshHome 只读 env，不触 electron app）
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'media-models-test-'))
process.env.DSH_HOME = home

let pass = 0
const fail = []
const check = (name, cond) => { if (cond) { pass++ } else { fail.push(name) } }

// ========== 字段表完整性 ==========
const keys = MEDIA_MODEL_GROUPS.flatMap((g) => g.fields.map((f) => f.key))
check('A1 六组 provider', MEDIA_MODEL_GROUPS.length === 6)
check('A2 21 个字段', keys.length === 21)
check('A3 字段键唯一', new Set(keys).size === keys.length)
check('A4 密钥型字段存在', MEDIA_MODEL_GROUPS.some((g) => g.fields.some((f) => f.secret === true)))
check('A5 env 路径落在 DSH_HOME', mediaModelEnvPath() === path.join(home, 'media-models.env'))

// ========== 写端白名单 ==========
writeMediaModelEnv({
  GEMINI_API_KEY: '  sk-img-123  ',
  GEMINI_BASE_URL: 'https://ark.example/api/v3',
  MINIMAX_API_KEY: 'mm-456',
  KLING_MODEL: '',                    // 空值不落盘
  LD_PRELOAD: '/tmp/evil.so',         // 白名单外注入面必须被滤
  PATH: '/usr/bin',                   // 同上
})
let raw = fs.readFileSync(mediaModelEnvPath(), 'utf8')
check('B1 已知键 trim 落盘', raw.includes('GEMINI_API_KEY=sk-img-123'))
check('B2 白名单外键被滤（LD_PRELOAD）', !raw.includes('LD_PRELOAD'))
check('B3 白名单外键被滤（PATH）', !raw.includes('PATH='))
check('B4 空值不落盘', !raw.includes('KLING_MODEL'))
check('B5 分组注释头', raw.includes('# 图像生成 · Seedream / OpenAI 兼容'))

// ========== 读端解析容错 ==========
let vals = readMediaModelEnv()
check('C1 roundtrip 读回', vals.GEMINI_API_KEY === 'sk-img-123' && vals.MINIMAX_API_KEY === 'mm-456')
fs.appendFileSync(mediaModelEnvPath(),
  '# 手工注释行\n' +
  '\n' +
  'TTS_APPID="app-quoted"\n' +          // 双引号剥离
  "KLING_MODEL='kling-v2-6'\n" +        // 单引号剥离
  'BROKEN LINE NO EQ\n' +               // 无 = 行跳过
  '=novalue\n' +                        // 空键跳过
  'EVIL_KEY=1\n',                       // 未知键读端保留（手工编辑不致命）
)
vals = readMediaModelEnv()
check('C2 注释/空行/坏行跳过', vals['BROKEN LINE NO EQ'] === undefined && vals[''] === undefined)
check('C3 双引号剥离', vals.TTS_APPID === 'app-quoted')
check('C4 单引号剥离', vals.KLING_MODEL === 'kling-v2-6')
check('C5 读端宽松（未知键保留）', vals.EVIL_KEY === '1')

// ========== spawn 透传（注入面收口在 KNOWN_KEYS） ==========
const spawn = mediaSpawnEnv()
check('D1 已知键透传', spawn.GEMINI_API_KEY === 'sk-img-123' && spawn.TTS_APPID === 'app-quoted')
check('D2 未知键不透传给 dsh（EVIL_KEY 拦截）', spawn.EVIL_KEY === undefined)
check('D3 白名单外注入面不透传（LD_PRELOAD 再验）', spawn.LD_PRELOAD === undefined)

// ========== 文件缺失态 ==========
fs.rmSync(mediaModelEnvPath())
vals = readMediaModelEnv()
check('E1 文件缺失读空对象', Object.keys(vals).length === 0)
check('E2 缺失时 spawn 注入为空', Object.keys(mediaSpawnEnv()).length === 0)

// 清理
fs.rmSync(home, { recursive: true, force: true })
fs.rmSync(path.join(DIR, 'electron-stub.js'))
fs.rmSync(path.join(DIR, 'media-models.js'))

if (fail.length > 0) {
  console.error(`FAIL ${fail.length}/${pass + fail.length}:`)
  for (const f of fail) console.error('  - ' + f)
  process.exit(1)
}
console.log(`media-models-test: ${pass}/${pass + fail.length} PASS`)
