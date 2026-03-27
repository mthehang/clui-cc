import * as http from 'http'
import * as https from 'https'
import { URL } from 'url'
import { log as _log } from '../logger'

const log = (msg: string) => _log('OllamaService', msg)

const ENHANCE_SYSTEM_PROMPT = [
  'You are a prompt editor. Your only job is to rewrite the user\'s message to be clearer and more precise.',
  'Rules: same language as input (NEVER translate); same first-person voice; fix ambiguous phrasing; make implicit context explicit; add technical precision where missing; keep same length; do NOT add new ideas.',
  'Reply with ONLY the rewritten message. Nothing else.',
].join('\n')

export const RECOMMENDED_OLLAMA_MODELS = [
  { id: 'qwen3:1.7b',   label: 'Qwen3 1.7B',   sizeMb: 1400, isDefault: true },
  { id: 'llama3.2:3b',  label: 'Llama 3.2 3B', sizeMb: 2000 },
] as const

export type OllamaModelId = typeof RECOMMENDED_OLLAMA_MODELS[number]['id']

export class OllamaService {
  private endpoint: string

  constructor(endpoint = 'http://localhost:11434') {
    this.endpoint = endpoint.replace(/\/$/, '')
  }

  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint.replace(/\/$/, '')
  }

  // ─── Status ───

  async isRunning(): Promise<{ running: boolean; version: string | null }> {
    try {
      const data = await this._fetch('GET', '/api/version', null, 3000) as { version?: string }
      return { running: true, version: data.version || null }
    } catch {
      return { running: false, version: null }
    }
  }

  // ─── Model management ───

  async listModels(): Promise<string[]> {
    try {
      const data = await this._fetch('GET', '/api/tags', null, 8000) as { models?: Array<{ name: string }> }
      return (data.models || []).map((m) => m.name)
    } catch (err: any) {
      log(`listModels failed: ${err.message}`)
      return []
    }
  }

  async deleteModel(model: string): Promise<void> {
    await this._fetch('DELETE', '/api/delete', { model }, 15000)
    log(`Deleted model: ${model}`)
  }

  async pullModel(
    model: string,
    onProgress: (percent: number, status: string) => void,
  ): Promise<void> {
    log(`Pulling model: ${model}`)
    const url = new URL(`${this.endpoint}/api/pull`)
    const body = JSON.stringify({ model, stream: true })

    await new Promise<void>((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? '443' : '80'),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }

      const lib = url.protocol === 'https:' ? https : http
      const req = lib.request(options, (res) => {
        let buffer = ''
        let resolved = false

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8')
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const data = JSON.parse(line) as {
                status?: string
                completed?: number
                total?: number
                error?: string
              }

              if (data.error) {
                reject(new Error(data.error))
                resolved = true
                return
              }

              const pct = (data.total && data.completed)
                ? Math.round((data.completed / data.total) * 100)
                : 0
              onProgress(pct, data.status || '')

              if (data.status === 'success') {
                resolved = true
                resolve()
              }
            } catch {}
          }
        })

        res.on('end', () => { if (!resolved) resolve() })
        res.on('error', (err) => { if (!resolved) { resolved = true; reject(err) } })
      })

      req.on('error', reject)
      req.write(body)
      req.end()
    })

    log(`Model pulled successfully: ${model}`)
  }

  // ─── Enhancement ───

  async enhancePrompt(model: string, prompt: string): Promise<{ enhanced: string }> {
    log(`Enhancing prompt with model ${model} (${prompt.length} chars)`)

    const body = {
      model,
      messages: [
        { role: 'system', content: ENHANCE_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 2000,
      },
    }

    const data = await this._fetch('POST', '/api/chat', body, 45000) as {
      message?: { content?: string }
      error?: string
    }

    if (data.error) throw new Error(data.error)

    let enhanced = data.message?.content?.trim() || ''
    log(`Raw response (${enhanced.length} chars): ${enhanced.substring(0, 200)}`)
    if (!enhanced) throw new Error('Empty response from Ollama')

    // Strip thinking blocks in case /nothink wasn't honored by the model
    enhanced = enhanced.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim()
    // Strip XML wrappers if model echoes them back
    const outputMatch = enhanced.match(/^<(?:output|input)>\s*([\s\S]*?)\s*<\/(?:output|input)>$/i)
    if (outputMatch) enhanced = outputMatch[1].trim()
    if (!enhanced) throw new Error('Response was empty after stripping')

    log(`Enhancement done: ${enhanced.length} chars`)
    return { enhanced }
  }

  // ─── Internal HTTP ───

  private _fetch(
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const url = new URL(`${this.endpoint}${path}`)
    const bodyStr = body != null ? JSON.stringify(body) : null

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        req.destroy(new Error(`Ollama request timed out: ${method} ${path}`))
      }, timeoutMs)

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? '443' : '80'),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      }

      const lib = url.protocol === 'https:' ? https : http
      const req = lib.request(options, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString('utf-8') })
        res.on('end', () => {
          clearTimeout(timer)
          try {
            resolve(JSON.parse(data))
          } catch {
            reject(new Error(`Ollama parse error: ${data.slice(0, 200)}`))
          }
        })
        res.on('error', (err) => { clearTimeout(timer); reject(err) })
      })

      req.on('error', (err) => { clearTimeout(timer); reject(err) })
      if (bodyStr) req.write(bodyStr)
      req.end()
    })
  }
}
