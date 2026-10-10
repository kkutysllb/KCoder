/**
 * 退役「一次性」账本（纯逻辑半区，2026-10-10）。
 *
 * ## 为什么必须一次性
 *
 * 两处退役名单（`RETIRED_PLUGINS` / `RETIRED_PRESETS`）的清理原本在**每次启动**都跑，
 * 动作是「deps 声明 + bundles 层叠 + node_modules 实体」三清。名单里既有历史中间态，
 * 也有**现行名**（用户仍可经插件页自装的包，如 `dsh-context` / `dsh-coding-sidebar` /
 * `@kkutysllb/dsh-terminal` / `@kkutysllb/dsh-file-attach` / `dsh-file-review-kcoder` /
 * `@tt-a1i/archify-dsh`）。于是用户**主动安装**这些包后，下一次启动就被静默删掉——
 * 现场表现为「装好可用、重启即消失、需重装」（首个被抓到的是 `@kkutysllb/dsh-git-panel`）。
 *
 * ## 语义
 *
 * 退役是**迁移**，不是**审查**：只需把这个 profile 里曾经留下的残留清一次；
 * 之后名字继续留在名单里（保留历史记录与判据），但**不再执行任何删除动作**。
 * 账本落 `$DSH_HOME/.retired-cleaned.json`，按 profile 家目录隔离（dev/packaged 各自一份）。
 *
 * 例外：随引擎分发的 provider 包（`RUNTIME_PROVIDED_PACKAGES`）**不**走一次性——它们在
 * profile 里的残留会**遮蔽**随包实体（版本漂移），必须每次清（其注释已写明该理由）。
 *
 * @module desktop/shared/retired-ledger
 */

/** 账本文件形状（宽松解析：缺字段/脏数据都当空）。 */
export interface RetiredLedger { names?: unknown }

/** 解析账本，返回已清理过的名字集合（去重、只取字符串）。 */
export function readCleanedNames(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw.trim() === '') return []
  try {
    const parsed = JSON.parse(raw) as RetiredLedger
    const list = Array.isArray(parsed.names) ? parsed.names : []
    return [...new Set(list.filter((x): x is string => typeof x === 'string' && x !== ''))]
  } catch {
    return []
  }
}

/** 本次启动**真正要清理**的退役名（= 名单 − 已清理）。 */
export function pendingRetired(all: readonly string[], cleaned: readonly string[]): string[] {
  const done = new Set(cleaned)
  return all.filter((name) => !done.has(name))
}

/** 合并本次已清理的名字（幂等、稳定排序）。 */
export function mergeCleaned(cleaned: readonly string[], justCleaned: readonly string[]): string[] {
  return [...new Set([...cleaned, ...justCleaned])].sort()
}

/** 序列化账本（稳定格式，便于 diff 与人工查看）。 */
export function serializeLedger(names: readonly string[]): string {
  return JSON.stringify({ names: [...names].sort() }, null, 2) + '\n'
}
