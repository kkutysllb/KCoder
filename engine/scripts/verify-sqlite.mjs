import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(join(process.cwd(), 'package.json'))
const Database = require('better-sqlite3')

function assertRow(row, label) {
  if (!row || row.ok !== 1) throw new Error(`${label} sqlite probe failed`)
}

function probeDatabase(path, label) {
  const db = new Database(path)
  try {
    db.exec('create table if not exists qiongqi_probe (id integer primary key, value text not null)')
    db.prepare('insert into qiongqi_probe (value) values (?)').run(label)
    const row = db.prepare('select count(*) as ok from qiongqi_probe where value = ?').get(label)
    assertRow(row, label)
  } finally {
    db.close()
  }
}

const tempDir = await mkdtemp(join(tmpdir(), 'qiongqi-sqlite-'))
try {
  probeDatabase(':memory:', 'memory')
  probeDatabase(join(tempDir, 'probe.sqlite3'), 'file')
  console.log('better-sqlite3 native binding ok; memory and file probes passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
