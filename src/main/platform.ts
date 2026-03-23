/**
 * platform.ts — Cross-platform abstraction layer for Clui CC.
 *
 * Centralises every OS-specific decision (paths, binaries, shell probes)
 * so the rest of the codebase can stay platform-agnostic.
 */

import { execFileSync, execSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname, sep } from 'path'
import { log } from './logger'

/* ------------------------------------------------------------------ */
/*  Platform constants                                                 */
/* ------------------------------------------------------------------ */

export const IS_MAC = process.platform === 'darwin'
export const IS_WIN = process.platform === 'win32'

/** PATH environment variable delimiter — ';' on Windows, ':' elsewhere. */
export const PATH_SEP = IS_WIN ? ';' : ':'

/* ------------------------------------------------------------------ */
/*  Path helpers                                                       */
/* ------------------------------------------------------------------ */

/** Validates an absolute path on any platform. */
export function isAbsolutePath(p: string): boolean {
  if (IS_WIN) return /^[a-zA-Z]:[/\\]/.test(p)
  return p.startsWith('/')
}

/** Extracts the directory portion of a binary path, cross-platform. */
export function dirOfBinary(binaryPath: string): string {
  return dirname(binaryPath)
}

/* ------------------------------------------------------------------ */
/*  Shell / icon helpers                                               */
/* ------------------------------------------------------------------ */

/** Returns the default interactive shell for the current platform. */
export function getDefaultShell(): string {
  if (IS_WIN) return process.env.COMSPEC || 'cmd.exe'
  return process.env.SHELL || '/bin/zsh'
}

/** Returns the correct app icon path based on platform. */
export function getIconPath(resourcesDir: string): string {
  if (IS_WIN) return join(resourcesDir, 'icon.ico')
  return join(resourcesDir, 'icon.icns')
}

/* ------------------------------------------------------------------ */
/*  Binary discovery                                                   */
/* ------------------------------------------------------------------ */

/**
 * Resolves the absolute path of a named binary.
 * Uses `where` on Windows, `whence`/`which` on macOS/Linux.
 */
export function findBinaryInPath(name: string): string | null {
  if (IS_WIN) {
    try {
      const result = execFileSync('where', [name], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      // `where` may return multiple lines — take the first hit.
      const first = result.split(/\r?\n/)[0]?.trim()
      return first || null
    } catch {
      return null
    }
  }

  // macOS / Linux: try zsh whence first, then bash which.
  const probes = [
    ['/bin/zsh', ['-ilc', `whence -p ${name}`]],
    ['/bin/bash', ['-lc', `which ${name}`]],
  ] as const

  for (const [shell, args] of probes) {
    try {
      const result = execFileSync(shell, args, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      if (result) return result
    } catch {}
  }
  return null
}

/**
 * Finds the `claude` CLI binary.
 *
 * Checks well-known install locations first, then falls back to
 * a PATH probe. Returns `'claude'` as a last resort so `spawn()`
 * can still attempt the system PATH.
 */
export function findClaudeBinary(): string {
  const home = homedir()

  const candidates: string[] = IS_WIN
    ? [
        join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd'),
        join(home, '.npm-global', 'claude.cmd'),
        join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'pnpm', 'claude.cmd'),
        join(home, 'scoop', 'shims', 'claude.cmd'),
        join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Volta', 'bin', 'claude.cmd'),
      ]
    : [
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        join(home, '.npm-global/bin/claude'),
      ]

  for (const c of candidates) {
    if (existsSync(c)) return c
  }

  // Fallback: probe PATH via shell.
  const found = findBinaryInPath('claude')
  if (found) return found

  // Last resort — rely on spawn() to resolve via PATH.
  return 'claude'
}

/* ------------------------------------------------------------------ */
/*  Environment helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Prepends the directory of a binary to PATH if not already present.
 * Uses the correct platform separator.
 */
export function prependBinDirToPath(env: NodeJS.ProcessEnv, binaryPath: string): void {
  const binDir = dirOfBinary(binaryPath)
  if (!binDir || binDir === '.') return
  if (env.PATH && !env.PATH.split(PATH_SEP).includes(binDir)) {
    env.PATH = `${binDir}${PATH_SEP}${env.PATH}`
  }
}

/**
 * Encodes a project working-directory path to the format Claude CLI
 * uses for its per-project session directory under ~/.claude/projects/.
 *
 * On macOS:   /Users/me/project  → -Users-me-project
 * On Windows: C:\Users\me\project → C-Users-me-project
 */
export function encodeProjectPath(cwd: string): string {
  if (IS_WIN) {
    // Replace colon and separators with dashes (C:\ → C--, matching Claude CLI encoding).
    return cwd.replace(/:/g, '-').replace(/[\\/]/g, '-')
  }
  return cwd.replace(/\//g, '-')
}
