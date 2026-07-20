import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const pkgNames = [
  'contracts', 'domain', 'ports', 'cache', 'loop', 'services',
  'adapter-model', 'adapter-storage', 'adapter-tools', 'skills',
  'memory', 'attachments', 'delegation', 'http', 'cli',
  'adapter-fs', 'tool-infra', 'preset-coding',
]

// Maps each package to its semantic layer directory under packages/.
// Keep in sync with docs/architecture.{zh,en}.md §3.3 layer definitions.
const pkgLayer = {
  'contracts': 'foundation',
  'domain': 'domain-layer',
  'ports': 'ports-layer',
  'cache': 'infrastructure',
  'attachments': 'infrastructure',
  'adapter-fs': 'infrastructure',
  'tool-infra': 'infrastructure',
  'loop': 'engine',
  'services': 'engine',
  'adapter-storage': 'adapters',
  'adapter-model': 'adapters',
  'adapter-tools': 'adapters',
  'skills': 'capabilities',
  'memory': 'capabilities',
  'delegation': 'delegation-layer',
  'http': 'http-layer',
  'cli': 'cli-layer',
  'preset-coding': 'presets',
}

const alias = {}
for (const name of pkgNames) {
  alias[`@qiongqi/${name}`] = resolve(__dirname, 'packages', pkgLayer[name], name, 'src')
}

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
})
