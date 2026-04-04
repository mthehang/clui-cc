import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { DotsThree, Bell, ArrowsOutSimple, Moon, Microphone, Keyboard, MagnifyingGlassPlus, MagnifyingGlassMinus, ArrowCounterClockwise, Power, EyeSlash, Translate, NotePencil, CheckCircle, DownloadSimple, Trash, CaretRight, CircleNotch, ArrowsClockwise, Browsers, Sparkle, Sliders } from '@phosphor-icons/react'
import type { UpdateStatus } from '../../shared/types'
import { useThemeStore } from '../theme'
import { useSessionStore } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../theme'
import { useT, AVAILABLE_LANGUAGES } from '../i18n'

function RowToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
}) {
  const colors = useColors()
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 w-9 h-5 rounded-full transition-colors"
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
    // Stop recording if user clicks elsewhere
    const blur = () => { setRecording(false); setPreview('') }
    window.addEventListener('keydown', handler, true)
    window.addEventListener('keyup', cancel, true)
    window.addEventListener('mousedown', blur)
    return () => { window.removeEventListener('keydown', handler, true); window.removeEventListener('keyup', cancel, true); window.removeEventListener('mousedown', blur) }
  }, [recording, onChange, defaultAccelerator])

  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px]" style={{ color: colors.textSecondary }}>{label}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => { setRecording(true); setPreview('') }}
          className="px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors"
          style={{
            background: recording ? colors.accent + '22' : colors.surfacePrimary,
            border: `1px solid ${recording ? colors.accent : colors.containerBorder}`,
            color: recording ? colors.accent : colors.textSecondary,
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
  const t = useT()
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
          label={t('settings.shortcuts.global')}
          value={customShortcut}
          defaultAccelerator={DEFAULT_SHORTCUT}
          defaultDisplay={DEFAULT_DISPLAY}
          onChange={(acc) => {
            setCustomShortcut(acc)
          }}
        />
        <ShortcutRecorderField
          colors={colors}
          label={t('settings.shortcuts.transcription')}
          value={transcriptionShortcut}
          defaultAccelerator={null}
          defaultDisplay={t('general.none')}
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
  const t = useT()
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
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.startup.auto')}</span>
          <RowToggle
            checked={autoStart}
            onChange={(next) => {
              setAutoStart(next)
              window.clui.saveSettings({ autoStart: next })
            }}
            label={t('settings.startup.auto')}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.startup.hidden')}</span>
          <RowToggle
            checked={startHidden}
            onChange={(next) => {
              setStartHidden(next)
              window.clui.saveSettings({ startHidden: next })
            }}
            label={t('settings.startup.hidden')}
          />
        </div>
    </div>
  )
}

/* ─── Response language ─── */

const RESPONSE_LANGUAGES: Record<string, Array<{ value: string; label: string }>> = {
  'en': [
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
  ],
  'pt-BR': [
    { value: 'auto', label: 'Detectar automaticamente' },
    { value: 'en', label: 'Inglês' },
    { value: 'pt', label: 'Português' },
    { value: 'es', label: 'Espanhol' },
    { value: 'fr', label: 'Francês' },
    { value: 'de', label: 'Alemão' },
    { value: 'ja', label: 'Japonês' },
    { value: 'zh', label: 'Chinês' },
    { value: 'ko', label: 'Coreano' },
    { value: 'it', label: 'Italiano' },
    { value: 'ru', label: 'Russo' },
  ],
}

function LanguageSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const t = useT()
  const appLanguage = useSessionStore((s) => s.appLanguage)
  const [responseLang, setResponseLang] = useState('auto')

  useEffect(() => {
    window.clui.getSettings().then((s) => {
      setResponseLang(s.responseLanguage || 'auto')
    }).catch(() => {})
  }, [])

  const langOptions = RESPONSE_LANGUAGES[appLanguage] || RESPONSE_LANGUAGES['en']

  return (
    <div className="flex flex-col gap-2">
      {/* App language */}
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.language.app')}</span>
        <select
          value={appLanguage}
          onChange={(e) => {
            const value = e.target.value as 'en' | 'pt-BR'
            window.clui.saveSettings({ appLanguage: value })
            useSessionStore.setState({ appLanguage: value })
          }}
          className="text-[11px] rounded-lg px-2 py-1 outline-none clui-select"
          style={{
            background: colors.surfacePrimary,
            color: colors.textSecondary,
            border: `1px solid ${colors.containerBorder}`,
            width: 140,
          }}
        >
          {AVAILABLE_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </div>

      {/* Response language */}
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.language.responses')}</span>
        <select
          value={responseLang}
          onChange={(e) => {
            setResponseLang(e.target.value)
            window.clui.saveSettings({ responseLanguage: e.target.value })
          }}
          className="text-[11px] rounded-lg px-2 py-1 outline-none clui-select"
          style={{
            background: colors.surfacePrimary,
            color: colors.textSecondary,
            border: `1px solid ${colors.containerBorder}`,
            width: 140,
          }}
        >
          {langOptions.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>
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

function WhisperSection({ colors, micDeviceId, micDevices, setMicDeviceId }: {
  colors: ReturnType<typeof useColors>
  micDeviceId: string | null
  micDevices: MediaDeviceInfo[]
  setMicDeviceId: (id: string | null) => void
}) {
  const t = useT()
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

  const [cudaInstalled, setCudaInstalled] = useState(false)
  const [cudaDownloading, setCudaDownloading] = useState(false)

  useEffect(() => {
    window.clui.checkCuda().then((r) => setCudaInstalled(r.installed)).catch(() => {})
  }, [])

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
            <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.whisper.model')}</span>
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
                      {isDownloading ? t('general.downloading') : m.note}
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
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.whisper.language')}</span>
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
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.whisper.device')}</span>
          <select
            value={device}
            onChange={(e) => { setDevice(e.target.value); window.clui.saveSettings({ whisperDevice: e.target.value }) }}
            className="text-[11px] rounded-lg px-2 py-1 outline-none"
            style={{ ...selectStyle, width: 140 }}
          >
            <option value="auto">{t('settings.whisper.device.auto')}</option>
            <option value="gpu" disabled={!gpuInfo.hasGpu}>
              {gpuInfo.hasGpu ? `${t('settings.whisper.device.gpu.detected')} (${gpuInfo.name})` : t('settings.whisper.device.gpu.none')}
            </option>
            <option value="cpu">{t('settings.whisper.device.cpu')}</option>
          </select>
        </div>
        {/* GPU Acceleration (CUDA) download */}
        {gpuInfo.hasGpu && (
          <div className="flex items-center justify-between">
            <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.whisper.gpu.title')}</span>
            {cudaInstalled ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px]" style={{ color: colors.accent }}>{t('general.installed')}</span>
                <button
                  onClick={async () => {
                    await window.clui.deleteCuda()
                    setCudaInstalled(false)
                  }}
                  className="text-[10px] rounded-md px-1.5 py-0.5"
                  style={{ color: colors.statusError, border: `1px solid ${colors.statusError}33` }}
                >
                  {t('general.remove')}
                </button>
              </div>
            ) : (
              <button
                disabled={cudaDownloading}
                onClick={async () => {
                  setCudaDownloading(true)
                  const result = await window.clui.downloadCuda()
                  setCudaDownloading(false)
                  if (result.ok) setCudaInstalled(true)
                }}
                className="text-[10px] rounded-md px-2 py-0.5 font-medium"
                style={{
                  color: cudaDownloading ? colors.textTertiary : '#fff',
                  background: cudaDownloading ? colors.surfaceHover : colors.accent,
                  border: 'none', cursor: cudaDownloading ? 'wait' : 'pointer',
                }}
              >
                {cudaDownloading ? t('settings.whisper.gpu.downloading') : t('settings.whisper.gpu.download')}
              </button>
            )}
          </div>
        )}
        {/* Microphone */}
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.mic')}</span>
          <select
            value={micDeviceId || ''}
            onChange={(e) => setMicDeviceId(e.target.value || null)}
            className="text-[11px] rounded-lg px-2 py-1 outline-none"
            style={{ ...selectStyle, width: 140 }}
          >
            <option value="">{t('settings.mic.default')}</option>
            {micDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
    </div>
  )
}

/* ─── Global Rules ─── */

/* ─── Ollama Prompt Enhancer settings ─── */

const OLLAMA_MODELS = [
  { id: 'qwen3:1.7b',  label: 'Qwen3 1.7B',   sizeMb: 1400, note: 'Recommended — best quality/speed' },
  { id: 'qwen3:4b',    label: 'Qwen3 4B',     sizeMb: 2500, note: 'Best quality under 3 GB' },
  { id: 'llama3.2:3b', label: 'Llama 3.2 3B', sizeMb: 2000, note: 'No thinking-mode overhead' },
] as const

function OllamaSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const ollamaEnabled = useSessionStore((s) => s.ollamaEnabled)
  const ollamaModel   = useSessionStore((s) => s.ollamaModel)
  const setOllamaEnabled = useSessionStore((s) => s.setOllamaEnabled)
  const setOllamaModel   = useSessionStore((s) => s.setOllamaModel)

  const [status, setStatus] = useState<{ running: boolean; version: string | null } | null>(null)
  const [installedModels, setInstalledModels] = useState<string[]>([])
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadPct, setDownloadPct] = useState(0)
  const [deleting, setDeleting] = useState<string | null>(null)

  const refreshStatus = useCallback(() => {
    window.clui.ollamaCheck().then(setStatus).catch(() => setStatus({ running: false, version: null }))
    window.clui.ollamaListModels().then((r) => setInstalledModels(r.installed)).catch(() => {})
  }, [])

  useEffect(() => {
    if (ollamaEnabled) refreshStatus()
  }, [ollamaEnabled, refreshStatus])

  // Subscribe to pull progress events
  useEffect(() => {
    const unsub = window.clui.onOllamaPullProgress((model, pct, _status) => {
      if (model === downloading) setDownloadPct(pct)
    })
    return unsub
  }, [downloading])

  const handleInstall = useCallback(async (modelId: string) => {
    if (!status?.running) { refreshStatus(); return }
    setDownloading(modelId)
    setDownloadPct(0)
    try {
      const result = await window.clui.ollamaPullModel(modelId)
      if (result.ok) {
        setOllamaModel(modelId)
        refreshStatus()
      }
    } finally {
      setDownloading(null)
      setDownloadPct(0)
    }
  }, [status, setOllamaModel, refreshStatus])

  const handleDelete = useCallback(async (modelId: string) => {
    setDeleting(modelId)
    try {
      await window.clui.ollamaDeleteModel(modelId)
      refreshStatus()
      if (ollamaModel === modelId) {
        const remaining = OLLAMA_MODELS.find((m) => m.id !== modelId)
        if (remaining) setOllamaModel(remaining.id)
      }
    } finally {
      setDeleting(null)
    }
  }, [ollamaModel, setOllamaModel, refreshStatus])

  const selectStyle = {
    background: colors.surfacePrimary,
    color: colors.textPrimary,
    border: `1px solid ${colors.containerBorder}`,
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: colors.textSecondary }}>Enable Prompt Enhancer</span>
        <RowToggle
          checked={ollamaEnabled}
          onChange={(v) => { setOllamaEnabled(v); if (v) refreshStatus() }}
          label="Enable Ollama Prompt Enhancer"
        />
      </div>

      {ollamaEnabled && (
        <>
          {/* Ollama status */}
          <div className="flex items-center justify-between">
            <span className="text-[11px]" style={{ color: colors.textSecondary }}>Ollama status</span>
            <div className="flex items-center gap-2">
              {status === null ? (
                <span className="text-[10px]" style={{ color: colors.textTertiary }}>Checking…</span>
              ) : status.running ? (
                <span className="text-[10px]" style={{ color: colors.accent }}>
                  ● Running{status.version ? ` v${status.version}` : ''}
                </span>
              ) : (
                <>
                  <span className="text-[10px]" style={{ color: colors.statusError }}>● Not running</span>
                  <button
                    onClick={() => window.clui.openExternal('https://ollama.ai')}
                    className="text-[10px] underline"
                    style={{ color: colors.textTertiary, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Install Ollama ↗
                  </button>
                </>
              )}
              <button
                onClick={refreshStatus}
                className="flex items-center justify-center rounded"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: colors.textTertiary }}
                title="Refresh status"
              >
                <ArrowsClockwise size={11} />
              </button>
            </div>
          </div>

          {/* Model list */}
          <div>
            <span className="text-[11px] block mb-1" style={{ color: colors.textSecondary }}>Models</span>
            <div className="flex flex-col gap-0.5">
              {OLLAMA_MODELS.map((m) => {
                const isSelected = ollamaModel === m.id
                const isInstalled = installedModels.some((name) => name === m.id || name.startsWith(`${m.id}:`))
                const isDownloading = downloading === m.id
                const isDeleting = deleting === m.id

                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5"
                    style={{
                      background: isSelected ? `${colors.accent}18` : colors.surfaceHover,
                      border: isSelected ? `1px solid ${colors.accent}44` : '1px solid transparent',
                    }}
                  >
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() => isInstalled && setOllamaModel(m.id)}
                    >
                      <div className="flex items-center gap-1.5">
                        {isSelected && isInstalled && (
                          <CheckCircle size={10} style={{ color: colors.accent, flexShrink: 0 }} />
                        )}
                        <span className="text-[11px] font-medium" style={{ color: colors.textPrimary }}>{m.label}</span>
                        <span className="text-[10px]" style={{ color: colors.textTertiary }}>{Math.round(m.sizeMb / 100) / 10} GB</span>
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: colors.textTertiary }}>{m.note}</div>
                      {isDownloading && downloadPct > 0 && (
                        <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: colors.surfaceSecondary }}>
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${downloadPct}%`, background: colors.accent }}
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 ml-2">
                      {isDownloading ? (
                        <div className="flex items-center gap-1">
                          <CircleNotch size={11} className="animate-spin" style={{ color: colors.accent }} />
                          <span className="text-[10px]" style={{ color: colors.textTertiary }}>{downloadPct}%</span>
                        </div>
                      ) : isDeleting ? (
                        <CircleNotch size={11} className="animate-spin" style={{ color: colors.textTertiary }} />
                      ) : isInstalled ? (
                        <button
                          onClick={() => handleDelete(m.id)}
                          title="Remove model"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: colors.textTertiary }}
                        >
                          <Trash size={11} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleInstall(m.id)}
                          title="Install model"
                          disabled={!status?.running || !!downloading}
                          style={{
                            background: 'none', border: 'none', cursor: (!status?.running || !!downloading) ? 'default' : 'pointer',
                            padding: 2, color: (!status?.running || !!downloading) ? colors.textTertiary : colors.accent,
                          }}
                        >
                          <DownloadSimple size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function GlobalRulesSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const t = useT()
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
        placeholder={t('settings.rules.placeholder')}
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
          {t('general.saved')}
        </div>
      )}
    </div>
  )
}

/* ─── About & Updates ─── */

function UpdateSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const t = useT()
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
        <span className="text-[10px]" style={{ color: colors.textTertiary }}>{t('settings.update.about')}</span>
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
            {t('settings.update.reportIssue')}
          </a>
        </div>
      </div>

      <div style={{ height: 1, background: colors.containerBorder }} />

      {/* Version & Updates */}
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.update.version')}</span>
        <span className="text-[11px] font-mono" style={{ color: colors.textTertiary }}>v{version}</span>
      </div>

      {status.state === 'checking' && (
        <div className="flex items-center gap-1.5">
          <CircleNotch size={12} className="animate-spin" style={{ color: colors.accent }} />
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.update.checking')}</span>
        </div>
      )}

      {status.state === 'up-to-date' && (
        <div className="flex items-center gap-1.5">
          <CheckCircle size={12} weight="fill" style={{ color: colors.accent }} />
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.update.upToDate')}</span>
        </div>
      )}

      {status.state === 'available' && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>v{status.version} {t('settings.update.availableSuffix')}</span>
          <button
            onClick={() => window.clui.downloadUpdate()}
            className="text-[11px] px-2 py-1 rounded-lg"
            style={{ background: colors.accent, color: '#fff', cursor: 'pointer' }}
          >
            {t('settings.update.openDownload')}
          </button>
        </div>
      )}

      {status.state === 'downloaded' && (
        <div className="flex flex-col gap-1">
          <CheckCircle size={12} weight="fill" style={{ color: colors.accent }} />
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.update.opened')}</span>
        </div>
      )}

      {status.state === 'error' && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px]" style={{ color: colors.statusError }}>{t('settings.update.error')}</span>
          <button
            onClick={() => window.clui.checkForUpdate()}
            className="text-[10px] px-2 py-0.5 rounded"
            style={{ background: colors.surfacePrimary, color: colors.textSecondary, border: `1px solid ${colors.containerBorder}`, cursor: 'pointer' }}
          >
            {t('settings.update.retry')}
          </button>
        </div>
      )}

      {(status.state === 'idle' || status.state === 'up-to-date' || status.state === 'error') && (
        <button
          onClick={() => window.clui.checkForUpdate()}
          className="text-[10px] self-start"
          style={{ color: colors.textTertiary, cursor: 'pointer', textDecoration: 'underline' }}
        >
          {t('settings.update.check')}
        </button>
      )}
    </div>
  )
}

/* ─── Window Margins ─── */

const OFFSET_STEP = 10

function WindowMarginsSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const t = useT()
  const offsetY = useSessionStore((s) => s.uiOffsetY)
  const offsetX = useSessionStore((s) => s.uiOffsetX)
  const setUiOffset = useSessionStore((s) => s.setUiOffset)

  const move = (dx: number, dy: number) => {
    const newX = offsetX + dx
    const newY = Math.max(0, offsetY + dy)
    setUiOffset(newX, newY)
  }

  const reset = () => setUiOffset(0, 0)
  const hasOffset = offsetX !== 0 || offsetY !== 0

  const btn = (content: string, onClick: () => void, title: string) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: colors.surfacePrimary,
        color: colors.textSecondary,
        border: `1px solid ${colors.containerBorder}`,
        borderRadius: 6,
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: 14,
        flexShrink: 0,
      }}
    >
      {content}
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[10px]" style={{ color: colors.textMuted }}>
        {t('settings.margins.hint')}
      </span>

      {/* D-pad */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex justify-center">
          {btn('↑', () => move(0, OFFSET_STEP), t('settings.margins.up'))}
        </div>
        <div className="flex items-center gap-2">
          {btn('←', () => move(-OFFSET_STEP, 0), t('settings.margins.left'))}
          <div className="text-center" style={{ minWidth: 72 }}>
            <div className="text-[11px] font-mono" style={{ color: colors.textSecondary }}>
              {offsetX > 0 ? `+${offsetX}` : offsetX}px · {offsetY}px
            </div>
            <div className="text-[10px]" style={{ color: colors.textMuted }}>
              X · Y
            </div>
          </div>
          {btn('→', () => move(OFFSET_STEP, 0), t('settings.margins.right'))}
        </div>
        <div className="flex justify-center">
          {btn('↓', () => move(0, -OFFSET_STEP), t('settings.margins.down'))}
        </div>
      </div>

      {hasOffset && (
        <button
          onClick={reset}
          className="text-[10px] text-center"
          style={{ color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {t('settings.margins.reset')}
        </button>
      )}
    </div>
  )
}

/* ─── Advanced section (token economy controls) ─── */

function AdvancedSection({ colors }: { colors: ReturnType<typeof useColors> }) {
  const maxTurns = useSessionStore((s) => s.maxTurns)
  const setMaxTurns = useSessionStore((s) => s.setMaxTurns)
  const warmupEnabled = useSessionStore((s) => s.warmupEnabled)
  const setWarmupEnabled = useSessionStore((s) => s.setWarmupEnabled)
  const systemHintEnabled = useSessionStore((s) => s.systemHintEnabled)
  const setSystemHintEnabled = useSessionStore((s) => s.setSystemHintEnabled)
  const autoCompactThreshold = useSessionStore((s) => s.autoCompactThreshold)
  const setAutoCompactThreshold = useSessionStore((s) => s.setAutoCompactThreshold)
  const maxBudgetUsd = useSessionStore((s) => s.maxBudgetUsd)
  const setMaxBudgetUsd = useSessionStore((s) => s.setMaxBudgetUsd)
  const t = useT()

  const inputStyle = {
    background: colors.surfacePrimary,
    color: colors.textSecondary,
    border: `1px solid ${colors.containerBorder}`,
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.advanced.maxTurns')}</span>
          <span className="text-[10px]" style={{ color: colors.textMuted }}>{t('settings.advanced.maxTurns.hint')}</span>
        </div>
        <input
          type="number"
          min={1}
          max={200}
          value={maxTurns}
          onChange={(e) => setMaxTurns(parseInt(e.target.value) || 25)}
          className="w-16 text-[11px] rounded px-1.5 py-0.5 text-right outline-none"
          style={inputStyle}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.advanced.autoCompact')}</span>
          <span className="text-[10px]" style={{ color: colors.textMuted }}>{t('settings.advanced.autoCompact.hint')}</span>
        </div>
        <input
          type="number"
          min={50}
          max={99}
          value={autoCompactThreshold}
          onChange={(e) => setAutoCompactThreshold(parseInt(e.target.value) || 80)}
          className="w-16 text-[11px] rounded px-1.5 py-0.5 text-right outline-none"
          style={inputStyle}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.advanced.budget')}</span>
          <span className="text-[10px]" style={{ color: colors.textMuted }}>{t('settings.advanced.budget.hint')}</span>
        </div>
        <input
          type="number"
          min={0}
          step={0.1}
          value={maxBudgetUsd ?? 0}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setMaxBudgetUsd(v > 0 ? v : null)
          }}
          className="w-16 text-[11px] rounded px-1.5 py-0.5 text-right outline-none"
          style={inputStyle}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.advanced.systemHint')}</span>
          <span className="text-[10px]" style={{ color: colors.textMuted }}>{t('settings.advanced.systemHint.hint')}</span>
        </div>
        <RowToggle checked={systemHintEnabled} onChange={setSystemHintEnabled} label="GUI context hint" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{t('settings.advanced.warmup')}</span>
          <span className="text-[10px]" style={{ color: colors.textMuted }}>{t('settings.advanced.warmup.hint')}</span>
        </div>
        <RowToggle checked={warmupEnabled} onChange={setWarmupEnabled} label="Pre-warm sessions" />
      </div>
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
  const t = useT()

  const [open, setOpen] = useState(false)

  // Listen for /config slash command
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('clui:open-settings', handler)
    return () => window.removeEventListener('clui:open-settings', handler)
  }, [])
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
        title={t('settings.title')}
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
                    {t('settings.appearance.expanded')}
                  </div>
                </div>
                <RowToggle
                  checked={expandedUI}
                  onChange={(next) => { setExpandedUI(next) }}
                  label="Toggle full width panel"
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
                    {t('settings.appearance.theme')}
                  </div>
                </div>
                <RowToggle
                  checked={themeMode === 'dark'}
                  onChange={(next) => setThemeMode(next ? 'dark' : 'light')}
                  label="Toggle dark theme"
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
                    {t('settings.appearance.sound')}
                  </div>
                </div>
                <RowToggle
                  checked={soundEnabled}
                  onChange={setSoundEnabled}
                  label="Toggle notification sound"
                />
              </div>
            </div>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            {/* Zoom */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <MagnifyingGlassPlus size={14} style={{ color: colors.textTertiary }} />
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    {t('settings.appearance.zoom')}
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

            <CollapsibleSection colors={colors} icon={<Translate size={14} style={{ color: colors.textTertiary }} />} label={t('settings.language')}>
              <LanguageSection colors={colors} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<Keyboard size={14} style={{ color: colors.textTertiary }} />} label={t('settings.shortcuts')}>
              <ShortcutsSection colors={colors} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<Microphone size={14} style={{ color: colors.textTertiary }} />} label={t('settings.whisper')}>
              <WhisperSection colors={colors} micDeviceId={micDeviceId} micDevices={micDevices} setMicDeviceId={setMicDeviceId} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<Sparkle size={14} style={{ color: colors.textTertiary }} />} label={t('settings.ollama')}>
              <OllamaSection colors={colors} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<Power size={14} style={{ color: colors.textTertiary }} />} label={t('settings.startup')}>
              <StartupSection colors={colors} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<Browsers size={14} style={{ color: colors.textTertiary }} />} label={t('settings.margins')}>
              <WindowMarginsSection colors={colors} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<Sliders size={14} style={{ color: colors.textTertiary }} />} label={t('settings.advanced')}>
              <AdvancedSection colors={colors} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<NotePencil size={14} style={{ color: colors.textTertiary }} />} label={t('settings.rules')}>
              <GlobalRulesSection colors={colors} />
            </CollapsibleSection>

            <div style={{ height: 1, background: colors.popoverBorder }} />

            <CollapsibleSection colors={colors} icon={<ArrowsClockwise size={14} style={{ color: colors.textTertiary }} />} label={t('settings.about')}>
              <UpdateSection colors={colors} />
            </CollapsibleSection>
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}
