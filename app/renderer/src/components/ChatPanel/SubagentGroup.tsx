// SubagentGroup — 并行子代理任务分组（参考 KStock SubagentGroup.tsx）。
//
// 按 taskId 分组，每个任务显示状态徽章 + 描述，可展开看每一步的正文和工具调用。

import { useState } from 'react'
import type { SubagentTask } from '../../lib/chatMessage'

interface SubagentGroupProps {
  task: SubagentTask
  showToolCalls?: boolean
}

const STATUS_CONFIG: Record<SubagentTask['status'], { label: string; cls: string }> = {
  running: { label: '运行中', cls: 'text-blue-400 bg-blue-400/10' },
  completed: { label: '已完成', cls: 'text-green-400 bg-green-400/10' },
  failed: { label: '失败', cls: 'text-red-400 bg-red-400/10' },
  cancelled: { label: '已取消', cls: 'text-text-muted bg-bg-hover' },
  timed_out: { label: '超时', cls: 'text-amber-400 bg-amber-400/10' }
}

export function SubagentGroup({ task, showToolCalls = true }: SubagentGroupProps) {
  const [expanded, setExpanded] = useState(task.status === 'running')

  const status = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.running
  const stepCount = task.steps.length

  return (
    <div className="mb-2 rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03] transition-colors text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* 状态点 */}
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-300 ${
          task.status === 'running' ? 'bg-blue-400 animate-pulse' :
          task.status === 'completed' ? 'bg-green-400' :
          task.status === 'failed' ? 'bg-red-400' :
          'bg-text-muted'
        }`} />
        {/* 描述 */}
        <span className="text-xs text-text-primary font-medium truncate flex-1">
          {task.description ?? task.taskId}
        </span>
        {task.model && (
          <span className="text-[10px] text-text-muted font-mono shrink-0">{task.model}</span>
        )}
        {/* 步骤数 */}
        {stepCount > 0 && (
          <span className="text-[10px] text-text-muted shrink-0">{stepCount} 步</span>
        )}
        {/* 状态徽章 */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 transition-colors duration-300 ${status.cls}`}>
          {status.label}
        </span>
        {/* 折叠箭头 */}
        <svg
          className={`w-3 h-3 text-text-muted transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {expanded && task.steps.length > 0 && (
        <div className="px-3 py-2 space-y-2 border-t border-white/[0.04]">
          {task.steps.map((step) => (
            <div key={step.index} className="text-xs">
              <div className="flex items-center gap-1.5 text-text-muted">
                <span className="font-mono text-[10px]">#{step.index}</span>
                {step.text && (
                  <span className="line-clamp-2 text-text-secondary">{step.text}</span>
                )}
              </div>
              {showToolCalls && step.toolCalls && step.toolCalls.length > 0 && (
                <div className="mt-1 pl-4 text-[10px] text-text-muted">
                  {step.toolCalls.map((tc) => (
                    <div key={tc.id} className="flex items-center gap-1.5">
                      <span>↳</span>
                      <span className="font-mono">{tc.name}</span>
                      <span className={
                        tc.status === 'completed' ? 'text-green-400' :
                        tc.status === 'failed' ? 'text-red-400' :
                        'text-blue-400'
                      }>
                        {tc.status === 'completed' ? '✓' : tc.status === 'failed' ? '✗' : '⋯'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
