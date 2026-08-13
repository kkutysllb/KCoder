// shiki 语法高清单例。
//
// createHighlighter 会加载所有注册语言的 grammar（数百 KB），因此只创建
// 一次并全局复用。语言集按 KCoder 对话场景裁剪为常用集，减小首屏开销。
// 高亮失败（未知语言 / 初始化异常）时调用方回退纯文本，绝不让渲染崩溃。

import { createHighlighter, type Highlighter } from 'shiki'

const THEME = 'one-dark-pro'

const LANGS = [
  'typescript',
  'javascript',
  'python',
  'json',
  'bash',
  'markdown',
  'yaml',
  'sql',
  'css',
  'html',
  'xml',
  'java',
  'go',
  'rust',
  'c',
  'cpp',
  'diff'
]

// 语言别名 → shiki lang id（react-markdown 传回的 className 可能是别名）
const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  js: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  md: 'markdown',
  yml: 'yaml',
  htm: 'html',
  cxx: 'cpp',
  h: 'c',
  rb: 'rust'
}

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEME],
      langs: LANGS
    }).catch((err) => {
      // 失败后允许重试（例如网络加载 grammar 失败）
      highlighterPromise = null
      throw err
    })
  }
  return highlighterPromise
}

export function normalizeLang(language: string): string {
  const lang = (language || '').trim().toLowerCase()
  return LANG_ALIASES[lang] ?? lang
}

/**
 * 高亮代码，返回 shiki 输出的 HTML（含行内 token span）。
 * 失败返回 null，调用方应回退到纯文本渲染。
 */
export async function highlight(code: string, language: string): Promise<string | null> {
  try {
    const highlighter = await getHighlighter()
    const lang = normalizeLang(language)
    try {
      return highlighter.codeToHtml(code, { lang, theme: THEME })
    } catch {
      // 语言未注册（如 llvm、proto 等冷门语言）：退化为纯文本着色
      return highlighter.codeToHtml(code, { lang: 'text', theme: THEME })
    }
  } catch {
    return null
  }
}
