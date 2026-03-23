import { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut, Tray, Menu, nativeImage, nativeTheme, shell, systemPreferences, clipboard, desktopCapturer } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, statSync, createReadStream, readFileSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { createInterface } from 'readline'
import { homedir } from 'os'
import { promisify } from 'util'
import { ControlPlane } from './claude/control-plane'
import { ensureSkills, type SkillStatus } from './skills/installer'
import { fetchCatalog, listInstalled, installPlugin, uninstallPlugin, scanLocalSkills } from './marketplace/catalog'
import { log as _log, LOG_FILE, flushLogs } from './logger'
import { getCliEnv } from './cli-env'
import { IS_MAC, IS_WIN, isAbsolutePath, getIconPath, encodeProjectPath, findBinaryInPath } from './platform'
import { IPC } from '../shared/types'
import type { RunOptions, NormalizedEvent, EnrichedError, AppSettings, CloudUsageResponse, UsageBarData } from '../shared/types'
import { initAutoUpdater, checkForUpdate, downloadUpdate, installUpdate } from './updater'

// Windows: disable hardware acceleration entirely to prevent system freeze on startup.
// transparent: true + DWM layered window composition causes DXGI to stall the GPU pipeline.
if (IS_WIN) {
  app.disableHardwareAcceleration()
}

const DEBUG_MODE = process.env.CLUI_DEBUG === '1'
const SPACES_DEBUG = DEBUG_MODE || process.env.CLUI_SPACES_DEBUG === '1'

function log(msg: string): void {
  _log('main', msg)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let screenshotCounter = 0
let toggleSequence = 0

// Feature flag: enable PTY interactive permissions transport
const INTERACTIVE_PTY = process.env.CLUI_INTERACTIVE_PERMISSIONS_PTY === '1'

const controlPlane = new ControlPlane(INTERACTIVE_PTY)

// ─── Settings Persistence ───

const DEFAULT_SETTINGS: AppSettings = {
  shortcut: null,
  zoomLevel: 1.0,
  autoStart: false,
  startHidden: false,
  permissionMode: 'auto',
  effortLevel: null,
  planMode: false,
  secondaryShortcut: null,
  transcriptionShortcut: null,
  thinkingEnabled: true,

  responseLanguage: 'auto',
  globalRules: '',
  whisperModel: 'tiny',
  whisperLanguage: 'auto',
  whisperDevice: 'auto',
  appLanguage: 'en',
}

let currentSettings: AppSettings = { ...DEFAULT_SETTINGS }

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function loadSettings(): AppSettings {
  try {
    const raw = readFileSync(getSettingsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    currentSettings = { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    currentSettings = { ...DEFAULT_SETTINGS }
  }
  return currentSettings
}

function saveSettings(partial: Partial<AppSettings>): void {
  currentSettings = { ...currentSettings, ...partial }
  try {
    writeFileSync(getSettingsPath(), JSON.stringify(currentSettings, null, 2), 'utf-8')
  } catch (err: any) {
    log(`Failed to save settings: ${err.message}`)
  }
}

// ─── Broadcast to renderer ───

function broadcast(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function snapshotWindowState(reason: string): void {
  if (!SPACES_DEBUG) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    log(`[spaces] ${reason} window=none`)
    return
  }

  const b = mainWindow.getBounds()
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const visibleOnAll = mainWindow.isVisibleOnAllWorkspaces()
  const wcFocused = mainWindow.webContents.isFocused()

  log(
    `[spaces] ${reason} ` +
    `vis=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} wcFocused=${wcFocused} ` +
    `alwaysOnTop=${mainWindow.isAlwaysOnTop()} allWs=${visibleOnAll} ` +
    `bounds=(${b.x},${b.y},${b.width}x${b.height}) ` +
    `cursor=(${cursor.x},${cursor.y}) display=${display.id} ` +
    `workArea=(${display.workArea.x},${display.workArea.y},${display.workArea.width}x${display.workArea.height})`
  )
}

function scheduleToggleSnapshots(toggleId: number, phase: 'show' | 'hide'): void {
  if (!SPACES_DEBUG) return
  const probes = [0, 100, 400, 1200]
  for (const delay of probes) {
    setTimeout(() => {
      snapshotWindowState(`toggle#${toggleId} ${phase} +${delay}ms`)
    }, delay)
  }
}


// ─── Wire ControlPlane events → renderer ───

controlPlane.on('event', (tabId: string, event: NormalizedEvent) => {
  broadcast('clui:normalized-event', tabId, event)
})

controlPlane.on('tab-status-change', (tabId: string, newStatus: string, oldStatus: string) => {
  broadcast('clui:tab-status-change', tabId, newStatus, oldStatus)
})

controlPlane.on('error', (tabId: string, error: EnrichedError) => {
  broadcast('clui:enriched-error', tabId, error)
})

// ─── Window Creation ───

function createWindow(): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width, height } = display.workArea

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),  // NSPanel — non-activating, joins all spaces
    frame: false,
    ...(IS_MAC ? { titleBarStyle: 'hidden' as const } : {}),
    title: '',
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: true,
    backgroundColor: '#00000000',
    show: false,
    icon: getIconPath(join(__dirname, '../../resources')),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Belt-and-suspenders: panel already joins all spaces and floats,
  // but explicit flags ensure correct behavior on older Electron builds.
  if (IS_MAC) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  mainWindow.setAlwaysOnTop(true, IS_MAC ? 'screen-saver' : 'pop-up-menu')

  mainWindow.once('ready-to-show', () => {
    // On Windows, openAsHidden adds --hidden to auto-start args.
    // On macOS, check wasOpenedAsHidden from login item settings.
    const wasOpenedHidden = process.argv.includes('--hidden') ||
      (IS_MAC && app.getLoginItemSettings().wasOpenedAsHidden)

    if (!wasOpenedHidden) {
      mainWindow?.show()
    }

    // Enable OS-level click-through for transparent regions.
    // { forward: true } ensures mousemove events still reach the renderer
    // so it can toggle click-through off when cursor enters interactive UI.
    mainWindow?.setIgnoreMouseEvents(true, { forward: true })
    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  let forceQuit = false
  app.on('before-quit', () => { forceQuit = true })
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Initialize auto-updater (only in packaged builds)
  if (app.isPackaged) {
    initAutoUpdater(mainWindow)
  }
}

function showWindow(source = 'unknown'): void {
  if (!mainWindow) return
  const toggleId = ++toggleSequence

  // Position on the display where the cursor currently is (not always primary)
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea
  mainWindow.setBounds({ x: dx, y: dy, width: dw, height: dh })

  // Always re-assert space membership — the flag can be lost after hide/show cycles
  // and must be set before show() so the window joins the active Space, not its
  // last-known Space.
  if (IS_MAC) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  if (SPACES_DEBUG) {
    log(`[spaces] showWindow#${toggleId} source=${source} move-to-display id=${display.id}`)
    snapshotWindowState(`showWindow#${toggleId} pre-show`)
  }
  // As an accessory app (app.dock.hide), show() + focus gives keyboard
  // without deactivating the active app — hover preserved everywhere.
  mainWindow.show()
  mainWindow.webContents.focus()
  broadcast(IPC.WINDOW_SHOWN)
  if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'show')
}

function toggleWindow(source = 'unknown'): void {
  if (!mainWindow) return
  const toggleId = ++toggleSequence
  if (SPACES_DEBUG) {
    log(`[spaces] toggle#${toggleId} source=${source} start`)
    snapshotWindowState(`toggle#${toggleId} pre`)
  }

  if (mainWindow.isVisible()) {
    // Tell renderer to play exit animation, then it calls hideWindow()
    mainWindow.webContents.send('clui:animate-hide')
    if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'hide')
  } else {
    showWindow(source)
  }
}

// ─── Resize ───
// Fixed-height mode: ignore renderer resize events to prevent jank.
// The native window covers the full workArea; all expand/collapse happens inside the renderer.

ipcMain.on(IPC.RESIZE_HEIGHT, () => {
  // No-op — fixed height window, no dynamic resize
})

ipcMain.on(IPC.SET_WINDOW_WIDTH, () => {
  // No-op — native width is fixed to keep expand/collapse animation smooth.
})

ipcMain.handle(IPC.ANIMATE_HEIGHT, () => {
  // No-op — kept for API compat, animation handled purely in renderer
})

ipcMain.on(IPC.HIDE_WINDOW, () => {
  mainWindow?.hide()
})

ipcMain.handle(IPC.IS_VISIBLE, () => {
  return mainWindow?.isVisible() ?? false
})

// OS-level click-through toggle — renderer calls this on mousemove
// to enable clicks on interactive UI while passing through transparent areas
ipcMain.on(IPC.SET_IGNORE_MOUSE_EVENTS, (event, ignore: boolean, options?: { forward?: boolean }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, options || {})
  }
})

// ─── IPC Handlers (typed, strict) ───

