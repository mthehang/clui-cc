import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Terminal, CaretDown, Check, FolderOpen, ShieldCheck, Keyboard, Gauge, Warning, ListChecks, Question, PencilSimple, Lightning } from '@phosphor-icons/react'
import type { IconWeight } from '@phosphor-icons/react'
import { useSessionStore, AVAILABLE_MODELS, getModelDisplayLabel } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { useColors, useThemeStore } from '../theme'
import { useT } from '../i18n'

/* ─── Model Picker (inline — tightly coupled to StatusBar) ─── */

function ModelPicker() {
  const preferredModel = useSessionStore((s) => s.preferredModel)
  const setPreferredModel = useSessionStore((s) => s.setPreferredModel)
  const setTabModel = useSessionStore((s) => s.setTabModel)
  const tab = useSessionStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId),
    (a, b) => a === b || (!!a && !!b && a.status === b.status && a.sessionModel === b.sessionModel && a.tabModel === b.tabModel),
  )
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ bottom: 0, left: 0 })

  const isBusy = tab?.status === 'running' || tab?.status === 'connecting'

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left,
    })
  }, [])

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

  const handleToggle = () => {
    if (isBusy) return
    if (!open) updatePos()
    setOpen((o) => !o)
  }

  const effectiveModel = tab?.tabModel ?? preferredModel
  const activeLabel = (() => {
    if (effectiveModel) {
      const m = AVAILABLE_MODELS.find((m) => m.id === effectiveModel)
      return m?.label || getModelDisplayLabel(effectiveModel)
    }
    if (tab?.sessionModel) {
      return getModelDisplayLabel(tab.sessionModel)
    }
    return AVAILABLE_MODELS[0].label
  })()

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 transition-colors"
        style={{
          color: colors.textTertiary,
          cursor: isBusy ? 'not-allowed' : 'pointer',
        }}
        title={isBusy ? 'Stop the task to change model' : 'Switch model'}
      >
        {activeLabel}
        <CaretDown size={10} style={{ opacity: 0.6 }} />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clui-ui
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.12 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            bottom: pos.bottom,
            left: pos.left,
            width: 192,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
          }}
        >
          <div className="py-1">
            {AVAILABLE_MODELS.map((m) => {
              const isSelected = effectiveModel === m.id || (!effectiveModel && m.id === AVAILABLE_MODELS[0].id)
              return (
                <button
                  key={m.id}
                  onClick={() => { if (tab) setTabModel(tab.id, m.id); else setPreferredModel(m.id); setOpen(false) }}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
                  style={{
                    color: isSelected ? colors.textPrimary : colors.textSecondary,
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {m.label}
                  {isSelected && <Check size={12} style={{ color: colors.accent }} />}
                </button>
              )
            })}
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}

/* ─── Permission Mode Picker (per-tab with global fallback) ─── */

function PermissionModePicker() {
  const t = useT()
  const globalPermissionMode = useSessionStore((s) => s.permissionMode)
  const setPermissionMode = useSessionStore((s) => s.setPermissionMode)
  const setTabPermissionMode = useSessionStore((s) => s.setTabPermissionMode)
  const tab = useSessionStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId),
    (a, b) => a === b || (!!a && !!b && a.tabPermissionMode === b.tabPermissionMode),
  )
  const permissionMode = tab?.tabPermissionMode ?? globalPermissionMode
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ bottom: 0, left: 0 })

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left,
    })
  }, [])

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

  const handleToggle = () => {
    if (!open) updatePos()
    setOpen((o) => !o)
  }

  const handleSetMode = (mode: 'plan' | 'ask' | 'acceptEdits' | 'auto' | 'dontAsk' | 'bypass') => {
    if (tab) setTabPermissionMode(tab.id, mode)
    else setPermissionMode(mode)
    setOpen(false)
  }

  const isBypass = permissionMode === 'bypass'
  const isAuto = permissionMode === 'auto'
  const isPlan = permissionMode === 'plan'
  const isAcceptEdits = permissionMode === 'acceptEdits'
  const isDontAsk = permissionMode === 'dontAsk'

  const modeLabelMap: Record<string, string> = {
    plan: t('mode.plan'), ask: t('mode.ask'), acceptEdits: t('mode.acceptEdits'), auto: t('mode.auto'), dontAsk: t('mode.dontAsk'), bypass: t('mode.bypass'),
  }
  const modeLabel = modeLabelMap[permissionMode] || 'Ask'

  const triggerIcon = isPlan ? <ListChecks size={11} weight="bold" />
    : isAcceptEdits ? <PencilSimple size={11} weight="bold" />
    : isAuto ? <ShieldCheck size={11} weight="fill" />
    : isDontAsk ? <Lightning size={11} weight="fill" />
    : isBypass ? <Warning size={11} weight="fill" />
    : <Question size={11} weight="bold" />

  const triggerColor = isPlan ? '#60a5fa' : (isBypass || isDontAsk) ? '#e57c23' : colors.textTertiary
  const expandedUI = useThemeStore((s) => s.expandedUI)

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 transition-colors"
        style={{ color: triggerColor, cursor: 'pointer' }}
        title={`Mode: ${modeLabel}`}
      >
        {triggerIcon}
        {expandedUI && <span className="hidden sm:inline">{modeLabel}</span>}
        <CaretDown size={10} style={{ opacity: 0.6 }} />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clui-ui
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.12 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            bottom: pos.bottom,
            left: pos.left,
            width: 180,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
          }}
        >
          <div className="py-1">
            <button
              onClick={() => handleSetMode('plan')}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
              style={{
                color: isPlan ? '#60a5fa' : colors.textSecondary,
                fontWeight: isPlan ? 600 : 400,
              }}
            >
              <span className="flex items-center gap-1.5">
                <ListChecks size={12} weight="bold" style={{ color: '#60a5fa' }} />
                {t('mode.plan')}
              </span>
              {isPlan && <Check size={12} style={{ color: '#60a5fa' }} />}
            </button>

            <div className="mx-2 my-0.5" style={{ height: 1, background: colors.popoverBorder }} />

            <button
              onClick={() => handleSetMode('ask')}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
              style={{
                color: permissionMode === 'ask' ? colors.textPrimary : colors.textSecondary,
                fontWeight: permissionMode === 'ask' ? 600 : 400,
              }}
            >
              <span className="flex items-center gap-1.5">
                <Question size={12} weight="bold" />
                {t('mode.ask')}
              </span>
              {permissionMode === 'ask' && <Check size={12} style={{ color: colors.accent }} />}
            </button>

            <div className="mx-2 my-0.5" style={{ height: 1, background: colors.popoverBorder }} />

            <button
              onClick={() => handleSetMode('acceptEdits')}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
              style={{
                color: isAcceptEdits ? colors.textPrimary : colors.textSecondary,
                fontWeight: isAcceptEdits ? 600 : 400,
              }}
            >
              <span className="flex items-center gap-1.5">
                <PencilSimple size={12} weight="bold" />
                {t('mode.acceptEdits')}
              </span>
              {isAcceptEdits && <Check size={12} style={{ color: colors.accent }} />}
            </button>

            <div className="mx-2 my-0.5" style={{ height: 1, background: colors.popoverBorder }} />

            <button
              onClick={() => handleSetMode('auto')}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
              style={{
                color: isAuto ? colors.textPrimary : colors.textSecondary,
                fontWeight: isAuto ? 600 : 400,
              }}
            >
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={12} weight="fill" />
                {t('mode.auto')}
              </span>
              {isAuto && <Check size={12} style={{ color: colors.accent }} />}
            </button>

            <div className="mx-2 my-0.5" style={{ height: 1, background: colors.popoverBorder }} />

            <button
              onClick={() => handleSetMode('dontAsk')}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
              style={{
                color: isDontAsk ? '#e57c23' : colors.textSecondary,
                fontWeight: isDontAsk ? 600 : 400,
              }}
            >
              <span className="flex items-center gap-1.5">
                <Lightning size={12} weight="fill" style={{ color: isDontAsk ? '#e57c23' : undefined }} />
                {t('mode.dontAsk')}
              </span>
              {isDontAsk && <Check size={12} style={{ color: '#e57c23' }} />}
            </button>

            <div className="mx-2 my-0.5" style={{ height: 1, background: colors.popoverBorder }} />

            <button
              onClick={() => handleSetMode('bypass')}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
              style={{
                color: isBypass ? '#e57c23' : colors.textSecondary,
                fontWeight: isBypass ? 600 : 400,
              }}
            >
              <span className="flex items-center gap-1.5">
                <Warning size={12} weight="fill" style={{ color: '#e57c23' }} />
                {t('mode.bypass')}
              </span>
              {isBypass && <Check size={12} style={{ color: '#e57c23' }} />}
            </button>
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}

