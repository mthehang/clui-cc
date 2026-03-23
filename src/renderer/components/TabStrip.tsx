import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Broadcast } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { HistoryPicker } from './HistoryPicker'
import { SettingsPopover } from './SettingsPopover'
import { useColors } from '../theme'
import { useT } from '../i18n'
import type { TabStatus } from '../../shared/types'

function StatusDot({ status, hasUnread, hasPermission, permissionCount }: { status: TabStatus; hasUnread: boolean; hasPermission: boolean; permissionCount: number }) {
  const colors = useColors()
  let bg: string = colors.statusIdle
  let pulse = false
  let glow = false

  if (status === 'dead' || status === 'failed') {
    bg = colors.statusError
  } else if (hasPermission) {
    bg = colors.statusPermission
    glow = true
  } else if (status === 'connecting' || status === 'running') {
    bg = colors.statusRunning
    pulse = true
  } else if (hasUnread) {
    bg = colors.statusComplete
  }

  return (
    <span className="relative flex-shrink-0 flex items-center">
      <span
        className={`w-[8px] h-[8px] rounded-full ${pulse ? 'animate-pulse-dot' : ''}`}
        style={{
          background: bg,
          ...(glow ? { boxShadow: `0 0 8px 3px ${colors.statusPermissionGlow}` } : {}),
        }}
      />
      {hasPermission && permissionCount > 0 && (
        <span
          className="absolute -top-1.5 -right-2 min-w-[12px] h-[12px] flex items-center justify-center rounded-full text-[7px] font-bold leading-none"
          style={{
            background: colors.statusPermission,
            color: '#fff',
          }}
        >
          {permissionCount > 9 ? '9+' : permissionCount}
        </span>
      )}
    </span>
  )
}

export function TabStrip({ rcActive, rcTabIds, onRcClick }: { rcActive?: boolean; rcTabIds?: Set<string>; onRcClick?: () => void }) {
  const tabs = useSessionStore((s) => s.tabs)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const selectTab = useSessionStore((s) => s.selectTab)
  const createTab = useSessionStore((s) => s.createTab)
  const closeTab = useSessionStore((s) => s.closeTab)
  const colors = useColors()
  const t = useT()

  return (
    <div
      data-clui-ui
      className="flex items-center no-drag"
      style={{ padding: '8px 0' }}
    >
      {/* Scrollable tabs area — clipped by master card edge */}
      <div className="relative min-w-0 flex-1">
        <div
          className="flex items-center gap-1 overflow-x-auto min-w-0"
          style={{
            scrollbarWidth: 'none',
            paddingLeft: 8,
            // Extra right breathing room so clipped tabs fade out before the edge.
            paddingRight: 14,
            // Right-only content fade so the parent card's own animated background
            // shows through cleanly in both collapsed and expanded states.
            maskImage: 'linear-gradient(to right, black 0%, black calc(100% - 40px), transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black calc(100% - 40px), transparent 100%)',
          }}
        >
          <AnimatePresence mode="popLayout">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId
              return (
                <motion.div
                  key={tab.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => selectTab(tab.id)}
                  className="group flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0 max-w-[160px] transition-all duration-150"
                  style={{
                    background: isActive ? colors.tabActive : 'transparent',
                    border: isActive ? `1px solid ${colors.tabActiveBorder}` : '1px solid transparent',
                    borderRadius: 9999,
                    padding: '4px 10px',
                    fontSize: 12,
                    color: isActive ? colors.textPrimary : colors.textTertiary,
                    fontWeight: isActive ? 500 : 400,
                  }}
                >
                  <StatusDot status={tab.status} hasUnread={tab.hasUnread} hasPermission={tab.permissionQueue.length > 0} permissionCount={tab.permissionQueue.length} />
                  <span className="truncate flex-1">{tab.title}</span>
                  {rcTabIds?.has(tab.id) && (
                    <Broadcast size={10} weight="fill" style={{ color: colors.accent, flexShrink: 0 }} />
                  )}
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                      className="flex-shrink-0 rounded-full w-4 h-4 flex items-center justify-center transition-opacity"
                      style={{
                        opacity: isActive ? 0.5 : 0,
                        color: colors.textSecondary,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = isActive ? '0.5' : '0' }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Pinned action buttons — always visible on the right */}
      <div className="flex items-center gap-0.5 flex-shrink-0 ml-1 pr-2">
        {rcActive && (
          <button
            onClick={onRcClick}
            className="flex items-center justify-center w-6 h-6 rounded-full transition-colors"
            style={{ color: colors.accent }}
            title={t('tabs.rc.show')}
          >
            <Broadcast size={14} weight="fill" />
          </button>
        )}
        <button
          onClick={() => createTab()}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors"
          style={{ color: colors.textTertiary }}
          title={t('tabs.new')}
        >
          <Plus size={14} />
        </button>

        <HistoryPicker />

        <SettingsPopover />
      </div>
    </div>
  )
}
