/**
 * 孤儿 bundles 判据的逻辑门（2026-10-10）。
 *
 * 背景见 desktop/shared/orphan-bundles.ts：旧判据「不受管 + 不在 dependencies」会
 * 把**实体完好**的用户自装插件当孤儿删掉（连 node_modules 一起删），表现为重启后
 * 插件消失、需重装（@kkutysllb/dsh-git-panel 现场）。本门钉住保守判据三条同时成立。
 *
 * 用法：node scripts/check-orphan-bundles.mjs（挂进 pnpm typecheck 链）
 *
 * @module scripts/check-orphan-bundles
 */

const mod = await import(new URL('../desktop/shared/orphan-bundles.ts', import.meta.url).href)

let passed = 0
let failed = 0
const eq = (name, actual, expected) => {
  const okv = JSON.stringify(actual) === JSON.stringify(expected)
  if (okv) passed += 1
  else { failed += 1; console.error(`  ✗ ${name}（实际 ${JSON.stringify(actual)} / 期望 ${JSON.stringify(expected)}）`) }
}

const managed = new Set(['@deepseek-ai/dsh-base', 'dsh-ssh-remote'])
const none = () => false

eq('A1 受管名单内的条目永不判孤儿',
  mod.orphanBundlesOf(['@deepseek-ai/dsh-base', 'dsh-ssh-remote'], new Set(), managed, none), [])

eq('B1 dependencies 有声明 ⇒ 不是孤儿',
  mod.orphanBundlesOf(['@kkutysllb/dsh-git-panel'], new Set(['@kkutysllb/dsh-git-panel']), managed, none), [])

eq('B2 devDependencies 声明同样算声明',
  mod.orphanBundlesOf(['@kkutysllb/dsh-git-panel'], mod.declaredNames({ devDependencies: { '@kkutysllb/dsh-git-panel': '^1' } }), managed, none), [])

eq('C1 **实体在位 ⇒ 绝不判孤儿**（本门核心：用户自装插件不被误删）',
  mod.orphanBundlesOf(['@kkutysllb/dsh-git-panel'], new Set(), managed, (p) => p === '@kkutysllb/dsh-git-panel'), [])

eq('D1 不受管 + 无声明 + 无实体 ⇒ 判孤儿（保留原有自愈目的）',
  mod.orphanBundlesOf(['ghost-panel'], new Set(), managed, none), ['ghost-panel'])

eq('E1 混合场景：只摘真正无来源的那条',
  mod.orphanBundlesOf(['dsh-ssh-remote', 'declared-one', 'installed-one', 'ghost'],
    new Set(['declared-one']), managed, (p) => p === 'installed-one'), ['ghost'])

eq('F1 declaredNames 汇总三段去重',
  [...mod.declaredNames({ dependencies: { a: '1' }, devDependencies: { b: '2' }, optionalDependencies: { a: '3' } })].sort(), ['a', 'b'])

// G. 静态防线（2026-10-10 现场）：退役名单不得包含 git-panel 系（含现行名），
//    否则「每次启动三清」会把用户自装的 @kkutysllb/dsh-git-panel 洗掉。
{
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../desktop/main/kcoder-skills-bundle.ts', import.meta.url), 'utf8')
  const block = /const RETIRED_PLUGINS = \[([\s\S]*?)\n\]/.exec(src)?.[1] ?? ''
  for (const bad of ['@kkutysllb/dsh-git-panel', 'dsh-git-panel', '@dsh-external/dsh-git-panel', '@kcoder/git-panel']) {
    const hit = new RegExp(`'${bad.replace(/[/@]/g, (c) => `\\${c}`)}'`).test(block)
    if (hit) { failed += 1; console.error(`  ✗ G1 退役名单仍含冲突旧名 ${bad}`) } else passed += 1
  }
}

console.log(`check-orphan-bundles: ${String(passed)} passed, ${String(failed)} failed`)
if (failed > 0) process.exit(1)
