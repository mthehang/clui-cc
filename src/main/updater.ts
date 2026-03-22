import { autoUpdater } from 'electron-updater'
import type { UpdateInfo, ProgressInfo } from 'electron-updater'
import { BrowserWindow } from 'electron'
import { log as _log } from './logger'
import { IPC } from '../shared/types'
import type { UpdateStatus } from '../shared/types'

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

export function initAutoUpdater(win: BrowserWindow): void {
  mainWindowRef = win

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    log('Checking for update...')
    broadcast({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log(`Update available: ${info.version}`)
    broadcast({
      state: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    log(`Up to date: ${info.version}`)
    broadcast({ state: 'up-to-date', version: info.version })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    broadcast({ state: 'downloading', percent: progress.percent })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log(`Update downloaded: ${info.version}`)
    broadcast({ state: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (err: Error) => {
    log(`Update error: ${err.message}`)
    broadcast({ state: 'error', message: err.message })
  })

  // Check on startup after a short delay
  setTimeout(() => checkForUpdate(), 5000)
}

export function checkForUpdate(): void {
  autoUpdater.checkForUpdates().catch((err) => {
    log(`Check failed: ${err.message}`)
    broadcast({ state: 'error', message: err.message })
  })
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch((err) => {
    log(`Download failed: ${err.message}`)
    broadcast({ state: 'error', message: err.message })
  })
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}
