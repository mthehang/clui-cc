import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Clock, ChatCircle, FolderOpen } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../theme'
import { useT } from '../i18n'
import type { SessionMeta } from '../../shared/types'

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

/** Get last folder name from a path */
function lastFolder(fullPath: string): string {
  if (!fullPath || fullPath === '~') return '~'
  const parts = fullPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || fullPath
}

export function HistoryPicker() {
  const t = useT()
  const resumeSession = useSessionStore((s) => s.resumeSession)
  const isExpanded = useSessionStore((s) => s.isExpanded)
  const activeTab = useSessionStore(
    (s) => s.tabs.find((t) => t.id === s.activeTabId)
  )
  const staticInfo = useSessionStore((s) => s.staticInfo)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [showAll, setShowAll] = useState(!activeTab?.hasChosenDirectory)
  const effectiveProjectPath = activeTab?.hasChosenDirectory
    ? activeTab.workingDirectory
    : (staticInfo?.homePath || activeTab?.workingDirectory || '~')

  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number; maxHeight?: number }>({ right: 0 })

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    if (isExpanded) {
      const top = rect.bottom + 6
      setPos({
        top,
        right: window.innerWidth - rect.right,
        maxHeight: window.innerHeight - top - 12,
      })
    } else {
      setPos({
        bottom: window.innerHeight - rect.top + 6,
        right: window.innerWidth - rect.right,
      })
    }
  }, [isExpanded])

  const loadSessions = useCallback(async () => {
    setLoading(true)
    try {
      if (showAll) {
        const result = await window.clui.listAllSessions()
        setSessions(result)
      } else {
        const result = await window.clui.listSessions(effectiveProjectPath)
        setSessions(result)
      }
    } catch {
      setSessions([])
    }
    setLoading(false)
  }, [effectiveProjectPath, showAll])

  useEffect(() => {
    if (open) void loadSessions()
  }, [showAll, open, loadSessions])

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
    if (!open) {
      updatePos()
    }
    setOpen((o) => !o)
  }

  const handleSelect = (session: SessionMeta) => {
    setOpen(false)
    const title = session.firstMessage
      ? (session.firstMessage.length > 30 ? session.firstMessage.substring(0, 27) + '...' : session.firstMessage)
      : session.slug || 'Resumed'
    // Use the session's original projectPath if available (unified history)
    const resumePath = session.projectPath || effectiveProjectPath
    void resumeSession(session.sessionId, title, resumePath, session.encodedPath)
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors"
        style={{ color: colors.textTertiary }}
        title={t('history.resume')}
      >
        <Clock size={13} />
      </button>

      {popoverLayer && open && createPortal(
        <motion.div
          ref={popoverRef}
          data-clui-ui
          initial={{ opacity: 0, y: isExpanded ? -4 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: isExpanded ? -4 : 4 }}
          transition={{ duration: 0.12 }}
          className="rounded-xl"
          style={{
            position: 'fixed',
            ...(pos.top != null ? { top: pos.top } : {}),
            ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
            right: pos.right,
            width: 300,
            pointerEvents: 'auto',
            background: colors.popoverBg,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: colors.popoverShadow,
            border: `1px solid ${colors.popoverBorder}`,
            ...(pos.maxHeight != null ? { maxHeight: pos.maxHeight } : {}),
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column' as const,
          }}
        >
          {/* Header with toggle */}
          <div className="px-3 py-2 flex items-center justify-between flex-shrink-0" style={{ borderBottom: `1px solid ${colors.popoverBorder}` }}>
            <span className="text-[11px] font-medium" style={{ color: colors.textTertiary }}>
              {t('history.title')}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowAll(false)}
                className="text-[10px] px-1.5 py-0.5 rounded-md transition-colors"
                style={{
                  color: !showAll ? colors.textPrimary : colors.textTertiary,
                  background: !showAll ? colors.accent + '22' : 'transparent',
                  fontWeight: !showAll ? 600 : 400,
                }}
              >
                {t('history.current') || 'Current'}
              </button>
              <button
                onClick={() => setShowAll(true)}
                className="text-[10px] px-1.5 py-0.5 rounded-md transition-colors"
                style={{
                  color: showAll ? colors.textPrimary : colors.textTertiary,
                  background: showAll ? colors.accent + '22' : 'transparent',
                  fontWeight: showAll ? 600 : 400,
                }}
              >
                {t('history.all') || 'All'}
              </button>
            </div>
          </div>

          <div className="overflow-y-auto py-1" style={{ maxHeight: pos.maxHeight != null ? undefined : 240 }}>
            {loading && (
              <div className="px-3 py-4 text-center text-[11px]" style={{ color: colors.textTertiary }}>
                Loading...
              </div>
            )}

            {!loading && sessions.length === 0 && (
              <div className="px-3 py-4 text-center text-[11px]" style={{ color: colors.textTertiary }}>
                {t('history.empty')}
              </div>
            )}

            {!loading && sessions.map((session) => (
              <button
                key={session.sessionId}
                onClick={() => handleSelect(session)}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors"
              >
                <ChatCircle size={13} className="flex-shrink-0 mt-0.5" style={{ color: colors.textTertiary }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] truncate" style={{ color: colors.textPrimary }}>
                    {session.firstMessage || session.slug || session.sessionId.substring(0, 8)}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] mt-0.5" style={{ color: colors.textTertiary }}>
                    <span>{formatTimeAgo(session.lastTimestamp)}</span>
                    <span>{formatSize(session.size)}</span>
                    {showAll && session.projectPath && (
                      <span className="flex items-center gap-0.5 truncate" title={session.projectPath}>
                        <FolderOpen size={9} />
                        {lastFolder(session.projectPath)}
                      </span>
                    )}
                    {!showAll && session.slug && <span className="truncate">{session.slug}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </motion.div>,
        popoverLayer,
      )}
    </>
  )
}