ipcMain.handle(IPC.START, async () => {
  log('IPC START — fetching static CLI info')

  const execFileAsync = promisify(execFile)
  const opts = { encoding: 'utf-8' as const, timeout: 5000, env: getCliEnv() }
  const claudePath = findBinaryInPath('claude') || 'claude'

  const [vResult, authResult, mcpResult] = await Promise.allSettled([
    execFileAsync(claudePath, ['-v'], opts),
    execFileAsync(claudePath, ['auth', 'status'], opts),
    execFileAsync(claudePath, ['mcp', 'list'], opts),
  ])

  const version = vResult.status === 'fulfilled' ? vResult.value.stdout.trim() : 'unknown'

  let auth: { email?: string; subscriptionType?: string; authMethod?: string } = {}
  if (authResult.status === 'fulfilled') {
    try { auth = JSON.parse(authResult.value.stdout.trim()) } catch {}
  }

  let mcpServers: string[] = []
  if (mcpResult.status === 'fulfilled') {
    const raw = mcpResult.value.stdout.trim()
    if (raw) mcpServers = raw.split('\n').filter(Boolean)
  }

  return { version, auth, mcpServers, projectPath: process.cwd(), homePath: homedir() }
})

ipcMain.handle(IPC.CREATE_TAB, () => {
  const tabId = controlPlane.createTab()
  log(`IPC CREATE_TAB → ${tabId}`)
  return { tabId }
})

ipcMain.on(IPC.INIT_SESSION, (_event, tabId: string) => {
  log(`IPC INIT_SESSION: ${tabId}`)
  controlPlane.initSession(tabId)
})

ipcMain.on(IPC.RESET_TAB_SESSION, (_event, tabId: string) => {
  log(`IPC RESET_TAB_SESSION: ${tabId}`)
  controlPlane.resetTabSession(tabId)
})

ipcMain.handle(IPC.PROMPT, async (_event, { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }) => {
  if (DEBUG_MODE) {
    log(`IPC PROMPT: tab=${tabId} req=${requestId} prompt="${options.prompt.substring(0, 100)}"`)
  } else {
    log(`IPC PROMPT: tab=${tabId} req=${requestId}`)
  }

  if (!tabId) {
    throw new Error('No tabId provided — prompt rejected')
  }
  if (!requestId) {
    throw new Error('No requestId provided — prompt rejected')
  }

  try {
    await controlPlane.submitPrompt(tabId, requestId, options)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`PROMPT error: ${msg}`)
    throw err
  }
})

ipcMain.handle(IPC.CANCEL, (_event, requestId: string) => {
  log(`IPC CANCEL: ${requestId}`)
  return controlPlane.cancel(requestId)
})

ipcMain.handle(IPC.STOP_TAB, (_event, tabId: string) => {
  log(`IPC STOP_TAB: ${tabId}`)
  return controlPlane.cancelTab(tabId)
})

ipcMain.handle(IPC.RETRY, async (_event, { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }) => {
  log(`IPC RETRY: tab=${tabId} req=${requestId}`)
  return controlPlane.retry(tabId, requestId, options)
})

ipcMain.handle(IPC.STATUS, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.TAB_HEALTH, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.CLOSE_TAB, (_event, tabId: string) => {
  log(`IPC CLOSE_TAB: ${tabId}`)
  // Kill RC daemon if active for this tab
  const rcDaemon = rcDaemons.get(tabId)
  if (rcDaemon) { rcDaemon.stop(); rcDaemons.delete(tabId) }
  controlPlane.closeTab(tabId)
})

ipcMain.on(IPC.SET_PERMISSION_MODE, (_event, mode: string) => {
  if (mode !== 'ask' && mode !== 'auto' && mode !== 'bypass') {
    log(`IPC SET_PERMISSION_MODE: invalid mode "${mode}" — ignoring`)
    return
  }
  log(`IPC SET_PERMISSION_MODE: ${mode}`)
  controlPlane.setPermissionMode(mode as 'ask' | 'auto' | 'bypass')
  saveSettings({ permissionMode: mode as AppSettings['permissionMode'] })
})

ipcMain.on(IPC.SET_ZOOM, (_event, level: number) => {
  if (typeof level !== 'number' || level < 0.5 || level > 2.0) return
  mainWindow?.webContents.setZoomFactor(level)
  saveSettings({ zoomLevel: level })
})

// ── Editable global shortcut ──
const DEFAULT_SHORTCUT = IS_MAC ? 'Alt+Space' : 'Ctrl+Alt+Space'
let currentPrimaryShortcut = DEFAULT_SHORTCUT

ipcMain.on(IPC.SET_SHORTCUT, (_event, accelerator: string | null) => {
  const newShortcut = (typeof accelerator === 'string' && accelerator.length > 0) ? accelerator : DEFAULT_SHORTCUT
  if (newShortcut === currentPrimaryShortcut) return
  try { globalShortcut.unregister(currentPrimaryShortcut) } catch { /* ignore */ }
  const ok = globalShortcut.register(newShortcut, () => toggleWindow(`shortcut ${newShortcut}`))
  if (ok) {
    log(`Shortcut changed: ${currentPrimaryShortcut} → ${newShortcut}`)
    currentPrimaryShortcut = newShortcut
    saveSettings({ shortcut: newShortcut === DEFAULT_SHORTCUT ? null : newShortcut })
  } else {
    log(`Failed to register shortcut ${newShortcut}, reverting to ${currentPrimaryShortcut}`)
    globalShortcut.register(currentPrimaryShortcut, () => toggleWindow(`shortcut ${currentPrimaryShortcut}`))
  }
})

// ── Secondary shortcut ──
let currentSecondaryShortcut: string | null = null

ipcMain.on(IPC.SET_SECONDARY_SHORTCUT, (_event, accelerator: string | null) => {
  // Unregister old secondary
  if (currentSecondaryShortcut) {
    try { globalShortcut.unregister(currentSecondaryShortcut) } catch { /* ignore */ }
  }
  if (typeof accelerator === 'string' && accelerator.length > 0) {
    const ok = globalShortcut.register(accelerator, () => toggleWindow(`shortcut ${accelerator}`))
    if (ok) {
      log(`Secondary shortcut set: ${accelerator}`)
      currentSecondaryShortcut = accelerator
    } else {
      log(`Failed to register secondary shortcut ${accelerator}`)
      currentSecondaryShortcut = null
    }
  } else {
    currentSecondaryShortcut = null
  }
  saveSettings({ secondaryShortcut: currentSecondaryShortcut })
})

// ── Transcription shortcut ──
let currentTranscriptionShortcut: string | null = null

ipcMain.on(IPC.SET_TRANSCRIPTION_SHORTCUT, (_event, accelerator: string | null) => {
  if (currentTranscriptionShortcut) {
    try { globalShortcut.unregister(currentTranscriptionShortcut) } catch { /* ignore */ }
  }
  if (typeof accelerator === 'string' && accelerator.length > 0) {
    const ok = globalShortcut.register(accelerator, () => {
      // Show window if hidden, then toggle transcription
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show()
        mainWindow.webContents.focus()
        broadcast(IPC.WINDOW_SHOWN)
      }
      broadcast(IPC.TOGGLE_TRANSCRIPTION)
    })
    if (ok) {
      log(`Transcription shortcut set: ${accelerator}`)
      currentTranscriptionShortcut = accelerator
    } else {
      log(`Failed to register transcription shortcut ${accelerator}`)
      currentTranscriptionShortcut = null
    }
  } else {
    currentTranscriptionShortcut = null
  }
  saveSettings({ transcriptionShortcut: currentTranscriptionShortcut })
})

// ── Whisper model management ──
const WHISPER_MODEL_IDS = ['tiny', 'base', 'small', 'medium', 'large-v3', 'large-v3-turbo']

function getWhisperDir(): string {
  if (IS_MAC) return join(homedir(), '.local', 'share', 'whisper')
  return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'clui-cc', 'whisper')
}

ipcMain.handle(IPC.LIST_WHISPER_MODELS, () => {
  const dir = getWhisperDir()
  const result: Record<string, boolean> = {}
  for (const id of WHISPER_MODEL_IDS) {
    const file = join(dir, `ggml-${id}.bin`)
    result[id] = existsSync(file)
  }
  return result
})

