/**
 * 渲染端入口：极简 hash 路由（#/landing、#/splash、#/setup、#/diagnostics、
 * #/sync、#/plugins、#/preferences）。无框架零运行时依赖——桌面壳页面
 * 保持轻量。（#/terminal 已随宿主终端面板退役：dsh-terminal 插件
 * 在 dsh shell 页面内自渲染，不经本渲染端。）
 *
 * @module desktop/renderer/src/main
 */

import './app.css'
import { mountSplash } from './views/splash'
import { mountSetup } from './views/setup'
import { mountDiagnostics } from './views/diagnostics'
import { mountSync } from './views/sync'
import { mountPlugins } from './views/plugins'
import { mountPreferences } from './views/preferences'
import { mountLanding } from './views/landing'

const app = document.getElementById('app') as HTMLDivElement

type Route = 'landing' | 'splash' | 'setup' | 'diagnostics' | 'sync' | 'plugins' | 'preferences'

function route(): Route {
  const hash = window.location.hash.replace(/^#\//, '')
  const valid: Route[] = ['landing', 'splash', 'setup', 'diagnostics', 'sync', 'plugins', 'preferences']
  return (valid as string[]).includes(hash) ? (hash as Route) : 'landing'
}

function render(): void {
  app.replaceChildren()
  app.className = ''
  switch (route()) {
    case 'landing':
      mountLanding(app)
      break
    case 'splash':
      mountSplash(app)
      break
    case 'setup':
      mountSetup(app)
      break
    case 'diagnostics':
      mountDiagnostics(app)
      break
    case 'sync':
      mountSync(app)
      break
    case 'plugins':
      mountPlugins(app)
      break
    case 'preferences':
      mountPreferences(app)
      break
  }
}

window.addEventListener('hashchange', render)
render()
