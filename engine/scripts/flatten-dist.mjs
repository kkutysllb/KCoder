#!/usr/bin/env node
/**
 * Post-build script: flatten nested dist output.
 *
 * When tsconfig.build.json uses `paths` mapping pointing to other packages' src/,
 * TypeScript outputs a nested structure like:
 *   dist/adapter-tools/src/index.js  (the package's own files)
 *   dist/contracts/src/index.js      (dependency files, duplicated)
 *
 * This script flattens the package's own files to dist/ root level
 * and removes the duplicated dependency directories.
 */
import { readdirSync, statSync, existsSync, rmSync, cpSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packagesDir = resolve(import.meta.dirname, '..', 'packages')

export function packageRelativeDirs(entries, isPackageDir) {
  const dirs = []
  const roots = entries.filter((entry) => !entry.includes('/'))
  for (const root of roots) {
    if (isPackageDir(root)) {
      dirs.push(root)
      continue
    }
    for (const entry of entries) {
      if (entry.startsWith(`${root}/`) && entry.split('/').length === 2 && isPackageDir(entry)) {
        dirs.push(entry)
      }
    }
  }
  return dirs.sort()
}

export function ownNestedSourceDir(pkgDir, relativeDir) {
  return join(pkgDir, 'dist', ...relativeDir.split('/'), 'src')
}

export function flattenDist(packagesRoot = packagesDir) {
  const entries = collectPackageEntries(packagesRoot)
  const packageDirs = packageRelativeDirs(entries, (relative) =>
    existsSync(join(packagesRoot, relative, 'package.json'))
  )

  for (const relativeDir of packageDirs) {
    const pkgDir = join(packagesRoot, relativeDir)
  const distDir = join(pkgDir, 'dist')
  if (!existsSync(distDir)) continue

    // Check if the nested structure exists: dist/<layer>/<pkg>/src/
    const nestedSrc = ownNestedSourceDir(pkgDir, relativeDir)
  if (!existsSync(nestedSrc)) continue

  // Copy the package's own files from nested path to dist root
  const tempDir = join(pkgDir, 'dist-flat-tmp')
  cpSync(nestedSrc, tempDir, { recursive: true })

  // Remove the old dist and replace with flattened version
  rmSync(distDir, { recursive: true })
  renameSync(tempDir, distDir)

    console.log(`  Flattened dist for ${relativeDir}`)
  }

  console.log('Done: all dist directories flattened.')
}

function collectPackageEntries(packagesRoot) {
  const entries = []
  for (const root of readdirSync(packagesRoot)) {
    const rootDir = join(packagesRoot, root)
    if (!statSync(rootDir).isDirectory()) continue
    entries.push(root)
    for (const child of readdirSync(rootDir)) {
      const childDir = join(rootDir, child)
      if (statSync(childDir).isDirectory()) entries.push(`${root}/${child}`)
    }
  }
  return entries
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  flattenDist()
}
