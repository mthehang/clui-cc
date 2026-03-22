import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { DotsThree, Bell, ArrowsOutSimple, Moon, Microphone, Keyboard, MagnifyingGlassPlus, MagnifyingGlassMinus, ArrowCounterClockwise, Power, EyeSlash, Translate, NotePencil, CheckCircle, DownloadSimple, Trash, CaretRight, CircleNotch, ArrowsClockwise } from '@phosphor-icons/react'
import type { UpdateStatus } from '../../shared/types'
import { useThemeStore } from '../theme'
import { useSessionStore } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../theme'

function RowToggle({
  checked,
  onChange,
  colors,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  colors: ReturnType<typeof useColors>
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="relative w-9 h-5 rounded-full transition-colors"
      style={{
        background: checked ? colors.accent : colors.surfaceSecondary,
        border: `1px solid ${checked ? colors.accent : colors.containerBorder}`,
      }}
    >
      <span
        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all"
        style={{
          left: checked ? 18 : 2,
          background: '#fff',
        }}
      />
    </button>
  )
}

/* ─── Shortcut recorder ─── */

const IS_MAC = navigator.platform?.includes('Mac')
const DEFAULT_SHORTCUT = IS_MAC ? 'Alt+Space' : 'Ctrl+Alt+Space'
const DEFAULT_DISPLAY = IS_MAC ? '⌥ Space' : 'Ctrl+Alt+Space'

/** Map a KeyboardEvent key to Electron accelerator format */
function keyToAccelerator(key: string): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null
  const map: Record<string, string> = {
    ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Enter: 'Return', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape', Tab: 'Tab',
  }
  return map[key] || (key.length === 1 ? key.toUpperCase() : key)
}

/** Format accelerator for display (e.g. Ctrl+Alt+Space → ⌃⌥Space on Mac) */
function formatAccelerator(acc: string): string {
  if (IS_MAC) {
    return acc.replace('Ctrl', '⌃').replace('Alt', '⌥').replace('Shift', '⇧').replace('Meta', '⌘').replace(/\+/g, '')
  }
  return acc
}

/* ─── Collapsible section wrapper ─── */

function CollapsibleSection({
  colors,
  icon,
  label,
  children,
}: {
  colors: ReturnType<typeof useColors>
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full"
        style={{ cursor: 'pointer' }}
      >
        {icon}
        <div className="text-[12px] font-medium flex-1 text-left" style={{ color: colors.textPrimary }}>
          {label}
        </div>
        <CaretRight
          size={12}
          style={{
            color: colors.textTertiary,
            transition: 'transform 0.15s ease',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        />
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  )
}

function ShortcutRecorderField({
  colors,
  label,
  value,
  defaultAccelerator,
  defaultDisplay,
  onChange,
}: {
  colors: ReturnType<typeof useColors>
  label: string
  value: string | null
  defaultAccelerator: string | null
  defaultDisplay: string
  onChange: (acc: string | null) => void
}) {
  const [recording, setRecording] = useState(false)
  const [preview, setPreview] = useState('')

  const displayShortcut = value ? formatAccelerator(value) : defaultDisplay
  const hasCustom = value !== null

  useEffect(() => {
    if (!recording) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (e.metaKey) parts.push('Meta')
      const mapped = keyToAccelerator(e.key)
      if (!mapped) { setPreview(parts.join('+')); return }
      parts.push(mapped)
      const accelerator = parts.join('+')
      onChange(defaultAccelerator && accelerator === defaultAccelerator ? null : accelerator)
      setRecording(false)
      setPreview('')
    }
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setRecording(false); setPreview('') }
    }
    window.addEventListener('keydown', handler, true)
    window.addEventListener('keyup', cancel, true)
    return () => { window.removeEventListener('keydown', handler, true); window.removeEventListener('keyup', cancel, true) }
  }, [recording, onChange, defaultAccelerator])

  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px]" style={{ color: colors.textSecondary }}>{label}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => { setRecording(true); setPreview('') }}
          className="px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors"
          style={{
            background: recording ? colors.accentPrimary + '22' : colors.surfacePrimary,
            border: `1px solid ${recording ? colors.accentPrimary : colors.containerBorder}`,
            color: recording ? colors.accentPrimary : undefined,
            minWidth: 60,
            textAlign: 'center',
          }}
          title={recording ? 'Press your desired shortcut (Esc to cancel)' : 'Click to change shortcut'}
        >
          {recording ? (preview || '...') : displayShortcut}
        </button>
        {hasCustom && !recording && (
          <button
            onClick={() => onChange(null)}
            className="flex items-center justify-center rounded transition-colors"
            style={{ color: colors.textTertiary, width: 16, height: 16 }}
            title="Reset to default"
          >
            <ArrowCounterClockwise size={10} />
          </button>
        )}
      </div>
    </div>
  )
}

function ShortcutsSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const customShortcut = useThemeStore((s) => s.customShortcut)
  const setCustomShortcut = useThemeStore((s) => s.setCustomShortcut)
  const [transcriptionShortcut, setTranscriptionShortcut] = useState<string | null>(null)

  useEffect(() => {
    window.clui.getSettings().then((s) => {
      setTranscriptionShortcut(s.transcriptionShortcut)
    }).catch(() => {})
  }, [])

  return (
    <div className="flex flex-col gap-1.5">
        <ShortcutRecorderField
          colors={colors}
          label="Hide/Show"
          value={customShortcut}
          defaultAccelerator={DEFAULT_SHORTCUT}
          defaultDisplay={DEFAULT_DISPLAY}
          onChange={(acc) => {
            setCustomShortcut(acc)
          }}
        />
        <ShortcutRecorderField
          colors={colors}
          label="Transcription"
          value={transcriptionShortcut}
          defaultAccelerator={null}
          defaultDisplay="None"
          onChange={(acc) => {
            setTranscriptionShortcut(acc)
            window.clui.setTranscriptionShortcut(acc)
          }}
        />
    </div>
  )
}

/* ─── Startup section ─── */

function StartupSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const [autoStart, setAutoStart] = useState(false)
  const [startHidden, setStartHidden] = useState(false)

  useEffect(() => {
    window.clui.getSettings().then((s) => {
      setAutoStart(s.autoStart)
      setStartHidden(s.startHidden)
    }).catch(() => {})
  }, [])

  return (
    <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>Start with Windows</span>
          <RowToggle
            checked={autoStart}
            onChange={(next) => {
              setAutoStart(next)
              window.clui.saveSettings({ autoStart: next })
            }}
            colors={colors}
            label="Start with Windows"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>Start hidden</span>
          <RowToggle
            checked={startHidden}
            onChange={(next) => {
              setStartHidden(next)
              window.clui.saveSettings({ startHidden: next })
            }}
            colors={colors}
            label="Start hidden"
          />
        </div>
    </div>
  )
}

/* ─── Response language ─── */

const LANGUAGES = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'it', label: 'Italian' },
  { value: 'ru', label: 'Russian' },
] as const

function LanguageSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const [lang, setLang] = useState('auto')

  useEffect(() => {
    window.clui.getSettings().then((s) => {
      setLang(s.responseLanguage || 'auto')
    }).catch(() => {})
  }, [])

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <Translate size={14} style={{ color: colors.textTertiary }} />
        <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
          Response language
        </div>
      </div>
      <select
        value={lang}
        onChange={(e) => {
          setLang(e.target.value)
          window.clui.saveSettings({ responseLanguage: e.target.value })
        }}
        className="w-full text-[11px] rounded-lg px-2 py-1.5 outline-none transition-colors"
        style={{
          background: colors.surfacePrimary,
          color: colors.textSecondary,
          border: `1px solid ${colors.containerBorder}`,
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.value} value={l.value}>{l.label}</option>
        ))}
      </select>
    </div>
  )
}

/* ─── Whisper settings ─── */

