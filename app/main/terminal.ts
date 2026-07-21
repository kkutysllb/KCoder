import { ipcMain, type BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { homedir } from 'os'
import { basename } from 'path'

interface TerminalSession {
  id: string
  pty: pty.IPty
  shell: string
  cwd: string
}

const sessions = new Map<string, TerminalSession>()
let nextId = 1

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return 'powershell.exe'
  }
  return process.env.SHELL || '/bin/zsh'
}

export interface CreateTerminalOptions {
  cwd?: string
  cols?: number
  rows?: number
}

export interface TerminalInfo {
  id: string
  shell: string
  name: string
  cwd: string
}

/**
 * Register terminal IPC handlers.
 * PTY output is pushed to the renderer via `terminal:data` / `terminal:exit`.
 */
export function setupTerminalIPC(getWindow: () => BrowserWindow | null): void {
  // Create a new PTY session
  ipcMain.handle('terminal:create', (_event, options?: CreateTerminalOptions): TerminalInfo => {
    const shell = getDefaultShell()
    const cwd = options?.cwd || homedir()
    const id = `term-${nextId++}`

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options?.cols || 80,
      rows: options?.rows || 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
    })

    sessions.set(id, { id, pty: ptyProcess, shell, cwd })
    console.log(`[KCoder] Terminal created: ${id} (${shell} @ ${cwd})`)

    // Forward PTY output to the renderer
    ptyProcess.onData((data) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal:data', id, data)
      }
    })

    // Notify renderer when the shell exits
    ptyProcess.onExit(({ exitCode }) => {
      sessions.delete(id)
      console.log(`[KCoder] Terminal exited: ${id} (code ${exitCode})`)
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal:exit', id, exitCode)
      }
    })

    return {
      id,
      shell: basename(shell),
      name: basename(cwd),
      cwd
    }
  })

  // Write user input to the PTY
  ipcMain.on('terminal:write', (_event, id: string, data: string) => {
    sessions.get(id)?.pty.write(data)
  })

  // Resize the PTY
  ipcMain.on('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    try {
      sessions.get(id)?.pty.resize(cols, rows)
    } catch {
      // Ignore resize errors on dead sessions
    }
  })

  // Kill a PTY session
  ipcMain.handle('terminal:kill', (_event, id: string) => {
    const session = sessions.get(id)
    if (session) {
      try {
        session.pty.kill()
      } catch {
        // Already dead
      }
      sessions.delete(id)
      console.log(`[KCoder] Terminal killed: ${id}`)
    }
  })
}

/** Kill all PTY sessions (called on app quit) */
export function killAllTerminals(): void {
  for (const session of sessions.values()) {
    try {
      session.pty.kill()
    } catch {
      // Ignore
    }
  }
  sessions.clear()
}
