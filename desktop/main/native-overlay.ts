/**
 * 原生 in-box 包的运行时覆盖（native overlay）。
 *
 * KCoder 对上游 dsh 自带包的功能增强不走平行 bundle（会被「安装树优先、
 * profile 兜底」的双锚解析绕开），而是把增强后的构建产物整文件覆盖到
 * **运行时实际解析到的安装树**上：
 *
 * - 解析链与运行时一致：profile 清单 → `$DSH_HOME/profiles/node_modules`
 *   扁平兜底 symlink → 安装树真实位置（打包态 userData/kcoder-runtime、
 *   开发态克隆或全局安装，均用户可写）；
 * - 版本门：目标包 version 与 overlay 声明的 targetVersion 不一致时拒绝
 *   覆盖（上游升级后 overlay 须对照 .patches/ 原版快照重新制作）；
 * - 幂等：目标文件已含补丁标记（mark）则跳过；恢复原版 = 重装 dsh 或
 *   重解压运行时后不再启动本覆盖。
 *
 * 首个覆盖对象：@deepseek-ai/dsh-client-ui-deliverables（原生交付面板），
 * 增强审查变更（+N/−N、hunk 红删绿增）与纯审计轮结论卡。
 *
 * @module desktop/main/native-overlay
 */

import { cpSync, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT, dshHome, ensureBundledRuntime } from './dsh-contract'

interface OverlayMeta {
  package: string
  targetVersion: string
  mark: string
}

/** 读取 JSON；失败返回 null。 */
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** overlay 源根（开发态仓库内；打包态 extraResources）。 */
function overlaySourceRoot(): string {
  const packaged = join(process.resourcesPath ?? PROJECT_ROOT, 'native-overlay')
  if (existsSync(join(packaged, 'dsh-client-ui-deliverables'))) return packaged
  return join(PROJECT_ROOT, 'native-overlay')
}

/**
 * 候选安装位置（与运行时「安装树优先」解析对齐；全部命中时逐个覆盖，
 * 读不到/不存在静默跳过）：
 * 1. `$DSH_HOME/profiles/node_modules/<pkg>` 扁平兜底 symlink 的真实指向
 *    （app-boot 维护的「安装闭包」入口，三种 dsh 来源通吃）
 * 2. 打包内置运行时树 `userData/kcoder-runtime/node_modules/<pkg>`（首启
 *    时 1 可能尚未建立）
 */
function candidateDirs(pkg: string): string[] {
  const out: string[] = []
  const flat = join(dshHome(), 'profiles', 'node_modules', ...pkg.split('/'))
  try {
    out.push(realpathSync(flat))
  } catch {
    // 扁平兜底尚未建立：跳过
  }
  const bundled = ensureBundledRuntime()
  if (bundled !== null) out.push(join(bundled, 'node_modules', ...pkg.split('/')))
  return [...new Set(out)]
}

/**
 * 幂等覆盖（dsh 启动前调用）。任何失败只记日志不抛——覆盖缺席时原生
 * 面板照常工作，只是没有 KCoder 增强段。
 */
export function ensureNativeOverlay(): void {
  const root = overlaySourceRoot()
  let overlays: string[]
  try {
    overlays = readdirSync(root).filter((d) => existsSync(join(root, d, 'overlay.json')))
  } catch {
    console.warn('[native-overlay] 源目录缺失，跳过:', root)
    return
  }
  for (const name of overlays) {
    try {
      const meta = readJson(join(root, name, 'overlay.json')) as OverlayMeta | null
      if (meta === null || typeof meta.package !== 'string' || typeof meta.targetVersion !== 'string') {
        console.warn(`[native-overlay] ${name}/overlay.json 无效，跳过`)
        continue
      }
      const overlayFile = join(root, name, 'lib', 'client.js')
      if (!existsSync(overlayFile)) {
        console.warn(`[native-overlay] ${name} 缺少 lib/client.js，跳过`)
        continue
      }
      for (const dir of candidateDirs(meta.package)) {
        const pkgJson = join(dir, 'package.json')
        const installed = readJson(pkgJson) as { version?: unknown } | null
        if (installed === null || typeof installed.version !== 'string') continue
        if (installed.version !== meta.targetVersion) {
          console.warn(
            `[native-overlay] ${meta.package}@${installed.version} ≠ 目标 ${meta.targetVersion}，跳过（上游已升级，overlay 需重新制作）`,
          )
          continue
        }
        const target = join(dir, 'lib', 'client.js')
        let current: string
        try {
          current = readFileSync(target, 'utf8')
        } catch {
          continue
        }
        if (current.includes(meta.mark)) continue
        // 原版签名锚：确认是已知的上游构建（防同版本号但内容异常的树被误覆盖）
        if (!current.includes('selectProducedFiles') || !current.includes('producedForClosing')) {
          console.warn(`[native-overlay] ${target} 非已知上游构建，跳过`)
          continue
        }
        cpSync(overlayFile, target)
        const size = statSync(target).size
        console.log(`[native-overlay] 已覆盖 ${meta.package}/lib/client.js@${installed.version}（${size}B）: ${dir}`)
      }
    } catch (error) {
      console.warn(`[native-overlay] ${name} 覆盖失败（不影响启动）:`, error)
    }
  }
}