/* ─── Effort Picker (thinking budget) ─── */

const EFFORT_OPTIONS: Array<{ label: string; value: number | null; weight: IconWeight }> = [
  { label: 'Auto', value: null, weight: 'thin' },
  { label: 'Low', value: 4096, weight: 'light' },
  { label: 'Medium', value: 8192, weight: 'regular' },
  { label: 'High', value: 16384, weight: 'bold' },
  { label: 'Max', value: 32768, weight: 'fill' },
]

function EffortPicker() {
  const globalEffortLevel = useSessionStore((s) => s.effortLevel)
  const setEffortLevel = useSessionStore((s) => s.setEffortLevel)
  const setTabEffortLevel = useSessionStore((s) => s.setTabEffortLevel)
  const tab = useSessionStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId),
    (a, b) => a === b || (!!a && !!b && a.tabEffortLevel === b.tabEffortLevel),
  )
  const effortLevel = tab?.tabEffortLevel !== undefined && tab?.tabEffortLevel !== null ? tab.tabEffortLevel : globalEffortLevel
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ bottom: 0, left: 0 })

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left,
    })
  }, [])

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

  const handleToggle = () => {
    if (!open) updatePos()
    setOpen((o) => !o)
  }

  const activeOption = EFFORT_OPTIONS.find((o) => o.value === effortLevel) || EFFORT_OPTIONS[0]
  const expandedUI = useThemeStore((s) => s.expandedUI)

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 transition-colors"
        style={{
          color: colors.textTertiary,
          cursor: 'pointer',
        }}
        title={`Thinking effort: ${activeOption.label}`}
      >
        <Gauge size={11} weight={activeOption.weight} style={activeOption.value === 32768 ? { color: colors.accent } : undefined} />
        {expandedUI && <span className="hidden sm:inline">{activeOption.label}</span>}
        <CaretDown size={10} style={{ opacity: 0.6 }} />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clui-ui
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.12 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            bottom: pos.bottom,
            left: pos.left,
            width: 180,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
          }}
        >
          <div className="py-1">
            {EFFORT_OPTIONS.map((opt, idx) => {
              const isSelected = effortLevel === opt.value
              return (
                <React.Fragment key={opt.label}>
                  {idx > 0 && (
                    <div className="mx-2 my-0.5" style={{ height: 1, background: colors.popoverBorder }} />
                  )}
                  <button
                    onClick={() => { if (tab) setTabEffortLevel(tab.id, opt.value); else setEffortLevel(opt.value); setOpen(false) }}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
                    style={{
                      color: isSelected ? colors.textPrimary : colors.textSecondary,
                      fontWeight: isSelected ? 600 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      <Gauge size={12} weight={opt.weight} style={opt.value === 32768 ? { color: colors.accent } : undefined} />
                      {opt.label}
                    </span>
                    {isSelected && <Check size={12} style={{ color: colors.accent }} />}
                  </button>
                </React.Fragment>
              )
            })}
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}

/* ─── StatusBar ─── */


/** Get a compact display path: basename for deep paths, ~ for home */
function compactPath(fullPath: string): string {
  if (fullPath === '~') return '~'
  const parts = fullPath.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || fullPath
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export function StatusBar() {
  const t = useT()
  const tab = useSessionStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId),
    (a, b) => a === b || (!!a && !!b
      && a.status === b.status
      && a.hasChosenDirectory === b.hasChosenDirectory
      && a.workingDirectory === b.workingDirectory
      && a.claudeSessionId === b.claudeSessionId
      && a.cumulativeUsage.totalInputTokens === b.cumulativeUsage.totalInputTokens
      && a.cumulativeUsage.totalOutputTokens === b.cumulativeUsage.totalOutputTokens
    ),
  )
  const changeDirectory = useSessionStore((s) => s.changeDirectory)
  const expandedUI = useThemeStore((s) => s.expandedUI)
  const compact = !expandedUI
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [dirOpen, setDirOpen] = useState(false)
  const dirRef = useRef<HTMLButtonElement>(null)
  const dirPopRef = useRef<HTMLDivElement>(null)
  const [dirPos, setDirPos] = useState({ bottom: 0, left: 0 })

  // Close popover on outside click
  useEffect(() => {
    if (!dirOpen) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (dirRef.current?.contains(target)) return
      if (dirPopRef.current?.contains(target)) return
      setDirOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dirOpen])

  if (!tab) return null

  const isRunning = tab.status === 'running' || tab.status === 'connecting'
  const isEmpty = tab.messages.length === 0

  const handleOpenInTerminal = () => {
    window.clui.openInTerminal(tab.claudeSessionId, tab.workingDirectory)
  }

  const handleDirClick = () => {
    if (isRunning) return
    if (!dirOpen && dirRef.current) {
      const rect = dirRef.current.getBoundingClientRect()
      setDirPos({
        bottom: window.innerHeight - rect.top + 6,
        left: rect.left,
      })
    }
    setDirOpen((o) => !o)
  }

  const handleChangeDir = async () => {
    const dir = await window.clui.selectDirectory()
    if (dir) {
      changeDirectory(dir)
      setDirOpen(false)
    }
  }

  const dirTooltip = tab.hasChosenDirectory
    ? tab.workingDirectory
    : t('status.dir.choose')

  return (
    <div
      className="flex items-center justify-between px-4 py-1.5"
      style={{ minHeight: 28 }}
    >
      {/* Left — directory + model picker */}
      <div className="flex items-center gap-2 text-[11px] min-w-0" style={{ color: colors.textTertiary }}>
        {/* Directory button */}
        <button
          ref={dirRef}
          onClick={handleDirClick}
          className="flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors flex-shrink-0"
          style={{
            color: colors.textTertiary,
            cursor: isRunning ? 'not-allowed' : 'pointer',
            maxWidth: 140,
          }}
          title={dirTooltip}
          disabled={isRunning}
        >
          <FolderOpen size={11} className="flex-shrink-0" />
          {!compact && <span className="truncate">{tab.hasChosenDirectory ? compactPath(tab.workingDirectory) : '—'}</span>}
        </button>

        {/* Directory popover */}
        {popoverLayer && dirOpen && createPortal(
          <motion.div
            ref={dirPopRef}
            data-clui-ui
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12 }}
            className="rounded-xl"
            style={{
              position: 'fixed',
              bottom: dirPos.bottom,
              left: dirPos.left,
              width: 220,
              pointerEvents: 'auto',
              background: colors.popoverBg,
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: colors.popoverShadow,
              border: `1px solid ${colors.popoverBorder}`,
            }}
          >
            <div className="py-1.5 px-1">
              {/* Base directory */}
              <div className="px-2 py-1">
                <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: colors.textTertiary }}>
                  {t('status.dir.base')}
                </div>
                <div className="text-[11px] truncate" style={{ color: tab.hasChosenDirectory ? colors.textSecondary : colors.textMuted }} title={tab.hasChosenDirectory ? tab.workingDirectory : t('status.dir.none')}>
                  {tab.hasChosenDirectory ? tab.workingDirectory : t('status.dir.none')}
                </div>
              </div>

              <div className="mx-2 my-1" style={{ height: 1, background: colors.popoverBorder }} />

              {/* Change directory button */}
              <button
                onClick={handleChangeDir}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] transition-colors rounded-lg"
                style={{ color: colors.accent }}
              >
                <FolderOpen size={10} />
                {t('status.dir.change') || 'Change directory'}
              </button>
            </div>
          </motion.div>,
          popoverLayer,
        )}

        <span style={{ color: colors.textMuted, fontSize: 10 }}>|</span>

        <ModelPicker />

        <span style={{ color: colors.textMuted, fontSize: 10 }}>|</span>

        <PermissionModePicker />

        <EffortPicker />
      </div>

      {/* Right — context % + CLI */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {(() => {
          const inputTokens = tab.lastResult?.usage?.input_tokens ?? 0
          const contextLimit = 200_000
          const pct = Math.min(100, Math.round((inputTokens / contextLimit) * 100))
          const color = pct >= 80 ? colors.contextHigh
            : pct >= 60 ? colors.contextMedium
            : colors.contextLow
          const tooltipText = inputTokens > 0
            ? `${t('status.context')}: ${pct}% (${formatTokenCount(inputTokens)} / ${formatTokenCount(contextLimit)} tokens)`
            : `${t('status.context')}: 0% — ${t('status.context.empty')}`
          return (
            <span
              className="text-[10px] tabular-nums flex items-center gap-1"
              style={{ color, opacity: pct >= 60 ? 1 : 0.6 }}
              title={tooltipText}
            >
              {!compact && <span className="text-[9px]" style={{ opacity: 0.8 }}>{t('status.context')}</span>}
              <span style={{
                display: 'inline-block', width: 24, height: 4, borderRadius: 2,
                background: colors.contextTrack, overflow: 'hidden', position: 'relative',
              }}>
                <span style={{
                  position: 'absolute', left: 0, top: 0, height: '100%',
                  width: `${pct}%`, borderRadius: 2, background: color,
                }} />
              </span>
              {pct}%
            </span>
          )
        })()}
        <span style={{ color: colors.textMuted, fontSize: 10 }}>|</span>
        <button
          onClick={handleOpenInTerminal}
          className="flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 transition-colors"
          style={{ color: colors.textTertiary }}
          title={t('status.terminal.title')}
        >
          {!compact && t('status.terminal')}
          <Terminal size={11} />
        </button>
      </div>
    </div>
  )
}
