// Package scaffold + fixup script.
// Creates package.json, tsconfig.json for all 15 packages,
// merges barrel exports, fixes imports, moves remaining files.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ROOT = resolve()
const PKGS = join(ROOT, 'packages')

function resolve() { return import.meta.dirname ? join(import.meta.dirname, '..') : process.cwd() }

// ── Package metadata ───────────────────────────────────────────────
const PACKAGES = {
  'contracts': {
    deps: [],
    exports: ['approvals', 'attachments', 'capabilities', 'errors', 'events', 'items',
              'memory', 'model-endpoint-format', 'policy', 'review', 'runtime-info',
              'threads', 'turns', 'usage', 'workspace', 'gui-plan', 'todos',
              'qiongqi-system-prompt', 'qiongqi-config', 'secret-redaction']
  },
  'domain': {
    deps: ['@qiongqi/contracts'],
    exports: ['approval', 'event', 'item', 'model-history-repair', 'runtime-event-reducer',
              'session', 'thread', 'turn', 'usage']
  },
  'ports': {
    deps: ['@qiongqi/contracts', '@qiongqi/domain'],
    exports: ['approval-gate', 'clock', 'event-bus', 'id-generator', 'model-client',
              'session-store', 'thread-store', 'tool-host', 'user-input-gate',
              'web-provider', 'workspace-inspector']
  },
  'cache': {
    deps: ['@qiongqi/contracts', '@qiongqi/ports'],
    exports: ['immutable-prefix', 'lru-cache', 'prefix-volatility',
              'tool-catalog-fingerprint', 'ttl-lru-cache', 'cache-telemetry', 'usage-counter']
  },
  'loop': {
    deps: ['@qiongqi/contracts', '@qiongqi/domain', '@qiongqi/ports', '@qiongqi/cache', '@qiongqi/services'],
    exports: ['append-only-session-log', 'auto-model-router', 'compaction-marker',
              'context-compactor', 'context-estimator', 'continuation-policy',
              'history-healing', 'inflight-tracker', 'loop-events', 'loop-helpers',
              'model-context-profile', 'model-request-estimator', 'model-step-runner',
              'prompt-builder', 'request-history-hygiene', 'steering-queue',
              'token-economy', 'tool-call-coordinator', 'tool-call-repair',
              'tool-storm-breaker', 'turn-orchestrator',
              'git-review-target', 'review-output', 'review-prompt']
  },
  'services': {
    deps: ['@qiongqi/contracts', '@qiongqi/domain', '@qiongqi/ports', '@qiongqi/loop'],
    exports: ['runtime-event-recorder', 'thread-service', 'turn-service', 'usage-service']
  },
  'adapter-model': {
    deps: ['@qiongqi/contracts', '@qiongqi/domain', '@qiongqi/ports'],
    exports: ['deepseek-compat-model-client', 'deepseek-pricing', 'model-error-probe',
              'tool-argument-repair']
  },
  'adapter-storage': {
    deps: ['@qiongqi/contracts', '@qiongqi/domain', '@qiongqi/ports'],
    exports: ['atomic-write', 'file-session-store', 'file-thread-store',
              'hybrid-session-store', 'hybrid-thread-store', 'local-workspace-inspector',
              'in-memory-approval-gate', 'in-memory-event-bus', 'in-memory-session-store',
              'in-memory-thread-store', 'in-memory-user-input-gate']
  },
  'adapter-tools': {
    deps: ['@qiongqi/contracts', '@qiongqi/domain', '@qiongqi/ports', '@qiongqi/services',
           '@qiongqi/memory', '@qiongqi/delegation'],
    exports: ['bash', 'builtin-bash-tool', 'builtin-file-tools', 'builtin-read-tool',
              'builtin-search-tools', 'builtin-tool-operations', 'builtin-tool-types',
              'builtin-tool-utils', 'builtin-tools', 'capability-registry', 'create-plan-tool',
              'delegation-tool-provider', 'edit-diff', 'edit', 'file-mutation-queue',
              'find', 'goal-tools', 'grep', 'local-tool-host', 'ls',
              'mcp-tool-provider', 'mcp-tool-search', 'memory-tool-provider',
              'output-accumulator', 'read-tracker', 'read', 'todo-tools', 'tool-hooks',
              'tool-rate-limit', 'truncate', 'web-tool-provider', 'write']
  },
  'skills': {
    deps: ['@qiongqi/contracts', '@qiongqi/ports', '@qiongqi/adapter-tools'],
    exports: ['manifest', 'marketplace', 'plugin-host', 'skill-command-registry',
              'skill-mcp-bridge', 'skill-runtime', 'skill-tool-provider']
  },
  'memory': {
    deps: ['@qiongqi/contracts', '@qiongqi/adapter-storage'],
    exports: ['memory-store']
  },
  'attachments': {
    deps: ['@qiongqi/contracts'],
    exports: ['attachment-store']
  },
  'delegation': {
    deps: ['@qiongqi/contracts', '@qiongqi/ports', '@qiongqi/cache', '@qiongqi/loop',
           '@qiongqi/adapter-storage'],
    exports: ['child-agent-executor', 'delegation-runtime']
  },
  'http': {
    deps: ['@qiongqi/contracts', '@qiongqi/domain', '@qiongqi/ports', '@qiongqi/cache',
           '@qiongqi/loop', '@qiongqi/services', '@qiongqi/adapter-model',
           '@qiongqi/adapter-storage', '@qiongqi/adapter-tools', '@qiongqi/skills',
           '@qiongqi/memory', '@qiongqi/attachments', '@qiongqi/delegation'],
    exports: ['auth', 'http-server', 'node-http-server', 'read-json-body', 'response',
              'router', 'runtime-factory', 'sse']
  },
  'cli': {
    deps: ['@qiongqi/http', '@qiongqi/contracts', '@qiongqi/adapter-tools',
           '@qiongqi/ports', '@qiongqi/loop'],
    exports: ['agent-cli', 'cli-options', 'serve', 'serve-entry']
  }
}

