import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const adapterRequire = createRequire(`${root}/packages/adapters/adapter-storage/package.json`)
const rootRequire = createRequire(`${root}/package.json`)
const sqlitePackageJson = adapterRequire.resolve('better-sqlite3/package.json')
const sqliteDir = dirname(sqlitePackageJson)
const nodeGypBin = rootRequire.resolve('node-gyp/bin/node-gyp.js')

const result = spawnSync(process.execPath, [nodeGypBin, 'rebuild', '--release'], {
  cwd: sqliteDir,
  stdio: 'inherit'
})

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
