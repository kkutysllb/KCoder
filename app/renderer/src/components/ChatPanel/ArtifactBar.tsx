// ArtifactBar — present_files 工具产出的可点击文件卡片。
//
// 当 agent 调用 present_files 时，SSE 翻译层从 tool_call args 中提取
// filepaths 数组，通过 tool_call_started 事件传递到前端。
// 本组件从 msg.toolCalls 中检测 present_files 调用，
// 渲染可点击的文件卡片，点击后用 FilePreviewModal 弹窗显示文件内容。

import { useState } from 'react'
import type { ChatMessage } from '../../lib/chatMessage'
import { FilePreviewModal } from './FilePreviewModal'

interface ArtifactBarProps {
  msg: ChatMessage
}

interface ArtifactItem {
  path: string
  filename: string
  ext: string
}

/** 从 toolCalls 中提取 present_files 的文件路径 */
function extractArtifacts(msg: ChatMessage): ArtifactItem[] {
  const calls = msg.toolCalls ?? []
  const seen = new Set<string>()
  const items: ArtifactItem[] = []
  for (const call of calls) {
    if (call.name === 'present_files' && call.args) {
      const filepaths = call.args.filepaths
      if (Array.isArray(filepaths)) {
        for (const fp of filepaths) {
          if (typeof fp === 'string' && fp && !seen.has(fp)) {
            seen.add(fp)
            const filename = fp.split('/').pop() || fp
            const ext = filename.split('.').pop()?.toLowerCase() || ''
            items.push({ path: fp, filename, ext })
          }
        }
      }
    }
  }
  return items
}

const ICON_MAP: Record<string, string> = {
  md: '📄',
  txt: '📄',
  json: '📋',
  csv: '📊',
  html: '🌐',
  py: '🐍',
  ts: '🔷',
  tsx: '🔷',
  js: '📜',
  jsx: '📜',
  sh: '⚙️',
  yml: '⚙️',
  yaml: '⚙️',
  png: '🖼️',
  jpg: '🖼️',
  jpeg: '🖼️',
  gif: '🖼️',
  svg: '🖼️',
  pdf: '📕',
}

export function ArtifactBar({ msg }: ArtifactBarProps) {
  const artifacts = extractArtifacts(msg)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  if (artifacts.length === 0) return null

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {artifacts.map((item) => {
          const icon = ICON_MAP[item.ext] || '📎'
          return (
            <button
              key={item.path}
              onClick={() => setSelectedPath(item.path)}
              className="group flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/[0.04] px-3 py-2 text-left hover:border-blue-500/40 hover:bg-blue-500/[0.08] transition-colors"
            >
              <span className="text-base">{icon}</span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-primary truncate max-w-[200px]">
                  {item.filename}
                </p>
                <p className="text-[10px] text-text-muted uppercase">{item.ext || 'file'}</p>
              </div>
              <svg
                className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
          )
        })}
      </div>

      {/* 文件预览弹窗（共享组件，engine 端口 + 应用内渲染） */}
      {selectedPath && (
        <FilePreviewModal path={selectedPath} onClose={() => setSelectedPath(null)} />
      )}
    </>
  )
}