ipcMain.handle(IPC.DOWNLOAD_WHISPER_MODEL, async (_event, model: string) => {
  if (typeof model !== 'string' || !WHISPER_MODEL_IDS.includes(model)) {
    return { ok: false, error: 'Invalid model' }
  }
  const dir = getWhisperDir()
  const file = join(dir, `ggml-${model}.bin`)
  if (existsSync(file)) return { ok: true } // already downloaded
  try {
    const { mkdirSync } = require('fs')
    mkdirSync(dir, { recursive: true })
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`
    log(`Downloading whisper model: ${model} from ${url}`)
    const { execFile } = require('child_process')
    await new Promise<void>((resolve, reject) => {
      execFile('curl', ['-L', '--fail', '-o', file, url], { timeout: 600000 }, (err: any) => {
        if (err) reject(err); else resolve()
      })
    })
    if (existsSync(file)) {
      log(`Whisper model downloaded: ${model}`)
      return { ok: true }
    }
    return { ok: false, error: 'Download completed but file not found' }
  } catch (err: any) {
    log(`Whisper model download failed: ${err.message}`)
    // Clean up partial download
    try { require('fs').unlinkSync(file) } catch { /* ignore */ }
    return { ok: false, error: err.message }
  }
})

ipcMain.handle(IPC.DELETE_WHISPER_MODEL, (_event, model: string) => {
  if (typeof model !== 'string' || !WHISPER_MODEL_IDS.includes(model)) {
    return { ok: false, error: 'Invalid model' }
  }
  const file = join(getWhisperDir(), `ggml-${model}.bin`)
  try {
    if (existsSync(file)) {
      require('fs').unlinkSync(file)
      log(`Whisper model deleted: ${model}`)
    }
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

// ── Settings + Usage IPC ──

ipcMain.handle(IPC.GET_SETTINGS, () => currentSettings)

ipcMain.on(IPC.SAVE_SETTINGS, (_event, partial: Partial<AppSettings>) => {
  if (!partial || typeof partial !== 'object') return
  saveSettings(partial)
  // Apply auto-start changes immediately
  if ('autoStart' in partial || 'startHidden' in partial) {
    app.setLoginItemSettings({
      openAtLogin: currentSettings.autoStart,
      openAsHidden: currentSettings.startHidden,
    })
    log(`Auto-start updated: openAtLogin=${currentSettings.autoStart}, openAsHidden=${currentSettings.startHidden}`)
  }
})

// ── Global Rules (reads/writes ~/.claude/CLAUDE.md) ──

const globalRulesPath = join(homedir(), '.claude', 'CLAUDE.md')

ipcMain.handle(IPC.READ_GLOBAL_RULES, () => {
  try {
    return existsSync(globalRulesPath) ? readFileSync(globalRulesPath, 'utf-8') : ''
  } catch {
    return ''
  }
})

ipcMain.handle(IPC.SAVE_GLOBAL_RULES, (_event, content: string) => {
  if (typeof content !== 'string') return
  try {
    const dir = join(homedir(), '.claude')
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true })
    }
    writeFileSync(globalRulesPath, content, 'utf-8')
  } catch (err: any) {
    log(`Failed to save global rules: ${err.message}`)
  }
})

// ── Auto-update IPC ──

ipcMain.handle(IPC.GET_APP_VERSION, () => app.getVersion())
ipcMain.handle(IPC.CHECK_FOR_UPDATE, () => { checkForUpdate(); return true })
ipcMain.handle(IPC.DOWNLOAD_UPDATE, () => { downloadUpdate(); return true })
ipcMain.handle(IPC.INSTALL_UPDATE, () => { installUpdate(); return true })

// ── Cloud Usage (claude.ai-style bars) ──

let usageCache: { data: CloudUsageResponse; fetchedAt: number } | null = null
const USAGE_CACHE_TTL = 5 * 60 * 1000 // 5 min

ipcMain.handle(IPC.FETCH_USAGE, async (_event, opts?: { forceRefresh?: boolean }) => {
  const force = opts?.forceRefresh === true
  if (!force && usageCache && Date.now() - usageCache.fetchedAt < USAGE_CACHE_TTL) {
    return usageCache.data
  }

  // Try reading OAuth credentials from ~/.claude/.credentials.json
  const credPath = join(homedir(), '.claude', '.credentials.json')
  let accessToken: string | null = null
  let orgId: string | null = null
  let subscriptionType: string | null = null

  try {
    const creds = JSON.parse(readFileSync(credPath, 'utf-8'))
    accessToken = creds?.claudeAiOauth?.accessToken || null
    orgId = creds?.organizationUuid || null
    subscriptionType = creds?.claudeAiOauth?.subscriptionType || null
  } catch {
    log('FETCH_USAGE: no credentials found')
  }

  // Try fetching from claude.ai API
  if (accessToken && orgId) {
    try {
      const { net } = await import('electron')
      const url = `https://claude.ai/api/organizations/${orgId}/usage`
      const response = await net.fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'anthropic-client-platform': 'web',
          'User-Agent': 'CluiCC/1.0',
        },
      })

      if (response.ok) {
        const data = await response.json() as any
        const bars: UsageBarData[] = []

        // Parse the response — adapt to claude.ai API shape
        if (data?.daily_usage || data?.usage) {
          const usage = data.daily_usage || data.usage || data
          // Session/daily limit
          if (usage.daily_limit !== undefined || usage.message_limit !== undefined) {
            bars.push({
              label: 'Sessao atual',
              current: usage.daily_used ?? usage.messages_used ?? 0,
              limit: usage.daily_limit ?? usage.message_limit ?? 100,
              unit: 'messages',
              resetsAt: usage.daily_resets_at ?? usage.resets_at ?? null,
            })
          }
          // Weekly/all models
          if (usage.weekly_limit !== undefined) {
            bars.push({
              label: 'Todos os modelos',
              current: usage.weekly_used ?? 0,
              limit: usage.weekly_limit ?? 100,
              unit: 'messages',
              resetsAt: usage.weekly_resets_at ?? null,
            })
          }
        }

        // If we got structured rate limit data
        if (Array.isArray(data?.rate_limits)) {
          for (const rl of data.rate_limits) {
            bars.push({
              label: rl.label || rl.type || 'Limite',
              current: rl.used ?? rl.current ?? 0,
              limit: rl.limit ?? rl.max ?? 100,
              unit: rl.unit || 'requests',
              resetsAt: rl.resets_at ?? rl.resetsAt ?? null,
            })
          }
        }

        // If API returned data but we couldn't parse bars, add raw percentage if available
        if (bars.length === 0 && typeof data === 'object') {
          // Try common field patterns
          for (const key of Object.keys(data)) {
            const val = data[key]
            if (val && typeof val === 'object' && ('used' in val || 'current' in val) && ('limit' in val || 'max' in val)) {
              bars.push({
                label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                current: val.used ?? val.current ?? 0,
                limit: val.limit ?? val.max ?? 100,
                unit: val.unit || 'units',
                resetsAt: val.resets_at ?? val.resetsAt ?? null,
              })
            }
          }
        }

        const result: CloudUsageResponse = {
          bars,
          lastUpdated: Date.now(),
          source: 'cloud',
          error: bars.length === 0 ? 'API returned data but no recognizable usage bars' : null,
          subscriptionType,
        }
        usageCache = { data: result, fetchedAt: Date.now() }
        log(`FETCH_USAGE: cloud success, ${bars.length} bars`)
        return result
      }

      log(`FETCH_USAGE: API returned ${response.status}`)
    } catch (err: any) {
      log(`FETCH_USAGE: cloud fetch failed — ${err.message}`)
    }
  }

  // Fallback: local-only data
  const result: CloudUsageResponse = {
    bars: [],
    lastUpdated: Date.now(),
    source: 'local',
    error: accessToken ? 'Nao foi possivel acessar a API do claude.ai' : 'Credenciais nao encontradas',
    subscriptionType,
  }
  usageCache = { data: result, fetchedAt: Date.now() }
  return result
})

ipcMain.handle(IPC.RESPOND_PERMISSION, (_event, { tabId, questionId, optionId }: { tabId: string; questionId: string; optionId: string }) => {
  log(`IPC RESPOND_PERMISSION: tab=${tabId} question=${questionId} option=${optionId}`)
  return controlPlane.respondToPermission(tabId, questionId, optionId)
})

ipcMain.handle(IPC.LIST_SESSIONS, async (_e, projectPath?: string) => {
  log(`IPC LIST_SESSIONS ${projectPath ? `(path=${projectPath})` : ''}`)
  try {
    const cwd = projectPath || process.cwd()
    // Validate projectPath — reject null bytes, newlines, non-absolute paths
    if (/[\0\r\n]/.test(cwd) || !isAbsolutePath(cwd)) {
      log(`LIST_SESSIONS: rejected invalid projectPath: ${cwd}`)
      return []
    }
    // Claude stores project sessions at ~/.claude/projects/<encoded-path>/
    const encodedPath = encodeProjectPath(cwd)
    const sessionsDir = join(homedir(), '.claude', 'projects', encodedPath)
    if (!existsSync(sessionsDir)) {
      log(`LIST_SESSIONS: directory not found: ${sessionsDir}`)
      return []
    }
    const files = readdirSync(sessionsDir).filter((f: string) => f.endsWith('.jsonl'))

    const sessions: Array<{ sessionId: string; slug: string | null; firstMessage: string | null; lastTimestamp: string; size: number }> = []

    // UUID v4 regex — only consider files named as valid UUIDs
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    for (const file of files) {
      // The filename (without .jsonl) IS the canonical resume ID for `claude --resume`
      const fileSessionId = file.replace(/\.jsonl$/, '')
      if (!UUID_RE.test(fileSessionId)) continue // skip non-UUID files

      const filePath = join(sessionsDir, file)
      const stat = statSync(filePath)
      if (stat.size < 100) continue // skip trivially small files

      // Read lines to extract metadata and validate transcript schema
      const meta: { validated: boolean; slug: string | null; firstMessage: string | null; lastTimestamp: string | null } = {
        validated: false, slug: null, firstMessage: null, lastTimestamp: null,
      }

      await new Promise<void>((resolve) => {
        const rl = createInterface({ input: createReadStream(filePath) })
        rl.on('line', (line: string) => {
          try {
            const obj = JSON.parse(line)
            // Validate: must have expected Claude transcript fields
            if (!meta.validated && obj.type && obj.timestamp) {
              meta.validated = true
            }
            if (obj.slug && !meta.slug) meta.slug = obj.slug
            if (obj.timestamp) meta.lastTimestamp = obj.timestamp
            if (obj.type === 'user' && !meta.firstMessage) {
              const content = obj.message?.content
              if (typeof content === 'string') {
                meta.firstMessage = content.substring(0, 100)
              } else if (Array.isArray(content)) {
                const textPart = content.find((p: any) => p.type === 'text')
                meta.firstMessage = textPart?.text?.substring(0, 100) || null
              }
            }
          } catch {}
          // Read all lines to get the last timestamp
        })
        rl.on('close', () => resolve())
      })

      if (meta.validated) {
        sessions.push({
          sessionId: fileSessionId,
          slug: meta.slug,
          firstMessage: meta.firstMessage,
          lastTimestamp: meta.lastTimestamp || stat.mtime.toISOString(),
          size: stat.size,
        })
      }
    }

    // Sort by last timestamp, most recent first
    sessions.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
    return sessions.slice(0, 20) // Return top 20
  } catch (err) {
    log(`LIST_SESSIONS error: ${err}`)
    return []
  }
})

