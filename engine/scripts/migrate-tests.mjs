// Test migration script.
// Copies test files from qiongqi/tests/ and qiongqi/src/**/__tests__/
// to a root-level tests/ directory and rewrites all imports to @qiongqi/*.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

const ROOT = process.cwd()

// Source directories
const TEST_DIRS = [
  join(ROOT, 'qiongqi', 'tests'),
]

// Also scan for __tests__ and inline test files in src
function findTestFiles(dir, base = '') {
  const results = []
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      results.push(...findTestFiles(full, rel))
    } else if (entry.name.endsWith('.test.ts')) {
      results.push(rel)
    }
  }
  return results
}

// Directory-to-package mapping (same as migrate-packages.mjs)
const PKG_MAP = [
  ['contracts', 'contracts'],
  ['shared', 'contracts'],
  ['prompt', 'contracts'],
  ['config', 'contracts'],
  ['domain', 'domain'],
  ['ports', 'ports'],
  ['cache', 'cache'],
  ['telemetry', 'cache'],
  ['loop', 'loop'],
  ['review', 'loop'],
  ['services', 'services'],
  ['adapters/model', 'adapter-model'],
  ['adapters/tool', 'adapter-tools'],
  ['adapters/file', 'adapter-storage'],
  ['adapters/hybrid', 'adapter-storage'],
  ['adapters/workspace', 'adapter-storage'],
  ['adapters', 'adapter-storage'],  // in-memory-* and index.ts
  ['skills', 'skills'],
  ['memory', 'memory'],
  ['attachments', 'attachments'],
  ['delegation', 'delegation'],
  ['server', 'http'],
  ['cli', 'cli'],
]

function pkgForPath(path) {
  for (const [prefix, pkg] of PKG_MAP.sort((a, b) => b[0].length - a[0].length)) {
    if (path.startsWith(prefix + '/')) return pkg
  }
  // Check if it's a file directly in adapters (in-memory-*)
  if (path.startsWith('adapters/in-memory-')) return 'adapter-storage'
  if (path === 'adapters/index.ts') return 'adapter-storage'
  // Single-level match
  const top = path.split('/')[0]
  for (const [prefix, pkg] of PKG_MAP) {
    if (top === prefix) return pkg
  }
  return null
}

function rewriteTestImports(content) {
  // Rewrite ../src/X/Y.js → @qiongqi/<pkg>
  let result = content

  // Pattern: from '../src/<path>' or from '../../src/<path>'
  result = result.replace(
    /from\s+['"](\.\.\/)+src\/([^'"]+)['"]/g,
    (match, dots, srcPath) => {
      // Strip .js extension
      const cleanPath = srcPath.replace(/\.js$/, '')
      const pkg = pkgForPath(cleanPath)
      if (pkg) {
        return `from '@qiongqi/${pkg}'`
      }
      return match
    }
  )

  // Pattern for __tests__ files: from '../capabilities.js' → @qiongqi/contracts
  // These are trickier — we need context of which package the test file is in
  // Handle them per-file in the migration loop below

  return result
}

function rewriteTestImportsWithContext(content, originalPkg) {
  let result = content

  // Rewrite ../src/ imports first
  result = rewriteTestImports(result)

  // Now rewrite relative imports that go outside the test file's package
  // Pattern: from '../X.js' or from '../../X.js' (within src subdirs)
  result = result.replace(
    /from\s+['"](\.\.\/)+([^'"]+)['"]/g,
    (match, dots, relPath) => {
      // Skip if already processed (starts with @qiongqi)
      if (relPath.startsWith('@qiongqi')) return match

      // Skip node: imports
      if (relPath.startsWith('node:')) return match

      // Count how many levels up
      const upCount = (match.match(/\.\.\//g) || []).length
      const cleanPath = relPath.replace(/\.js$/, '')

      // For __tests__ files, the original location tells us the context
      // e.g., skills/__tests__/plugin-host.test.ts → originalPkg = 'skills'
      // from '../plugin-host.js' → same package, keep relative
      // from '../../contracts/capabilities.js' → @qiongqi/contracts

      // Check if the target is a different package
      // First, try to resolve the path from the original package's src directory
      if (upCount >= 2) {
        // Going up 2+ levels means crossing package boundary
        const pkg = pkgForPath(cleanPath)
        if (pkg) return `from '@qiongqi/${pkg}'`
      }

      return match
    }
  )

  return result
}

// ── Main ────────────────────────────────────────────────────────────
const destDir = join(ROOT, 'tests')
mkdirSync(destDir, { recursive: true })

// Collect test files from qiongqi/tests/
const testFiles = findTestFiles(join(ROOT, 'qiongqi', 'tests'))
console.log(`Found ${testFiles.length} test files in qiongqi/tests/`)

// Also collect __tests__ files and inline test files from qiongqi/src/
const srcTestDirs = [
  join(ROOT, 'qiongqi', 'src', 'contracts', '__tests__'),
  join(ROOT, 'qiongqi', 'src', 'skills', '__tests__'),
]
const srcInlineTests = [
  join(ROOT, 'qiongqi', 'src', 'cli', 'agent-cli.test.ts'),
  join(ROOT, 'qiongqi', 'src', 'cli', 'serve.test.ts'),
  join(ROOT, 'qiongqi', 'src', 'config', 'qiongqi-config.test.ts'),
  join(ROOT, 'qiongqi', 'src', 'adapters', 'tool', 'builtin-tool-utils.test.ts'),
  join(ROOT, 'qiongqi', 'src', 'adapters', 'tool', 'file-mutation-queue.test.ts'),
]

let migrated = 0

// Migrate qiongqi/tests/ files
for (const file of testFiles) {
  const src = join(ROOT, 'qiongqi', 'tests', file)
  const dest = join(destDir, file)

  mkdirSync(dirname(dest), { recursive: true })

  let content = readFileSync(src, 'utf-8')
  content = rewriteTestImports(content)
  writeFileSync(dest, content)
  migrated++
}

// Migrate __tests__ files
for (const testDir of srcTestDirs) {
  if (!existsSync(testDir)) continue
  for (const file of readdirSync(testDir)) {
    if (!file.endsWith('.test.ts')) continue
    const src = join(testDir, file)
    const dest = join(destDir, file)

    let content = readFileSync(src, 'utf-8')
    // Determine which package this test belongs to
    const pkg = testDir.includes('contracts') ? 'contracts' : 'skills'
    content = rewriteTestImportsWithContext(content, pkg)
    writeFileSync(dest, content)
    migrated++
  }
}

// Migrate inline test files
for (const src of srcInlineTests) {
  if (!existsSync(src)) continue
  const file = basename(src)
  const dest = join(destDir, file)

  let content = readFileSync(src, 'utf-8')
  content = rewriteTestImports(content)
  writeFileSync(dest, content)
  migrated++
}

console.log(`Migrated ${migrated} test files to tests/`)

// Copy test helper files
const helpers = [
  join(ROOT, 'qiongqi', 'tests', 'loop-test-harness.ts'),
  join(ROOT, 'qiongqi', 'tests', 'http-server-test-harness.ts'),
]
for (const helper of helpers) {
  if (!existsSync(helper)) continue
  const file = basename(helper)
  const dest = join(destDir, file)
  let content = readFileSync(helper, 'utf-8')
  content = rewriteTestImports(content)
  writeFileSync(dest, content)
  console.log(`  Copied helper: ${file}`)
}

console.log('Test migration complete!')
