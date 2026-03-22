import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Microphone, ArrowUp, SpinnerGap, X, Check } from '@phosphor-icons/react'
import { useSessionStore, AVAILABLE_MODELS } from '../stores/sessionStore'
import { AttachmentChips } from './AttachmentChips'
import { SlashCommandMenu, getFilteredCommandsWithExtras, type SlashCommand } from './SlashCommandMenu'
import { useColors, useThemeStore } from '../theme'

const INPUT_MIN_HEIGHT = 20
const INPUT_MAX_HEIGHT = 140
const MULTILINE_ENTER_HEIGHT = 52
const MULTILINE_EXIT_HEIGHT = 50
const INLINE_CONTROLS_RESERVED_WIDTH = 104

type VoiceState = 'idle' | 'recording' | 'transcribing'

/**
 * InputBar renders inside a glass-surface rounded-full pill provided by App.tsx.
 * It provides: textarea + mic/send buttons. Attachment chips render above when present.
 */
export function InputBar() {
  const [input, setInput] = useState('')
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [slashFilter, setSlashFilter] = useState<string | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [isMultiLine, setIsMultiLine] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLTextAreaElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [audioLevel, setAudioLevel] = useState(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const animFrameRef = useRef<number>(0)
  const silenceStartRef = useRef<number>(0)
  const frequencyDataRef = useRef<Uint8Array | null>(null)

  const sendMessage = useSessionStore((s) => s.sendMessage)
  const clearTab = useSessionStore((s) => s.clearTab)
  const addSystemMessage = useSessionStore((s) => s.addSystemMessage)
  const addAttachments = useSessionStore((s) => s.addAttachments)
  const removeAttachment = useSessionStore((s) => s.removeAttachment)

  const setPreferredModel = useSessionStore((s) => s.setPreferredModel)
  const staticInfo = useSessionStore((s) => s.staticInfo)
  const preferredModel = useSessionStore((s) => s.preferredModel)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const tab = useSessionStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const colors = useColors()
  const micDeviceId = useThemeStore((s) => s.micDeviceId)
  const isBusy = tab?.status === 'running' || tab?.status === 'connecting'
  const isConnecting = tab?.status === 'connecting'
  const hasContent = input.trim().length > 0 || (tab?.attachments?.length ?? 0) > 0
  const canSend = !!tab && !isConnecting && hasContent
  const attachments = tab?.attachments || []
  const showSlashMenu = slashFilter !== null && !isConnecting
  const localSkills = useSessionStore((s) => s.localSkills)
  const skillCommands: SlashCommand[] = useMemo(() => {
    const sessionNames = new Set(tab?.sessionSkills || [])
    const sessionCmds: SlashCommand[] = (tab?.sessionSkills || []).map((skill) => ({
      command: `/${skill}`,
      description: `Run skill: ${skill}`,
      icon: <span className="text-[11px]">✦</span>,
    }))
    const localCmds: SlashCommand[] = localSkills
      .filter((ls) => !sessionNames.has(ls.name))
      .map((ls) => ({
        command: `/${ls.name}`,
        description: ls.description || (ls.source === 'command' ? 'Custom command' : 'Local skill'),
        icon: <span className="text-[11px]">{ls.source === 'command' ? '\u2318' : '\u2726'}</span>,
      }))
    return [...sessionCmds, ...localCmds]
  }, [tab?.sessionSkills, localSkills])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [activeTabId])

  // Focus textarea when window is shown (shortcut toggle, screenshot return)
  useEffect(() => {
    const unsub = window.clui.onWindowShown(() => {
      textareaRef.current?.focus()
    })
    return unsub
  }, [])

  const measureInlineHeight = useCallback((value: string): number => {
    if (typeof document === 'undefined') return 0
    if (!measureRef.current) {
      const m = document.createElement('textarea')
      m.setAttribute('aria-hidden', 'true')
      m.tabIndex = -1
      m.style.position = 'absolute'
      m.style.top = '-99999px'
      m.style.left = '0'
      m.style.height = '0'
      m.style.minHeight = '0'
      m.style.overflow = 'hidden'
      m.style.visibility = 'hidden'
      m.style.pointerEvents = 'none'
      m.style.zIndex = '-1'
      m.style.resize = 'none'
      m.style.border = '0'
      m.style.outline = '0'
      m.style.boxSizing = 'border-box'
      document.body.appendChild(m)
      measureRef.current = m
    }

    const m = measureRef.current
    const hostWidth = wrapperRef.current?.clientWidth ?? 0
    const inlineWidth = Math.max(120, hostWidth - INLINE_CONTROLS_RESERVED_WIDTH)
    m.style.width = `${inlineWidth}px`
    m.style.fontSize = '14px'
    m.style.lineHeight = '20px'
    m.style.paddingTop = '15px'
    m.style.paddingBottom = '15px'
    m.style.paddingLeft = '0'
    m.style.paddingRight = '0'

    const computed = textareaRef.current ? window.getComputedStyle(textareaRef.current) : null
    if (computed) {
      m.style.fontFamily = computed.fontFamily
      m.style.letterSpacing = computed.letterSpacing
      m.style.fontWeight = computed.fontWeight
    }

    m.value = value || ' '
    return m.scrollHeight
  }, [])

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = `${INPUT_MIN_HEIGHT}px`
    const naturalHeight = el.scrollHeight
    const clampedHeight = Math.min(naturalHeight, INPUT_MAX_HEIGHT)
    el.style.height = `${clampedHeight}px`
    el.style.overflowY = naturalHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden'
    if (naturalHeight <= INPUT_MAX_HEIGHT) {
      el.scrollTop = 0
    }
    // Decide multiline mode against fixed inline-width measurement to avoid
    // expand/collapse bounce when layout switches between modes.
    const inlineHeight = measureInlineHeight(input)
    setIsMultiLine((prev) => {
      if (!prev) return inlineHeight > MULTILINE_ENTER_HEIGHT
      return inlineHeight > MULTILINE_EXIT_HEIGHT
    })
  }, [input, measureInlineHeight])

  useLayoutEffect(() => { autoResize() }, [input, isMultiLine, autoResize])

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
      if (measureRef.current) {
        measureRef.current.remove()
        measureRef.current = null
      }
    }
  }, [])

  // ─── Slash command detection ───
  const updateSlashFilter = useCallback((value: string) => {
    const match = value.match(/^(\/[a-zA-Z-]*)$/)
    if (match) {
      setSlashFilter(match[1])
      setSlashIndex(0)
    } else {
      setSlashFilter(null)
    }
  }, [])

  // ─── Handle slash commands ───
  const executeCommand = useCallback((cmd: SlashCommand) => {
    switch (cmd.command) {
      case '/clear':
        clearTab()
        addSystemMessage('Conversation cleared.')
        break
      case '/cost': {
        if (tab?.lastResult) {
          const r = tab.lastResult
          const parts = [`$${r.totalCostUsd.toFixed(4)}`, `${(r.durationMs / 1000).toFixed(1)}s`, `${r.numTurns} turn${r.numTurns !== 1 ? 's' : ''}`]
          if (r.usage.input_tokens) {
            parts.push(`${r.usage.input_tokens.toLocaleString()} in / ${(r.usage.output_tokens || 0).toLocaleString()} out`)
          }
          addSystemMessage(parts.join(' · '))
        } else {
          addSystemMessage('No cost data yet — send a message first.')
        }
        break
      }
      case '/model': {
        const model = tab?.sessionModel || null
        const version = tab?.sessionVersion || staticInfo?.version || null
        const current = preferredModel || model || 'default'
        const lines = AVAILABLE_MODELS.map((m) => {
          const active = m.id === current || (!preferredModel && m.id === model)
          return `  ${active ? '\u25CF' : '\u25CB'} ${m.label} (${m.id})`
        })
        const header = version ? `Claude Code ${version}` : 'Claude Code'
        addSystemMessage(`${header}\n\n${lines.join('\n')}\n\nSwitch model: type /model <name>\n  e.g. /model sonnet`)
        break
      }
      case '/mcp': {
        if (tab?.sessionMcpServers && tab.sessionMcpServers.length > 0) {
          const lines = tab.sessionMcpServers.map((s) => {
            const icon = s.status === 'connected' ? '\u2713' : s.status === 'failed' ? '\u2717' : '\u25CB'
            return `  ${icon} ${s.name} — ${s.status}`
          })
          addSystemMessage(`MCP Servers (${tab.sessionMcpServers.length}):\n${lines.join('\n')}`)
        } else if (tab?.claudeSessionId) {
          addSystemMessage('No MCP servers connected in this session.')
        } else {
          addSystemMessage('No MCP data yet — send a message to start a session.')
        }
        break
      }
      case '/skills': {
        if (tab?.sessionSkills && tab.sessionSkills.length > 0) {
          const lines = tab.sessionSkills.map((s) => `/${s}`)
          addSystemMessage(`Available skills (${tab.sessionSkills.length}):\n${lines.join('\n')}`)
        } else if (tab?.claudeSessionId) {
          addSystemMessage('No skills available in this session.')
        } else {
          addSystemMessage('No session metadata yet — send a message first.')
        }
        break
      }
      case '/help': {
        const lines = [
          '/clear — Clear conversation history',
          '/cost — Show token usage and cost',
          '/model — Show model info & switch models',
          '/mcp — Show MCP server status',
          '/skills — Show available skills',
          '/help — Show this list',
        ]
        addSystemMessage(lines.join('\n'))
        break
      }
    }
  }, [tab, clearTab, addSystemMessage, staticInfo, preferredModel])

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    const cmdName = cmd.command.replace(/^\//, '')
    const isSessionSkill = !!tab?.sessionSkills?.includes(cmdName)
    const isLocalSkill = localSkills.some((ls) => ls.name === cmdName)
    if (isSessionSkill || isLocalSkill) {
      setInput(`${cmd.command} `)
      setSlashFilter(null)
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    setInput('')
    setSlashFilter(null)
    executeCommand(cmd)
  }, [executeCommand, tab?.sessionSkills, localSkills])

  // ─── Send ───
  const handleSend = useCallback(() => {
    if (showSlashMenu) {
      const filtered = getFilteredCommandsWithExtras(slashFilter!, skillCommands)
      if (filtered.length > 0) {
        handleSlashSelect(filtered[slashIndex])
        return
      }
    }
    const prompt = input.trim()
    const modelMatch = prompt.match(/^\/model\s+(\S+)/i)
    if (modelMatch) {
      const query = modelMatch[1].toLowerCase()
      const match = AVAILABLE_MODELS.find((m: { id: string; label: string }) =>
        m.id.toLowerCase().includes(query) || m.label.toLowerCase().includes(query)
      )
      if (match) {
        setPreferredModel(match.id)
        setInput('')
        setSlashFilter(null)
        addSystemMessage(`Model switched to ${match.label} (${match.id})`)
      } else {
        setInput('')
        setSlashFilter(null)
        addSystemMessage(`Unknown model "${modelMatch[1]}". Available: opus, sonnet, haiku`)
      }
      return
    }
    if (!prompt && attachments.length === 0) return
    if (isConnecting) return
    setInput('')
    setSlashFilter(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = `${INPUT_MIN_HEIGHT}px`
    }
    sendMessage(prompt || 'See attached files')
    // Refocus after React re-renders from the state update
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [input, isBusy, sendMessage, attachments.length, showSlashMenu, slashFilter, slashIndex, handleSlashSelect])

  // ─── Keyboard ───
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu) {
      const filtered = getFilteredCommandsWithExtras(slashFilter!, skillCommands)
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => (i + 1) % filtered.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex((i) => (i - 1 + filtered.length) % filtered.length); return }
      if (e.key === 'Tab') { e.preventDefault(); if (filtered.length > 0) handleSlashSelect(filtered[slashIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); setSlashFilter(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape' && !showSlashMenu) { window.clui.hideWindow() }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    updateSlashFilter(value)
  }

  // ─── Paste image ───
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) return
        const reader = new FileReader()
        reader.onload = async () => {
          const dataUrl = reader.result as string
          const attachment = await window.clui.pasteImage(dataUrl)
          if (attachment) addAttachments([attachment])
        }
        reader.readAsDataURL(blob)
        return
      }
    }
  }, [addAttachments])

  // ─── Voice ───
  const cancelledRef = useRef(false)

  const stopRecording = useCallback(() => {
    cancelledRef.current = false
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
  }, [])

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
  }, [])

  const cleanupAudio = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    animFrameRef.current = 0
    setAudioLevel(0)
    silenceStartRef.current = 0
    frequencyDataRef.current = null
    if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {} }
    audioCtxRef.current = null
    analyserRef.current = null
  }, [])

  const startRecording = useCallback(async () => {
    setVoiceError(null)
    chunksRef.current = []
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
      })
    } catch {
      setVoiceError('Microphone permission denied.')
      return
    }

    // Set up audio analysis for level monitoring + silence detection
    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.3
    source.connect(analyser)
    audioCtxRef.current = audioCtx
    analyserRef.current = analyser
    silenceStartRef.current = 0

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    frequencyDataRef.current = dataArray
    const SILENCE_THRESHOLD = 0.06
    const SILENCE_TIMEOUT = 3000
    let hasSpoken = false

    const monitorLevels = () => {
      if (!analyserRef.current) return
      analyserRef.current.getByteFrequencyData(dataArray)
      // Calculate RMS-like level from frequency data (0-1 range)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i]
      const level = Math.sqrt(sum / dataArray.length) / 255
      setAudioLevel(level)

      // Silence detection: auto-stop after 3s of silence (only after user has spoken)
      if (level > SILENCE_THRESHOLD) {
        hasSpoken = true
        silenceStartRef.current = 0
      } else if (hasSpoken) {
        if (!silenceStartRef.current) silenceStartRef.current = Date.now()
        else if (Date.now() - silenceStartRef.current > SILENCE_TIMEOUT) {
          // Auto-stop after silence
          if (mediaRecorderRef.current?.state === 'recording') {
            cancelledRef.current = false
            mediaRecorderRef.current.stop()
          }
          return
        }
      }
      animFrameRef.current = requestAnimationFrame(monitorLevels)
    }
    animFrameRef.current = requestAnimationFrame(monitorLevels)

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = async () => {
      cleanupAudio()
      stream.getTracks().forEach((t) => t.stop())
      if (cancelledRef.current) { cancelledRef.current = false; setVoiceState('idle'); return }
      if (chunksRef.current.length === 0) { setVoiceState('idle'); return }
      setVoiceState('transcribing')
      try {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const wavBase64 = await blobToWavBase64(blob)
        const result = await window.clui.transcribeAudio(wavBase64)
        if (result.error) setVoiceError(result.error)
        else if (result.transcript) setInput((prev) => (prev ? `${prev} ${result.transcript}` : result.transcript!))
      } catch (err: any) { setVoiceError(`Voice failed: ${err.message}`) }
      finally { setVoiceState('idle') }
    }
    recorder.onerror = () => { cleanupAudio(); stream.getTracks().forEach((t) => t.stop()); setVoiceError('Recording failed.'); setVoiceState('idle') }
    mediaRecorderRef.current = recorder
    setVoiceState('recording')
    recorder.start()
  }, [micDeviceId, cleanupAudio])

  const handleVoiceToggle = useCallback(() => {
    if (voiceState === 'recording') stopRecording()
    else if (voiceState === 'idle') void startRecording()
  }, [voiceState, startRecording, stopRecording])

  // Global shortcut triggers transcription toggle via IPC
  useEffect(() => {
    const unsub = window.clui.onToggleTranscription(() => {
      handleVoiceToggle()
    })
    return unsub
  }, [handleVoiceToggle])

  const hasAttachments = attachments.length > 0

  return (
    <div ref={wrapperRef} data-clui-ui className="flex flex-col w-full relative">
      {/* Slash command menu */}
      <AnimatePresence>
        {showSlashMenu && (
          <SlashCommandMenu
            filter={slashFilter!}
            selectedIndex={slashIndex}
            onSelect={handleSlashSelect}
            anchorRect={wrapperRef.current?.getBoundingClientRect() ?? null}
            extraCommands={skillCommands}
          />
        )}
      </AnimatePresence>

      {/* Attachment chips — renders inside the pill, above textarea */}
      {hasAttachments && (
        <div style={{ paddingTop: 6, marginLeft: -6 }}>
          <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
        </div>
      )}

      {/* Single-line: inline controls. Multi-line: controls in bottom row */}
      <div className="w-full" style={{ minHeight: 50 }}>
        {isMultiLine ? (
          <div className="w-full">
            {voiceState === 'recording' ? (
              <div style={{ paddingTop: 11, paddingBottom: 2, minHeight: 50 }} className="flex items-center">
                <AudioWaveform analyserRef={analyserRef} colors={colors} />
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={
                  isConnecting
                    ? 'Initializing...'
                    : voiceState === 'transcribing'
                      ? 'Transcribing...'
                      : isBusy
                        ? 'Type to queue a message...'
                        : 'Ask Claude Code anything...'
                }
                rows={1}
                className="w-full bg-transparent resize-none"
                style={{
                  fontSize: 14,
                  lineHeight: '20px',
                  color: colors.textPrimary,
                  minHeight: 20,
                  maxHeight: INPUT_MAX_HEIGHT,
                  paddingTop: 11,
                  paddingBottom: 2,
                }}
              />
            )}

            <div className="flex items-center justify-end gap-1" style={{ marginTop: 0, paddingBottom: 4 }}>
              <VoiceButtons
                voiceState={voiceState}
                isConnecting={isConnecting}
                colors={colors}
                onToggle={handleVoiceToggle}
                onCancel={cancelRecording}
                onStop={stopRecording}
                audioLevel={audioLevel}
              />
              <AnimatePresence>
                {canSend && voiceState !== 'recording' && (
                  <motion.div key="send" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleSend}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                      style={{ background: colors.sendBg, color: colors.textOnAccent }}
                      title={isBusy ? 'Queue message' : 'Send (Enter)'}
                    >
                      <ArrowUp size={16} weight="bold" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        ) : (
          <div className="flex items-center w-full" style={{ minHeight: 50 }}>
            {voiceState === 'recording' ? (
              <div className="flex-1 flex items-center" style={{ minHeight: 20, paddingTop: 15, paddingBottom: 15 }}>
                <AudioWaveform analyserRef={analyserRef} colors={colors} />
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={
                  isConnecting
                    ? 'Initializing...'
                    : voiceState === 'transcribing'
                      ? 'Transcribing...'
                      : isBusy
                        ? 'Type to queue a message...'
                        : 'Ask Claude Code anything...'
                }
                rows={1}
                className="flex-1 bg-transparent resize-none"
                style={{
                  fontSize: 14,
                  lineHeight: '20px',
                  color: colors.textPrimary,
                  minHeight: 20,
                  maxHeight: INPUT_MAX_HEIGHT,
                  paddingTop: 15,
                  paddingBottom: 15,
                }}
              />
            )}

            <div className="flex items-center gap-1 shrink-0 ml-2">
              <VoiceButtons
                voiceState={voiceState}
                isConnecting={isConnecting}
                colors={colors}
                onToggle={handleVoiceToggle}
                onCancel={cancelRecording}
                onStop={stopRecording}
                audioLevel={audioLevel}
              />
              <AnimatePresence>
                {canSend && voiceState !== 'recording' && (
                  <motion.div key="send" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleSend}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                      style={{ background: colors.sendBg, color: colors.textOnAccent }}
                      title={isBusy ? 'Queue message' : 'Send (Enter)'}
                    >
                      <ArrowUp size={16} weight="bold" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* Voice error */}
      {voiceError && (
        <div className="px-1 pb-2 text-[11px]" style={{ color: colors.statusError }}>
          {voiceError}
        </div>
      )}
    </div>
  )
}

// ─── Audio Waveform Visualizer ───
// Organic, flowing waveform inspired by Claude/Anthropic's warm visual language.
// Renders layered sine-waves that respond to audio frequency data with smooth
// interpolation, subtle gradients, and a gentle idle breathing animation.

function AudioWaveform({ analyserRef, colors }: {
  analyserRef: React.RefObject<AnalyserNode | null>
  colors: ReturnType<typeof useColors>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  // Smoothed frequency band values persisted across frames
  const smoothedRef = useRef<Float32Array | null>(null)
  // Continuous phase offset for the idle breathing / wave motion
  const phaseRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Number of frequency bands we sample for the wave shape
    const BAND_COUNT = 64
    // Exponential smoothing factor (0 = frozen, 1 = raw). Lower = smoother.
    const LERP_UP = 0.18
    const LERP_DOWN = 0.08

    if (!smoothedRef.current) {
      smoothedRef.current = new Float32Array(BAND_COUNT)
    }

    const draw = () => {
      const analyser = analyserRef.current
      if (!analyser || !canvas) {
        animRef.current = requestAnimationFrame(draw)
        return
      }

      // --- Canvas setup (HiDPI) ---
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr
        canvas.height = rect.height * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const w = rect.width
      const h = rect.height
      ctx.clearRect(0, 0, w, h)

      // --- Frequency data ---
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(dataArray)

      const smoothed = smoothedRef.current!

      // Map frequency bins to our band count with voice-range emphasis
      for (let i = 0; i < BAND_COUNT; i++) {
        const t = i / BAND_COUNT
        // Non-linear mapping: emphasise lower/mid frequencies (voice range)
        const freqIndex = Math.min(
          dataArray.length - 1,
          Math.floor(Math.pow(t, 0.7) * dataArray.length * 0.55) + 2
        )
        const raw = (dataArray[freqIndex] || 0) / 255
        // Asymmetric smoothing: rise faster than fall for responsive-yet-fluid feel
        const lerp = raw > smoothed[i] ? LERP_UP : LERP_DOWN
        smoothed[i] += (raw - smoothed[i]) * lerp
      }

      // Advance continuous phase for organic wave drift
      phaseRef.current += 0.025
      const phase = phaseRef.current

      const centerY = h / 2
      const accent = colors.accent

      // --- Helper: sample smoothed amplitude at a normalised x position ---
      const sampleAmplitude = (nx: number): number => {
        const idx = nx * (BAND_COUNT - 1)
        const lo = Math.floor(idx)
        const hi = Math.min(lo + 1, BAND_COUNT - 1)
        const frac = idx - lo
        // Cubic-ish interpolation via cosine for extra smoothness
        const t = (1 - Math.cos(frac * Math.PI)) / 2
        return smoothed[lo] * (1 - t) + smoothed[hi] * t
      }

      // --- Draw layered organic waves ---
      // We draw three layers with decreasing opacity and slightly different
      // wave parameters to create a rich, Claude-style flowing effect.

      interface WaveLayer {
        amplitudeScale: number
        freqMult: number
        phaseOffset: number
        opacity: number
        lineWidth: number
        fill: boolean
      }

      const layers: WaveLayer[] = [
        // Background fill layer: wide, soft glow
        { amplitudeScale: 0.38, freqMult: 1.2, phaseOffset: 0, opacity: 0.12, lineWidth: 0, fill: true },
        // Mid layer: secondary wave shape
        { amplitudeScale: 0.34, freqMult: 1.8, phaseOffset: 1.2, opacity: 0.25, lineWidth: 1.5, fill: true },
        // Foreground stroke: crisp primary wave
        { amplitudeScale: 0.40, freqMult: 1.0, phaseOffset: 0.5, opacity: 0.85, lineWidth: 1.8, fill: false },
      ]

      for (const layer of layers) {
        const maxAmp = h * 0.5 * layer.amplitudeScale

        // Build top wave path points
        const steps = Math.ceil(w / 2) // ~1 point per 2 CSS px for smoothness
        const topPoints: { x: number; y: number }[] = []
        const botPoints: { x: number; y: number }[] = []

        for (let s = 0; s <= steps; s++) {
          const x = (s / steps) * w
          const nx = s / steps

          // Audio-driven amplitude — power curve amplifies low volumes for visible response
          const amp = Math.pow(sampleAmplitude(nx), 0.6)

          // Organic wave: combine two sine waves at different frequencies
          // plus a slow drift from the continuous phase
          const wave1 = Math.sin(nx * Math.PI * 2 * layer.freqMult + phase + layer.phaseOffset)
          const wave2 = Math.sin(nx * Math.PI * 3.3 * layer.freqMult + phase * 0.7 + layer.phaseOffset + 1.0) * 0.3
          const wave = wave1 + wave2

          // Edge fade: taper amplitude to zero at edges for a clean look
          const edgeFade = Math.sin(nx * Math.PI)
          // Minimum "idle breathing" amplitude so the wave never goes flat
          const idleBreath = (0.08 + 0.04 * Math.sin(phase * 0.6 + layer.phaseOffset)) * edgeFade
          const totalAmp = (amp * 0.85 + idleBreath) * edgeFade

          const displacement = wave * totalAmp * maxAmp

          topPoints.push({ x, y: centerY - displacement })
          botPoints.push({ x, y: centerY + displacement })
        }

        // --- Draw the upper wave ---
        ctx.save()
        ctx.globalAlpha = layer.opacity

        // Create gradient from center outward for warm glow
        const grad = ctx.createLinearGradient(0, centerY - maxAmp, 0, centerY + maxAmp)
        grad.addColorStop(0, accent)
        grad.addColorStop(0.5, accent)
        grad.addColorStop(1, accent)

        if (layer.fill) {
          // Filled shape: top wave -> bottom wave (mirrored)
          ctx.beginPath()
          ctx.moveTo(topPoints[0].x, centerY)

          // Smooth curve through top points
          for (let i = 0; i < topPoints.length - 1; i++) {
            const curr = topPoints[i]
            const next = topPoints[i + 1]
            const cpx = (curr.x + next.x) / 2
            ctx.quadraticCurveTo(curr.x, curr.y, cpx, (curr.y + next.y) / 2)
          }
          const lastTop = topPoints[topPoints.length - 1]
          ctx.lineTo(lastTop.x, centerY)

          // Bottom wave in reverse
          ctx.lineTo(botPoints[botPoints.length - 1].x, centerY)
          for (let i = botPoints.length - 1; i > 0; i--) {
            const curr = botPoints[i]
            const prev = botPoints[i - 1]
            const cpx = (curr.x + prev.x) / 2
            ctx.quadraticCurveTo(curr.x, curr.y, cpx, (curr.y + prev.y) / 2)
          }
          ctx.lineTo(botPoints[0].x, centerY)
          ctx.closePath()

          ctx.fillStyle = grad
          ctx.fill()
        } else {
          // Stroke only: draw top and bottom wave lines
          ctx.lineWidth = layer.lineWidth
          ctx.strokeStyle = grad
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'

          // Top wave stroke
          ctx.beginPath()
          ctx.moveTo(topPoints[0].x, topPoints[0].y)
          for (let i = 0; i < topPoints.length - 1; i++) {
            const curr = topPoints[i]
            const next = topPoints[i + 1]
            const cpx = (curr.x + next.x) / 2
            ctx.quadraticCurveTo(curr.x, curr.y, cpx, (curr.y + next.y) / 2)
          }
          ctx.stroke()

          // Bottom wave stroke (mirror)
          ctx.beginPath()
          ctx.moveTo(botPoints[0].x, botPoints[0].y)
          for (let i = 0; i < botPoints.length - 1; i++) {
            const curr = botPoints[i]
            const next = botPoints[i + 1]
            const cpx = (curr.x + next.x) / 2
            ctx.quadraticCurveTo(curr.x, curr.y, cpx, (curr.y + next.y) / 2)
          }
          ctx.stroke()
        }

        ctx.restore()
      }

      // --- Subtle center line: warm glow anchor ---
      ctx.save()
      ctx.globalAlpha = 0.08
      ctx.strokeStyle = accent
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(0, centerY)
      ctx.lineTo(w, centerY)
      ctx.stroke()
      ctx.restore()

      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [analyserRef, colors.accent])

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height: 28, display: 'block' }}
    />
  )
}