// Load conversation history from a session's JSONL file
ipcMain.handle(IPC.LOAD_SESSION, async (_e, arg: { sessionId: string; projectPath?: string } | string) => {
  const sessionId = typeof arg === 'string' ? arg : arg.sessionId
  const projectPath = typeof arg === 'string' ? undefined : arg.projectPath
  log(`IPC LOAD_SESSION ${sessionId}${projectPath ? ` (path=${projectPath})` : ''}`)

  // Validate sessionId — must be strict UUID to prevent path traversal via crafted filenames
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(sessionId)) {
    log(`LOAD_SESSION: rejected invalid sessionId: ${sessionId}`)
    return []
  }

  try {
    const cwd = projectPath || process.cwd()
    // Validate projectPath — reject null bytes, newlines, non-absolute paths
    if (/[\0\r\n]/.test(cwd) || !isAbsolutePath(cwd)) {
      log(`LOAD_SESSION: rejected invalid projectPath: ${cwd}`)
      return []
    }
    const encodedPath = encodeProjectPath(cwd)
    const filePath = join(homedir(), '.claude', 'projects', encodedPath, `${sessionId}.jsonl`)
    if (!existsSync(filePath)) return []

    const messages: Array<{ role: string; content: string; toolName?: string; timestamp: number }> = []
    await new Promise<void>((resolve) => {
      const rl = createInterface({ input: createReadStream(filePath) })
      rl.on('line', (line: string) => {
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'user') {
            const content = obj.message?.content
            let text = ''
            if (typeof content === 'string') {
              text = content
            } else if (Array.isArray(content)) {
              text = content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n')
            }
            if (text) {
              messages.push({ role: 'user', content: text, timestamp: new Date(obj.timestamp).getTime() })
            }
          } else if (obj.type === 'assistant') {
            const content = obj.message?.content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  messages.push({ role: 'assistant', content: block.text, timestamp: new Date(obj.timestamp).getTime() })
                } else if (block.type === 'tool_use' && block.name) {
                  messages.push({
                    role: 'tool',
                    content: '',
                    toolName: block.name,
                    timestamp: new Date(obj.timestamp).getTime(),
                  })
                }
              }
            }
          }
        } catch {}
      })
      rl.on('close', () => resolve())
    })
    return messages
  } catch (err) {
    log(`LOAD_SESSION error: ${err}`)
    return []
  }
})

ipcMain.handle(IPC.LIST_LOCAL_SKILLS, async () => {
  try {
    return await scanLocalSkills()
  } catch { return [] }
})

ipcMain.handle(IPC.RUN_CLI_LOGIN, async () => {
  const claudePath = findBinaryInPath('claude') || 'claude'
  try {
    const { spawn } = require('child_process')
    // claude login opens a browser for OAuth — run detached so it doesn't block
    const child = spawn(claudePath, ['login'], {
      detached: true,
      stdio: 'ignore',
      env: getCliEnv(),
    })
    child.unref()
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle(IPC.SELECT_DIRECTORY, async () => {
  if (!mainWindow) return null
  // macOS: activate app so unparented dialog appears on top (not behind other apps).
  // Unparented avoids modal dimming on the transparent overlay.
  // Activation is fine here — user is actively interacting with CLUI.
  if (process.platform === 'darwin') app.focus()
  const options = { properties: ['openDirectory'] as const }
  const result = process.platform === 'darwin'
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(mainWindow, options)
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
  try {
    // Parse with URL constructor to reject malformed/ambiguous payloads
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (!parsed.hostname) return false
    await shell.openExternal(parsed.href)
    return true
  } catch {
    return false
  }
})

ipcMain.handle(IPC.ATTACH_FILES, async () => {
  if (!mainWindow) return null
  // macOS: activate app so unparented dialog appears on top
  if (process.platform === 'darwin') app.focus()
  const options = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
      { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'md', 'json', 'yaml', 'toml'] },
    ],
  }
  const result = process.platform === 'darwin'
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(mainWindow, options)
  if (result.canceled || result.filePaths.length === 0) return null

  const { basename, extname } = require('path')
  const { readFileSync, statSync } = require('fs')

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json', '.yaml': 'text/yaml', '.toml': 'text/toml',
  }

  return result.filePaths.map((fp: string) => {
    const ext = extname(fp).toLowerCase()
    const mime = mimeMap[ext] || 'application/octet-stream'
    const stat = statSync(fp)
    let dataUrl: string | undefined

    // Generate preview data URL for images (max 2MB to keep IPC fast)
    if (IMAGE_EXTS.has(ext) && stat.size < 2 * 1024 * 1024) {
      try {
        const buf = readFileSync(fp)
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      } catch {}
    }

    return {
      id: crypto.randomUUID(),
      type: IMAGE_EXTS.has(ext) ? 'image' : 'file',
      name: basename(fp),
      path: fp,
      mimeType: mime,
      dataUrl,
      size: stat.size,
    }
  })
})

