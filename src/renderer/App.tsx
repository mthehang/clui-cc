import React, { useEffect, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Paperclip, Camera, HeadCircuit, ChartBar, Brain, Broadcast } from '@phosphor-icons/react'
import { TabStrip } from './components/TabStrip'
import { ConversationView } from './components/ConversationView'
import { InputBar } from './components/InputBar'
import { StatusBar } from './components/StatusBar'
import { MarketplacePanel } from './components/MarketplacePanel'
import { UsagePanel } from './components/UsagePanel'
import { PopoverLayerProvider } from './components/PopoverLayer'
import { useClaudeEvents } from './hooks/useClaudeEvents'
import { useHealthReconciliation } from './hooks/useHealthReconciliation'
import { useSessionStore } from './stores/sessionStore'
import { useColors, useThemeStore, spacing } from './theme'
import { useT } from './i18n'

const TRANSITION = { duration: 0.26, ease: [0.4, 0, 0.1, 1] as const }

export default function App() {
  useClaudeEvents()
  useHealthReconciliation()
  const t = useT()

  const activeTabStatus = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.status)
  const addAttachments = useSessionStore((s) => s.addAttachments)
  const colors = useColors()
  const setSystemTheme = useThemeStore((s) => s.setSystemTheme)
  const expandedUI = useThemeStore((s) => s.expandedUI)

  // ─── Theme initialization ───
  useEffect(() => {
    // Get initial OS theme — setSystemTheme respects themeMode (system/light/dark)
    window.clui.getTheme().then(({ isDark }) => {
      setSystemTheme(isDark)
    }).catch(() => {})

    // Listen for OS theme changes
    const unsub = window.clui.onThemeChange((isDark) => {
      setSystemTheme(isDark)
    })
    return unsub
  }, [setSystemTheme])

  useEffect(() => {
    useSessionStore.getState().initStaticInfo().then(() => {
      const homeDir = useSessionStore.getState().staticInfo?.homePath || '~'
      const tab = useSessionStore.getState().tabs[0]
      if (tab) {
        // Set working directory to home by default (user hasn't chosen yet)
        useSessionStore.setState((s) => ({
          tabs: s.tabs.map((t, i) => (i === 0 ? { ...t, workingDirectory: homeDir, hasChosenDirectory: false } : t)),
        }))
        window.clui.createTab().then(({ tabId }) => {
          useSessionStore.setState((s) => ({
            tabs: s.tabs.map((t, i) => (i === 0 ? { ...t, id: tabId } : t)),
            activeTabId: tabId,
          }))
        }).catch(() => {})
      }
    })
  }, [])

  // OS-level click-through (RAF-throttled to avoid per-pixel IPC)
  useEffect(() => {
    if (!window.clui?.setIgnoreMouseEvents) return
    let lastIgnored: boolean | null = null
    let rafId: number | null = null
    let lastX = 0, lastY = 0

    const onMouseMove = (e: MouseEvent) => {
      lastX = e.clientX
      lastY = e.clientY
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const el = document.elementFromPoint(lastX, lastY)
        const isUI = !!(el && el.closest('[data-clui-ui]'))
        const shouldIgnore = !isUI
        if (shouldIgnore !== lastIgnored) {
          lastIgnored = shouldIgnore
          if (shouldIgnore) {
            window.clui.setIgnoreMouseEvents(true, { forward: true })
          } else {
            window.clui.setIgnoreMouseEvents(false)
          }
        }
      })
    }

    const onMouseLeave = () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      if (lastIgnored !== true) {
        lastIgnored = true
        window.clui.setIgnoreMouseEvents(true, { forward: true })
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseleave', onMouseLeave)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  // ─── Shift+Tab cycles permission modes (Plan → Ask → AcceptEdits → Auto → DontAsk → Bypass) ───
  useEffect(() => {
    const PERM_CYCLE: Array<'plan' | 'ask' | 'acceptEdits' | 'auto' | 'dontAsk' | 'bypass'> = ['plan', 'ask', 'acceptEdits', 'auto', 'dontAsk', 'bypass']
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        const cur = useSessionStore.getState().permissionMode
        const idx = PERM_CYCLE.indexOf(cur as any)
        const next = PERM_CYCLE[(idx + 1) % PERM_CYCLE.length]
        useSessionStore.getState().setPermissionMode(next)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // ─── Open marketplace via custom event ───
  useEffect(() => {
    const handler = () => {
      const s = useSessionStore.getState()
      if (!s.marketplaceOpen) s.toggleMarketplace()
    }
    window.addEventListener('clui:open-marketplace', handler)
    return () => window.removeEventListener('clui:open-marketplace', handler)
  }, [])

  // ─── Window show/hide animation ───
  const [windowVisible, setWindowVisible] = useState(false)

  useEffect(() => {
    // Animate in on first render (window is being shown)
    requestAnimationFrame(() => setWindowVisible(true))

    const unsubShow = window.clui.onWindowShown(() => {
      setWindowVisible(true)
    })

    const unsubHide = window.clui.onAnimateHide(() => {
      // Immediately release mouse capture so desktop stays clickable
      window.clui.setIgnoreMouseEvents(true, { forward: true })
      setWindowVisible(false)
      // Wait for exit animation to finish, then actually hide
      setTimeout(() => window.clui.hideWindow(), 150)
    })

    return () => { unsubShow(); unsubHide() }
  }, [])

  const isExpanded = useSessionStore((s) => s.isExpanded)
  const marketplaceOpen = useSessionStore((s) => s.marketplaceOpen)
  const usagePanelOpen = useSessionStore((s) => s.usagePanelOpen)
  const globalThinkingEnabled = useSessionStore((s) => s.thinkingEnabled)
  const setTabThinkingEnabled = useSessionStore((s) => s.setTabThinkingEnabled)
  const activeTab = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const thinkingEnabled = activeTab?.tabThinkingEnabled ?? globalThinkingEnabled
  const uiOffsetY = useSessionStore((s) => s.uiOffsetY)
  const uiOffsetX = useSessionStore((s) => s.uiOffsetX)

  const isRunning = activeTabStatus === 'running' || activeTabStatus === 'connecting'

  // ─── Remote Control daemon state ───
  const [rcUrl, setRcUrl] = useState<string | null>(null)
  const [rcActive, setRcActive] = useState(false)
  const [rcPopupVisible, setRcPopupVisible] = useState(false)
  const [rcTabIds, setRcTabIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const unsubUrl = window.clui.onRcUrl((tabId, url) => {
      setRcTabIds((prev) => new Set(prev).add(tabId))
      const s = useSessionStore.getState()
      if (tabId === s.activeTabId) {
        setRcUrl(url)
        setRcActive(true)
        setRcPopupVisible(true)
      }
    })
    const unsubStopped = window.clui.onRcStopped((tabId) => {
      setRcTabIds((prev) => { const next = new Set(prev); next.delete(tabId); return next })
      const s = useSessionStore.getState()
      if (tabId === s.activeTabId) {
        setRcUrl(null)
        setRcActive(false)
        setRcPopupVisible(false)
      }
    })
    return () => { unsubUrl(); unsubStopped() }
  }, [])

  // Layout dimensions — expandedUI widens and heightens the panel
  const contentWidth = expandedUI ? 700 : spacing.contentWidth
  const cardExpandedWidth = expandedUI ? 700 : 460
  const cardCollapsedWidth = expandedUI ? 670 : 430
  const cardCollapsedMargin = expandedUI ? 15 : 15
  const bodyMaxHeight = expandedUI ? 520 : 400

  const handleScreenshot = useCallback(async () => {
    const result = await window.clui.takeScreenshot()
    if (!result) return
    addAttachments([result])
  }, [addAttachments])

  const handleAttachFile = useCallback(async () => {
    const files = await window.clui.attachFiles()
    if (!files || files.length === 0) return
    addAttachments(files)
  }, [addAttachments])

  return (
    <PopoverLayerProvider>
      <div
        className="flex flex-col justify-end h-full"
        style={{
          background: 'transparent',
          paddingBottom: uiOffsetY,
        }}
      >

        {/* ─── 460px content column, centered. Circles overflow left. ─── */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={windowVisible
            ? { opacity: 1, y: 0, scale: 1 }
            : { opacity: 0, y: 18, scale: 0.97 }
          }
          transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ width: contentWidth, position: 'relative', margin: '0 auto', transition: 'width 0.26s cubic-bezier(0.4, 0, 0.1, 1)', transform: `translateX(${uiOffsetX}px)` }}
        >

          <AnimatePresence initial={false}>
            {marketplaceOpen && (
              <div
                data-clui-ui
                style={{
                  width: 720,
                  maxWidth: 720,
                  marginLeft: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 14,
                  position: 'relative',
                  zIndex: 30,
                }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.985 }}
                  transition={TRANSITION}
                >
                  <div
                    data-clui-ui
                    className="glass-surface overflow-hidden no-drag"
                    style={{
                      borderRadius: 24,
                      maxHeight: 470,
                    }}
                  >
                    <MarketplacePanel />
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {usagePanelOpen && (
              <div
                data-clui-ui
                style={{
                  width: 720,
                  maxWidth: 720,
                  marginLeft: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 14,
                  position: 'relative',
                  zIndex: 30,
                }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.985 }}
                  transition={TRANSITION}
                >
                  <div
                    data-clui-ui
                    className="glass-surface overflow-hidden no-drag"
                    style={{
                      borderRadius: 24,
                      maxHeight: 350,
                    }}
                  >
                    <UsagePanel />
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/*
            ─── Tabs / message shell ───
            This always remains the chat shell. The marketplace is a separate
            panel rendered above it, never inside it.
          */}
          <motion.div
            data-clui-ui
            className="overflow-hidden flex flex-col drag-region"
            animate={{
              width: isExpanded ? cardExpandedWidth : cardCollapsedWidth,
              marginBottom: isExpanded ? 10 : -14,
              marginLeft: isExpanded ? 0 : cardCollapsedMargin,
              marginRight: isExpanded ? 0 : cardCollapsedMargin,
              background: isExpanded ? colors.containerBg : colors.containerBgCollapsed,
              borderColor: colors.containerBorder,
              boxShadow: isExpanded ? colors.cardShadow : colors.cardShadowCollapsed,
            }}
            transition={TRANSITION}
            style={{
              borderWidth: 1,
              borderStyle: 'solid',
              borderRadius: 20,
              position: 'relative',
              zIndex: isExpanded ? 20 : 10,
            }}
          >
            {/* Tab strip — always mounted */}
            <div className="no-drag">
              <TabStrip rcActive={rcActive} rcTabIds={rcTabIds} onRcClick={() => setRcPopupVisible((v) => !v)} />
            </div>

            {/* Body — chat history only; the marketplace is a separate overlay above */}
            <motion.div
              initial={false}
              animate={{
                height: isExpanded ? 'auto' : 0,
                opacity: isExpanded ? 1 : 0,
              }}
              transition={TRANSITION}
              className="overflow-hidden no-drag"
            >
              <div style={{ maxHeight: bodyMaxHeight }}>
                <ConversationView />
                <StatusBar />
              </div>
            </motion.div>
          </motion.div>

          {/* ─── Input row — circles float outside left ─── */}
          {/* marginBottom: shadow buffer so the glass-surface drop shadow isn't clipped at the native window edge */}
          <div data-clui-ui className="relative" style={{ minHeight: 46, zIndex: 15, marginBottom: 10 }}>
            {/* Stacked circle buttons — expand on hover */}
            <div
              data-clui-ui
              className="circles-out"
            >
              <div className="btn-stack">
                {/* btn-1: Attach (front, rightmost) */}
                <button
                  className="stack-btn stack-btn-1 glass-surface"
                  title="Attach file"
                  onClick={handleAttachFile}
                  disabled={isRunning}
                >
                  <Paperclip size={17} />
                </button>
                {/* btn-2: Screenshot (middle) */}
                <button
                  className="stack-btn stack-btn-2 glass-surface"
                  title="Take screenshot"
                  onClick={handleScreenshot}
                  disabled={isRunning}
                >
                  <Camera size={17} />
                </button>
                {/* btn-3: Skills (middle-back) */}
                <button
                  className="stack-btn stack-btn-3 glass-surface"
                  title="Skills & Plugins"
                  onClick={() => useSessionStore.getState().toggleMarketplace()}
                  disabled={isRunning}
                >
                  <HeadCircuit size={17} />
                </button>
                {/* btn-4: Usage (back, leftmost) */}
                <button
                  className="stack-btn stack-btn-4 glass-surface"
                  title="Session Usage"
                  onClick={() => useSessionStore.getState().toggleUsagePanel()}
                >
                  <ChartBar size={17} />
                </button>
              </div>
            </div>

            {/* Input pill */}
            <div
              data-clui-ui
              className="glass-surface w-full"
              style={{ minHeight: 50, borderRadius: 25, padding: '0 6px 0 16px', background: colors.inputPillBg }}
            >
              <InputBar />
            </div>

            {/* Right-side toggles — mirrored stack (same pattern as left) */}
            <div data-clui-ui className="circles-out-right">
              <div className="btn-stack-right">
                {/* btn-r1: Thinking (front, leftmost) */}
                <button
                  className="stack-btn stack-btn-r1 glass-surface"
                  title={thinkingEnabled ? 'Extended thinking ON' : 'Extended thinking OFF'}
                  onClick={() => {
                    const s = useSessionStore.getState()
                    const tabId = s.activeTabId
                    const tab = s.tabs.find((t) => t.id === tabId)
                    const current = tab?.tabThinkingEnabled ?? s.thinkingEnabled
                    if (tab) {
                      setTabThinkingEnabled(tabId, !current)
                    } else {
                      useSessionStore.setState({ thinkingEnabled: !current })
                      window.clui.saveSettings({ thinkingEnabled: !current })
                    }
                  }}
                  style={thinkingEnabled ? { color: colors.accent } : undefined}
                >
                  <Brain size={17} weight={thinkingEnabled ? 'fill' : 'regular'} />
                </button>
                {/* btn-r2: Remote control toggle — spawns/kills background daemon */}
                <button
                  className="stack-btn stack-btn-r2 glass-surface"
                  title={rcActive && rcUrl ? 'Remote control ON — click to stop' : rcActive ? 'Remote control connecting...' : (activeTab?.claudeSessionId ? 'Start remote control' : 'Send a message first to start a session')}
                  onClick={async () => {
                    const s = useSessionStore.getState()
                    const tabId = s.activeTabId
                    const tab = s.tabs.find((t) => t.id === tabId)
                    if (!tab) return

                    if (rcActive) {
                      // Stop daemon
                      await window.clui.rcStop(tabId)
                      setRcActive(false)
                      setRcUrl(null)
                    } else {
                      // Need an active session to resume
                      if (!tab.claudeSessionId) return
                      setRcActive(true) // Optimistic — shows spinner state
                      try {
                        const result = await window.clui.rcStart(tabId, tab.claudeSessionId, tab.workingDirectory)
                        if (!result.ok) {
                          setRcActive(false)
                          useSessionStore.getState().addSystemMessage(`Remote Control failed to start: ${(result as any).error || 'unknown error'}`)
                        }
                      } catch (err: any) {
                        setRcActive(false)
                        useSessionStore.getState().addSystemMessage(`Remote Control failed to start: ${err.message || 'unknown error'}`)
                      }
                    }
                  }}
                  style={rcActive ? { color: colors.accent } : (!activeTab?.claudeSessionId ? { opacity: 0.4 } : undefined)}
                >
                  <Broadcast size={17} weight={rcActive ? 'fill' : 'regular'} />
                </button>
              </div>
            </div>
          </div>

          {/* Remote Control URL popup — overlays chat area */}
          <AnimatePresence>
            {rcActive && rcUrl && rcPopupVisible && (
              <motion.div
                data-clui-ui
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)',
                  background: colors.popoverBg, backdropFilter: 'blur(20px)',
                  border: `1px solid ${colors.popoverBorder}`,
                  borderRadius: 12, padding: '12px 16px', zIndex: 200,
                  display: 'flex', flexDirection: 'column', gap: 6,
                  boxShadow: colors.popoverShadow, width: 300,
                  pointerEvents: 'auto',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: colors.textPrimary, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Broadcast size={14} weight="fill" style={{ color: colors.accent }} />
                    {t('rc.title')}
                  </div>
                  <button
                    onClick={() => setRcPopupVisible(false)}
                    style={{ background: 'none', border: 'none', color: colors.textTertiary, cursor: 'pointer', padding: 2, lineHeight: 1, fontSize: 14 }}
                  >✕</button>
                </div>
                <div style={{ fontSize: 11, color: colors.textSecondary }}>{t('rc.subtitle')}</div>
                <input
                  readOnly
                  value={rcUrl}
                  onClick={(e) => e.currentTarget.select()}
                  style={{
                    fontSize: 11, padding: '6px 8px', borderRadius: 8,
                    border: `1px solid ${colors.containerBorder}`, background: colors.surfacePrimary,
                    color: colors.textPrimary, width: '100%', outline: 'none',
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(rcUrl) }}
                  style={{
                    fontSize: 11, padding: '5px 12px', borderRadius: 8,
                    border: 'none', background: colors.accent,
                    color: '#fff', cursor: 'pointer', alignSelf: 'flex-end',
                    fontWeight: 500,
                  }}
                >
                  {t('rc.copy')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

        </motion.div>
      </div>
    </PopoverLayerProvider>
  )
}