const WHISPER_MODELS = [
  { value: 'tiny',           label: 'Tiny',           size: '75 MB',  note: 'Fast, low accuracy' },
  { value: 'base',           label: 'Base',           size: '142 MB', note: 'Faster, basic accuracy' },
  { value: 'small',          label: 'Small',          size: '466 MB', note: 'Good for English' },
  { value: 'medium',         label: 'Medium',         size: '1.5 GB', note: 'Best for multilingual' },
  { value: 'large-v3',       label: 'Large v3',       size: '3 GB',   note: 'Most accurate, slow' },
  { value: 'large-v3-turbo', label: 'Turbo',          size: '800 MB', note: 'Near-large speed+quality' },
] as const

const WHISPER_LANGUAGES = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
] as const

function WhisperSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const [model, setModel] = useState('tiny')
  const [language, setLanguage] = useState('auto')
  const [device, setDevice] = useState('auto')
  const [gpuInfo, setGpuInfo] = useState<{ hasGpu: boolean; name: string }>({ hasGpu: false, name: '' })
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({})

  const refreshDownloaded = useCallback(() => {
    window.clui.listWhisperModels().then(setDownloaded).catch(() => {})
  }, [])

  useEffect(() => {
    window.clui.getSettings().then((s) => {
      setModel(s.whisperModel || 'tiny')
      setLanguage(s.whisperLanguage || 'auto')
      setDevice(s.whisperDevice || 'auto')
    }).catch(() => {})
    refreshDownloaded()
    window.clui.detectGpu().then(setGpuInfo).catch(() => {})
  }, [refreshDownloaded])

  const [downloading, setDownloading] = useState<string | null>(null)

  const handleDownloadModel = useCallback(async (modelId: string) => {
    setDownloading(modelId)
    try {
      const result = await window.clui.downloadWhisperModel(modelId)
      if (!result.ok) console.error('Download failed:', result.error)
    } finally {
      setDownloading(null)
      refreshDownloaded()
    }
  }, [refreshDownloaded])

  const handleDeleteModel = useCallback(async (modelId: string) => {
    const result = await window.clui.deleteWhisperModel(modelId)
    if (result.ok) refreshDownloaded()
  }, [refreshDownloaded])

  const selectStyle = {
    background: colors.surfacePrimary,
    color: colors.textSecondary,
    border: `1px solid ${colors.containerBorder}`,
  }

  return (
    <div className="flex flex-col gap-1.5">
        {/* Model selector with download status */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px]" style={{ color: colors.textSecondary }}>Model</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {WHISPER_MODELS.map((m) => {
              const isSelected = model === m.value
              const isDownloaded = !!downloaded[m.value]
              const isDownloading = downloading === m.value
              return (
                <div
                  key={m.value}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors"
                  style={{
                    background: isSelected ? colors.accent + '18' : 'transparent',
                    border: isSelected ? `1px solid ${colors.accent}44` : '1px solid transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setModel(m.value)
                    window.clui.saveSettings({ whisperModel: m.value })
                  }}
                >
                  {/* Status icon */}
                  {isDownloading ? (
                    <CircleNotch size={12} className="animate-spin" style={{ color: colors.accent, flexShrink: 0 }} />
                  ) : isDownloaded ? (
                    <CheckCircle size={12} weight="fill" style={{ color: colors.accent, flexShrink: 0 }} />
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownloadModel(m.value) }}
                      className="flex items-center justify-center"
                      style={{ flexShrink: 0, color: colors.textTertiary }}
                      title={`Download ${m.label} (${m.size})`}
                    >
                      <DownloadSimple size={12} />
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px]" style={{ color: isSelected ? colors.textPrimary : colors.textSecondary, fontWeight: isSelected ? 600 : 400 }}>
                        {m.label}
                      </span>
                      <span className="text-[9px]" style={{ color: colors.textTertiary }}>{m.size}</span>
                    </div>
                    <div className="text-[9px]" style={{ color: colors.textTertiary }}>
                      {isDownloading ? 'Downloading...' : m.note}
                    </div>
                  </div>
                  {/* Delete button for downloaded models */}
                  {isDownloaded && !isDownloading && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteModel(m.value) }}
                      className="flex items-center justify-center rounded-full transition-colors"
                      style={{ width: 18, height: 18, flexShrink: 0, color: colors.textTertiary }}
                      title="Remove downloaded model"
                    >
                      <Trash size={11} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>Language</span>
          <select
            value={language}
            onChange={(e) => { setLanguage(e.target.value); window.clui.saveSettings({ whisperLanguage: e.target.value }) }}
            className="text-[11px] rounded-lg px-2 py-1 outline-none"
            style={{ ...selectStyle, width: 140 }}
          >
            {WHISPER_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>Device</span>
          <select
            value={device}
            onChange={(e) => { setDevice(e.target.value); window.clui.saveSettings({ whisperDevice: e.target.value }) }}
            className="text-[11px] rounded-lg px-2 py-1 outline-none"
            style={{ ...selectStyle, width: 140 }}
          >
            <option value="auto">Auto (GPU if available)</option>
            <option value="gpu" disabled={!gpuInfo.hasGpu}>
              {gpuInfo.hasGpu ? `GPU (${gpuInfo.name})` : 'GPU (no NVIDIA detected)'}
            </option>
            <option value="cpu">CPU</option>
          </select>
        </div>
    </div>
  )
}

