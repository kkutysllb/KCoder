/**
 * session_projcache 域一次性迁移：alpha.4 投影缓存身份换代兼容。
 *
 * 上游 alpha.4（session-projection-cache，域版本 4 → 5）给缓存条目身份
 * CheckpointIdentity 新增 isSeeded / inheritedEventCount 两个必填字段——
 * 记录绑定到具体会话生命周期，防同 id 换日志后旧缓存误发。旧引擎写的
 * 条目缺这两个字段：zod 解析失败整条判废，unit 文档版本不匹配整体拒收
 * （storage-json：unit 拒收 → 全表读空；分片 stale → 读作缺失记录）。
 *
 * 表现：历史任务列表初载全部缓存 miss，标题投影（session-title 的
 * `title` 投影）缺失，UI 回退显示工作区目录名；点开会话后全量投影恢复
 * 标题并把该条以新身份回写，但未点开的会话每次启动继续无标题。
 *
 * 迁移 = 抬版本号 + 补身份字段；缓存值（rows）结构兼容无需重算：
 * - unit 文档 `storages/session_projcache.json`：`unit.version` → 目标版
 * - 分片文档 `storages/session_projcache/sessions/<key>.json`：`version` → 目标版
 * - `identity` 补 `isSeeded: false` / `inheritedEventCount: 0`
 *
 * isSeeded 统一补 false 是安全的：真 fork 会话的 header.isSeeded=true 与
 * 补出的 false 不匹配 → identityMatches 拒绝 → 该条继续 miss（与迁移前
 * 行为一致，绝不会错发旧值）；非 fork 会话（绝大多数）立即恢复命中。
 *
 * 幂等：unit 已是目标版本即早退（unit 写入是提交点——先分片后 unit，
 * 半迁移残留会让版本仍落后而在此重入，分片侧补丁逐条 no-op）；单条
 * identity 已含字段时不覆盖。挂载：dshManager.start() 之前——引擎读
 * 缓存前的串行窗口，无并发写。
 *
 * 上游 rc.1（0.1.2-rc.1）起引擎自带 compatibleVersions:[3,4] 读兼容
 * （identity 字段改 optional，缺字段读作未播种谱系），本模块从唯一解
 * 变双保险：迁移先把旧文档抬成规范 v5 形态（零重算直接恢复命中），
 * 未迁移场景由引擎读兼容兜底；继续保留。域版本仍 5，无需改动。
 */

import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-contract'

/** alpha.4 session-projection-cache 期望的域版本（其 spec.ts projectionCacheDomainSpec.version）。 */
const TARGET_VERSION = 5

type Json = Record<string, unknown>

/** 身份缺字段即补（不覆盖已有值）；返回是否改动。 */
function patchIdentity(identity: Json): boolean {
  let changed = false
  if (typeof identity['isSeeded'] !== 'boolean') {
    identity['isSeeded'] = false
    changed = true
  }
  if (typeof identity['inheritedEventCount'] !== 'number') {
    identity['inheritedEventCount'] = 0
    changed = true
  }
  return changed
}

/** 原子写（tmp + rename），避免半写文档被引擎读到。 */
function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

/** 逐份迁移分片文档（{version, record:{identity,rows}}），返回改动份数。 */
function migrateShards(dir: string): number {
  let changed = 0
  for (const table of readdirSync(dir)) {
    const tableDir = join(dir, table)
    let files: string[]
    try {
      files = readdirSync(tableDir)
    } catch {
      continue // 非目录（残留 tmp 等），跳过
    }
    for (const file of files) {
      if (!file.endsWith('.json') || file.endsWith('.tmp')) continue
      const path = join(tableDir, file)
      try {
        const doc = JSON.parse(readFileSync(path, 'utf8')) as Json
        let touched = false
        if (typeof doc['version'] !== 'number' || doc['version'] < TARGET_VERSION) {
          doc['version'] = TARGET_VERSION
          touched = true
        }
        const record = doc['record']
        if (record !== null && typeof record === 'object') {
          const identity = (record as Json)['identity']
          if (identity !== null && typeof identity === 'object' && patchIdentity(identity as Json)) {
            touched = true
          }
        }
        if (touched) {
          writeAtomic(path, JSON.stringify(doc))
          changed++
        }
      } catch {
        // 单份分片坏档读作缺失记录（上游语义），跳过不拖垮整体
      }
    }
  }
  return changed
}

/** 执行迁移（幂等）；失败仅降级为缓存缺失，不阻断启动。 */
export function migrateProjcache(): void {
  const unitPath = join(dshHome(), 'storages', 'session_projcache.json')
  if (!existsSync(unitPath)) return // 全新安装无缓存，无事可做
  try {
    const unit = JSON.parse(readFileSync(unitPath, 'utf8')) as Json
    const unitMeta = (unit['unit'] ?? {}) as Json
    const version = unitMeta['version']
    if (version === TARGET_VERSION) return // 已迁移（提交点早退）
    if (typeof version !== 'number' || version > TARGET_VERSION) {
      // 无版本戳（异常文档）或比本构建更新（未来版本），不动
      return
    }

    // unit 文档：全量内联记录的身份补齐（旧引擎把 tables 全量写在这）
    let records = 0
    const tables = (unit['tables'] ?? {}) as Record<string, Json>
    for (const rows of Object.values(tables)) {
      if (rows === null || typeof rows !== 'object') continue
      for (const record of Object.values(rows)) {
        if (record === null || typeof record !== 'object') continue
        const identity = (record as Json)['identity']
        if (identity !== null && typeof identity === 'object' && patchIdentity(identity as Json)) {
          records++
        }
      }
    }

    // 分片：per-record 布局的运行时读路径，逐份抬版本 + 补身份
    // （空域——旧引擎从未写过缓存——两处统计为零，只补版本戳即可）
    const dir = join(dshHome(), 'storages', 'session_projcache')
    const shards = existsSync(dir) ? migrateShards(dir) : 0

    // 迁移前备份一次 unit 文档（含全量数据，足以回滚；分片不备份——
    // 改动仅为补字段/抬版本，且缓存本质可弃，最坏回退为列表标题缺失）
    const backup = `${unitPath}.bak-projcache-v${version}`
    if (!existsSync(backup)) copyFileSync(unitPath, backup)

    unitMeta['version'] = TARGET_VERSION
    writeAtomic(unitPath, JSON.stringify(unit))
    console.log(
      `[projcache-migrate] 域 v${version} → v${TARGET_VERSION}：unit ${records} 条 + 分片 ${shards} 份身份补齐（备份 ${backup}）`,
    )
  } catch (error) {
    console.warn('[projcache-migrate] 迁移失败（引擎将按缓存缺失自愈，列表标题回退显示目录名）:', error)
  }
}
