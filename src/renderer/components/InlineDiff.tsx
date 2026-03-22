import React, { useMemo, useState } from 'react'
import { useColors } from '../theme'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DiffLine {
  type: 'added' | 'removed' | 'context'
  content: string
}

interface ParsedEdit {
  kind: 'edit'
  oldString: string
  newString: string
}

interface ParsedWrite {
  kind: 'write'
  content: string
}

type ParsedInput = ParsedEdit | ParsedWrite | null

/* ------------------------------------------------------------------ */
/*  Safety limits                                                      */
/* ------------------------------------------------------------------ */

const MAX_INPUT_BYTES = 512 * 1024 // 512 KB
const MAX_LINES = 2000
const PREVIEW_LINES = 6

/* ------------------------------------------------------------------ */
/*  LCS-based diff (dynamic programming, Int32Array table)             */
/* ------------------------------------------------------------------ */

function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr ? oldStr.split('\n') : []
  const newLines = newStr ? newStr.split('\n') : []

  const m = oldLines.length
  const n = newLines.length

  if (m === 0 && n === 0) return []
  if (m === 0) return newLines.map((l) => ({ type: 'added' as const, content: l }))
  if (n === 0) return oldLines.map((l) => ({ type: 'removed' as const, content: l }))

  // Build LCS length table using a flat Int32Array for performance
  const dp = new Int32Array((m + 1) * (n + 1))
  const cols = n + 1

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i * cols + j] = dp[(i - 1) * cols + (j - 1)] + 1
      } else {
        dp[i * cols + j] = Math.max(dp[(i - 1) * cols + j], dp[i * cols + (j - 1)])
      }
    }
  }

  // Back-track to produce the diff
  const result: DiffLine[] = []
  let i = m
  let j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'context', content: oldLines[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i * cols + (j - 1)] >= dp[(i - 1) * cols + j])) {
      result.push({ type: 'added', content: newLines[j - 1] })
      j--
    } else {
      result.push({ type: 'removed', content: oldLines[i - 1] })
      i--
    }
  }

  return result.reverse()
}

/* ------------------------------------------------------------------ */
/*  Parsing helper                                                     */
/* ------------------------------------------------------------------ */

function parseToolInput(raw: string): ParsedInput {
  try {
    const obj = JSON.parse(raw)

    if (typeof obj.old_string === 'string' && typeof obj.new_string === 'string') {
      return { kind: 'edit', oldString: obj.old_string, newString: obj.new_string }
    }

    if (typeof obj.content === 'string') {
      return { kind: 'write', content: obj.content }
    }

    return null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function InlineDiff({ toolInput }: { toolInput: string }) {
  const colors = useColors()
  const [expanded, setExpanded] = useState(false)

  // Safety: reject oversized input before any work
  if (toolInput.length > MAX_INPUT_BYTES) return null

  const parsed = useMemo(() => parseToolInput(toolInput), [toolInput])

  const diffLines = useMemo<DiffLine[]>(() => {
    if (!parsed) return []

    if (parsed.kind === 'edit') {
      return computeDiff(parsed.oldString, parsed.newString)
    }

    // Write tool — every line is an addition
    const lines = parsed.content.split('\n')
    return lines.map((l) => ({ type: 'added' as const, content: l }))
  }, [parsed])

  // Safety: skip rendering if too many lines
  if (!parsed || diffLines.length === 0 || diffLines.length > MAX_LINES) return null

  const addedCount = diffLines.filter((d) => d.type === 'added').length
  const removedCount = diffLines.filter((d) => d.type === 'removed').length

  const visibleLines = expanded ? diffLines : diffLines.slice(0, PREVIEW_LINES)
  const hasMore = diffLines.length > PREVIEW_LINES

  /* ---- inline styles ---- */

  const lineStyle = (type: DiffLine['type']): React.CSSProperties => {
    switch (type) {
      case 'added':
        return { backgroundColor: 'rgba(74, 222, 128, 0.1)', color: '#4ade80' }
      case 'removed':
        return { backgroundColor: 'rgba(248, 113, 113, 0.1)', color: '#f87171' }
      case 'context':
        return { backgroundColor: 'transparent', color: colors.textSecondary }
    }
  }

  const prefix = (type: DiffLine['type']): string => {
    switch (type) {
      case 'added':
        return '+'
      case 'removed':
        return '-'
      case 'context':
        return ' '
    }
  }

  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${colors.containerBorder}`,
        overflow: 'hidden',
        fontFamily: 'monospace',
        fontSize: 11,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 10px',
          backgroundColor: colors.surfaceSecondary,
          color: colors.textSecondary,
          fontSize: 11,
          fontFamily: 'monospace',
          borderBottom: `1px solid ${colors.containerBorder}`,
        }}
      >
        {addedCount > 0 && <span style={{ color: '#4ade80' }}>+{addedCount} added</span>}
        {addedCount > 0 && removedCount > 0 && (
          <span style={{ color: colors.textMuted }}>/</span>
        )}
        {removedCount > 0 && <span style={{ color: '#f87171' }}>-{removedCount} removed</span>}
      </div>

      {/* Diff lines */}
      <div style={{ padding: '4px 0' }}>
        {visibleLines.map((line, idx) => (
          <div
            key={idx}
            style={{
              ...lineStyle(line.type),
              padding: '1px 10px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              lineHeight: '18px',
            }}
          >
            <span style={{ opacity: 0.5, marginRight: 6, userSelect: 'none' }}>
              {prefix(line.type)}
            </span>
            {line.content}
          </div>
        ))}
      </div>

      {/* Expand / collapse */}
      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: 'block',
            width: '100%',
            padding: '4px 10px',
            backgroundColor: 'transparent',
            border: 'none',
            borderTop: `1px solid ${colors.containerBorder}`,
            color: colors.accent,
            fontSize: 11,
            fontFamily: 'monospace',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {expanded ? 'Collapse' : `Show all (${diffLines.length} lines)`}
        </button>
      )}
    </div>
  )
}