// Transparent overlay HTML for screenshot selection (crosshair + orange dashed rect)
const SCREENSHOT_OVERLAY_HTML = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}html,body{width:100vw;height:100vh;overflow:hidden;background:transparent;cursor:crosshair;user-select:none;-webkit-user-select:none}canvas{position:fixed;top:0;left:0;width:100vw;height:100vh}</style></head><body><canvas id="c"></canvas><script>
const c=document.getElementById('c'),g=c.getContext('2d'),D=devicePixelRatio||1;c.width=innerWidth*D;c.height=innerHeight*D;g.scale(D,D);
let sx,sy,ex,ey,dr=false;
function p(){const W=innerWidth,H=innerHeight;g.clearRect(0,0,W,H);g.fillStyle='rgba(0,0,0,0.18)';g.fillRect(0,0,W,H);if(!dr)return;const rx=Math.min(sx,ex),ry=Math.min(sy,ey),rw=Math.abs(ex-sx),rh=Math.abs(ey-sy);g.save();g.beginPath();g.rect(0,0,W,H);g.rect(rx,ry,rw,rh);g.clip('evenodd');g.fillStyle='rgba(0,0,0,0.35)';g.fillRect(0,0,W,H);g.restore();g.clearRect(rx,ry,rw,rh);g.strokeStyle='#f97316';g.lineWidth=2;g.setLineDash([6,4]);g.strokeRect(rx+1,ry+1,rw-2,rh-2);if(rw>50&&rh>25){const l=Math.round(rw)+'\\u00d7'+Math.round(rh);g.font='12px system-ui';g.setLineDash([]);const m=g.measureText(l),lx=rx+rw/2-m.width/2,ly=ry+rh+20;g.fillStyle='rgba(0,0,0,0.75)';g.beginPath();g.roundRect(lx-6,ly-13,m.width+12,18,4);g.fill();g.fillStyle='#fff';g.fillText(l,lx,ly)}}p();setTimeout(()=>window.focus(),50);document.oncontextmenu=e=>e.preventDefault();
c.onmousedown=e=>{window.focus();sx=ex=e.clientX;sy=ey=e.clientY;dr=true};c.onmousemove=e=>{if(dr){ex=e.clientX;ey=e.clientY;p()}};
c.onmouseup=e=>{if(!dr)return;dr=false;ex=e.clientX;ey=e.clientY;const w=Math.abs(ex-sx),h=Math.abs(ey-sy);if(w<5||h<5){console.log('{"a":"x"}');return}console.log(JSON.stringify({a:'ok',r:{x:Math.round(Math.min(sx,ex)),y:Math.round(Math.min(sy,ey)),w:Math.round(w),h:Math.round(h)}}))};
document.onkeydown=e=>{if(e.key==='Escape')console.log('{"a":"x"}')};
</script></body></html>`

ipcMain.handle(IPC.TAKE_SCREENSHOT, async () => {
  if (!mainWindow) return null

  if (SPACES_DEBUG) snapshotWindowState('screenshot pre-hide')
  mainWindow.hide()
  await new Promise((r) => setTimeout(r, 300))

  try {
    if (IS_WIN) {
      // Windows: transparent overlay selection + desktopCapturer crop
      const displays = screen.getAllDisplays()
      const overlays: BrowserWindow[] = []
      const selection = await new Promise<{ di: number; r: { x: number; y: number; w: number; h: number } } | null>((resolve) => {
        let done = false
        for (let i = 0; i < displays.length; i++) {
          const d = displays[i]
          const ow = new BrowserWindow({
            x: d.bounds.x, y: d.bounds.y,
            width: d.bounds.width, height: d.bounds.height,
            transparent: true, frame: false, alwaysOnTop: true,
            skipTaskbar: true, resizable: false, movable: false,
            hasShadow: false, show: false, focusable: true,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
          })
          ow.setAlwaysOnTop(true, 'screen-saver')
          const idx = i
          ow.webContents.on('console-message', (_ev: any, _lvl: any, msg: string) => {
            if (done) return
            try {
              const data = JSON.parse(msg)
              if (data.a === 'ok') { done = true; resolve({ di: idx, r: data.r }) }
              else if (data.a === 'x') { done = true; resolve(null) }
            } catch {}
          })
          ow.once('closed', () => { if (!done) { done = true; resolve(null) } })
          ow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SCREENSHOT_OVERLAY_HTML)}`)
          ow.once('ready-to-show', () => ow.show())
          overlays.push(ow)
        }
      })

      for (const ow of overlays) { if (!ow.isDestroyed()) ow.close() }
      if (!selection) return null

      // Wait for OS to finish removing overlay windows from screen buffer
      await new Promise((r) => setTimeout(r, 200))

      const td = displays[selection.di]
      const sf = td.scaleFactor || 1
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.ceil(td.bounds.width * sf), height: Math.ceil(td.bounds.height * sf) },
      })
      const source = sources.find((s: any) => s.display_id === String(td.id)) || sources[selection.di] || sources[0]
      if (!source || source.thumbnail.isEmpty()) return null

      const cropped = source.thumbnail.crop({
        x: Math.round(selection.r.x * sf), y: Math.round(selection.r.y * sf),
        width: Math.round(selection.r.w * sf), height: Math.round(selection.r.h * sf),
      })
      const buf = cropped.toPNG()
      const { writeFileSync } = require('fs')
      const { tmpdir } = require('os')
      const { join: joinPath } = require('path')
      const tmpPath = joinPath(tmpdir(), `clui-screenshot-${Date.now()}.png`)
      writeFileSync(tmpPath, buf)
      return {
        id: crypto.randomUUID(),
        type: 'image',
        name: `screenshot ${++screenshotCounter}.png`,
        path: tmpPath,
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
        size: buf.length,
      }
    }

    // macOS: use native screencapture with interactive selection
    const { execSync } = require('child_process')
    const { join } = require('path')
    const { tmpdir } = require('os')
    const { readFileSync, existsSync } = require('fs')

    const timestamp = Date.now()
    const screenshotPath = join(tmpdir(), `clui-screenshot-${timestamp}.png`)

    execSync(`/usr/sbin/screencapture -i "${screenshotPath}"`, {
      timeout: 30000,
      stdio: 'ignore',
    })

    if (!existsSync(screenshotPath)) {
      return null
    }

    // Return structured attachment with data URL preview
    const buf = readFileSync(screenshotPath)
    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `screenshot ${++screenshotCounter}.png`,
      path: screenshotPath,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
      size: buf.length,
    }
  } catch {
    return null
  } finally {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.webContents.focus()
    }
    broadcast(IPC.WINDOW_SHOWN)
    if (SPACES_DEBUG) {
      log('[spaces] screenshot restore show+focus')
      snapshotWindowState('screenshot restore immediate')
      setTimeout(() => snapshotWindowState('screenshot restore +200ms'), 200)
    }
  }
})

let pasteCounter = 0
ipcMain.handle(IPC.PASTE_IMAGE, async (_event, dataUrl: string) => {
  try {
    const { writeFileSync } = require('fs')
    const { join } = require('path')
    const { tmpdir } = require('os')

    // Parse data URL: "data:image/png;base64,..."
    const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/)
    if (!match) return null

    const [, mimeType, ext, base64Data] = match
    const buf = Buffer.from(base64Data, 'base64')
    const timestamp = Date.now()
    const filePath = join(tmpdir(), `clui-paste-${timestamp}.${ext}`)
    writeFileSync(filePath, buf)

    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `pasted image ${++pasteCounter}.${ext}`,
      path: filePath,
      mimeType,
      dataUrl,
      size: buf.length,
    }
  } catch {
    return null
  }
})

