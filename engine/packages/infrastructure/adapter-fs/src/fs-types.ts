import { stat } from 'node:fs/promises'

/** File-system stat result (pure I/O, no Agent concepts). */
export type FsStats = NonNullable<Awaited<ReturnType<typeof stat>>>

export type ShellConfig = {
  shell: string
  args: string[]
}

export type TruncateMode = 'head' | 'tail'

export type TextSlice = {
  text: string
  truncated: boolean
  totalLines: number
  shownLines: number
  totalBytes: number
  shownBytes: number
  firstLineExceedsLimit?: boolean
  truncatedBy?: 'lines' | 'bytes'
  lastLinePartial?: boolean
}

export type ListEntry = {
  path: string
  relative_path: string
  name: string
  kind: 'file' | 'directory' | 'symlink' | 'other'
  size: number
}

export type GrepMatch = {
  path: string
  relative_path: string
  line: number
  column: number
  text: string
  context_before?: string[]
  context_after?: string[]
}

export type EditInstruction = {
  oldText: string
  newText: string
}
