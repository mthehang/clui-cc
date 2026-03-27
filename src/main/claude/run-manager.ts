import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { StreamParser } from '../stream-parser'
import { normalize } from './event-normalizer'
import { log as _log } from '../logger'
import { getCliEnv } from '../cli-env'
import { findClaudeBinary, prependBinDirToPath, IS_WIN } from '../platform'
import type { ClaudeEvent, NormalizedEvent, RunOptions, EnrichedError } from '../../shared/types'

const MAX_RING_LINES = 100
const DEBUG = process.env.CLUI_DEBUG === '1'

// Appended to Claude's default system prompt so it knows it's running inside CLUI.
// Uses --append-system-prompt (additive) not --system-prompt (replacement).
// Kept minimal (~50 tokens) — only the context that meaningfully changes output quality.
const CLUI_SYSTEM_HINT = [
  'You are inside CLUI, a desktop GUI that renders full markdown.',
  'Use rich formatting freely: links [label](url), tables, headers, code blocks with language tags.',
  'Keep using your engineering tools (Read, Edit, Bash, etc.) normally.',
].join('\n')

// Tools auto-approved via --allowedTools (never trigger the permission card).
const SAFE_TOOLS = [
  'Read', 'Glob', 'Grep', 'LS',
  'TodoRead', 'TodoWrite',
  'Agent', 'Task', 'TaskOutput',
  'Notebook',
  'WebSearch', 'WebFetch',
]

const DEFAULT_ALLOWED_TOOLS = [
  'Bash', 'Edit', 'Write', 'MultiEdit',
  ...SAFE_TOOLS,
]

function log(msg: string): void {
  _log('RunManager', msg)
}

export interface RunHandle {
  /** Original spawn requestId (for diagnostics) */
  runId: string
  /** Current active requestId — updated each turn in keepalive mode */
  currentRequestId: string
  /** Which tab owns this handle (null for non-persistent) */
  tabId: string | null
  sessionId: string | null
  process: ChildProcess
  pid: number | null
  startedAt: number
  stderrTail: string[]
  stdoutTail: string[]
  toolCallCount: number
  sawPermissionRequest: boolean
  permissionDenials: Array<{ tool_name: string; tool_use_id: string }>
  /** Model used at spawn — used to decide if process can be reused */
  spawnModel: string | null
  /** Permission mode used at spawn */
  spawnPermissionMode: string
  /** True while actively processing a turn, false between turns */
  isTurnActive: boolean
}

/**
 * RunManager: spawns `claude -p` processes, parses NDJSON, emits normalized events.
 *
 * Keepalive mode (default for all tabs):
 *   One process per tab is kept alive across turns. Subsequent prompts for the
 *   same tab are written to the existing process stdin instead of spawning anew.
 *   This eliminates the 300–500ms spawn overhead per message.
 *
 * A process is reused when:
 *   - stdin is still open
 *   - process hasn't exited
 *   - model matches the spawn model
 *   - permission mode matches
 *   - compact is NOT requested (compact needs a fresh --compact spawn)
 *
 * Events emitted:
 *  - 'normalized'      (requestId, NormalizedEvent)
 *  - 'raw'             (requestId, ClaudeEvent)        — for debugging
 *  - 'turn-complete'   (requestId, code, signal, sessionId) — keepalive: turn done, process alive
 *  - 'exit'            (requestId, code, signal, sessionId) — process actually died
 *  - 'tab-process-died'(tabId, code, signal)           — process died while idle (between turns)
 *  - 'error'           (requestId, Error)
 */
export class RunManager extends EventEmitter {
  private activeRuns = new Map<string, RunHandle>()
  /** Holds recently-finished runs so diagnostics survive past process exit */
  private _finishedRuns = new Map<string, RunHandle>()
  /** Persistent handles keyed by tabId — kept alive between turns */
  private tabHandles = new Map<string, RunHandle>()
  private claudeBinary: string

  constructor() {
    super()
    this.claudeBinary = findClaudeBinary()
    log(`Claude binary: ${this.claudeBinary}`)
  }

  private _getEnv(): NodeJS.ProcessEnv {
    const env = getCliEnv()
    prependBinDirToPath(env, this.claudeBinary)
    return env
  }

