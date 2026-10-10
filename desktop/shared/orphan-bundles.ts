/**
 * 孤儿 bundles 判据（纯逻辑半区，2026-10-10）。
 *
 * ## 为什么需要它，以及为什么要保守
 *
 * `dsh.profile.bundles` 里注册、却没有归属来源的条目会在加载器解析时失败，
 * 甚至挡死整个 profile（进程 exit 1 循环重启）——历史病态来自 pnpm 安装半途失败：
 * 层叠声明入栈、实体未落地。故启动期要清理。
 *
 * ## 但「没有 dependencies 声明」不足以判它是垃圾
 *
 * 用户**自行安装**的第三方插件（上游插件页 `pnpm add`）会在 profile 的
 * `dependencies` 留下声明；可一旦某条链把声明丢了（安装器差异、手工编辑、
 * 上游 reconcile 时序），旧判据就会把**实体完好、用户正在用**的插件当孤儿：
 * 不仅摘层叠，还 `rmSync` 掉它的 node_modules 实体——用户重启后插件「消失」，
 * 只能重装（2026-10-10 现场：@kkutysllb/dsh-git-panel 每次重启都要重装）。
 *
 * 因此判据改为三条**同时**成立才算孤儿：
 *   ① 不在受管名单（模板 / 内置 / 退役 / 上游可选集）；
 *   ② 任何依赖段（dependencies / devDependencies / optionalDependencies）都没有声明；
 *   ③ **实体也不在** node_modules 里。
 * 实体在位 ⇒ 加载器解析得到 ⇒ 摘除永远不是修复，只会制造「用户插件消失」。
 *
 * @module desktop/shared/orphan-bundles
 */

/** 依赖段集合（三条判据用的「有声明」全集）。 */
export interface DeclaredDependencies {
  dependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
  optionalDependencies?: Record<string, unknown>
}

/** 汇总各依赖段的包名。 */
export function declaredNames(manifest: DeclaredDependencies): Set<string> {
  const out = new Set<string>()
  for (const section of [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies]) {
    if (section === undefined || section === null) continue
    for (const name of Object.keys(section)) out.add(name)
  }
  return out
}

/**
 * 计算应当清理的孤儿 bundles 条目。
 * @param bundles - `dsh.profile.bundles` 现值。
 * @param declared - 各依赖段的包名集合（见 {@link declaredNames}）。
 * @param managed - 受管名单（模板 / 内置 / 退役 / 上游可选集）。
 * @param installed - 该包实体是否在 profile 的 node_modules 里（判据 ③）。
 * @returns 需要摘除的条目（保持原顺序）。
 */
export function orphanBundlesOf(
  bundles: readonly string[],
  declared: ReadonlySet<string>,
  managed: ReadonlySet<string>,
  installed: (pkg: string) => boolean,
): string[] {
  return bundles.filter((name) => !managed.has(name) && !declared.has(name) && !installed(name))
}
