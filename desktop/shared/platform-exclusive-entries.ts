/**
 * 平台互斥 entry 归一（纯逻辑半区）。
 *
 * ## 为什么需要（2026-10-10 打包态现场）
 *
 * 上游 `@deepseek-ai/dsh-experimental-terminal-bundle` 把 `optional-terminal-bash`
 * 与 `optional-terminal-pwsh` 定义为**同一个包 `@deepseek-ai/dsh-terminal-bash` 的
 * 两个 entry**（后者靠 `config.shellDialect: pwsh` 区分），并以
 * `disabled: !!js process.platform === 'win32'` / `!== 'win32'` 做**平台互斥**。
 *
 * 但插件页允许把对手那个打开，引擎会把**显式** `disabled: false` 写进 profile 的
 * `cordis.patch.yml`——显式值压过 `!!js` 平台条件 ⇒ 两个 entry 同时激活 ⇒ 都注册
 * 名为 `shell` 的 PTY 后端 ⇒
 * `TerminalError: a PTY backend named "shell" is already registered`
 * （打包态表现：实验性插件页「持久终端」组件「异常」、右栏终端不可用）。
 *
 * 归一策略：按平台把**对手** entry 的 `disabled` 键值强制为 `true`；entry 不存在
 * 时**不新增**（上游平台条件的默认值本就正确），只纠偏「被写下的显式值」。
 * 只改这一个键的值，其余行（含用户自建条目与格式）原样保留。
 *
 * @module desktop/shared/platform-exclusive-entries
 */

/** 终端后端两个 entry 的 id（上游 terminal-bundle 的约定名）。 */
export const TERMINAL_ENTRY_IDS = {
  bash: 'optional-terminal-bash',
  pwsh: 'optional-terminal-pwsh',
} as const

/** 该平台**不该**启用的那个 entry（两个 entry 共享同一后端名，同时启用必冲突）。 */
export function wrongPlatformEntry(platform: string): string {
  return platform === 'win32' ? TERMINAL_ENTRY_IDS.bash : TERMINAL_ENTRY_IDS.pwsh
}

/**
 * 把 `cordis.patch.yml` 文本里「对手 entry」的 `disabled` 归一为 true。
 * @param raw - profile patch 原文（LF 或 CRLF 均可）。
 * @param platform - `process.platform` 取值（注入以便测试）。
 * @returns 归一后的文本与是否发生改动。
 */
export function normalizePatchText(raw: string, platform: string): { text: string; changed: boolean } {
  const target = wrongPlatformEntry(platform)
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  const out: string[] = []
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trim() !== `- id: ${target}`) { out.push(line); continue }
    out.push(line)
    let j = i + 1
    let sawDisabled = false
    const block: string[] = []
    while (j < lines.length) {
      const bl = lines[j] ?? ''
      if (bl !== '' && !/^\s/.test(bl)) break   // 下一个顶层条目
      const m = /^(\s+)disabled:\s*(\S+)\s*$/.exec(bl)
      if (m !== null) {
        sawDisabled = true
        block.push(`${m[1]}disabled: true`)
        if (m[2] !== 'true') changed = true
      } else {
        block.push(bl)
      }
      j++
    }
    if (!sawDisabled) {
      // 插在尾部空行**之前**：YAML 两种写法都合法，但紧凑写法让归一结果可预期
      // （否则出现 `shellDialect: pwsh` 与 `disabled: true` 之间夹空行）。
      let tail = 0
      while (tail < block.length && (block[block.length - 1 - tail] ?? '').trim() === '') tail += 1
      block.splice(block.length - tail, 0, '  disabled: true')
      changed = true
    }
    out.push(...block)
    i = j - 1
  }
  return { text: out.join(eol), changed }
}
