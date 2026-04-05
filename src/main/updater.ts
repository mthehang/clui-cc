import { app, BrowserWindow, shell } from 'electron'
import { log as _log } from './logger'
import { IPC } from '../shared/types'
import type { UpdateStatus } from '../shared/types'
import https from 'https'

const GITHUB_OWNER = 'mthehang'
const GITHUB_REPO = 'clui-cc'

function log(msg: string): void {
  _log('updater', msg)
}

let mainWindowRef: BrowserWindow | null = null
let currentStatus: UpdateStatus = { state: 'idle' }
let latestReleaseUrl: string | null = null
let hasElectronUpdater = false

function broadcast(status: UpdateStatus): void {
  currentStatus = status
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(IPC.UPDATE_STATUS, status)
  }
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

/** Compare semver strings. Returns 1 if a > b, -1 if a < b, 0 if equal. */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

/** Fetch latest GitHub release via API (no auth needed for public repos). */
function fetchLatestRelease(): Promise<{ version: string; htmlUrl: string; body: string; hasInstaller: boolean }> {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    const opts = { headers: { 'User-Agent': 'CLUI-CC-Updater' } }

    function parseResponse(data: string): void {
      const json = JSON.parse(data)
      const assets: Array<{ name: string }> = json.assets || []
      const hasInstaller = assets.some((a) => a.name.endsWith('.exe') || a.name === 'latest.yml')
      resolve({
        version: json.tag_name?.replace(/^v/, '') || json.name,
        htmlUrl: json.html_url,
        body: json.body || '',
        hasInstaller,
      })
    }

    const req = https.get(url, opts, (res) => {
      // Follow one redirect (GitHub sometimes redirects)
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        https.get(res.headers.location, opts, (res2) => {
          let data = ''
          res2.on('data', (c: Buffer) => { data += c })
          res2.on('end', () => { try { parseResponse(data) } catch (e) { reject(e) } })
        }).on('error', reject)
        return
      }
      if (res.statusCode !== 200) return reject(new Error(`GitHub API ${res.statusCode}`))
      let data = ''
      res.on('data', (c: Buffer) => { data += c })
      res.on('end', () => { try { parseResponse(data) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

// ─── electron-updater (lazy-loaded, only in packaged builds) ───

let autoUpdater: any = null

function initElectronUpdater(): boolean {
  if (!app.isPackaged) return false
  try {
    const eu = require('electron-updater')
    autoUpdater = eu.autoUpdater
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('download-progress', (p: any) => {
      broadcast({ state: 'downloading', percent: p.percent })
    })
    autoUpdater.on('update-downloaded', (info: any) => {
      log(`Update downloaded: ${info.version}`)
      broadcast({ state: 'downloaded', version: info.version })
    })
    autoUpdater.on('error', (err: Error) => {
      log(`electron-updater error: ${err.message}`)
      broadcast({ state: 'error', message: `Update failed: ${err.message}` })
    })
    hasElectronUpdater = true
    log('electron-updater initialized')
    return true
  } catch (err: any) {
    log(`electron-updater not available: ${err.message}`)
    return false
  }
}

// ─── Public API ───

export function initAutoUpdater(win: BrowserWindow): void {
  mainWindowRef = win
  initElectronUpdater()
  setTimeout(() => checkForUpdate(), 5000)
}

export async function checkForUpdate(): Promise<void> {
  broadcast({ state: 'checking' })
  try {
    const currentVersion = app.getVersion()
    log(`Current version: ${currentVersion}`)

    const release = await fetchLatestRelease()
    log(`Latest release: ${release.version} (hasInstaller=${release.hasInstaller})`)

    if (compareSemver(release.version, currentVersion) > 0) {
      latestReleaseUrl = release.htmlUrl
      broadcast({
        state: 'available',
        version: release.version,
        releaseNotes: release.body || undefined,
      })
    } else {
      broadcast({ state: 'up-to-date', version: currentVersion })
    }
  } catch (err: any) {
    log(`Check failed: ${err.message}`)
    broadcast({ state: 'error', message: err.message })
  }
}

export function downloadUpdate(): void {
  if (hasElectronUpdater && autoUpdater) {
    // electron-updater requires checkForUpdates() to be called before
    // downloadUpdate() so it can resolve the latest.yml feed URL.
    // Setting autoDownload=true makes it start downloading automatically
    // once the check resolves, triggering download-progress and update-downloaded.
    log('Downloading via electron-updater (checkForUpdates → autoDownload)...')
    broadcast({ state: 'downloading', percent: 0 })
    autoUpdater.autoDownload = true
    autoUpdater.checkForUpdates().catch((err: Error) => {
      log(`electron-updater check failed: ${err.message}, falling back to browser`)
      autoUpdater.autoDownload = false
      if (latestReleaseUrl) shell.openExternal(latestReleaseUrl)
      broadcast({ state: 'error', message: 'Auto-download failed — opened release page.' })
    })
  } else {
    // Fallback: open release page in browser
    log('Opening release page in browser (no electron-updater)')
    const url = latestReleaseUrl || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    shell.openExternal(url)
  }
}

export function installUpdate(): void {
  if (hasElectronUpdater && autoUpdater) {
    autoUpdater.quitAndInstall(false, true)
  } else {
    shell.openExternal(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`)
  }
}
