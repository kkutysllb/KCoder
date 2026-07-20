// Monorepo package migration script.
//
// Moves source files from qiongqi/src/ into packages/*/src/ and rewrites
// all cross-package imports to use @qiongqi/<name> package specifiers.
//
// Run from repo root: node scripts/migrate-packages.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, statSync } from 'node:fs'
import { join, dirname, relative, resolve, basename } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'qiongqi', 'src')
const PACKAGES = join(ROOT, 'packages')

// ── Package mapping: source sub-path → package name ────────────────
// Directories or individual files mapped to their target package.
const PKG_MAP = {
  'contracts':           'contracts',
  'shared':              'contracts',   // merged into contracts
  'prompt':              'contracts',   // merged into contracts
  'config':              'contracts',   // merged into contracts
  'domain':              'domain',
  'ports':               'ports',
  'cache':               'cache',
  'telemetry':           'cache',       // merged into cache
  'loop':                'loop',
  'review':              'loop',        // merged into loop
  'services':            'services',
  'adapters/model':      'adapter-model',
  'adapters/tool':       'adapter-tools',
  'adapters/file':       'adapter-storage',
  'adapters/hybrid':     'adapter-storage',
  'adapters/workspace':  'adapter-storage',
  'adapters/in-memory-approval-gate.ts': 'adapter-storage',
  'adapters/in-memory-event-bus.ts':     'adapter-storage',
  'adapters/in-memory-session-store.ts': 'adapter-storage',
  'adapters/in-memory-thread-store.ts':  'adapter-storage',
  'adapters/in-memory-user-input-gate.ts': 'adapter-storage',
  'skills':              'skills',
  'memory':              'memory',
  'attachments':         'attachments',
  'delegation':          'delegation',
  'server':              'http',
}

// Reverse map: package name → set of source directory roots
const PKG_DIRS = {}
for (const [src, pkg] of Object.entries(PKG_MAP)) {
  if (!PKG_DIRS[pkg]) PKG_DIRS[pkg] = []
  PKG_DIRS[pkg].push(src)
}

// ── Determine which package a source path belongs to ───────────────
function packageForPath(relPath) {
  // relPath is relative to qiongqi/src/, e.g. "domain/turn.ts"
  // Try exact file match first (for individual files like adapters/in-memory-*)
  const fileName = relPath.split('/').pop()
  const parentDir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''

  // Check adapters/in-memory-* individual files
  if (relPath.startsWith('adapters/in-memory-')) {
    return 'adapter-storage'
  }
  if (relPath === 'adapters/index.ts') {
    return 'adapter-storage'  // barrel export for in-memory adapters
  }

  // Check multi-level paths first (adapters/model, adapters/tool, etc.)
  for (const key of Object.keys(PKG_MAP).sort((a, b) => b.split('/').length - a.split('/').length)) {
    if (relPath.startsWith(key + '/')) {
      return PKG_MAP[key]
    }
  }

  // Single-level directory match
  const topDir = relPath.split('/')[0]
  if (PKG_MAP[topDir]) {
    return PKG_MAP[topDir]
  }

  // Root-level files (index.ts)
  if (!relPath.includes('/')) {
    return null  // root index.ts, stays or gets special handling
  }

  return null
}

// ── Determine the flattened path within the package src/ ────────────
// When directories are merged (shared→contracts, telemetry→cache, etc.),
// the files go directly into the package src/ root, not into a subdirectory.
function flattenPath(relPath, pkg) {
  // Remove the source directory prefix
  for (const [src, srcPkg] of Object.entries(PKG_MAP)) {
    if (srcPkg === pkg) {
      if (relPath.startsWith(src + '/')) {
        // If this source dir maps to this package, strip the prefix
        let rest = relPath.slice(src.length + 1)
        // For merged directories (shared, prompt, config, telemetry, review),
        // files go directly into package root (no subdirectory)
        const mergedDirs = ['shared', 'prompt', 'config', 'telemetry', 'review']
        if (mergedDirs.includes(src)) {
          return rest  // e.g., shared/gui-plan.ts → gui-plan.ts
        }
        // For adapters subdirectories, strip the full prefix
        if (src.startsWith('adapters/')) {
          return rest
        }
        // For adapters/in-memory-* individual files
        if (src.endsWith('.ts') && relPath === src) {
          return basename(relPath)
        }
        // Normal case: keep relative path within the directory
        return rest
      }
    }
  }
  return basename(relPath)
}

