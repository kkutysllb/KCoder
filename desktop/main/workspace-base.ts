/**
 * 工作区基准：当前页面选中的工作区路径。唯一消费方是 workspace-probe 的
 * 页面探针解析结果（console 通道喂进 {@link WorkspaceBase.setWorkspace}），
 * 唯一读取方是 skills-catalog 的工作区项目技能目录探位。
 *
 * ## 为什么只有这么点（退役记录 2026-10-05）
 *
 * 本模块的前身是 `file-activity.ts`「文件活动记录器」：按工作区分桶聚合
 * agent 的读/编辑活动（session/page 历史补拉 + 工具参数近似 + turn-end
 * 微型探针 + /api/changes.summary 的 numstat 精确值），并把 edit 的
 * +n/−n 推给 shell 页面，在工具卡片文件路径上渲染「正文文件徽章」。
 *
 * 那枚徽章是**重复渲染**：上游 `client-ui-tool` 的 `ToolRow` 自带同一行的
 * diff 统计（`diffTotals(diff.card.diffs)` → `+added -removed`，
 * 见 `ui-tool/src/client/tool/components/ToolRow.tsx:248-250`），
 * 于是同一行出现两枚 +n/−n，用户判定冲突并要求退役（2026-10-05）。
 *
 * 随徽章一并退役的，是**只服务于它**的整条数据链（同一次改动）：
 * - 页面侧：`_fileLink` / `_fileMention` 上的统计 span、`window.__dshFileStat`、
 *   `session/page` 的 fetch 拦截（上报 sessionId 触发补拉）；
 * - 主进程侧：历史补拉 `session/page`、`/api/changes.summary` numstat、
 *   turn-end 指数+二分微型探针、按工作区分桶的活动表。
 *
 * ⚠ 留下的这一项职责**不是可选项**：`activeKey()` 是 skills-catalog
 * 「工作区项目技能」的基准，删掉它会让技能分区失去工作区来源。
 * 页面侧写入 `--dsh-ws-name` / `--dsh-ws-path`（自绘标题栏的工作区名与
 * 打开目录目标）与这里的 `setWorkspace` 是**同一次解析**的结果，两者一起活着。
 *
 * @module desktop/main/workspace-base
 */

/** 工作区基准（进程级存续；托盘保活期间不重置）。 */
class WorkspaceBase {
  /** 当前页面选中/解析出的工作区绝对路径（null = 未解析或无工作区）。 */
  private activeWorkspace: string | null = null

  /**
   * 记下页面探针解析出的当前工作区。
   * @param path - 工作区绝对路径；空串与 null 等价（视作无工作区）。
   */
  setWorkspace(path: string | null): void {
    this.activeWorkspace = path !== null && path !== '' ? path : null
  }

  /** 当前工作区键（无工作区时空串；消费方据此跳过工作区相关查询）。 */
  activeKey(): string {
    return this.activeWorkspace ?? ''
  }
}

/** 进程级单例（跨窗口存续）。 */
export const workspaceBase = new WorkspaceBase()
