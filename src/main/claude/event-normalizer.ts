import type {
  ClaudeEvent,
  NormalizedEvent,
  StreamEvent,
  InitEvent,
  AssistantEvent,
  ResultEvent,
  RateLimitEvent,
  PermissionEvent,
  ContentDelta,
} from '../../shared/types'

/**
 * Maps raw Claude stream-json events to canonical CLUI events.
 *
 * The normalizer is stateless — it takes one raw event and returns
 * zero or more normalized events. The caller (RunManager) is responsible
 * for sequencing and routing.
 */
export function normalize(raw: ClaudeEvent): NormalizedEvent[] {
  switch (raw.type) {
    case 'system':
      return normalizeSystem(raw as InitEvent)

    case 'stream_event':
      return normalizeStreamEvent(raw as StreamEvent)

    case 'assistant':
      return normalizeAssistant(raw as AssistantEvent)

    case 'result':
      return normalizeResult(raw as ResultEvent)

    case 'rate_limit_event':
      return normalizeRateLimit(raw as RateLimitEvent)

    case 'permission_request':
      return normalizePermission(raw as PermissionEvent)

    default:
      // Unknown event type — skip silently (defensive)
      return []
  }
}

function normalizeSystem(event: InitEvent): NormalizedEvent[] {
  if (event.subtype !== 'init') return []

  return [{
    type: 'session_init',
    sessionId: event.session_id,
    tools: event.tools || [],
    model: event.model || 'unknown',
    mcpServers: event.mcp_servers || [],
    skills: event.skills || [],
    version: event.claude_code_version || 'unknown',
  }]
}

function normalizeStreamEvent(event: StreamEvent): NormalizedEvent[] {
  const sub = event.event
  if (!sub) return []

  switch (sub.type) {
    case 'content_block_start': {
      if (sub.content_block.type === 'tool_use') {
        return [{
          type: 'tool_call',
          toolName: sub.content_block.name || 'unknown',
          toolId: sub.content_block.id || '',
          index: sub.index,
        }]
      }
      // text block start — no event needed, text comes via deltas
      return []
    }

    case 'content_block_delta': {
      const delta = sub.delta as ContentDelta
      if (delta.type === 'text_delta') {
        return [{ type: 'text_chunk', text: delta.text }]
      }
      if (delta.type === 'input_json_delta') {
        return [{
          type: 'tool_call_update',
          toolId: '', // caller can associate via index tracking
          partialInput: delta.partial_json,
        }]
      }
      return []
    }

    case 'content_block_stop': {
      return [{
        type: 'tool_call_complete',
        index: sub.index,
      }]
    }

    case 'message_start':
    case 'message_stop':
      // These are structural events — the assembled `assistant` event handles message completion
      return []

    case 'message_delta': {
      // message_delta carries context_management data (context window usage) from Claude CLI.
      // This is the primary source of context fill %, auto-compaction threshold, etc.
      const md = sub as { type: 'message_delta'; delta: { stop_reason: string | null }; usage?: unknown; context_management?: { context_window_used?: number; context_window_budget?: number; auto_compact_at?: number; [key: string]: unknown } }
      const cm = md.context_management
      if (cm) {
        // Normalize context_management: tolerate varying field name conventions
        const used = (cm.context_window_used ?? cm.input_tokens ?? cm.tokens_used ?? 0) as number
        const budget = (cm.context_window_budget ?? cm.context_window ?? cm.max_tokens ?? 0) as number
        const autoCompactAt = (cm.auto_compact_at ?? cm.auto_compact_threshold) as number | undefined
        if (used > 0 || budget > 0) {
          return [{
            type: 'context_window',
            used,
            budget,
            ...(autoCompactAt != null ? { autoCompactAt } : {}),
          }]
        }
      }
      return []
    }

    default:
      return []
  }
}

function normalizeAssistant(event: AssistantEvent): NormalizedEvent[] {
  const results: NormalizedEvent[] = [{
    type: 'task_update',
    message: event.message,
  }]

  // Extract context window usage from message.usage.
  // Total context = input_tokens (non-cached) + cache_read_input_tokens + cache_creation_input_tokens.
  // This is the reliable source — context_management in message_delta is not always emitted by the CLI.
  const usage = event.message?.usage
  if (usage) {
    const used = (usage.input_tokens || 0)
      + (usage.cache_read_input_tokens || 0)
      + (usage.cache_creation_input_tokens || 0)
    if (used > 0) {
      results.push({
        type: 'context_window',
        used,
        budget: 200_000, // All current Claude models have 200K context window
      })
    }
  }

  return results
}

function normalizeResult(event: ResultEvent): NormalizedEvent[] {
  if (event.is_error || event.subtype === 'error') {
    return [{
      type: 'error',
      message: event.result || 'Session error. The session may have expired or been moved.',
      isError: true,
      sessionId: event.session_id,
    }]
  }

  const denials = Array.isArray((event as any).permission_denials)
    ? (event as any).permission_denials.map((d: any) => ({
        toolName: d.tool_name || '',
        toolUseId: d.tool_use_id || '',
      }))
    : undefined

  return [{
    type: 'task_complete',
    result: event.result || '',
    costUsd: event.total_cost_usd || 0,
    durationMs: event.duration_ms || 0,
    numTurns: event.num_turns || 0,
    usage: event.usage || {},
    sessionId: event.session_id,
    ...(denials && denials.length > 0 ? { permissionDenials: denials } : {}),
  }]
}

function normalizeRateLimit(event: RateLimitEvent): NormalizedEvent[] {
  const info = event.rate_limit_info
  if (!info) return []

  return [{
    type: 'rate_limit',
    status: info.status,
    resetsAt: info.resetsAt,
    rateLimitType: info.rateLimitType,
  }]
}

function normalizePermission(event: PermissionEvent): NormalizedEvent[] {
  return [{
    type: 'permission_request',
    questionId: event.question_id,
    toolName: event.tool?.name || 'unknown',
    toolDescription: event.tool?.description,
    toolInput: event.tool?.input,
    options: (event.options || []).map((o) => ({
      id: o.id,
      label: o.label,
      kind: o.kind,
    })),
  }]
}