ipcMain.handle(IPC.TRANSCRIBE_AUDIO, async (_event, audioBase64: string) => {
  const { writeFileSync, existsSync, unlinkSync, readFileSync } = require('fs')
  const { execFile } = require('child_process')
  const { join, basename } = require('path')
  const { tmpdir } = require('os')

  const startedAt = Date.now()
  const phaseMs: Record<string, number> = {}
  const mark = (name: string, t0: number) => { phaseMs[name] = Date.now() - t0 }

  const tmpWav = join(tmpdir(), `clui-voice-${Date.now()}.wav`)
  try {
    const runExecFile = (bin: string, args: string[], timeout: number): Promise<string> =>
      new Promise((resolve, reject) => {
        // Set cwd to binary's directory so CUDA DLLs are found
        const cwd = require('path').dirname(bin)
        execFile(bin, args, { encoding: 'utf-8', timeout, cwd }, (err: any, stdout: string, stderr: string) => {
          const isDeprecationWarning = stderr?.includes('deprecated') || stderr?.includes('deprecation-warning')

          if (err) {
            // Whisper may exit non-zero with a deprecation warning but still produce valid output
            if (stdout?.trim()) {
              log(`whisper exited with error but produced output, using stdout. stderr: ${stderr?.trim()}`)
              resolve(stdout)
              return
            }
            // Deprecation warning with no output is not a real error — resolve empty
            if (isDeprecationWarning) {
              log(`whisper deprecation warning only (no output), treating as empty`)
              resolve('')
              return
            }
            const detail = stderr?.trim() || err.message
            reject(new Error(detail))
            return
          }
          resolve(stdout || '')
        })
      })

    let t0 = Date.now()
    const buf = Buffer.from(audioBase64, 'base64')
    writeFileSync(tmpWav, buf)
    mark('decode+write_wav', t0)

    // Read device setting early — it affects binary detection order
    const wDevice = loadSettings().whisperDevice || 'auto'

    // Find whisper backend in priority order
    t0 = Date.now()
    let whisperBin = ''

    const whisperLocalDir = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'clui-cc', 'whisper')

    if (IS_WIN) {
      // Windows: detection order depends on device setting
      // GPU/Auto → prefer PATH (system-installed, may have CUDA) → bundled → local
      // CPU → prefer bundled/local (CPU-only) → PATH
      const preferPath = wDevice !== 'cpu'

      const findInPath = (): string => {
        for (const name of ['whisper-whisper-cli', 'whisper-cli', 'whisper']) {
          const found = findBinaryInPath(name)
          if (found) return found
        }
        return ''
      }

      const MIN_REAL_BIN = 100000 // real binary >400KB; 28KB wrappers must be skipped
      const isRealBinary = (p: string): boolean => {
        try { return require('fs').statSync(p).size >= MIN_REAL_BIN } catch { return false }
      }
      const findBundledOrLocal = (): string => {
        for (const binName of ['whisper-cli.exe', 'whisper-whisper-cli.exe']) {
          const bundled = join(process.resourcesPath || '', 'whisper', binName)
          const local = join(whisperLocalDir, binName)
          if (existsSync(bundled) && isRealBinary(bundled)) return bundled
          if (existsSync(local) && isRealBinary(local)) return local
        }
        return ''
      }

      if (preferPath) {
        whisperBin = findInPath() || findBundledOrLocal()
      } else {
        whisperBin = findBundledOrLocal() || findInPath()
      }
    } else {
      // macOS: check well-known Homebrew paths first
      const candidates = [
        '/opt/homebrew/bin/whisperkit-cli',
        '/usr/local/bin/whisperkit-cli',
        '/opt/homebrew/bin/whisper-cli',
        '/usr/local/bin/whisper-cli',
        '/opt/homebrew/bin/whisper',
        '/usr/local/bin/whisper',
        join(homedir(), '.local/bin/whisper'),
      ]

      for (const c of candidates) {
        if (existsSync(c)) { whisperBin = c; break }
      }
    }
    mark('probe_binary_paths', t0)

    if (!whisperBin && IS_MAC) {
      t0 = Date.now()
      for (const name of ['whisperkit-cli', 'whisper-cli', 'whisper']) {
        try {
          whisperBin = await runExecFile('/bin/zsh', ['-lc', `whence -p ${name}`], 5000).then((s) => s.trim())
          if (whisperBin) break
        } catch {}
      }
      mark('probe_binary_whence', t0)
    }

    if (!whisperBin && IS_WIN) {
      // Auto-download whisper binary + model on first use
      log('Whisper not found — auto-downloading to ' + whisperLocalDir)
      try {
        const { mkdirSync, unlinkSync, renameSync, rmSync } = require('fs')
        const { execFileSync } = require('child_process')
        mkdirSync(whisperLocalDir, { recursive: true })

        const localBin = join(whisperLocalDir, 'whisper-whisper-cli.exe')
        const legacyBin = join(whisperLocalDir, 'whisper-cli.exe')
        if (!existsSync(localBin) && !existsSync(legacyBin)) {
          const releaseJson = execFileSync('curl', ['-sL', '-H', 'User-Agent: clui-cc', 'https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest'], { encoding: 'utf-8', timeout: 30000 })
          const release = JSON.parse(releaseJson)
          const asset = release.assets.find((a: any) => { const n = a.name.toLowerCase(); return n.includes('win') && n.includes('x64') && n.endsWith('.zip') && !n.includes('cuda') && !n.includes('vulkan') && !n.includes('openvino') })
            || release.assets.find((a: any) => { const n = a.name.toLowerCase(); return n.includes('bin-x64') && n.endsWith('.zip') })
          if (asset) {
            const zipPath = join(whisperLocalDir, 'whisper.zip')
            execFileSync('curl', ['-L', '--fail', '-o', zipPath, asset.browser_download_url], { stdio: 'ignore', timeout: 600000 })
            const listing = execFileSync('tar', ['-tf', zipPath], { encoding: 'utf-8' })
            const entries = listing.split(/\r?\n/).filter(Boolean)
            const binEntry = entries.find((e: string) => e.endsWith('whisper-whisper-cli.exe')) || entries.find((e: string) => e.endsWith('whisper-cli.exe')) || entries.find((e: string) => e.endsWith('main.exe'))
            if (binEntry) {
              execFileSync('tar', ['-xf', zipPath, '-C', whisperLocalDir, binEntry], { stdio: 'ignore' })
              const extracted = join(whisperLocalDir, binEntry)
              if (extracted !== localBin && existsSync(extracted)) renameSync(extracted, localBin)
            }
            // Extract DLLs
            for (const dll of entries.filter((e: string) => e.endsWith('.dll'))) {
              try {
                execFileSync('tar', ['-xf', zipPath, '-C', whisperLocalDir, dll], { stdio: 'ignore' })
                const de = join(whisperLocalDir, dll), dd = join(whisperLocalDir, require('path').basename(dll))
                if (de !== dd && existsSync(de)) renameSync(de, dd)
              } catch {}
            }
            // Clean nested dirs
            for (const entry of readdirSync(whisperLocalDir)) {
              const full = join(whisperLocalDir, entry)
              if (statSync(full).isDirectory()) rmSync(full, { recursive: true, force: true })
            }
            try { unlinkSync(zipPath) } catch {}
          }
        }
        if (existsSync(localBin)) whisperBin = localBin
      } catch (dlErr: any) {
        log(`Whisper auto-download failed: ${dlErr.message}`)
      }
    }

    if (!whisperBin) {
      const hint = IS_WIN
        ? 'Auto-download failed. Install manually: winget install ggerganov.whisper.cpp'
        : process.arch === 'arm64'
          ? 'brew install whisperkit-cli   (or: brew install whisper-cpp)'
          : 'brew install whisper-cpp'
      return {
        error: `Whisper not found. Install with:\n  ${hint}`,
        transcript: null,
      }
    }

    const isWhisperKit = !IS_WIN && whisperBin.includes('whisperkit-cli')
    const isWhisperCpp = !isWhisperKit && (whisperBin.includes('whisper-cli') || whisperBin.includes('whisper-whisper-cli') || whisperBin.endsWith('main.exe'))

    // Read whisper settings (wDevice already read above for binary detection)
    const wSettings = loadSettings()
    const wModel = wSettings.whisperModel || 'tiny'
    const wLang = wSettings.whisperLanguage || 'auto'

    log(`Transcribing with: ${whisperBin} (backend: ${isWhisperKit ? 'WhisperKit' : isWhisperCpp ? 'whisper-cpp' : 'Python whisper'}, model: ${wModel}, lang: ${wLang}, device: ${wDevice})`)

    let output: string
    if (isWhisperKit) {
      // WhisperKit (Apple Silicon CoreML) — auto-downloads models on first run
      // Use --report to produce a JSON file with a top-level "text" field for deterministic parsing
      const reportDir = tmpdir()
      t0 = Date.now()
      output = await runExecFile(
        whisperBin,
        ['transcribe', '--audio-path', tmpWav, '--model', wModel, '--without-timestamps', '--skip-special-tokens', '--report', '--report-path', reportDir, ...(wLang !== 'auto' ? ['--language', wLang] : [])],
        60000
      )
      mark('whisperkit_transcribe_report', t0)

      // WhisperKit writes <audioFileName>.json (filename without extension)
      const wavBasename = basename(tmpWav, '.wav')
      const reportPath = join(reportDir, `${wavBasename}.json`)
      if (existsSync(reportPath)) {
        try {
          t0 = Date.now()
          const report = JSON.parse(readFileSync(reportPath, 'utf-8'))
          const transcript = (report.text || '').trim()
          mark('whisperkit_parse_report_json', t0)
          try { unlinkSync(reportPath) } catch {}
          // Also clean up .srt that --report creates
          const srtPath = join(reportDir, `${wavBasename}.srt`)
          try { unlinkSync(srtPath) } catch {}
          log(`Transcription timing(ms): ${JSON.stringify({ ...phaseMs, total: Date.now() - startedAt })}`)
          return { error: null, transcript }
        } catch (parseErr: any) {
          log(`WhisperKit JSON parse failed: ${parseErr.message}, falling back to stdout`)
          try { unlinkSync(reportPath) } catch {}
        }
      }

      // Performance fallback: avoid a second full transcription if report file is missing/invalid.
      // Use stdout from the first run to keep latency close to pre-report behavior.
      if (!output || !output.trim()) {
        t0 = Date.now()
        output = await runExecFile(
          whisperBin,
          ['transcribe', '--audio-path', tmpWav, '--model', wModel, '--without-timestamps', '--skip-special-tokens', ...(wLang !== 'auto' ? ['--language', wLang] : [])],
          60000
        )
        mark('whisperkit_transcribe_stdout_rerun', t0)
      }
    } else if (isWhisperCpp) {
      // whisper-cpp: whisper-cli -m model -f file --no-timestamps
      // Find model file — check user-selected model first, then fallback to any available
      const modelFile = `ggml-${wModel}.bin`
      const modelCandidates = [
        // Bundled model (highest priority)
        join(process.resourcesPath || '', 'whisper', modelFile),
        // Auto-downloaded model (user-local)
        join(whisperLocalDir, modelFile),
        join(homedir(), '.local/share/whisper', modelFile),
        ...(IS_WIN ? [
          join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'whisper-cpp', 'models', modelFile),
          join(homedir(), 'whisper.cpp', 'models', modelFile),
        ] : [
          `/opt/homebrew/share/whisper-cpp/models/${modelFile}`,
        ]),
        // Fallback: try tiny if selected model not found
        ...(wModel !== 'tiny' ? [
          join(whisperLocalDir, 'ggml-tiny.bin'),
          join(process.resourcesPath || '', 'whisper', 'ggml-tiny.bin'),
        ] : []),
      ]

      let modelPath = ''
      for (const m of modelCandidates) {
        if (existsSync(m)) { modelPath = m; break }
      }

      // No more sync auto-download — models are downloaded from Settings

      if (!modelPath) {
        return {
          error: 'No whisper model downloaded yet. Open Settings > Whisper and download a model to enable voice transcription.',
          transcript: null,
        }
      }

      const isEnglishOnly = modelPath.includes('.en.')
      const effectiveLang = isEnglishOnly ? 'en' : (wLang === 'auto' ? 'auto' : wLang)
      t0 = Date.now()
      // auto/gpu: no flags (whisper uses GPU by default if compiled with CUDA/Vulkan)
      // cpu: explicitly disable GPU
      const deviceArgs: string[] = wDevice === 'cpu' ? ['--no-gpu'] : []
      output = await runExecFile(
        whisperBin,
        ['-m', modelPath, '-f', tmpWav, '--no-timestamps', '-l', effectiveLang, ...deviceArgs],
        60000
      )
      mark('whisper_cpp_transcribe', t0)
    } else {
      // Python whisper
      t0 = Date.now()
      output = await runExecFile(
        whisperBin,
        [tmpWav, '--model', 'tiny', '--output_format', 'txt', '--output_dir', tmpdir(), ...(wLang !== 'auto' ? ['--language', wLang] : [])],
        30000
      )
      mark('python_whisper_transcribe', t0)
      // Python whisper writes .txt file
      const txtPath = tmpWav.replace('.wav', '.txt')
      if (existsSync(txtPath)) {
        t0 = Date.now()
        const transcript = readFileSync(txtPath, 'utf-8').trim()
        mark('python_whisper_read_txt', t0)
        try { unlinkSync(txtPath) } catch {}
        log(`Transcription timing(ms): ${JSON.stringify({ ...phaseMs, total: Date.now() - startedAt })}`)
        return { error: null, transcript }
      }
      // File not created — Python whisper failed silently
      return {
        error: `Whisper output file not found at ${txtPath}. Check disk space and permissions.`,
        transcript: null,
      }
    }

    // WhisperKit (stdout fallback) and whisper-cpp print to stdout directly
    // Strip timestamp patterns and known hallucination outputs
    const HALLUCINATIONS = /^\s*(\[BLANK_AUDIO\]|you\.?|thank you\.?|thanks\.?)\s*$/i
    const transcript = output
      .replace(/\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/g, '')
      .trim()

    if (HALLUCINATIONS.test(transcript)) {
      log(`Transcription timing(ms): ${JSON.stringify({ ...phaseMs, total: Date.now() - startedAt })}`)
      return { error: null, transcript: '' }
    }

    log(`Transcription timing(ms): ${JSON.stringify({ ...phaseMs, total: Date.now() - startedAt })}`)
    return { error: null, transcript: transcript || '' }
  } catch (err: any) {
    log(`Transcription error: ${err.message}`)
    log(`Transcription timing(ms): ${JSON.stringify({ ...phaseMs, total: Date.now() - startedAt, failed: true })}`)
    return {
      error: `Transcription failed: ${err.message}`,
      transcript: null,
    }
  } finally {
    try { unlinkSync(tmpWav) } catch {}
  }
})

