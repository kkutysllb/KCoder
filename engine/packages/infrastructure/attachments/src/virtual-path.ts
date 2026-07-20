import { dirname, join, relative, resolve, sep } from 'node:path'
import { realpathSync } from 'node:fs'

export type VirtualMountName = 'workspace' | 'uploads' | 'outputs' | 'artifacts'

export type VirtualPathResolverOptions = {
  workspaceDir: string
  uploadsDir: string
  outputsDir: string
  artifactsDir?: string
}

export type ResolvedVirtualPath = {
  mount: VirtualMountName
  absolutePath: string
  relativePath: string
  virtualPath: string
}

const VIRTUAL_PREFIX = '/mnt/qiongqi'

export class VirtualPathResolver {
  private readonly mounts: Array<{ name: VirtualMountName; root: string }>

  constructor(options: VirtualPathResolverOptions) {
    this.mounts = [
      { name: 'workspace', root: canonicalRoot(options.workspaceDir) },
      { name: 'uploads', root: canonicalRoot(options.uploadsDir) },
      { name: 'outputs', root: canonicalRoot(options.outputsDir) },
      { name: 'artifacts', root: canonicalRoot(options.artifactsDir ?? options.outputsDir) }
    ]
  }

  async resolve(virtualPath: string): Promise<ResolvedVirtualPath> {
    const decoded = decodeURIComponent(virtualPath)
    const parts = decoded.split('/').filter(Boolean)
    if (parts[0] !== 'mnt' || parts[1] !== 'qiongqi') {
      throw new Error(`unsupported virtual path: ${virtualPath}`)
    }
    const mountName = parts[2] as VirtualMountName | undefined
    const mount = this.mounts.find((entry) => entry.name === mountName)
    if (!mount) throw new Error(`unsupported virtual mount: ${mountName ?? ''}`)
    const relativePath = parts.slice(3).join('/')
    const absolutePath = resolve(mount.root, relativePath)
    assertInside(mount.root, absolutePath, virtualPath)
    return {
      mount: mount.name,
      absolutePath,
      relativePath,
      virtualPath: toVirtual(mount.name, relativePath)
    }
  }

  async toVirtualPath(absolutePath: string): Promise<string | undefined> {
    const resolved = canonicalPath(absolutePath)
    for (const mount of this.mounts) {
      if (!isInside(mount.root, resolved)) continue
      const rel = normalizeVirtualRelative(relative(mount.root, resolved))
      return toVirtual(mount.name, rel)
    }
    return undefined
  }
}

function assertInside(root: string, absolutePath: string, original: string): void {
  if (!isInside(root, absolutePath)) {
    throw new Error(`virtual path escapes mount root: ${original}`)
  }
}

function isInside(root: string, absolutePath: string): boolean {
  const rel = relative(root, absolutePath)
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !resolve(rel).startsWith('/..'))
}

function toVirtual(mount: VirtualMountName, relativePath: string): string {
  const suffix = normalizeVirtualRelative(relativePath)
  return suffix ? `${VIRTUAL_PREFIX}/${mount}/${suffix}` : `${VIRTUAL_PREFIX}/${mount}`
}

function normalizeVirtualRelative(relativePath: string): string {
  return relativePath.split(sep).filter(Boolean).map(encodeURIComponent).join('/')
}

function canonicalRoot(path: string): string {
  return canonicalPath(path)
}

function canonicalPath(path: string): string {
  const absolute = resolve(path)
  const remainder: string[] = []
  let cursor = absolute
  while (true) {
    try {
      const real = realpathSync.native(cursor)
      return remainder.length > 0 ? join(real, ...remainder.reverse()) : real
    } catch {
      const parent = dirname(cursor)
      if (parent === cursor) return absolute
      remainder.push(cursor.slice(parent.length + 1))
      cursor = parent
    }
  }
}
