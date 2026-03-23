import React, { useEffect } from 'react'
import { X, ChartBar, ArrowClockwise, CurrencyDollar, Clock, Lightning } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'
import { useT } from '../i18n'

function fmt(n: number, decimals = 2): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(decimals)
}

function fmtDuration(ms: number): string {
  if (ms < 1_000) return ms + 'ms'
  const s = ms / 1_000
  if (s < 60) return s.toFixed(1) + 's'
  const m = Math.floor(s / 60)
  const rs = Math.round(s % 60)
  return `${m}m ${rs}s`
}

function fmtTimeUntil(timestamp: number | null): string {
  if (!timestamp) return ''
  const diff = timestamp - Date.now()
  if (diff <= 0) return 'Reiniciando...'
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const rh = hours % 24
    return `Reinicia em ${days}d ${rh}h`
  }
  if (hours > 0) return `Reinicia em ${hours}h ${minutes}min`
  return `Reinicia em ${minutes}min`
}

function fmtTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return 'agora'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `ha ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `ha ${hours}h ${minutes % 60}min`
}

function UsageBar({
  label,
  current,
  limit,
  resetsAt,
  accentColor,
  colors,
}: {
  label: string
  current: number
  limit: number
  resetsAt: number | null
  accentColor: string
  colors: ReturnType<typeof useColors>
}) {
  const pct = limit > 0 ? Math.min((current / limit) * 100, 100) : 0
  const isHigh = pct >= 80

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: colors.textPrimary }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: isHigh ? '#ef4444' : colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div
        style={{
          width: '100%',
          height: 8,
          borderRadius: 4,
          background: colors.surfaceSecondary,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 4,
            background: isHigh ? '#ef4444' : accentColor,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      {resetsAt && (
        <div style={{ fontSize: 10, color: colors.textTertiary, marginTop: 3 }}>
          {fmtTimeUntil(resetsAt)}
        </div>
      )}
    </div>
  )
}

export function UsagePanel() {
  const colors = useColors()
  const t = useT()
  const tabs = useSessionStore((s) => s.tabs)
  const closeUsagePanel = useSessionStore((s) => s.closeUsagePanel)
  const cloudUsage = useSessionStore((s) => s.cloudUsage)
  const cloudUsageLoading = useSessionStore((s) => s.cloudUsageLoading)
  const fetchCloudUsage = useSessionStore((s) => s.fetchCloudUsage)

  // Fetch cloud usage on mount
  useEffect(() => {
    fetchCloudUsage()
  }, [fetchCloudUsage])

  // Aggregate local usage across all tabs
  const totals = tabs.reduce(
    (acc, t) => {
      const cu = t.cumulativeUsage
      acc.cost += cu.totalCostUsd
      acc.duration += cu.totalDurationMs
      acc.turns += cu.totalTurns
      acc.input += cu.totalInputTokens
      acc.output += cu.totalOutputTokens
      acc.runs += cu.runCount
      return acc
    },
    { cost: 0, duration: 0, turns: 0, input: 0, output: 0, runs: 0 },
  )

  const accentColor = colors.accent || '#d97757'
  const hasBars = cloudUsage && cloudUsage.bars.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 420 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px 10px',
          borderBottom: `1px solid ${colors.containerBorder}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ChartBar size={16} weight="bold" style={{ color: accentColor }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{t('usage.session')}</span>
          {cloudUsage?.subscriptionType && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: accentColor,
                background: accentColor + '18',
                borderRadius: 4,
                padding: '2px 6px',
              }}
            >
              {cloudUsage.subscriptionType}
            </span>
          )}
        </div>
        <button
          onClick={closeUsagePanel}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 6,
            color: colors.textTertiary,
            display: 'flex',
            alignItems: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.textPrimary }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textTertiary }}
        >
          <X size={14} weight="bold" />
        </button>
      </div>

      {/* Body */}
      <div className="mp-scroll" style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 14px' }}>

        {/* Cloud usage bars */}
        {hasBars && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              {t('usage.title')}
            </div>
            {cloudUsage!.bars.map((bar, i) => (
              <UsageBar
                key={`${bar.label}-${i}`}
                label={bar.label}
                current={bar.current}
                limit={bar.limit}
                resetsAt={bar.resetsAt}
                accentColor={accentColor}
                colors={colors}
              />
            ))}
          </div>
        )}

        {/* Cloud unavailable note */}
        {cloudUsage && !hasBars && cloudUsage.error && (
          <div
            style={{
              fontSize: 11,
              color: colors.textTertiary,
              background: colors.surfaceSecondary,
              borderRadius: 8,
              padding: '8px 12px',
              marginBottom: 14,
            }}
          >
            {cloudUsage.error}
          </div>
        )}

        {/* Divider */}
        {(hasBars || cloudUsage?.error) && (
          <div style={{ height: 1, background: colors.containerBorder, marginBottom: 14 }} />
        )}

        {/* Local session usage — compact row */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            {t('usage.cumulative')}
          </div>
          {totals.runs > 0 ? (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <CurrencyDollar size={13} weight="bold" style={{ color: accentColor }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>${fmt(totals.cost, 4)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Lightning size={13} weight="bold" style={{ color: '#60a5fa' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{fmt(totals.input + totals.output, 0)} tok</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Clock size={13} weight="bold" style={{ color: '#34d399' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{fmtDuration(totals.duration)}</span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: colors.textTertiary }}>
              {t('history.empty')}
            </div>
          )}
        </div>

        {/* Footer: last updated + refresh */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 10,
            borderTop: `1px solid ${colors.containerBorder}`,
          }}
        >
          <span style={{ fontSize: 10, color: colors.textTertiary }}>
            {cloudUsage
              ? `Ultima atualizacao: ${fmtTimeAgo(cloudUsage.lastUpdated)}`
              : 'Dados do plano nao carregados'}
          </span>
          <button
            onClick={() => fetchCloudUsage(true)}
            disabled={cloudUsageLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              cursor: cloudUsageLoading ? 'wait' : 'pointer',
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 500,
              color: cloudUsageLoading ? colors.textTertiary : accentColor,
              transition: 'opacity 0.2s',
              opacity: cloudUsageLoading ? 0.6 : 1,
            }}
          >
            <ArrowClockwise
              size={12}
              weight="bold"
              style={{
                animation: cloudUsageLoading ? 'spin 1s linear infinite' : 'none',
              }}
            />
            {cloudUsageLoading ? t('settings.update.checking') : t('settings.update.check')}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
