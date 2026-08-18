/**
 * 渲染端入口：极简 hash 路由（#/landing、#/splash、#/setup、#/diagnostics、
 * #/sync、#/plugins、#/terminal、#/preview、#/git、#/preferences）。无框架——桌面壳页面保持
 * 除终端（xterm.js）外零运行时依赖。
 *
 * @module desktop/renderer/src/main
 */

import './app.css'
import { mountSplash } from './views/splash'
import { mountSetup } from './views/setup'
import { mountDiagnostics } from './views/diagnostics'
import { mountSync } from './views/sync'
import { mountPlugins } from './views/plugins'
import { mountTerminal } from './views/terminal'
import { mountPreview } from './views/preview'
import { mountGit } from './views/git'
import { mountPreferences } from './views/preferences'
import { mountLanding } from './views/landing'

const app = document.getElementById('app') as HTMLDivElement

type Route = 'landing' | 'splash' | 'setup' | 'diagnostics' | 'sync' | 'plugins' | 'terminal' | 'preview' | 'git' | 'preferences'

function route(): Route {
  const hash = window.location.hash.replace(/^#\//, '')
  const valid: Route[] = ['landing', 'splash', 'setup', 'diagnostics', 'sync', 'plugins', 'terminal', 'preview', 'git', 'preferences']
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
    case 'terminal':
      void mountTerminal(app)
      break
    case 'preview':
      void mountPreview(app)
      break
    case 'git':
      mountGit(app)
      break
    case 'preferences':
      mountPreferences(app)
      break
  }
}

window.addEventListener('hashchange', render)
render()
