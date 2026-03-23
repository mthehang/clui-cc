/**
 * RcDaemon: Background process for Claude Code Remote Control.
 *
 * Spawns `claude --rc --resume <sessionId>` via node-pty (pseudo-terminal)
 * so Claude treats it as an interactive session. Parses output for the RC URL.
 */

import { EventEmitter } from 'events'
import { findClaudeBinary, prependBinDirToPath } from '../platform'
import { getCliEnv } from '../cli-env'
import { log as _log } from '../logger'
function log(msg: string): void { _log('RcDaemon', msg) }

// node-pty is a native module — require at runtime to avoid Vite bundling issues
let pty: typeof import('node-pty')
try {
  pty = require('node-pty')
} catch {
  // Will fail at start() time if not available
}

export class RcDaemon extends EventEmitter {
  private process: import('node-pty').IPty | null = null
  private rcUrl: string | null = null
  private outputBuffer = ''

  start(sessionId: string, projectPath: string): void {
    if (this.process) this.stop()

    if (!pty) {
      this.emit('error', 'node-pty is not available')
      return
    }

    const claudeBin = findClaudeBinary()
    if (!claudeBin) {
      this.emit('error', 'Claude binary not found')
      return
    }

    const args = ['--rc', '--resume', sessionId]
    const env = { ...process.env, ...getCliEnv() } as Record<string, string>
    prependBinDirToPath(env, claudeBin)

    log(`[RcDaemon] Starting (pty): ${claudeBin} ${args.join(' ')} in ${projectPath}`)

    try {
      this.process = pty.spawn(claudeBin, args, {
        cwd: projectPath,
        env,
        cols: 120,
        rows: 30,
      })
    } catch (err: any) {
      log(`[RcDaemon] Failed to spawn: ${err.message}`)
      this.emit('error', `Failed to spawn: ${err.message}`)
      return
    }

    this.process.onData((data: string) => {
      this.outputBuffer += data
      log(`[RcDaemon] output: ${data.substring(0, 200).replace(/[\r\n]/g, '\\n')}`)

      // RC URL pattern — look for https URL in output (strip ANSI codes)
      if (!this.rcUrl) {
        const clean = this.outputBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        const urlMatch = clean.match(/https:\/\/[^\s\]]+/)
        if (urlMatch) {
          this.rcUrl = urlMatch[0]
          log(`[RcDaemon] RC URL found: ${this.rcUrl}`)
          this.emit('url', this.rcUrl)
        }
      }
    })

    this.process.onExit(({ exitCode, signal }) => {
      log(`[RcDaemon] Process exited: code=${exitCode} signal=${signal}`)
      this.process = null
      this.rcUrl = null
      this.outputBuffer = ''
      this.emit('stopped', exitCode)
    })
  }

  stop(): void {
    if (this.process) {
      log('[RcDaemon] Stopping daemon')
      this.process.kill()
      this.process = null
      this.rcUrl = null
      this.outputBuffer = ''
    }
  }

  getUrl(): string | null {
    return this.rcUrl
  }

  isRunning(): boolean {
    return this.process !== null
  }
}