  /**
   * Check whether an existing handle can be reused for a new turn.
   */
  private _canReuseHandle(handle: RunHandle, options: RunOptions): boolean {
    if (!handle.process.stdin || handle.process.stdin.destroyed) return false
    if (handle.process.exitCode !== null) return false
    if (handle.isTurnActive) return false  // Shouldn't happen, but safe
    if (options.compact) return false       // Compact requires respawn with --compact flag
    const model = options.model || null
    if (model !== handle.spawnModel) return false
    const perm = options.permissionMode || 'ask'
    if (perm !== handle.spawnPermissionMode) return false
    return true
  }

  /**
   * Reuse an existing handle for a new turn: redirect event routing and write prompt.
   */
  private _reuseHandle(handle: RunHandle, newRequestId: string, options: RunOptions): RunHandle {
    const oldRequestId = handle.currentRequestId
    this.activeRuns.delete(oldRequestId)
    handle.currentRequestId = newRequestId
    handle.isTurnActive = true
    this.activeRuns.set(newRequestId, handle)

    const userMessage = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: options.prompt }] },
    })
    handle.process.stdin!.write(userMessage + '\n')

    log(`Reused process [${handle.pid}] for turn [${newRequestId}] on tab ${handle.tabId?.substring(0, 8) ?? '?'}`)
    return handle
  }

  /**
   * Start or reuse a run for the given tab.
   * If a live process exists for tabId and options are compatible, reuses it.
   * Otherwise spawns a new process.
   *
   * @param requestId  Unique ID for this turn (tagged on emitted events)
   * @param tabId      Owning tab (used for keepalive lookup)
   * @param options    Run options
   */
  startRun(requestId: string, tabId: string, options: RunOptions): RunHandle {
    // Fast path: reuse existing live process
    const existing = this.tabHandles.get(tabId)
    if (existing && this._canReuseHandle(existing, options)) {
      return this._reuseHandle(existing, requestId, options)
    }

    // Terminate any existing process that can't be reused
    if (existing) {
      log(`Terminating old process [${existing.pid}] for tab ${tabId.substring(0, 8)} (options changed or process dead)`)
      try { existing.process.stdin?.end() } catch {}
      this.tabHandles.delete(tabId)
    }

    // Slow path: spawn a new process
    return this._spawnProcess(requestId, tabId, options)
  }

  private _spawnProcess(requestId: string, tabId: string, options: RunOptions): RunHandle {
    const rawCwd = options.projectPath === '~' ? homedir() : options.projectPath
    const cwd = rawCwd && existsSync(rawCwd) ? rawCwd : homedir()

    const args: string[] = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]

    const cliPermMap: Record<string, string> = {
      plan: 'plan',
      ask: 'default',
      acceptEdits: 'acceptEdits',
      auto: 'auto',
      dontAsk: 'dontAsk',
      bypass: 'bypassPermissions',
    }
    const effectivePerm = options.permissionMode || 'ask'
    const cliPerm = cliPermMap[effectivePerm] || 'default'
    args.push('--permission-mode', cliPerm)

    if (options.sessionId) {
      args.push('--resume', options.sessionId)
    }
    if (options.model) {
      args.push('--model', options.model)
    }
    if (options.effortLevel) {
      args.push('--effort', options.effortLevel)
    }
    if (options.hookSettingsPath) {
      args.push('--settings', options.hookSettingsPath)
      const safeAllowed = [
        ...SAFE_TOOLS,
        ...(options.allowedTools || []),
      ]
      args.push('--allowedTools', safeAllowed.join(','))
    } else {
      const allAllowed = [
        ...DEFAULT_ALLOWED_TOOLS,
        ...(options.allowedTools || []),
      ]
      args.push('--allowedTools', allAllowed.join(','))
    }

    // maxTurns applies per agentic loop (within a turn), not per session
    const effectiveMaxTurns = options.maxTurns || 25
    args.push('--max-turns', String(effectiveMaxTurns))

    if (options.maxBudgetUsd) {
      args.push('--max-budget-usd', String(options.maxBudgetUsd))
    }
    if (options.systemPrompt) {
      args.push('--append-system-prompt', options.systemPrompt)
    }
    // Inject CLUI_SYSTEM_HINT only on new sessions (not resumes, not warmup)
    if (!options.sessionId && !options.skipSystemHint) {
      args.push('--append-system-prompt', CLUI_SYSTEM_HINT)
    }
    if (options.compact) {
      args.push('--compact')
    }

    if (DEBUG) {
      log(`Spawning [${requestId}]: ${this.claudeBinary} ${args.join(' ')}`)
      log(`Prompt: ${options.prompt.substring(0, 200)}`)
    } else {
      log(`Spawning [${requestId}] for tab ${tabId.substring(0, 8)}`)
    }

    const child = spawn(this.claudeBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: this._getEnv(),
      shell: IS_WIN,
    })

    log(`Spawned PID: ${child.pid}`)

    const handle: RunHandle = {
      runId: requestId,
      currentRequestId: requestId,
      tabId,
      sessionId: options.sessionId || null,
      process: child,
      pid: child.pid || null,
      startedAt: Date.now(),
      stderrTail: [],
      stdoutTail: [],
      toolCallCount: 0,
      sawPermissionRequest: false,
      permissionDenials: [],
      spawnModel: options.model || null,
      spawnPermissionMode: effectivePerm,
      isTurnActive: true,
    }

    // ─── stdout → NDJSON → normalizer → events ───
    const parser = StreamParser.fromStream(child.stdout!)

    parser.on('event', (raw: ClaudeEvent) => {
      // Use handle.currentRequestId (mutable) so events are tagged with the CURRENT turn
      const emitId = handle.currentRequestId

      // Track session ID from init event
      if (raw.type === 'system' && 'subtype' in raw && raw.subtype === 'init') {
        handle.sessionId = (raw as any).session_id
      }

      // Track permission_request events
      if (raw.type === 'permission_request' || (raw.type === 'system' && 'subtype' in raw && (raw as any).subtype === 'permission_request')) {
        handle.sawPermissionRequest = true
        log(`Permission request seen [${emitId}]`)
      }

      // Extract permission_denials from result event
      if (raw.type === 'result') {
        const denials = (raw as any).permission_denials
        if (Array.isArray(denials) && denials.length > 0) {
          handle.permissionDenials = denials.map((d: any) => ({
            tool_name: d.tool_name || '',
            tool_use_id: d.tool_use_id || '',
          }))
          log(`Permission denials [${emitId}]: ${JSON.stringify(handle.permissionDenials)}`)
        }
      }

      this._ringPush(handle.stdoutTail, JSON.stringify(raw).substring(0, 300))
      this.emit('raw', emitId, raw)

      const normalized = normalize(raw)
      for (const evt of normalized) {
        if (evt.type === 'tool_call') handle.toolCallCount++
        this.emit('normalized', emitId, evt)
      }

      // Turn complete: emit signal to ControlPlane but keep process alive
      if (raw.type === 'result') {
        handle.isTurnActive = false
        log(`Turn complete [${emitId}]: keepalive=true, process PID=${handle.pid} staying alive`)
        // 'turn-complete' signals a finished turn; process remains alive for next message
        this.emit('turn-complete', emitId, 0, null, handle.sessionId)
      }
    })

    parser.on('parse-error', (line: string) => {
      log(`Parse error [${handle.currentRequestId}]: ${line.substring(0, 200)}`)
      this._ringPush(handle.stderrTail, `[parse-error] ${line.substring(0, 200)}`)
    })

    // ─── stderr ring buffer ───
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (data: string) => {
      const lines = data.split('\n').filter((l: string) => l.trim())
      for (const line of lines) {
        this._ringPush(handle.stderrTail, line)
      }
      log(`Stderr [${handle.currentRequestId}]: ${data.trim().substring(0, 500)}`)
    })

    // ─── Process lifecycle ───
    child.on('close', (code, signal) => {
      const emitId = handle.currentRequestId
      log(`Process closed [PID=${handle.pid}] [${emitId}]: code=${code} signal=${signal} isTurnActive=${handle.isTurnActive}`)

      // Snapshot diagnostics before deleting handle
      this._finishedRuns.set(emitId, handle)
      this.activeRuns.delete(emitId)
      if (handle.tabId) this.tabHandles.delete(handle.tabId)

      if (handle.isTurnActive) {
        // Process died while processing a turn — ControlPlane must handle this as a failed run
        this.emit('exit', emitId, code, signal, handle.sessionId)
      } else {
        // Process died between turns (was idle, waiting for next message)
        // ControlPlane has already resolved the previous turn's promise.
        // Just notify so the tab can recover on next dispatch.
        this.emit('tab-process-died', handle.tabId, code, signal)
      }

      setTimeout(() => this._finishedRuns.delete(emitId), 30000)
    })

    child.on('error', (err) => {
      const emitId = handle.currentRequestId
      log(`Process error [${emitId}]: ${err.message}`)
      this._finishedRuns.set(emitId, handle)
      this.activeRuns.delete(emitId)
      if (handle.tabId) this.tabHandles.delete(handle.tabId)
      this.emit('error', emitId, err)
      setTimeout(() => this._finishedRuns.delete(emitId), 30000)
    })

    // ─── Write first prompt ───
    const userMessage = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: options.prompt }] },
    })
    child.stdin!.write(userMessage + '\n')

    this.activeRuns.set(requestId, handle)
    this.tabHandles.set(tabId, handle)
    return handle
  }

  /**
   * Gracefully close the persistent process for a tab (stdin close → clean exit).
   * Called when a tab is closed or its session is reset.
   */
  closeTabProcess(tabId: string): void {
    const handle = this.tabHandles.get(tabId)
    if (!handle) return
    log(`Closing tab process [PID=${handle.pid}] for tab ${tabId.substring(0, 8)}`)
    try { handle.process.stdin?.end() } catch {}
    this.tabHandles.delete(tabId)
    // activeRuns cleanup will happen naturally in child.on('close')
  }

  /**
   * Force-terminate the persistent process for a tab (used for session reset).
   */
  terminateTabProcess(tabId: string): void {
    const handle = this.tabHandles.get(tabId)
    if (!handle) return
    log(`Terminating tab process [PID=${handle.pid}] for tab ${tabId.substring(0, 8)}`)
    try { handle.process.stdin?.end() } catch {}
    handle.process.kill('SIGINT')
    this.tabHandles.delete(tabId)
  }

  /**
   * Returns true if a live (stdin-open) process exists for the tab.
   */
  hasLiveProcess(tabId: string): boolean {
    const handle = this.tabHandles.get(tabId)
    if (!handle) return false
    return !handle.process.stdin?.destroyed && handle.process.exitCode === null
  }

  /**
   * Write a message to a running process's stdin (for permission responses, etc.)
   */
  writeToStdin(requestId: string, message: object): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return false
    if (!handle.process.stdin || handle.process.stdin.destroyed) return false

    const json = JSON.stringify(message)
    log(`Writing to stdin [${requestId}]: ${json.substring(0, 200)}`)
    handle.process.stdin.write(json + '\n')
    return true
  }

  /**
   * Cancel a running turn: SIGINT, then SIGKILL after 5s.
   * The process will exit (not be kept alive), since cancellation implies the
   * user wants to stop the current agent loop entirely.
   */
  cancel(requestId: string): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return false

    log(`Cancelling run ${requestId} [PID=${handle.pid}]`)
    // Remove from tabHandles so next dispatch spawns fresh
    if (handle.tabId) this.tabHandles.delete(handle.tabId)

    handle.process.kill('SIGINT')
    setTimeout(() => {
      if (handle.process.exitCode === null) {
        log(`Force killing run ${requestId} (SIGINT did not terminate)`)
        handle.process.kill('SIGKILL')
      }
    }, 5000)

    return true
  }

  /**
   * Get an enriched error object for a failed run.
   */
  getEnrichedError(requestId: string, exitCode: number | null): EnrichedError {
    const handle = this.activeRuns.get(requestId) || this._finishedRuns.get(requestId)
    return {
      message: `Run failed with exit code ${exitCode}`,
      stderrTail: handle?.stderrTail.slice(-20) || [],
      stdoutTail: handle?.stdoutTail.slice(-20) || [],
      exitCode,
      elapsedMs: handle ? Date.now() - handle.startedAt : 0,
      toolCallCount: handle?.toolCallCount || 0,
      sawPermissionRequest: handle?.sawPermissionRequest || false,
      permissionDenials: handle?.permissionDenials || [],
    }
  }

  isRunning(requestId: string): boolean {
    return this.activeRuns.has(requestId)
  }

  getHandle(requestId: string): RunHandle | undefined {
    return this.activeRuns.get(requestId)
  }

  getActiveRunIds(): string[] {
    return Array.from(this.activeRuns.keys())
  }

  private _ringPush(buffer: string[], line: string): void {
    buffer.push(line)
    if (buffer.length > MAX_RING_LINES) {
      buffer.shift()
    }
  }
}
