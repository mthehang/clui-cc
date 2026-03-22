'use strict'

/**
 * download-whisper.js — Downloads whisper.cpp binary + model for bundling.
 *
 * Fetches:
 *   1. whisper.cpp Windows x64 binary from GitHub Releases
 *   2. ggml-tiny.bin model from HuggingFace
 *
 * Places them into resources/whisper/ for electron-builder to bundle.
 * Idempotent — skips download if files already exist.
 *
 * NOTE: This is a build-time script with no user input — all URLs and paths
 * are hardcoded constants. execFileSync is used safely with fixed arguments.
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const WHISPER_DIR = path.join(__dirname, '..', 'resources', 'whisper')
const BIN_NAME = 'whisper-cli.exe'
const MODEL_NAME = 'ggml-tiny.bin'
const BIN_PATH = path.join(WHISPER_DIR, BIN_NAME)
const MODEL_PATH = path.join(WHISPER_DIR, MODEL_NAME)

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin'
const GITHUB_API = 'https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest'

function log(msg) {
  console.log(`[whisper-download] ${msg}`)
}

/**
 * Download a URL to a file using curl (no user input — all args are constants).
 */
function downloadFile(url, dest) {
  log(`Downloading: ${url}`)
  log(`Destination: ${dest}`)
  execFileSync('curl', ['-L', '--fail', '--progress-bar', '-o', dest, url], {
    stdio: 'inherit',
    timeout: 600000, // 10 minutes
  })
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    throw new Error(`Download failed or empty file: ${dest}`)
  }
}

/**
 * Fetch JSON from a URL using curl (no user input — URL is a constant).
 */
function fetchJson(url) {
  const headers = ['-H', 'User-Agent: clui-cc']
  if (process.env.GITHUB_TOKEN) {
    headers.push('-H', `Authorization: token ${process.env.GITHUB_TOKEN}`)
  }
  const result = execFileSync('curl', ['-sL', ...headers, url], {
    encoding: 'utf-8',
    timeout: 30000,
  })
  const json = JSON.parse(result)
  if (json.message) {
    throw new Error(`GitHub API error: ${json.message}`)
  }
  return json
}

function downloadWhisperBinary() {
  if (fs.existsSync(BIN_PATH)) {
    log(`Binary already exists: ${BIN_PATH} — skipping`)
    return
  }

  log('Fetching latest whisper.cpp release info...')
  const release = fetchJson(GITHUB_API)
  const tag = release.tag_name
  log(`Latest release: ${tag}`)

  // Find Windows x64 zip: prefer cuBLAS/CUDA build (GPU), fallback to plain
  const asset = release.assets.find(a => {
    const name = a.name.toLowerCase()
    return name.includes('x64') && name.endsWith('.zip') && name.includes('cublas-12')
  }) || release.assets.find(a => {
    const name = a.name.toLowerCase()
    return name.includes('x64') && name.endsWith('.zip') && name.includes('cublas')
  }) || release.assets.find(a => {
    const name = a.name.toLowerCase()
    return name.includes('win') && name.includes('x64') && name.endsWith('.zip')
      && !name.includes('cuda') && !name.includes('vulkan') && !name.includes('openvino')
  }) || release.assets.find(a => {
    const name = a.name.toLowerCase()
    return name.includes('bin-x64') && name.endsWith('.zip')
  })

  if (!asset) {
    log('ERROR: Could not find Windows x64 binary in release assets.')
    log('Available assets:')
    release.assets.forEach(a => log(`  - ${a.name}`))
    throw new Error('No suitable Windows binary found in release')
  }

  downloadAndExtractZip(asset.browser_download_url, tag)
}

function downloadAndExtractZip(zipUrl, tag) {
  const zipPath = path.join(WHISPER_DIR, `whisper-${tag}.zip`)
  const extractDir = path.join(WHISPER_DIR, '_extract')

  downloadFile(zipUrl, zipPath)

  log('Extracting whisper binary from zip...')

  try {
    // Use PowerShell Expand-Archive (works reliably on Windows, no C: host issue)
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
    fs.mkdirSync(extractDir, { recursive: true })

    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`
    ], { stdio: 'inherit', timeout: 120000 })

    // Find the REAL whisper binary — search each name in priority order.
    // IMPORTANT: The ZIP contains 28KB deprecation wrappers (main.exe, etc.)
    // alongside the real binary (whisper-cli.exe ~485KB). We must skip wrappers.
    const MIN_REAL_BINARY_SIZE = 100000 // real binary is >400KB, wrappers are ~28KB
    const BINARY_NAMES = ['whisper-whisper-cli.exe', 'whisper-cli.exe']
    let found = null
    for (const binName of BINARY_NAMES) {
      const candidate = findFileRecursive(extractDir, name => name === binName)
      if (candidate) {
        const size = fs.statSync(candidate).size
        if (size >= MIN_REAL_BINARY_SIZE) {
          found = candidate
          break
        }
        log(`Skipping ${binName} (${size} bytes — deprecation wrapper)`)
      }
    }

    if (!found) {
      const allFiles = listFilesRecursive(extractDir)
      log('Extracted contents:')
      allFiles.forEach(f => {
        const size = fs.statSync(f).size
        log(`  ${f} (${size} bytes)`)
      })
      throw new Error('Could not find real whisper binary (>100KB) in zip — only deprecation wrappers found')
    }

    log(`Found binary: ${path.basename(found)} (${fs.statSync(found).size} bytes)`)
    fs.copyFileSync(found, BIN_PATH)

    // Copy any DLLs (ggml.dll, whisper.dll) to WHISPER_DIR
    const dlls = listFilesRecursive(extractDir).filter(f => f.endsWith('.dll'))
    for (const dll of dlls) {
      const dest = path.join(WHISPER_DIR, path.basename(dll))
      fs.copyFileSync(dll, dest)
      log(`Copied DLL: ${path.basename(dll)}`)
    }
  } finally {
    // Clean up
    try { fs.unlinkSync(zipPath) } catch {}
    try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch {}
  }

  if (!fs.existsSync(BIN_PATH)) {
    throw new Error(`Extraction failed: ${BIN_PATH} not found`)
  }

  log(`Binary ready: ${BIN_PATH}`)
}

function findFileRecursive(dir, predicate) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const result = findFileRecursive(full, predicate)
      if (result) return result
    } else if (predicate(entry.name)) {
      return full
    }
  }
  return null
}

function listFilesRecursive(dir) {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full))
    } else {
      results.push(full)
    }
  }
  return results
}

function downloadModel() {
  if (fs.existsSync(MODEL_PATH)) {
    log(`Model already exists: ${MODEL_PATH} — skipping`)
    return
  }

  downloadFile(MODEL_URL, MODEL_PATH)
  log(`Model ready: ${MODEL_PATH} (${(fs.statSync(MODEL_PATH).size / 1024 / 1024).toFixed(1)} MB)`)
}

function main() {
  log('=== Whisper Download Script ===')

  // Ensure output directory exists
  fs.mkdirSync(WHISPER_DIR, { recursive: true })

  try {
    downloadWhisperBinary()
    downloadModel()
    log('=== Done! Whisper is ready for bundling ===')
  } catch (err) {
    log(`ERROR: ${err.message}`)
    process.exit(1)
  }
}

main()
