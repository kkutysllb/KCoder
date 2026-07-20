import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VirtualPathResolver } from '@qiongqi/attachments'

describe('VirtualPathResolver', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qiongqi-virtual-path-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function resolver(): VirtualPathResolver {
    return new VirtualPathResolver({
      workspaceDir: join(dir, 'workspace'),
      uploadsDir: join(dir, 'uploads'),
      outputsDir: join(dir, 'outputs'),
      artifactsDir: join(dir, 'artifacts')
    })
  }

  it('resolves workspace, uploads, outputs, and artifacts mounts', async () => {
    const root = await realpath(dir)
    expect(await resolver().resolve('/mnt/qiongqi/workspace/file.txt')).toMatchObject({
      mount: 'workspace',
      absolutePath: join(root, 'workspace', 'file.txt')
    })
    expect(await resolver().resolve('/mnt/qiongqi/uploads/input.pdf')).toMatchObject({
      mount: 'uploads',
      absolutePath: join(root, 'uploads', 'input.pdf')
    })
    expect(await resolver().resolve('/mnt/qiongqi/outputs/bash-output.txt')).toMatchObject({
      mount: 'outputs',
      absolutePath: join(root, 'outputs', 'bash-output.txt')
    })
    expect(await resolver().resolve('/mnt/qiongqi/artifacts/report.md')).toMatchObject({
      mount: 'artifacts',
      absolutePath: join(root, 'artifacts', 'report.md')
    })
  })

  it('rejects path traversal and percent-encoded traversal', async () => {
    await expect(resolver().resolve('/mnt/qiongqi/outputs/../secret.txt')).rejects.toThrow(/escapes/i)
    await expect(resolver().resolve('/mnt/qiongqi/outputs/%2e%2e/secret.txt')).rejects.toThrow(/escapes/i)
  })

  it('converts physical paths inside mounts back to virtual paths', async () => {
    const root = await realpath(dir)
    expect(await resolver().toVirtualPath(join(root, 'outputs', 'log.txt'))).toBe('/mnt/qiongqi/outputs/log.txt')
  })

  it('returns undefined for paths outside configured mounts', async () => {
    expect(await resolver().toVirtualPath('/tmp/outside.txt')).toBeUndefined()
  })
})
