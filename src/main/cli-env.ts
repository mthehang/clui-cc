import { execFileSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { IS_MAC, IS_WIN, PATH_SEP } from './platform'

let cachedPath: string | null = null

function appendPathEntries(target: string[], seen: Set<string>, rawPath: string | undefined): void {
  if (!rawPath) return
  for (const entry of rawPath.split(PATH_SEP)) {
    const p = entry.trim()
    if (!p || seen.has(p)) continue
    seen.add(p)
    target.push(p)
  }
}

export function getCliPath(): string {
  if (cachedPath) return cachedPath

  const ordered: string[] = []
  const seen = new Set<string>()

  // Start from current process PATH.
  appendPathEntries(ordered, seen, process.env.PATH)

  if (IS_WIN) {
    // Add common Windows binary locations.
    const home = homedir()
    const winPaths = [
      join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm'),
      join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
      join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Programs', 'Python'),
      join(home, '.npm-global'),
    ].join(PATH_SEP)
    appendPathEntries(ordered, seen, winPaths)
    // Windows GUI apps already inherit the full user PATH — no shell probe needed.
  } else {
    // Add common macOS / Linux binary locations (Homebrew + system).
    appendPathEntries(ordered, seen, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')

    // Try interactive login shell so nvm/asdf/etc. PATH hooks are loaded.
    const shellProbes: [string, string[]][] = [
      ['/bin/zsh', ['-ilc', 'echo $PATH']],
      ['/bin/zsh', ['-lc', 'echo $PATH']],
      ['/bin/bash', ['-lc', 'echo $PATH']],
    ]

    for (const [shell, args] of shellProbes) {
      try {
        const discovered = execFileSync(shell, args, {
          encoding: 'utf-8',
          timeout: 3000,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        appendPathEntries(ordered, seen, discovered)
      } catch {
        // Keep trying fallbacks.
      }
    }
  }

  cachedPath = ordered.join(PATH_SEP)
  return cachedPath
}

export function getCliEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
    PATH: getCliPath(),
  }
  delete env.CLAUDECODE
  return env
}
