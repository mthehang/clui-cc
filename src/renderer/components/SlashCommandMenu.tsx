import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  Trash, Cpu, CurrencyDollar, Question, HardDrives, Sparkle,
  GearSix, ArrowsInSimple, Notepad, Info, ShieldCheck, FilePlus,
  SignIn, SignOut, Stethoscope, Bug,
} from '@phosphor-icons/react'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../theme'
import { useT } from '../i18n'

export interface SlashCommand {
  command: string
  description: string
  i18nKey?: string
  icon: React.ReactNode
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/clear', description: 'Clear conversation history', i18nKey: 'cmd.clear', icon: <Trash size={13} /> },
  { command: '/cost', description: 'Show token usage and cost', i18nKey: 'cmd.cost', icon: <CurrencyDollar size={13} /> },
  { command: '/model', description: 'Show current model info', i18nKey: 'cmd.model', icon: <Cpu size={13} /> },
  { command: '/mcp', description: 'Show MCP server status', i18nKey: 'cmd.mcp', icon: <HardDrives size={13} /> },
  { command: '/skills', description: 'Show available skills', i18nKey: 'cmd.skills', icon: <Sparkle size={13} /> },
  { command: '/help', description: 'Show available commands', i18nKey: 'cmd.help', icon: <Question size={13} /> },
  { command: '/config', description: 'Open settings', i18nKey: 'cmd.config', icon: <GearSix size={13} /> },
  { command: '/compact', description: 'Compact conversation context', i18nKey: 'cmd.compact', icon: <ArrowsInSimple size={13} /> },
  { command: '/memory', description: 'Edit CLAUDE.md rules', i18nKey: 'cmd.memory', icon: <Notepad size={13} /> },
  { command: '/status', description: 'Show session status', i18nKey: 'cmd.status', icon: <Info size={13} /> },
  { command: '/permissions', description: 'Change permission mode', i18nKey: 'cmd.permissions', icon: <ShieldCheck size={13} /> },
  { command: '/init', description: 'Generate CLAUDE.md for project', i18nKey: 'cmd.init', icon: <FilePlus size={13} /> },
  { command: '/login', description: 'Authenticate with Anthropic', i18nKey: 'cmd.login', icon: <SignIn size={13} /> },
  { command: '/logout', description: 'Sign out', i18nKey: 'cmd.logout', icon: <SignOut size={13} /> },
  { command: '/doctor', description: 'Run diagnostics', i18nKey: 'cmd.doctor', icon: <Stethoscope size={13} /> },
  { command: '/bug', description: 'Report a bug', i18nKey: 'cmd.bug', icon: <Bug size={13} /> },
]

interface Props {
  filter: string
  selectedIndex: number
  onSelect: (cmd: SlashCommand) => void
  anchorRect: DOMRect | null
  extraCommands?: SlashCommand[]
}

export function getFilteredCommands(filter: string): SlashCommand[] {
  return getFilteredCommandsWithExtras(filter, [])
}

export function getFilteredCommandsWithExtras(filter: string, extraCommands: SlashCommand[]): SlashCommand[] {
  const q = filter.toLowerCase()
  const merged: SlashCommand[] = [...SLASH_COMMANDS]
  for (const cmd of extraCommands) {
    if (!merged.some((c) => c.command === cmd.command)) {
      merged.push(cmd)
    }
  }
  return merged.filter((c) => c.command.startsWith(q))
}

export function SlashCommandMenu({ filter, selectedIndex, onSelect, anchorRect, extraCommands = [] }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const popoverLayer = usePopoverLayer()
  const filtered = getFilteredCommandsWithExtras(filter, extraCommands)
  const colors = useColors()
  const t = useT()

  useEffect(() => {
    if (!listRef.current) return
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (filtered.length === 0 || !anchorRect || !popoverLayer) return null

  return createPortal(
    <motion.div
      data-clui-ui
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.12 }}
      style={{
        position: 'fixed',
        bottom: window.innerHeight - anchorRect.top + 4,
        left: anchorRect.left + 12,
        right: window.innerWidth - anchorRect.right + 12,
        pointerEvents: 'auto',
      }}
    >
      <div
        ref={listRef}
        className="overflow-y-auto rounded-xl py-1"
        style={{
          maxHeight: 220,
          background: colors.popoverBg,
          backdropFilter: 'blur(20px)',
          border: `1px solid ${colors.popoverBorder}`,
          boxShadow: colors.popoverShadow,
        }}
      >
        {filtered.map((cmd, i) => {
          const isSelected = i === selectedIndex
          return (
            <button
              key={cmd.command}
              onClick={() => onSelect(cmd)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors"
              style={{
                background: isSelected ? colors.accentLight : 'transparent',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = colors.accentLight
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                }
              }}
            >
              <span
                className="flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0"
                style={{
                  background: isSelected ? colors.accentSoft : colors.surfaceHover,
                  color: isSelected ? colors.accent : colors.textTertiary,
                }}
              >
                {cmd.icon}
              </span>
              <div className="min-w-0 flex-1">
                <span
                  className="text-[12px] font-mono font-medium"
                  style={{ color: isSelected ? colors.accent : colors.textPrimary }}
                >
                  {cmd.command}
                </span>
                <span
                  className="text-[11px] ml-2"
                  style={{ color: colors.textTertiary }}
                >
                  {cmd.i18nKey ? t(cmd.i18nKey) : cmd.description}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </motion.div>,
    popoverLayer,
  )
}