ipcMain.handle(IPC.DETECT_GPU, async () => {
  if (!IS_WIN) return { hasGpu: false, name: '' }
  try {
    const { execFile: ef } = require('child_process')
    const result: string = await new Promise((resolve, reject) => {
      ef('powershell', [
        '-NoProfile', '-Command',
        "Get-CimInstance Win32_VideoController | Where-Object {$_.Name -match 'NVIDIA'} | Select-Object -First 1 -ExpandProperty Name"
      ], { encoding: 'utf-8', timeout: 5000 }, (err: any, stdout: string) => {
        if (err) return reject(err)
        resolve(stdout?.trim() || '')
      })
    })
    return { hasGpu: !!result, name: result }
  } catch {
    return { hasGpu: false, name: '' }
  }
})

// ─── CUDA DLL management (on-demand GPU acceleration) ───

const CUDA_DLLS = ['cublas64_12.dll', 'cublasLt64_12.dll', 'cudart64_12.dll', 'ggml-cuda.dll', 'nvrtc64_120_0.dll', 'nvrtc-builtins64_124.dll']

ipcMain.handle(IPC.CHECK_CUDA, () => {
  const whisperDir = getWhisperDir()
  const installed = CUDA_DLLS.every((dll) => existsSync(join(whisperDir, dll)))
  return { installed }
})

ipcMain.handle(IPC.DOWNLOAD_CUDA, async () => {
  if (!IS_WIN) return { ok: false, error: 'CUDA acceleration is only available on Windows' }
  const whisperDir = getWhisperDir()
  const { mkdirSync, unlinkSync, renameSync, rmSync } = require('fs')
  const { execFileSync } = require('child_process')

  try {
    mkdirSync(whisperDir, { recursive: true })

    // Check if already installed
    if (CUDA_DLLS.every((dll) => existsSync(join(whisperDir, dll)))) {
      return { ok: true }
    }

    log('Downloading CUDA libraries for GPU acceleration...')

    // Fetch latest whisper.cpp release — find cuBLAS zip
    const releaseJson = execFileSync('curl', ['-sL', '-H', 'User-Agent: clui-cc', 'https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest'], { encoding: 'utf-8', timeout: 30000 })
    const release = JSON.parse(releaseJson)

    const asset = release.assets.find((a: any) => {
      const n = a.name.toLowerCase()
      return n.includes('x64') && n.endsWith('.zip') && n.includes('cublas-12')
    }) || release.assets.find((a: any) => {
      const n = a.name.toLowerCase()
      return n.includes('x64') && n.endsWith('.zip') && n.includes('cublas')
    })

    if (!asset) return { ok: false, error: 'Could not find CUDA build in latest whisper.cpp release' }

    const zipPath = join(whisperDir, 'cuda-libs.zip')
    const extractDir = join(whisperDir, '_cuda_extract')

    log(`Downloading CUDA zip: ${asset.name}`)
    execFileSync('curl', ['-L', '--fail', '-o', zipPath, asset.browser_download_url], { stdio: 'ignore', timeout: 600000 })

    // Extract only DLLs
    if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true })
    mkdirSync(extractDir, { recursive: true })

    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`
    ], { stdio: 'ignore', timeout: 120000 })

    // Find and copy CUDA DLLs + whisper binary
    const allFiles = listFilesRecursive(extractDir)
    let copiedCount = 0
    for (const f of allFiles) {
      const base = require('path').basename(f)
      if (base.endsWith('.dll') || base.endsWith('.exe')) {
        const dest = join(whisperDir, base)
        require('fs').copyFileSync(f, dest)
        copiedCount++
        log(`CUDA: copied ${base}`)
      }
    }

    // Cleanup
    try { unlinkSync(zipPath) } catch {}
    try { rmSync(extractDir, { recursive: true, force: true }) } catch {}

    // Clean nested dirs left over
    for (const entry of readdirSync(whisperDir)) {
      const full = join(whisperDir, entry)
      if (statSync(full).isDirectory()) rmSync(full, { recursive: true, force: true })
    }

    log(`CUDA download complete: ${copiedCount} files`)
    return { ok: true }
  } catch (err: any) {
    log(`CUDA download failed: ${err.message}`)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle(IPC.DELETE_CUDA, () => {
  const whisperDir = getWhisperDir()
  let deleted = 0
  for (const dll of CUDA_DLLS) {
    const p = join(whisperDir, dll)
    if (existsSync(p)) {
      try { require('fs').unlinkSync(p); deleted++ } catch {}
    }
  }
  return { ok: true, deleted }
})

// Helper reused by CUDA download
function listFilesRecursive(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) results.push(...listFilesRecursive(full))
    else results.push(full)
  }
  return results
}

// ─── Remote Control daemon ───
import { RcDaemon } from './claude/rc-daemon'
const rcDaemons = new Map<string, RcDaemon>()

ipcMain.handle(IPC.RC_START, (_event, { tabId, sessionId, projectPath }: { tabId: string; sessionId: string; projectPath: string }) => {
  try {
    if (rcDaemons.has(tabId)) return { ok: true, url: rcDaemons.get(tabId)!.getUrl() }

    const daemon = new RcDaemon()
    rcDaemons.set(tabId, daemon)

    daemon.on('url', (url: string) => {
      mainWindow?.webContents.send(IPC.RC_URL, tabId, url)
    })
    daemon.on('stopped', () => {
      rcDaemons.delete(tabId)
      mainWindow?.webContents.send(IPC.RC_STOPPED, tabId)
    })
    daemon.on('error', (msg: string) => {
      log(`[RC] Daemon error for tab ${tabId}: ${msg}`)
      rcDaemons.delete(tabId)
      mainWindow?.webContents.send(IPC.RC_STOPPED, tabId)
    })

    daemon.start(sessionId, projectPath)
    return { ok: true }
  } catch (err: any) {
    log(`[RC] RC_START failed for tab ${tabId}: ${err.message}`)
    rcDaemons.delete(tabId)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle(IPC.RC_STOP, (_event, tabId: string) => {
  const daemon = rcDaemons.get(tabId)
  if (daemon) {
    daemon.stop()
    rcDaemons.delete(tabId)
  }
  return { ok: true }
})

ipcMain.handle(IPC.GET_DIAGNOSTICS, () => {
  const { readFileSync, existsSync } = require('fs')
  const health = controlPlane.getHealth()

  let recentLogs = ''
  if (existsSync(LOG_FILE)) {
    try {
      const content = readFileSync(LOG_FILE, 'utf-8')
      const lines = content.split('\n')
      recentLogs = lines.slice(-100).join('\n')
    } catch {}
  }

  return {
    health,
    logPath: LOG_FILE,
    recentLogs,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    appVersion: app.getVersion(),
    transport: INTERACTIVE_PTY ? 'pty' : 'stream-json',
  }
})

ipcMain.handle(IPC.OPEN_IN_TERMINAL, (_event, arg: string | null | { sessionId?: string | null; projectPath?: string }) => {
  const { execFile } = require('child_process')
  const claudeBin = 'claude'

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  // Support both old (string) and new ({ sessionId, projectPath }) calling convention
  let sessionId: string | null = null
  let projectPath: string = process.cwd()
  if (typeof arg === 'string') {
    sessionId = arg
  } else if (arg && typeof arg === 'object') {
    sessionId = arg.sessionId ?? null
    projectPath = arg.projectPath && arg.projectPath !== '~' ? arg.projectPath : process.cwd()
  }

  // Validate sessionId — must be a strict UUID to prevent injection into the shell command
  if (sessionId && !UUID_RE.test(sessionId)) {
    log(`OPEN_IN_TERMINAL: rejected invalid sessionId: ${sessionId}`)
    return false
  }

  // Sanitize projectPath — reject null bytes, newlines, and non-absolute paths
  if (/[\0\r\n]/.test(projectPath) || !isAbsolutePath(projectPath)) {
    log(`OPEN_IN_TERMINAL: rejected invalid projectPath: ${projectPath}`)
    return false
  }

  // Windows: launch in Windows Terminal or fallback to cmd.exe
  if (IS_WIN) {
    const { spawn } = require('child_process')
    const claudeCmd = sessionId ? `claude --resume ${sessionId}` : 'claude'
    try {
      // Try Windows Terminal first
      spawn('wt', ['-d', projectPath, 'cmd', '/k', claudeCmd], { detached: true, stdio: 'ignore' }).unref()
    } catch {
      // Fallback to cmd.exe
      spawn('cmd', ['/c', 'start', 'cmd', '/k', claudeCmd], { detached: true, stdio: 'ignore', cwd: projectPath }).unref()
    }
    return true
  }

  // macOS: use AppleScript to open Terminal.app
  // Shell-safe single-quote escaping: replace ' with '\'' (end quote, escaped literal quote, reopen quote)
  // Single quotes block all shell expansion ($, `, \, etc.) — unlike double quotes which allow $() and backticks
  const shellSingleQuote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'"
  // AppleScript string escaping: backslashes doubled, double quotes escaped
  const escapeAppleScript = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

  const safeDir = escapeAppleScript(shellSingleQuote(projectPath))

  let cmd: string
  if (sessionId) {
    // sessionId is UUID-validated above, safe to embed directly
    cmd = `cd ${safeDir} && ${claudeBin} --resume ${sessionId}`
  } else {
    cmd = `cd ${safeDir} && ${claudeBin}`
  }

  const script = `tell application "Terminal"
  activate
  do script "${cmd}"
end tell`

  try {
    execFile('/usr/bin/osascript', ['-e', script], (err: Error | null) => {
      if (err) log(`Failed to open terminal: ${err.message}`)
      else log(`Opened terminal with: ${cmd}`)
    })
    return true
  } catch (err: unknown) {
    log(`Failed to open terminal: ${err}`)
    return false
  }
})