// ── Generate package.json ──────────────────────────────────────────
function genPackageJson(name, pkg, deps) {
  return JSON.stringify({
    name: `@qiongqi/${name}`,
    version: '0.1.0',
    description: `Qiongqi ${name} package`,
    type: 'module',
    main: './dist/index.js',
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './*': { types: './dist/*.d.ts', import: './dist/*.js' }
    },
    scripts: {
      build: 'tsc -p tsconfig.build.json',
      typecheck: 'tsc --noEmit -p tsconfig.json'
    },
    dependencies: deps.reduce((acc, d) => { acc[d] = 'workspace:*'; return acc }, {}),
    devDependencies: { typescript: '^5.8.2' },
    private: true
  }, null, 2) + '\n'
}

// ── Generate tsconfig.json ─────────────────────────────────────────
function genTsconfig() {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022'],
      strict: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      isolatedModules: true,
      forceConsistentCasingInFileNames: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      noEmit: true,
      types: ['node']
    },
    include: ['src']
  }, null, 2) + '\n'
}

function genTsconfigBuild() {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022'],
      strict: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      isolatedModules: true,
      forceConsistentCasingInFileNames: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      noEmit: false,
      outDir: './dist',
      rootDir: './src',
      types: ['node']
    },
    include: ['src'],
    exclude: ['dist', 'node_modules', '**/*.test.ts']
  }, null, 2) + '\n'
}

// ── Generate barrel index.ts ───────────────────────────────────────
function genIndexTs(exports) {
  const lines = exports
    .map(name => `export * from './${name}.js'`)
    .join('\n')
  return lines + '\n'
}

// ── Main ────────────────────────────────────────────────────────────
for (const [name, meta] of Object.entries(PACKAGES)) {
  const pkgDir = join(PKGS, name)
  mkdirSync(join(pkgDir, 'src'), { recursive: true })

  // Write package.json
  writeFileSync(join(pkgDir, 'package.json'), genPackageJson(name, meta, meta.deps))

  // Write tsconfig files
  writeFileSync(join(pkgDir, 'tsconfig.json'), genTsconfig())
  writeFileSync(join(pkgDir, 'tsconfig.build.json'), genTsconfigBuild())

  // Write barrel index.ts
  writeFileSync(join(pkgDir, 'src', 'index.ts'), genIndexTs(meta.exports))

  console.log(`  ${name}: package.json + tsconfig + index.ts`)
}

// ── Fix ContextCompactor import in services ────────────────────────
const turnServicePath = join(PKGS, 'services', 'src', 'turn-service.ts')
if (existsSync(turnServicePath)) {
  let content = readFileSync(turnServicePath, 'utf-8')
  content = content.replace(
    "import { ContextCompactor } from '@qiongqi/loop'",
    "import type { ContextCompactor } from '@qiongqi/loop'"
  )
  writeFileSync(turnServicePath, content)
  console.log('  Fixed: ContextCompactor → type import in services')
}

// ── Move review-service.ts from services to http ───────────────────
const reviewSvcOld = join(PKGS, 'services', 'src', 'review-service.ts')
const reviewSvcNew = join(PKGS, 'http', 'src', 'review-service.ts')
if (existsSync(reviewSvcOld)) {
  renameSync(reviewSvcOld, reviewSvcNew)
  console.log('  Moved: review-service.ts services → http')
}

console.log('\nScaffold complete!')
