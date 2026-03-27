import React, { useState, useCallback } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import { useColors } from '../theme'

interface SparkleEnhancerProps {
  /** Current text in the input field */
  input: string
  /** Ollama model ID to use (e.g. 'qwen3:1.7b') */
  model: string
  /** Called with the enhanced text on success */
  onEnhanced: (text: string) => void
  /** Called when loading state changes (true = started, false = done/error) */
  onEnhancing?: (isEnhancing: boolean) => void
  /** Disables the button (e.g. while Claude is running) */
  disabled?: boolean
}

type EnhancerState = 'idle' | 'loading' | 'error'

export function SparkleEnhancer({ input, model, onEnhanced, onEnhancing, disabled }: SparkleEnhancerProps) {
  const colors = useColors()
  const [state, setState] = useState<EnhancerState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const hasContent = input.trim().length > 0
  const isDisabled = disabled || !hasContent || state === 'loading'

  const handleClick = useCallback(async () => {
    if (isDisabled) return
    setState('loading')
    onEnhancing?.(true)
    setErrorMsg(null)
    try {
      const result = await window.clui.ollamaEnhancePrompt(model, input.trim())
      if (result.error) {
        setErrorMsg(result.error)
        setState('error')
        onEnhancing?.(false)
        setTimeout(() => setState('idle'), 3500)
      } else if (result.enhanced) {
        onEnhanced(result.enhanced)
        setState('idle')
        onEnhancing?.(false)
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Enhancement failed')
      setState('error')
      onEnhancing?.(false)
      setTimeout(() => setState('idle'), 3500)
    }
  }, [input, model, isDisabled, onEnhanced, onEnhancing])

  const isError = state === 'error'
  const baseColor = isError
    ? colors.statusError
    : colors.accent

  const opacity = !hasContent || disabled ? 0.2 : 0.55

  const tooltip = isError
    ? (errorMsg || 'Enhancement failed — is Ollama running?')
    : !hasContent
      ? 'Type something to enhance'
      : `Enhance prompt with AI (${model})`

  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={handleClick}
      disabled={isDisabled}
      title={tooltip}
      className="shrink-0 flex items-center justify-center rounded-lg transition-opacity"
      style={{
        width: 28,
        height: 28,
        background: 'none',
        border: 'none',
        cursor: isDisabled ? 'default' : 'pointer',
        opacity,
        transition: 'opacity 0.2s',
        padding: 0,
      }}
    >
      {state === 'loading' ? (
        <CircleNotch
          size={13}
          weight="bold"
          className="animate-spin"
          style={{ color: colors.accent }}
        />
      ) : (
        <SparkleCluster color={baseColor} />
      )}
    </button>
  )
}

/** Three 4-pointed stars (✦) of decreasing size, with staggered CSS pulse animation */
function SparkleCluster({ color }: { color: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      {/* Large star — center-left */}
      <path
        className="sparkle-1"
        d="M8 2L9.2 7.2L14 8L9.2 8.8L8 14L6.8 8.8L2 8L6.8 7.2Z"
        fill={color}
      />
      {/* Medium star — top-right */}
      <path
        className="sparkle-2"
        d="M16 1L16.9 4.6L20.5 5.5L16.9 6.4L16 10L15.1 6.4L11.5 5.5L15.1 4.6Z"
        fill={color}
      />
      {/* Small star — bottom-right */}
      <path
        className="sparkle-3"
        d="M17.5 13L18.1 15.4L20.5 16L18.1 16.6L17.5 19L16.9 16.6L14.5 16L16.9 15.4Z"
        fill={color}
      />
    </svg>
  )
}
