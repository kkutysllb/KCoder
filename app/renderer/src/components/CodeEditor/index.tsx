// CodeEditor — Monaco 包装的可编辑代码视图。
//
// props: path（绝对路径，用于语言推断 + 标题）、value、onChange、onSave(Ctrl+S)。
// 语言从文件扩展名推断。深色主题（KCoder 一致）。Ctrl/Cmd+S 触发保存。

import { useEffect, useRef } from 'react'
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react'
import '../../lib/monacoSetup'

// 扩展名 → monaco language
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', py: 'python', rb: 'ruby', go: 'go',
  rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sql: 'sql',
  sh: 'shell', bash: 'shell', zsh: 'shell', yaml: 'yaml', yml: 'yaml',
  json: 'json', md: 'markdown', markdown: 'markdown', html: 'html',
  css: 'css', scss: 'scss', less: 'less', xml: 'xml', toml: 'ini',
  ini: 'ini', dockerfile: 'dockerfile', graphql: 'graphql', vue: 'html',
}

export function langFromPath(path: string): string {
  const name = path.split('/').pop() || path
  if (name.toLowerCase() === 'dockerfile') return 'dockerfile'
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return EXT_LANG[ext] || 'plaintext'
}

interface CodeEditorProps {
  path: string
  value: string
  onChange?: (value: string) => void
  onSave?: () => void
  readOnly?: boolean
}

export function CodeEditor({ path, value, onChange, onSave, readOnly }: CodeEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)

  const handleMount: OnMount = (editor, monacoApi: Monaco) => {
    editorRef.current = editor
    // Ctrl/Cmd+S → 保存（阻止浏览器默认保存）
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => {
      onSave?.()
    })
  }

  // 主题跟随 KCoder：html 有 theme-light 时用 light，否则 vs-dark
  useEffect(() => {
    const apply = () => {
      const isLight = document.documentElement.classList.contains('theme-light')
      editorRef.current?.updateOptions({})
      // monaco 主题切换通过 editor 实例不够直接，交给 Editor 组件 theme prop
      void isLight
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const isLight = typeof document !== 'undefined' && document.documentElement.classList.contains('theme-light')

  return (
    <Editor
      path={path}
      language={langFromPath(path)}
      value={value}
      theme={isLight ? 'vs' : 'vs-dark'}
      onChange={(v) => onChange?.(v ?? '')}
      onMount={handleMount}
      loading={<div className="flex h-full items-center justify-center text-xs text-text-muted">Loading editor…</div>}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "'SF Mono', Menlo, Monaco, 'Cascadia Code', monospace",
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        smoothScrolling: true,
        renderWhitespace: 'selection',
      }}
    />
  )
}