// ── Rewrite imports in a file ──────────────────────────────────────
function rewriteImports(content, currentPkg, fileRelPath) {
  // Match: from '.../<dir>/<file>.js'
  // Also match: from '.../<dir>' (barrel imports)
  const importRegex = /(from\s+|require\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g

  return content.replace(importRegex, (match, prefix, importPath) => {
    // Resolve the import path relative to the current file
    // importPath is like "../contracts/capabilities.js" or "../../domain/item.js"

    // Count the depth: how many ../ to get to src/
    const fileDir = fileRelPath.includes('/') ? fileRelPath.slice(0, fileRelPath.lastIndexOf('/')) : ''
    const fileDepth = fileDir ? fileDir.split('/').length : 0

    // Parse the import path
    const parts = importPath.split('/')
    let upCount = 0
    let idx = 0
    while (idx < parts.length && (parts[idx] === '..' || parts[idx] === '.')) {
      if (parts[idx] === '..') upCount++
      idx++
    }
    const remaining = parts.slice(idx).join('/')

    // The resolved path from src/ root
    // If file is at depth D in src/, going up `upCount` levels
    // resolves to: src/ + fileDir going up
    const fileDirParts = fileDir ? fileDir.split('/') : []
    const resolvedParts = [...fileDirParts]
    for (let i = 0; i < upCount; i++) resolvedParts.pop()
    resolvedParts.push(...remaining.replace(/\.js$/, '').split('/'))
    const resolvedPath = resolvedParts.join('/')

    // Determine target package for the resolved path
    const targetPkg = packageForPath(resolvedPath.replace(/\.ts$/, ''))

    if (!targetPkg) {
      // Can't determine package, keep as-is
      return match
    }

    if (targetPkg === currentPkg) {
      // Same package — rewrite to relative path within the package
      // Current file's flattened path in the package
      const currentFlat = flattenPath(fileRelPath, currentPkg)
      const currentFlatDir = currentFlat.includes('/') ? currentFlat.slice(0, currentFlat.lastIndexOf('/')) : ''

      // Target file's flattened path in the package
      const targetFlat = flattenPath(resolvedPath.replace(/\.ts$/, '') + (resolvedPath.endsWith('.ts') ? '' : ''), currentPkg)
      // Actually, resolvedPath might not have .ts extension
      const targetFlatPath = flattenPath(resolvedPath.replace(/\.ts$/, ''), currentPkg)

      // Compute relative path from current file to target within the package
      const relPath = relative(currentFlatDir || '.', targetFlatPath)
      const finalPath = relPath.startsWith('.') ? relPath : './' + relPath

      return `${prefix}'${finalPath}.js'`
    }

    // Cross-package import → use @qiongqi/<package>
    return `${prefix}'@qiongqi/${targetPkg}'`
  })
}

// ── Main migration ─────────────────────────────────────────────────
function getAllSourceFiles(dir, base = '') {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relPath = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...getAllSourceFiles(fullPath, relPath))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(relPath)
    }
  }
  return files
}

console.log('Scanning source files...')
const allFiles = getAllSourceFiles(SRC)
console.log(`Found ${allFiles.length} source files`)

// Group files by target package
const filesByPackage = {}
let rootFiles = []

for (const file of allFiles) {
  const pkg = packageForPath(file)
  if (pkg) {
    if (!filesByPackage[pkg]) filesByPackage[pkg] = []
    filesByPackage[pkg].push(file)
  } else {
    rootFiles.push(file)
    console.log(`  ROOT (no package): ${file}`)
  }
}

// Print package summary
for (const [pkg, files] of Object.entries(filesByPackage).sort()) {
  console.log(`  ${pkg}: ${files.length} files`)
}

// Move files and rewrite imports
console.log('\nMigrating files...')
for (const [pkg, files] of Object.entries(filesByPackage)) {
  const pkgSrcDir = join(PACKAGES, pkg, 'src')
  mkdirSync(pkgSrcDir, { recursive: true })

  for (const file of files) {
    const flatPath = flattenPath(file, pkg)
    const srcFile = join(SRC, file)
    const destFile = join(pkgSrcDir, flatPath)

    // Create subdirectories if needed
    mkdirSync(dirname(destFile), { recursive: true })

    // Read, rewrite imports, write
    const content = readFileSync(srcFile, 'utf-8')
    const rewritten = rewriteImports(content, pkg, file)
    writeFileSync(destFile, rewritten)

    console.log(`  ${file} → packages/${pkg}/src/${flatPath}`)
  }
}

console.log(`\nMigration complete!`)
console.log(`Root files (need manual handling): ${rootFiles.join(', ') || 'none'}`)
