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
  const result = execFileSync('curl', ['-sL', '-H', 'User-Agent: clui-cc', url], {
    encoding: 'utf-8',
    timeout: 30000,
  })
  return JSON.parse(result)
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

  // Find the Windows x64 zip asset (no CUDA/Vulkan variants)
  const asset = release.assets.find(a => {
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

  downloadFile(zipUrl, zipPath)

  log('Extracting whisper binary from zip...')

  try {
    // List zip contents to find the binary
    const listing = execFileSync('tar', ['-tf', zipPath], { encoding: 'utf-8' })
    const entries = listing.split(/\r?\n/).filter(Boolean)

    // Find whisper-cli.exe or main.exe
    const binEntry = entries.find(e => e.endsWith('whisper-cli.exe'))
      || entries.find(e => e.endsWith('main.exe'))

    if (!binEntry) {
      log('Zip contents:')
      entries.forEach(e => log(`  ${e}`))
      throw new Error('Could not find whisper-cli.exe or main.exe in zip')
    }

    // Extract the binary
    execFileSync('tar', ['-xf', zipPath, '-C', WHISPER_DIR, binEntry], { stdio: 'inherit' })

    // Move to expected name if nested in subdirectory
    const extractedPath = path.join(WHISPER_DIR, binEntry)
    if (extractedPath !== BIN_PATH && fs.existsSync(extractedPath)) {
      fs.renameSync(extractedPath, BIN_PATH)
    }

    // Also extract any DLLs (ggml.dll, whisper.dll) that might be needed
    const dlls = entries.filter(e => e.endsWith('.dll'))
    for (const dll of dlls) {
      try {
        execFileSync('tar', ['-xf', zipPath, '-C', WHISPER_DIR, dll], { stdio: 'inherit' })
        const dllExtracted = path.join(WHISPER_DIR, dll)
        const dllDest = path.join(WHISPER_DIR, path.basename(dll))
        if (dllExtracted !== dllDest && fs.existsSync(dllExtracted)) {
          fs.renameSync(dllExtracted, dllDest)
        }
      } catch {}
    }

    // Clean up nested dirs left by extraction
    for (const entry of fs.readdirSync(WHISPER_DIR)) {
      const full = path.join(WHISPER_DIR, entry)
      if (fs.statSync(full).isDirectory()) {
        fs.rmSync(full, { recursive: true, force: true })
      }
    }
  } finally {
    // Clean up zip
    try { fs.unlinkSync(zipPath) } catch {}
  }

  if (!fs.existsSync(BIN_PATH)) {
    throw new Error(`Extraction failed: ${BIN_PATH} not found`)
  }

  log(`Binary ready: ${BIN_PATH}`)
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
