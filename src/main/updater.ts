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
function fetchLatestRelease(): Promise<{ version: string; htmlUrl: string; body: string }> {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    const req = https.get(url, { headers: { 'User-Agent': 'CLUI-CC-Updater' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
        const redirectUrl = res.headers.location
        if (!redirectUrl) return reject(new Error('Redirect without location'))
        https.get(redirectUrl, { headers: { 'User-Agent': 'CLUI-CC-Updater' } }, (res2) => {
          let data = ''
          res2.on('data', (chunk: Buffer) => { data += chunk })
          res2.on('end', () => {
            try {
              const json = JSON.parse(data)
              resolve({ version: json.tag_name?.replace(/^v/, '') || json.name, htmlUrl: json.html_url, body: json.body || '' })
            } catch (e) { reject(e) }
          })
        }).on('error', reject)
        return
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`GitHub API returned ${res.statusCode}`))
      }
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          resolve({ version: json.tag_name?.replace(/^v/, '') || json.name, htmlUrl: json.html_url, body: json.body || '' })
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timeout')) })
  })
}

export function initAutoUpdater(win: BrowserWindow): void {
  mainWindowRef = win
  // Check on startup after a short delay
  setTimeout(() => checkForUpdate(), 5000)
}

let latestReleaseUrl: string | null = null

export async function checkForUpdate(): Promise<void> {
  broadcast({ state: 'checking' })
  try {
    const currentVersion = app.getVersion()
    log(`Current version: ${currentVersion}`)

    const release = await fetchLatestRelease()
    log(`Latest release: ${release.version}`)

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
  // Open the release page in the default browser for manual download
  if (latestReleaseUrl) {
    shell.openExternal(latestReleaseUrl)
    broadcast({ state: 'downloaded', version: currentStatus.state === 'available' ? (currentStatus as any).version : '' })
  } else {
    shell.openExternal(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`)
  }
}

export function installUpdate(): void {
  // Open release page — user downloads and installs manually
  shell.openExternal(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`)
}
