import { app, BrowserWindow, shell } from 'electron'
import { log as _log } from './logger'
import { IPC } from '../shared/types'
import type { UpdateStatus } from '../shared/types'
import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'

const GITHUB_OWNER = 'mthehang'
const GITHUB_REPO = 'clui-cc'

function log(msg: string): void {
  _log('updater', msg)
}

let mainWindowRef: BrowserWindow | null = null
let currentStatus: UpdateStatus = { state: 'idle' }
let latestReleaseUrl: string | null = null
let latestInstallerUrl: string | null = null
let latestVersion: string | null = null
let downloadedInstallerPath: string | null = null

function broadcast(status: UpdateStatus): void {
  currentStatus = status
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(IPC.UPDATE_STATUS, status)
  }
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

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

interface ReleaseInfo {
  version: string
  htmlUrl: string
  body: string
  installerUrl: string | null
}

function fetchLatestRelease(): Promise<ReleaseInfo> {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    const opts = { headers: { 'User-Agent': 'CLUI-CC-Updater' } }

    function parseResponse(data: string): void {
      const json = JSON.parse(data)
      const assets: Array<{ name: string; browser_download_url: string }> = json.assets || []
      const installer = assets.find((a) => a.name.endsWith('.exe'))
      resolve({
        version: json.tag_name?.replace(/^v/, '') || json.name,
        htmlUrl: json.html_url,
        body: json.body || '',
        installerUrl: installer?.browser_download_url ?? null,
      })
    }

    const req = https.get(url, opts, (res) => {
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

/** Download a URL to dest, following redirects, firing onProgress(0-100). */
function downloadFile(
  url: string,
  dest: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    function doGet(targetUrl: string, redirects = 0): void {
      if (redirects > 10) { reject(new Error('Too many redirects')); return }
      const mod = targetUrl.startsWith('https') ? https : http
      const req = (mod as typeof https).get(targetUrl, (res) => {
        const { statusCode, headers } = res
        if (statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) {
          if (headers.location) { res.resume(); doGet(headers.location, redirects + 1) }
          else { reject(new Error('Redirect with no location')) }
          return
        }
        if (statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${statusCode}`)); return }
        const total = parseInt(headers['content-length'] || '0', 10)
        let received = 0
        const file = fs.createWriteStream(dest)
        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (total > 0) onProgress(Math.round((received / total) * 100))
        })
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
        file.on('error', (err) => { try { fs.unlinkSync(dest) } catch {} ; reject(err) })
        res.on('error', (err) => { try { fs.unlinkSync(dest) } catch {}; reject(err) })
      })
      req.on('error', reject)
      req.setTimeout(120_000, () => { req.destroy(); reject(new Error('Download timeout')) })
    }
    doGet(url)
  })
}

// ─── Public API ───

export function initAutoUpdater(win: BrowserWindow): void {
  mainWindowRef = win
  setTimeout(() => checkForUpdate(), 5000)
}

export async function checkForUpdate(): Promise<void> {
  broadcast({ state: 'checking' })
  try {
    const currentVersion = app.getVersion()
    log(`Current version: ${currentVersion}`)
    const release = await fetchLatestRelease()
    log(`Latest: ${release.version}, installer: ${release.installerUrl ? 'yes' : 'no'}`)

    if (compareSemver(release.version, currentVersion) > 0) {
      latestReleaseUrl = release.htmlUrl
      latestInstallerUrl = release.installerUrl
      latestVersion = release.version
      broadcast({ state: 'available', version: release.version, releaseNotes: release.body || undefined })
    } else {
      broadcast({ state: 'up-to-date', version: currentVersion })
    }
  } catch (err: any) {
    log(`Check failed: ${err.message}`)
    broadcast({ state: 'error', message: err.message })
  }
}

export function downloadUpdate(): void {
  if (!latestInstallerUrl) {
    // No .exe asset in release — open release page as fallback
    const url = latestReleaseUrl || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    log('No installer asset found, opening release page')
    shell.openExternal(url)
    return
  }

  const tmpPath = path.join(app.getPath('temp'), `clui-setup-${latestVersion || 'latest'}.exe`)
  log(`Downloading installer to ${tmpPath}`)
  broadcast({ state: 'downloading', percent: 0 })

  downloadFile(latestInstallerUrl, tmpPath, (percent) => {
    broadcast({ state: 'downloading', percent })
  }).then(() => {
    log('Download complete')
    downloadedInstallerPath = tmpPath
    broadcast({ state: 'downloaded', version: latestVersion || '' })
  }).catch((err: Error) => {
    log(`Download failed: ${err.message}`)
    try { fs.unlinkSync(tmpPath) } catch {}
    const url = latestReleaseUrl || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    shell.openExternal(url)
    broadcast({ state: 'error', message: 'Download falhou — abrindo página de release.' })
  })
}

export function installUpdate(): void {
  if (downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)) {
    log(`Launching installer: ${downloadedInstallerPath}`)
    shell.openPath(downloadedInstallerPath).then(() => {
      setTimeout(() => app.quit(), 500)
    }).catch((err) => {
      log(`Failed to open installer: ${err}`)
      app.quit()
    })
  } else {
    const url = latestReleaseUrl || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    shell.openExternal(url)
  }
}
