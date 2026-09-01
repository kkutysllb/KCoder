/**
 * dsh-stats-panel — server 半（占位）。
 *
 * 本插件纯 client 侧：hover 缩略条 → 底部弹出自绘统计面板，数据直接
 * 解析上游 StatsLine 的 DOM 文本，无 server 数据依赖（无 RPC、无
 * webServer 注册）。entry 仅作 cordis 层挂载占位：
 * - 保持 bundle 四件套形态一致（物化器 BUNDLES 表对 entry 的完整性
 *   校验，见 desktop/main/kcoder-skills-bundle.ts）；
 * - cordis.patch.yml 的 insert 行需要 name 指向可加载的包；
 * - 为未来 server 能力（如统计导出 RPC）预留挂载点。
 *
 * @module dsh-stats-panel/entry
 */

/** 纯占位：无 cordis 依赖。 */
export const inject = []

/** 纯占位：不注册任何服务。 */
export function apply() {}
