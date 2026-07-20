import type { LoadedSkillPlugin } from './plugin-host.js'
import type { SkillCommandV1 } from './manifest.js'

export type CollectedCommand = SkillCommandV1 & { skillId: string }

export function collectCommands(plugins: readonly LoadedSkillPlugin[], isEnabled?: (p: LoadedSkillPlugin) => boolean): CollectedCommand[] {
  const seen = new Set<string>()
  const out: CollectedCommand[] = []
  for (const plugin of plugins) {
    if (isEnabled && !isEnabled(plugin)) continue
    for (const cmd of plugin.manifest.commands) {
      if (seen.has(cmd.id)) continue
      seen.add(cmd.id)
      out.push({ ...cmd, skillId: plugin.id })
    }
  }
  return out
}
