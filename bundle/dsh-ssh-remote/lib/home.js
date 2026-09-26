// dsh-ssh-remote — 宿主家目录解析（单一事实源）。
//
// dsh 0.1.6-alpha.2 起插件的持久数据必须跟随实际启动它的宿主 home：
// - QiLin 启动器注入 QILIN_HOME，同时把 DSH_HOME 钉到同一处（dsh-compat
//   层行为），两种读法都落在麒麟家目录；
// - DSH/KCoder 侧设 DSH_HOME（KCoder 桌面端为 ~/.kcoder）；
// - 都缺席时回退 ~/.dsh（历史行为，兼容裸 node 直跑）。
// 与 dsh-super-ppts（templates.js）、dsh-skills-stock（stock-home）同口径。
import { homedir } from 'node:os'
import * as path from 'node:path'

/** 宿主家目录：QILIN_HOME → DSH_HOME → ~/.dsh。 */
export function harnessHome() {
  const env = (k) => {
    const v = process.env[k]
    return typeof v === 'string' && v !== '' ? v : null
  }
  return env('QILIN_HOME') ?? env('DSH_HOME') ?? path.join(homedir(), '.dsh')
}
