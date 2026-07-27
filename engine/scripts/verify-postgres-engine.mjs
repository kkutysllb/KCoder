import { spawnSync } from 'node:child_process'

const connectionString = process.env.QIONGQI_TEST_POSTGRES_URL
if (!connectionString) {
  console.error('QIONGQI_TEST_POSTGRES_URL is required for PostgreSQL engine verification')
  process.exit(1)
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(
  pnpm,
  [
    'vitest', 'run',
    'tests/postgres-durable-engine-store.test.ts',
    'tests/postgres-governed-engine.test.ts',
    'tests/postgres-durable-parallel-engine.test.ts'
  ],
  { stdio: 'inherit', env: { ...process.env, QIONGQI_TEST_POSTGRES_URL: connectionString } }
)

if (result.error) throw result.error
process.exit(result.status ?? 1)
