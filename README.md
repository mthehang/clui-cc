# Clui CC — Command Line User Interface for Claude Code

A lightweight, transparent desktop overlay for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on **Windows**. Clui CC wraps the Claude Code CLI in a floating pill interface with multi-tab sessions, a permission approval UI, voice input, remote control, auto-updates, and a skills marketplace.

> Fork of [lcoutodemos/clui-cc](https://github.com/lcoutodemos/clui-cc) with full Windows support and additional features.

## Features

- **Floating overlay** — transparent, click-through window that stays on top. Toggle with `Alt+Space` (fallback: `Ctrl+Shift+K`).
- **Multi-tab sessions** — each tab spawns its own `claude -p` process with independent session state.
- **Permission approval UI** — intercepts tool calls via PreToolUse HTTP hooks so you can review and approve/deny from the UI.
- **Remote control** — per-tab toggle for Claude Code's `--rc` flag, enabling session sharing across devices. Visual indicator on tab strip.
- **Auto-updates** — checks GitHub Releases for new versions. Download and install from Settings.
- **Usage tracking** — real-time cost and token usage breakdown by model.
- **Inline diff viewer** — file changes from tool results displayed as readable diffs.
- **Conversation history** — browse and resume past Claude Code sessions.
- **Skills marketplace** — install plugins from Anthropic's GitHub repos without leaving Clui CC.
- **Voice input** — local speech-to-text via Whisper with language selection.
- **File & screenshot attachments** — paste images or attach files directly.
- **Dual theme** — dark/light mode with system-follow option.

## Install

### Option 1: Download Installer (Recommended)

Download the latest `Clui.CC.Setup.x.x.x.exe` from [Releases](https://github.com/mthehang/clui-cc/releases).

> **Note:** The app is unsigned — Windows SmartScreen will show a warning on first launch. Click **More info → Run anyway**.

### Option 2: Build from Source

```bash
git clone https://github.com/mthehang/clui-cc.git
cd clui-cc
npm install
npm run dist:win
```

The installer will be in `release/`.

### Option 3: PowerShell One-Liner

```powershell
irm https://raw.githubusercontent.com/mthehang/clui-cc/main/scripts/install.ps1 | iex
```

## Prerequisites

- **Node.js** 20+ — [nodejs.org](https://nodejs.org)
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code` (must be authenticated)
- **Whisper** (optional, for voice) — `winget install ggerganov.whisper.cpp` or download from [GitHub](https://github.com/ggerganov/whisper.cpp/releases)

## Developer Workflow

```bash
npm install
npm run dev
```

Renderer changes update instantly. Main-process changes require restarting `npm run dev`.

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Production build (no packaging) |
| `npm run dist:win` | Package as Windows NSIS installer |
| `npm run dist:win:publish` | Build + publish to GitHub Releases |
| `npm run doctor` | Run environment diagnostic |

## How It Works

```
UI prompt -> Main process spawns claude -p -> NDJSON stream -> live render
                                           -> tool call? -> permission UI -> approve/deny
```

1. Each tab creates a `claude -p --output-format stream-json` subprocess.
2. NDJSON events are parsed by `RunManager` and normalized by `EventNormalizer`.
3. `ControlPlane` manages tab lifecycle (connecting -> idle -> running -> completed/failed/dead).
4. Tool permission requests arrive via HTTP hooks to `PermissionServer` (localhost only).
5. The renderer polls backend health every 1.5s and reconciles tab state.
6. Sessions are resumed with `--resume <session-id>` for continuity.

<details>
<summary><strong>Project Structure</strong></summary>

```
src/
├── main/                   # Electron main process
│   ├── claude/             # ControlPlane, RunManager, EventNormalizer
│   ├── hooks/              # PermissionServer (PreToolUse HTTP hooks)
│   ├── marketplace/        # Plugin catalog fetching + install
│   ├── skills/             # Skill auto-installer
│   ├── updater.ts          # Auto-update via electron-updater
│   └── index.ts            # Window creation, IPC handlers, tray
├── renderer/               # React frontend
│   ├── components/         # TabStrip, ConversationView, InputBar, etc.
│   ├── stores/             # Zustand session store
│   ├── hooks/              # Event listeners, health reconciliation
│   └── theme.ts            # Dual palette + CSS custom properties
├── preload/                # Secure IPC bridge (window.clui API)
└── shared/                 # Canonical types, IPC channel definitions
```

</details>

## Tested On

| Component | Version |
|-----------|---------|
| Windows | 11 Pro |
| Node.js | 20.x LTS |
| Electron | 35.x |
| Claude Code CLI | 2.x |

## Known Limitations

- **Windows only** (this fork) — the original repo supports macOS.
- **Requires Claude Code CLI** — Clui CC is a UI layer, not a standalone AI client. You need an authenticated `claude` CLI.
- **No code signing** — Windows SmartScreen will warn on first launch. Safe for personal use.

## License

[MIT](LICENSE)
