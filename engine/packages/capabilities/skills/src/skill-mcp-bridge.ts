import type { LoadedSkillPlugin } from './plugin-host.js'

/**
 * Merge every skill's `tools.mcpServers` into a single McpServerConfig map,
 * namespacing ids as `<skillId>__<serverName>` so they never collide with
 * user-configured servers. Skill servers are always workspace-scoped and
 * trusted only for the current workspace (design §5).
 */
export function collectSkillMcpServers(
  plugins: readonly LoadedSkillPlugin[],
  workspace: string,
  isEnabled?: (plugin: LoadedSkillPlugin) => boolean
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const plugin of plugins) {
    if (isEnabled && !isEnabled(plugin)) continue
    for (const [name, raw] of Object.entries(plugin.manifest.tools.mcpServers)) {
      const server = raw as Record<string, unknown>
      out[`${plugin.id}__${name}`] = {
        ...server,
        trustScope: 'workspace',
        trustedWorkspaceRoots: [workspace]
      }
    }
  }
  return out
}