/* ─── Global Rules ─── */

function GlobalRulesSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const [rules, setRules] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.clui.readGlobalRules().then((content) => {
      setRules(content || '')
    }).catch(() => {})
  }, [])

  const handleSave = () => {
    window.clui.saveGlobalRules(rules)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>
        ~/.claude/CLAUDE.md
      </div>
      <textarea
        value={rules}
        onChange={(e) => { setRules(e.target.value); setSaved(false) }}
        onBlur={handleSave}
        placeholder="Global instructions applied to all Claude Code sessions..."
        rows={5}
        className="w-full text-[11px] rounded-lg px-2 py-1.5 outline-none resize-none"
        style={{
          background: colors.surfacePrimary,
          color: colors.textSecondary,
          border: `1px solid ${colors.containerBorder}`,
          fontFamily: 'monospace',
        }}
      />
      {saved && (
        <div style={{ fontSize: 10, color: colors.accent, marginTop: 2 }}>
          Saved to ~/.claude/CLAUDE.md
        </div>
      )}
    </div>
  )
}

/* ─── About & Updates ─── */

function UpdateSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    window.clui.getAppVersion().then(setVersion).catch(() => {})
    const unsub = window.clui.onUpdateStatus(setStatus)
    return unsub
  }, [])

  return (
    <div className="flex flex-col gap-2.5">
      {/* About */}
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold" style={{ color: colors.textPrimary }}>Clui CC</span>
        <span className="text-[10px]" style={{ color: colors.textTertiary }}>Command Line User Interface for Claude Code</span>
        <div className="flex items-center gap-2 mt-0.5">
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); window.clui.openExternal('https://github.com/mthehang/clui-cc') }}
            className="text-[10px]"
            style={{ color: colors.accent, cursor: 'pointer' }}
          >
            GitHub
          </a>
          <span className="text-[10px]" style={{ color: colors.textTertiary }}>·</span>
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); window.clui.openExternal('https://github.com/mthehang/clui-cc/issues') }}
            className="text-[10px]"
            style={{ color: colors.accent, cursor: 'pointer' }}
          >
            Report Issue
          </a>
        </div>
      </div>

      <div style={{ height: 1, background: colors.containerBorder }} />

      {/* Version & Updates */}
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: colors.textSecondary }}>Version</span>
        <span className="text-[11px] font-mono" style={{ color: colors.textTertiary }}>v{version}</span>
      </div>

      {status.state === 'checking' && (
        <div className="flex items-center gap-1.5">
          <CircleNotch size={12} className="animate-spin" style={{ color: colors.accent }} />
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>Checking for updates...</span>
        </div>
      )}

      {status.state === 'up-to-date' && (
        <div className="flex items-center gap-1.5">
          <CheckCircle size={12} weight="fill" style={{ color: colors.accent }} />
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>Up to date</span>
        </div>
      )}

      {status.state === 'available' && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>v{status.version} available</span>
          <button
            onClick={() => window.clui.downloadUpdate()}
            className="text-[11px] px-2 py-1 rounded-lg"
            style={{ background: colors.accent, color: '#fff', cursor: 'pointer' }}
          >
            Download update
          </button>
        </div>
      )}

      {status.state === 'downloading' && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <CircleNotch size={12} className="animate-spin" style={{ color: colors.accent }} />
            <span className="text-[11px]" style={{ color: colors.textSecondary }}>Downloading... {Math.round(status.percent)}%</span>
          </div>
          <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: colors.surfaceSecondary }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${status.percent}%`, background: colors.accent }} />
          </div>
        </div>
      )}

      {status.state === 'downloaded' && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>v{status.version} ready to install</span>
          <button
            onClick={() => window.clui.installUpdate()}
            className="text-[11px] px-2 py-1 rounded-lg"
            style={{ background: colors.accent, color: '#fff', cursor: 'pointer' }}
          >
            Update &amp; Restart
          </button>
        </div>
      )}

      {status.state === 'error' && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px]" style={{ color: colors.statusError }}>Update error</span>
          <button
            onClick={() => window.clui.checkForUpdate()}
            className="text-[10px] px-2 py-0.5 rounded"
            style={{ background: colors.surfacePrimary, color: colors.textSecondary, border: `1px solid ${colors.containerBorder}`, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}

      {(status.state === 'idle' || status.state === 'up-to-date' || status.state === 'error') && (
        <button
          onClick={() => window.clui.checkForUpdate()}
          className="text-[10px] self-start"
          style={{ color: colors.textTertiary, cursor: 'pointer', textDecoration: 'underline' }}
        >
          Check for updates
        </button>
      )}
    </div>
  )
}

/* ─── Settings popover ─── */

export function SettingsPopover() {
  const soundEnabled = useThemeStore((s) => s.soundEnabled)
  const setSoundEnabled = useThemeStore((s) => s.setSoundEnabled)
  const themeMode = useThemeStore((s) => s.themeMode)
  const setThemeMode = useThemeStore((s) => s.setThemeMode)
  const expandedUI = useThemeStore((s) => s.expandedUI)
  const setExpandedUI = useThemeStore((s) => s.setExpandedUI)
  const micDeviceId = useThemeStore((s) => s.micDeviceId)
  const setMicDeviceId = useThemeStore((s) => s.setMicDeviceId)
  const zoomLevel = useThemeStore((s) => s.zoomLevel)
  const setZoomLevel = useThemeStore((s) => s.setZoomLevel)
  const isExpanded = useSessionStore((s) => s.isExpanded)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [open, setOpen] = useState(false)
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number; maxHeight?: number }>({ right: 0 })

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const gap = 6 // Match HistoryPicker spacing exactly.
    const margin = 8
    const right = window.innerWidth - rect.right

    if (isExpanded) {
      // Keep anchored below trigger (so it never covers the dots button),
      // and shrink if needed instead of shifting upward onto the trigger.
      const top = rect.bottom + gap
      setPos({
        top,
        right,
        maxHeight: Math.max(120, window.innerHeight - top - margin),
      })
      return
    }

    // Same logic as HistoryPicker for collapsed mode: open upward from trigger.
    setPos({
      bottom: window.innerHeight - rect.top + gap,
      right,
      maxHeight: undefined,
    })
  }, [isExpanded])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onResize = () => updatePos()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, updatePos])

  // Keep panel tracking the trigger continuously while open so it follows
  // width/position animations of the top bar without feeling "stuck in space."
  useEffect(() => {
    if (!open) return
    let raf = 0
    const tick = () => {
      updatePos()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [open, expandedUI, isExpanded, updatePos])

  useEffect(() => {
    if (!open) return
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setMicDevices(devices.filter((d) => d.kind === 'audioinput'))
    }).catch(() => {})
  }, [open])

  const handleToggle = () => {
    if (!open) updatePos()
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors"
        style={{ color: colors.textTertiary }}
        title="Settings"
      >
        <DotsThree size={16} weight="bold" />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clui-ui
          initial={{ opacity: 0, y: isExpanded ? -4 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: isExpanded ? -4 : 4 }}
          transition={{ duration: 0.12 }}
          className="rounded-xl settings-popover"
          style={{
            position: 'fixed',
            ...(pos.top != null ? { top: pos.top } : {}),
            ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
            right: pos.right,
            width: 280,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
          }}
        >
          <div
            className="settings-scroll p-3 flex flex-col gap-2.5"
            style={{
              maxHeight: pos.maxHeight ?? 520,
              overflowY: 'auto',
            }}
          >
            {/* Full width */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ArrowsOutSimple size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Full width
                  </div>
                </div>
                <RowToggle
                  checked={expandedUI}
                  onChange={(next) => {
                    setExpandedUI(next)
                  }}
                  colors={colors}
                  label="Toggle full width panel"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Notification sound */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Bell size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Notification sound
                  </div>
                </div>
                <RowToggle
                  checked={soundEnabled}
                  onChange={setSoundEnabled}
                  colors={colors}
                  label="Toggle notification sound"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Theme */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Moon size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Dark theme
                  </div>
                </div>
                <RowToggle
                  checked={themeMode === 'dark'}
                  onChange={(next) => setThemeMode(next ? 'dark' : 'light')}
                  colors={colors}
                  label="Toggle dark theme"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Microphone device */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Microphone size={14} style={{ color: colors.textTertiary }} />
                <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                  Microphone device
                </div>
              </div>
              <select
                value={micDeviceId || ''}
                onChange={(e) => setMicDeviceId(e.target.value || null)}
                className="w-full text-[11px] rounded-lg px-2 py-1.5 outline-none transition-colors"
                style={{
                  background: colors.surfacePrimary,
                  color: colors.textSecondary,
                  border: `1px solid ${colors.containerBorder}`,
                }}
              >
                <option value="">System default</option>
                {micDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Zoom */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <MagnifyingGlassPlus size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    Zoom
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setZoomLevel(zoomLevel - 0.1)}
                    disabled={zoomLevel <= 0.5}
                    className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                    style={{
                      background: colors.surfacePrimary,
                      color: zoomLevel <= 0.5 ? colors.textMuted : colors.textSecondary,
                      border: `1px solid ${colors.containerBorder}`,
                    }}
                    title="Zoom out"
                  >
                    <MagnifyingGlassMinus size={10} />
                  </button>
                  <span className="text-[10px] w-8 text-center tabular-nums" style={{ color: colors.textSecondary }}>
                    {Math.round(zoomLevel * 100)}%
                  </span>
                  <button
                    onClick={() => setZoomLevel(zoomLevel + 0.1)}
                    disabled={zoomLevel >= 2.0}
                    className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                    style={{
                      background: colors.surfacePrimary,
                      color: zoomLevel >= 2.0 ? colors.textMuted : colors.textSecondary,
                      border: `1px solid ${colors.containerBorder}`,
                    }}
                    title="Zoom in"
                  >
                    <MagnifyingGlassPlus size={10} />
                  </button>
                  {zoomLevel !== 1.0 && (
                    <button
                      onClick={() => setZoomLevel(1.0)}
                      className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                      style={{
                        background: colors.surfacePrimary,
                        color: colors.textSecondary,
                        border: `1px solid ${colors.containerBorder}`,
                      }}
                      title="Reset zoom"
                    >
                      <ArrowCounterClockwise size={10} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Response language */}
            <LanguageSection colors={colors} />

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<Microphone size={14} style={{ color: colors.textTertiary }} />} label="Whisper">
              <WhisperSection colors={colors} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<Keyboard size={14} style={{ color: colors.textTertiary }} />} label="Shortcuts">
              <ShortcutsSection colors={colors} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<Power size={14} style={{ color: colors.textTertiary }} />} label="Startup">
              <StartupSection colors={colors} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<NotePencil size={14} style={{ color: colors.textTertiary }} />} label="Global Rules">
              <GlobalRulesSection colors={colors} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<ArrowsClockwise size={14} style={{ color: colors.textTertiary }} />} label="About & Updates">
              <UpdateSection colors={colors} />
            </CollapsibleSection>
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}