// ─── Voice Buttons (extracted to avoid duplication) ───

function VoiceButtons({ voiceState, isConnecting, colors, onToggle, onCancel, onStop, audioLevel }: {
  voiceState: VoiceState
  isConnecting: boolean
  colors: ReturnType<typeof useColors>
  onToggle: () => void
  onCancel: () => void
  onStop: () => void
  audioLevel: number
}) {
  // Clamp and scale audio level for visual feedback
  const level = Math.min(1, audioLevel * 4)

  return (
    <AnimatePresence mode="wait">
      {voiceState === 'recording' ? (
        <motion.div
          key="voice-controls"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.12 }}
          className="flex items-center gap-1"
        >
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={onCancel}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
            style={{ background: colors.surfaceHover, color: colors.textTertiary }}
            title="Cancel recording"
          >
            <X size={15} weight="bold" />
          </button>
          {/* Mic button with pulsing audio ring */}
          <div className="relative flex items-center justify-center" style={{ width: 36, height: 36 }}>
            {/* Outer glow ring — reacts to audio level */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                boxShadow: `0 0 ${4 + level * 14}px ${1 + level * 5}px ${colors.accent}${Math.round(30 + level * 50).toString(16).padStart(2, '0')}`,
                transform: `scale(${1 + level * 0.25})`,
                transition: 'transform 0.08s ease-out, box-shadow 0.08s ease-out',
              }}
            />
            {/* Inner ring border — opacity follows level */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                border: `2px solid ${colors.accent}`,
                opacity: 0.4 + level * 0.6,
                transform: `scale(${1 + level * 0.1})`,
                transition: 'transform 0.08s ease-out, opacity 0.08s ease-out',
              }}
            />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={onStop}
              className="w-9 h-9 rounded-full flex items-center justify-center relative z-10"
              style={{ background: colors.accent, color: colors.textOnAccent }}
              title="Stop recording"
            >
              <Microphone size={16} weight="fill" />
            </button>
          </div>
        </motion.div>
      ) : voiceState === 'transcribing' ? (
        <motion.div key="transcribing" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
          <button
            disabled
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: colors.micBg, color: colors.micColor }}
          >
            <SpinnerGap size={16} className="animate-spin" />
          </button>
        </motion.div>
      ) : (
        <motion.div key="mic" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }}>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={onToggle}
            disabled={isConnecting}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
            style={{
              background: colors.micBg,
              color: isConnecting ? colors.micDisabled : colors.micColor,
            }}
            title="Voice input"
          >
            <Microphone size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Audio conversion: WebM blob → WAV base64 ───