// ─── Marketplace IPC ───

ipcMain.handle(IPC.MARKETPLACE_FETCH, async (_event, { forceRefresh } = {}) => {
  log('IPC MARKETPLACE_FETCH')
  return fetchCatalog(forceRefresh)
})

ipcMain.handle(IPC.MARKETPLACE_INSTALLED, async () => {
  log('IPC MARKETPLACE_INSTALLED')
  return listInstalled()
})

ipcMain.handle(IPC.MARKETPLACE_INSTALL, async (_event, { repo, pluginName, marketplace, sourcePath, isSkillMd }: { repo: string; pluginName: string; marketplace: string; sourcePath?: string; isSkillMd?: boolean }) => {
  log(`IPC MARKETPLACE_INSTALL: ${pluginName} from ${repo} (isSkillMd=${isSkillMd})`)
  return installPlugin(repo, pluginName, marketplace, sourcePath, isSkillMd)
})

ipcMain.handle(IPC.MARKETPLACE_UNINSTALL, async (_event, { pluginName }: { pluginName: string }) => {
  log(`IPC MARKETPLACE_UNINSTALL: ${pluginName}`)
  return uninstallPlugin(pluginName)
})

// ─── Theme Detection ───

ipcMain.handle(IPC.GET_THEME, () => {
  return { isDark: nativeTheme.shouldUseDarkColors }
})

nativeTheme.on('updated', () => {
  broadcast(IPC.THEME_CHANGED, nativeTheme.shouldUseDarkColors)
})

// ─── Permission Preflight ───
// Request all required macOS permissions upfront on first launch so the user
// is never interrupted mid-session by a permission prompt.

async function requestPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return

  // ── Microphone (for voice input via Whisper) ──
  try {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus === 'not-determined') {
      await systemPreferences.askForMediaAccess('microphone')
    }
  } catch (err: any) {
    log(`Permission preflight: microphone check failed — ${err.message}`)
  }

  // ── Accessibility (for global ⌥+Space shortcut) ──
  // globalShortcut works without it on modern macOS; Cmd+Shift+K is always the fallback.
  // Screen Recording: not requested upfront — macOS 15 Sequoia shows an alarming
  // "bypass private window picker" dialog. Let the OS prompt naturally if/when
  // the screenshot feature is actually used.
}

// ─── App Lifecycle ───

app.whenReady().then(async () => {
  // macOS: become an accessory app. Accessory apps can have key windows (keyboard works)
  // without deactivating the currently active app (hover preserved in browsers).
  // This is how Spotlight, Alfred, Raycast work.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }

  // Load persisted settings before creating anything
  loadSettings()
  log(`Settings loaded: ${JSON.stringify(currentSettings)}`)

  // Apply auto-start
  app.setLoginItemSettings({
    openAtLogin: currentSettings.autoStart,
    openAsHidden: currentSettings.startHidden,
  })

  // Apply saved permission mode
  if (currentSettings.permissionMode && currentSettings.permissionMode !== 'ask') {
    controlPlane.setPermissionMode(currentSettings.permissionMode)
  }

  // Request permissions upfront so the user is never interrupted mid-session.
  await requestPermissions()

  // Skill provisioning — non-blocking, streams status to renderer
  ensureSkills((status: SkillStatus) => {
    log(`Skill ${status.name}: ${status.state}${status.error ? ` — ${status.error}` : ''}`)
    broadcast(IPC.SKILL_STATUS, status)
  }).catch((err: Error) => log(`Skill provisioning error: ${err.message}`))

  createWindow()
  snapshotWindowState('after createWindow')

  // Apply saved zoom level
  if (currentSettings.zoomLevel && currentSettings.zoomLevel !== 1.0) {
    mainWindow?.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.setZoomFactor(currentSettings.zoomLevel)
    })
  }

  if (SPACES_DEBUG) {
    mainWindow?.on('show', () => snapshotWindowState('event window show'))
    mainWindow?.on('hide', () => snapshotWindowState('event window hide'))
    mainWindow?.on('focus', () => snapshotWindowState('event window focus'))
    mainWindow?.on('blur', () => snapshotWindowState('event window blur'))
    mainWindow?.webContents.on('focus', () => snapshotWindowState('event webContents focus'))
    mainWindow?.webContents.on('blur', () => snapshotWindowState('event webContents blur'))

    app.on('browser-window-focus', () => snapshotWindowState('event app browser-window-focus'))
    app.on('browser-window-blur', () => snapshotWindowState('event app browser-window-blur'))

    screen.on('display-added', (_e, display) => {
      log(`[spaces] event display-added id=${display.id}`)
      snapshotWindowState('event display-added')
    })
    screen.on('display-removed', (_e, display) => {
      log(`[spaces] event display-removed id=${display.id}`)
      snapshotWindowState('event display-removed')
    })
    screen.on('display-metrics-changed', (_e, display, changedMetrics) => {
      log(`[spaces] event display-metrics-changed id=${display.id} changed=${changedMetrics.join(',')}`)
      snapshotWindowState('event display-metrics-changed')
    })
  }


  // Use saved shortcut if persisted, otherwise default
  const toggleShortcut = currentSettings.shortcut || (IS_MAC ? 'Alt+Space' : 'Ctrl+Alt+Space')
  currentPrimaryShortcut = toggleShortcut
  const registered = globalShortcut.register(toggleShortcut, () => toggleWindow(`shortcut ${toggleShortcut}`))
  if (!registered) {
    log(`${toggleShortcut} shortcut registration failed — ${IS_MAC ? 'macOS input sources may claim it' : 'another app may have registered it'}`)
  }
  // Secondary shortcut: use saved or disabled by default
  const savedSecondary = currentSettings.secondaryShortcut
  if (savedSecondary) {
    const secOk = globalShortcut.register(savedSecondary, () => toggleWindow(`shortcut ${savedSecondary}`))
    if (secOk) {
      currentSecondaryShortcut = savedSecondary
    } else {
      log(`Secondary shortcut ${savedSecondary} registration failed`)
    }
  }

  // Transcription shortcut: use saved or disabled by default
  const savedTranscription = currentSettings.transcriptionShortcut
  if (savedTranscription) {
    const transOk = globalShortcut.register(savedTranscription, () => {
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show()
        mainWindow.webContents.focus()
        broadcast(IPC.WINDOW_SHOWN)
      }
      broadcast(IPC.TOGGLE_TRANSCRIPTION)
    })
    if (transOk) {
      currentTranscriptionShortcut = savedTranscription
    } else {
      log(`Transcription shortcut ${savedTranscription} registration failed`)
    }
  }

  const trayIconPath = join(__dirname, '../../resources/trayTemplate.png')
  const trayIcon = nativeImage.createFromPath(trayIconPath)
  if (IS_MAC) { trayIcon.setTemplateImage(true) }
  tray = new Tray(trayIcon)
  tray.setToolTip('Clui CC — Claude Code UI')
  tray.on('click', () => toggleWindow('tray click'))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Clui CC', click: () => showWindow('tray menu') },
      { label: 'Quit', click: () => { app.quit() } },
    ])
  )

  // app 'activate' fires when macOS brings the app to the foreground (e.g. after
  // webContents.focus() triggers applicationDidBecomeActive on some macOS versions).
  // Using showWindow here instead of toggleWindow prevents the re-entry race where
  // a summon immediately hides itself because activate fires mid-show.
  app.on('activate', () => showWindow('app activate'))
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  controlPlane.shutdown()
  flushLogs()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