async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const audioCtx = new AudioContext()
  const decoded = await audioCtx.decodeAudioData(arrayBuffer)
  audioCtx.close()
  const mono = mixToMono(decoded)
  const inputRms = rmsLevel(mono)
  if (inputRms < 0.003) {
    throw new Error('No voice detected. Check microphone permission and speak closer to the mic.')
  }
  const resampled = resampleLinear(mono, decoded.sampleRate, 16000)
  const normalized = normalizePcm(resampled)
  const wavBuffer = encodeWav(normalized, 16000)
  return bufferToBase64(wavBuffer)
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer
  if (numberOfChannels <= 1) return buffer.getChannelData(0)

  const mono = new Float32Array(length)
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const channel = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) mono[i] += channel[i]
  }
  const inv = 1 / numberOfChannels
  for (let i = 0; i < length; i++) mono[i] *= inv
  return mono
}

function resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input
  const ratio = inRate / outRate
  const outLength = Math.max(1, Math.floor(input.length / ratio))
  const output = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = pos - i0
    output[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return output
}

function normalizePcm(samples: Float32Array): Float32Array {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  if (peak < 1e-4 || peak > 0.95) return samples

  const gain = Math.min(0.95 / peak, 8)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain
  return out
}

function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sumSq = 0
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i]
  return Math.sqrt(sumSq / samples.length)
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length
  const buffer = new ArrayBuffer(44 + numSamples * 2)
  const view = new DataView(buffer)
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + numSamples * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, numSamples * 2, true)
  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }
  return buffer
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
