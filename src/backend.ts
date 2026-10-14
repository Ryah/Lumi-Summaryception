// Summaryception for Lumiverse. Adapted from Lodactio's Summaryception; AGPL-3.0-only.
import { DEFAULT_SETTINGS, normalizeSettings, createStore, parseStoredStore, validateStore, reconcile, skipBacklog, eligibleCount, injection, coveredIds, cleanOutput, summarizeBatch, promoteLayers, type Settings, type Store, type Message } from './engine.js'
import type { SpindleAPI } from 'lumiverse-spindle-types'
import * as v from 'valibot'
declare const spindle: SpindleAPI

const RequestSchema = v.object({
  type: v.literal('sc:request'), requestId: v.string(), action: v.string(),
  chatId: v.optional(v.string()), settings: v.optional(v.record(v.string(), v.unknown())),
  mode: v.optional(v.picklist(['one', 'all'])), snippetId: v.optional(v.string()),
  text: v.optional(v.string()), data: v.optional(v.unknown()),
})
const ResponseSchema = v.object({ content: v.optional(v.string()), finish_reason: v.optional(v.string()) })

const settingsByUser = new Map<string, Promise<Settings>>()
const queues = new Map<string, Promise<unknown>>()
const jobs = new Map<string, { chatId: string; controller: AbortController; completed: number; total: number }>()
const errors = new Map<string, string>()
const usersByChat = new Map<string, string>()
const key = (userId?: string) => userId || 'owner'
const path = (chatId: string) => `chats/${encodeURIComponent(chatId)}.json`
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

function exclusive<T>(userId: string | undefined, work: () => Promise<T>): Promise<T> {
  const id = key(userId)
  const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(work)
  queues.set(id, next)
  void next.finally(() => { if (queues.get(id) === next) queues.delete(id) }).catch(() => {})
  return next
}
function settings(userId?: string): Promise<Settings> {
  const id = key(userId)
  let pending = settingsByUser.get(id)
  if (!pending) {
    pending = spindle.userStorage.getJson('settings.json', { fallback: DEFAULT_SETTINGS, userId }).then(normalizeSettings)
    settingsByUser.set(id, pending)
    void pending.catch(() => settingsByUser.delete(id))
  }
  return pending
}
async function messages(chatId: string, userId?: string): Promise<Message[]> {
  if (!await spindle.chats.get(chatId, userId)) throw new Error('Chat is unavailable to this user.')
  if (userId) usersByChat.set(chatId, userId)
  return spindle.chat.getMessages(chatId)
}
async function load(chatId: string, userId?: string): Promise<{ store: Store; messages: Message[] }> {
  const current = await messages(chatId, userId)
  const raw = await spindle.userStorage.getJson(path(chatId), { fallback: null, userId })
  const store = raw === null ? createStore(chatId) : parseStoredStore(raw, chatId)
  reconcile(store, current)
  return { store, messages: current }
}
async function save(store: Store, userId?: string): Promise<void> {
  await spindle.userStorage.setJson(path(store.chatId), store, { userId })
}
function excludedIds(store: Store, current: Message[], config: Settings): Set<string> {
  if (!config.enabled || config.disableGhosting) return new Set()
  const assistants: number[] = []
  for (let index = 0; index < current.length; index++) {
    if (current[index].role === 'assistant' && current[index].content.trim()) assistants.push(index)
  }
  const oldCount = Math.max(0, assistants.length - config.verbatimTurns)
  const boundary = oldCount ? assistants[oldCount - 1] + 1 : 0
  const covered = coveredIds(store)
  return new Set(current.slice(0, boundary).filter(message => message.role !== 'system' && covered.has(message.id)).map(message => message.id))
}
async function state(chatId?: string | null, userId?: string) {
  const config = await settings(userId)
  const selected = chatId === undefined ? (await spindle.chats.getActive(userId))?.id || null : chatId
  const loaded = selected ? await load(selected, userId) : null
  const job = jobs.get(key(userId))
  const profiles = await spindle.connections.list(userId)
  const ghostedIds = loaded ? [...excludedIds(loaded.store, loaded.messages, config)] : []
  return {
    chatId: selected, settings: config, store: loaded?.store || null,
    preview: loaded ? injection(loaded.store, config) : '',
    eligibleTurns: loaded ? eligibleCount(loaded.store, loaded.messages, config) : 0,
    ghostedCount: ghostedIds.length, ghostedIds,
    busy: !!job, progress: job ? { completed: job.completed, total: job.total } : null,
    connections: profiles.map(({ id, name }) => ({ id, name })), error: errors.get(key(userId)) || null,
  }
}
async function publish(chatId: string | null | undefined, userId?: string) {
  spindle.sendToFrontend({ type: 'sc:state', state: await state(chatId, userId) }, userId)
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const abort = () => { clearTimeout(timer); reject(signal.reason) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  signal.addEventListener('abort', abort, { once: true })
  return promise
}
function retryDelay(error: unknown, attempt: number): number | null {
  const e = error as { status?: number; statusCode?: number; retryAfter?: string | number; response?: { status?: number; headers?: { get?: (key: string) => string | null; 'retry-after'?: string } } }
  const text = errorText(error)
  const status = e?.status || e?.statusCode || e?.response?.status || Number(text.match(/\b(429|500|502|503|504)\b/)?.[1])
  if (![429, 500, 502, 503, 504].includes(status) && !/network|fetch|timeout|rate limit|overloaded|ECONNRESET|ECONNREFUSED/i.test(text)) return null
  const header = e?.retryAfter ?? e?.response?.headers?.get?.('retry-after') ?? e?.response?.headers?.['retry-after']
  if (header !== undefined && header !== null) {
    const seconds = Number(header)
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(header)) - Date.now()
    if (Number.isFinite(delay)) return Math.max(0, delay)
  }
  return Math.min(60000, 2000 * 2 ** attempt + Math.random() * 500)
}
async function summarizer(config: Settings, userId?: string) {
  const persona = await spindle.personas.getActive(userId)
  const playerName = persona?.name || 'User'
  return async (story: string, context: string, signal: AbortSignal): Promise<string> => {
    const vars: Record<string, string> = { player_name: playerName, context_str: context, story_txt: story }
    const render = (text: string) => text.replace(/\{\{(player_name|context_str|story_txt)\}\}/g, (_, name: string) => vars[name])
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      if (config.debugMode) spindle.log.info(`Summaryception request ${attempt + 1}: ${story.length} passage characters, ${context.length} context characters, ${config.connectionId || 'active connection'}`)
      const timeout = AbortSignal.timeout(120000)
      const requestSignal = AbortSignal.any([signal, timeout])
      try {
        const result = v.parse(ResponseSchema, await spindle.generate.quiet({
          type: 'quiet', userId, connection_id: config.connectionId || undefined,
          messages: [{ role: 'system', content: render(config.summarizerSystemPrompt) }, { role: 'user', content: render(config.summarizerUserPrompt) }],
          parameters: { temperature: 0.2, ...(config.responseTokens ? { max_tokens: config.responseTokens } : {}) },
          reasoning: { source: 'off' }, signal: requestSignal,
        }))
        signal.throwIfAborted()
        if (result.finish_reason === 'length' || result.finish_reason === 'max_tokens') throw new Error('Summary was truncated. Increase the response token limit before retrying.')
        const content = cleanOutput(result.content || '', config)
        if (!content) throw new Error('Summarizer returned an empty response. History was not excluded.')
        return content
      } catch (error) {
        signal.throwIfAborted()
        const failure = timeout.aborted ? new Error('Summarizer request timeout') : error
        const delay = retryDelay(failure, attempt)
        if (attempt >= 5 || delay === null) throw failure
        spindle.log.warn(`Summaryception retry ${attempt + 1}: ${errorText(failure)}`)
        await wait(delay, signal)
      }
    }
  }
}
async function commit(candidate: Store, userId: string | undefined, signal: AbortSignal) {
  signal.throwIfAborted()
  const latest = await messages(candidate.chatId, userId)
  if (reconcile(candidate, latest)) throw new Error('Source messages changed during summarization. No new memory was committed; retry with the updated chat.')
  signal.throwIfAborted()
  await save(candidate, userId)
}
function startJob(chatId: string, mode: 'one' | 'all', userId?: string, snippetId?: string): void {
  const id = key(userId)
  if (jobs.has(id)) throw new Error('Stop the running summary operation first.')
  const job = { chatId, controller: new AbortController(), completed: 0, total: 0 }
  jobs.set(id, job)
  errors.delete(id)
  void (async () => {
    const config = await settings(userId)
    if (!config.enabled) throw new Error('Enable Summaryception before generating memory.')
    let loaded = await load(chatId, userId)
    const summarize = await summarizer(config, userId)
    const signal = job.controller.signal
    job.total = snippetId ? 1 : Math.ceil(eligibleCount(loaded.store, loaded.messages, config) / config.turnsPerSummary)
    await publish(chatId, userId)
    if (snippetId) {
      const candidate = structuredClone(loaded.store)
      const snippet = candidate.layers.flat().find(s => s.id === snippetId)
      if (!snippet) throw new Error('Snippet no longer exists.')
      const prior = candidate.layers.flat().filter(s => s.end < snippet.start).sort((a, b) => a.start - b.start).map(s => s.text).join(' ')
      const passage = loaded.messages.slice(snippet.start, snippet.end + 1).filter(m => m.role !== 'system').map(m => `${m.name || m.role}: ${m.content}`).join('\n\n')
      snippet.text = await summarize(passage, prior, signal)
      snippet.timestamp = Date.now()
      await commit(candidate, userId, signal)
      job.completed = 1
    } else {
      // Save each completed batch before promotion: a failed promotion never loses new memory.
      do {
        signal.throwIfAborted()
        const candidate = structuredClone(loaded.store)
        if (!await summarizeBatch(candidate, loaded.messages, config, summarize, signal)) break
        await commit(candidate, userId, signal)
        job.completed++
        await publish(chatId, userId)
        const promoted = structuredClone(candidate)
        await promoteLayers(promoted, config, summarize, signal)
        await commit(promoted, userId, signal)
        loaded = await load(chatId, userId)
      } while (mode === 'all' && eligibleCount(loaded.store, loaded.messages, config) > 0)
    }
  })().catch(error => {
    if (!job.controller.signal.aborted) {
      errors.set(id, errorText(error))
      spindle.log.error(`Summaryception: ${errorText(error)}`)
    }
  }).finally(async () => {
    if (jobs.get(id) === job) jobs.delete(id)
    await publish(chatId, userId).catch(error => spindle.log.error(errorText(error)))
  })
}

spindle.onFrontendMessage((payload, userId, frontendSessionId) => {
  const parsed = v.safeParse(RequestSchema, payload)
  if (!parsed.success) return
  const request = parsed.output
  void exclusive(userId, async () => {
    let selected: string | null | undefined = request.chatId
    let data: unknown
    try {
      if (request.action === 'stop') jobs.get(key(userId))?.controller.abort()
      else if (request.action !== 'state') {
        if (jobs.has(key(userId))) throw new Error('Stop the running summary operation first.')
        errors.delete(key(userId))
        if (request.action === 'settings') {
          const config = normalizeSettings({ ...await settings(userId), ...request.settings })
          await spindle.userStorage.setJson('settings.json', config, { userId })
          settingsByUser.set(key(userId), Promise.resolve(config))
        } else {
          selected = request.chatId || (await spindle.chats.getActive(userId))?.id || null
          if (!selected) throw new Error('Open a chat first.')
          const loaded = await load(selected, userId)
          const config = await settings(userId)
          switch (request.action) {
            case 'summarize': startJob(selected, request.mode === 'all' ? 'all' : 'one', userId); break
            case 'regenerate':
              if (!request.snippetId) throw new Error('Select a snippet first.')
              startJob(selected, 'one', userId, request.snippetId); break
            case 'skip': skipBacklog(loaded.store, loaded.messages, config); await save(loaded.store, userId); break
            case 'clear': await save(createStore(selected), userId); break
            case 'repair': await save(loaded.store, userId); break
            case 'export': data = loaded.store; break
            case 'import': await save(validateStore(request.data, selected, loaded.messages), userId); break
            case 'edit': {
              const snippet = loaded.store.layers.flat().find(s => s.id === request.snippetId)
              if (!snippet) throw new Error('Snippet no longer exists.')
              const text = request.text?.trim()
              if (!text) throw new Error('A snippet cannot be empty; use Delete to restore its source messages.')
              snippet.text = text; snippet.timestamp = Date.now(); await save(loaded.store, userId); break
            }
            case 'delete': {
              const snippet = loaded.store.layers.flat().find(s => s.id === request.snippetId)
              if (!snippet) throw new Error('Snippet no longer exists.')
              // Later deltas depend on this snippet. Restore the entire dependent suffix.
              loaded.store.layers = loaded.store.layers.map(layer => layer.filter(s => s.end < snippet.start))
              loaded.store.sources.length = snippet.start
              loaded.store.skipped = loaded.store.sources.length - coveredIds(loaded.store).size
              await save(loaded.store, userId); break
            }
            default: throw new Error('Unknown Summaryception action.')
          }
        }
      }
      spindle.sendToFrontend({ type: 'sc:response', requestId: request.requestId, ok: true, state: await state(selected, userId), data }, userId, frontendSessionId ? { frontendSessionId } : undefined)
    } catch (error) {
      spindle.sendToFrontend({ type: 'sc:response', requestId: request.requestId, ok: false, error: errorText(error) }, userId, frontendSessionId ? { frontendSessionId } : undefined)
    }
  })
})

spindle.registerInterceptor(async (prompt, context) => {
  const config = await settings(context.userId)
  if (!config.enabled || !context.chatId) return prompt
  const { store, messages: current } = await load(context.chatId, context.userId)
  context.signal.throwIfAborted()
  const preview = injection(store, config)
  if (!preview) return prompt
  const excluded = excludedIds(store, current, config)
  const kept = prompt.filter(message => !(message.__isChatHistory && message.sourceMessageId && excluded.has(message.sourceMessageId)))
  // Preserve preset/system ordering; historical context goes before the remaining raw chat.
  const historyIndex = kept.findIndex(message => message.__isChatHistory)
  const position = historyIndex < 0 ? kept.length : historyIndex
  kept.splice(position, 0, { role: 'user', content: preview })
  return { messages: kept, breakdown: [{ messageIndex: position, name: 'Summaryception memory' }] }
}, { priority: 100, required: true })

spindle.on('GENERATION_ENDED', (payload, userId) => {
  if (payload.error || !payload.messageId || !payload.chatId) return
  void exclusive(userId, async () => {
    if (jobs.has(key(userId))) return
    const config = await settings(userId)
    if (!config.enabled || config.pauseSummarization) return
    const loaded = await load(payload.chatId, userId)
    const count = eligibleCount(loaded.store, loaded.messages, config)
    if (count >= config.turnsPerSummary && count <= config.turnsPerSummary * 2) startJob(payload.chatId, 'one', userId)
    else await publish(payload.chatId, userId) // Large backlog needs an explicit choice.
  }).catch(error => spindle.log.error(errorText(error)))
})
for (const event of ['CHAT_SWITCHED', 'CHAT_CHANGED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'SWIPE_EDITED']) {
  spindle.on(event, (payload, userId) => {
    if (!payload || typeof payload !== 'object' || !('chatId' in payload)) return
    const chatId = payload.chatId
    if (chatId !== null && typeof chatId !== 'string') return
    if (event.startsWith('MESSAGE_') || event === 'SWIPE_EDITED') {
      const job = jobs.get(key(userId))
      if (job?.chatId === chatId) job.controller.abort()
    }
    void publish(chatId, userId).catch(error => spindle.log.error(errorText(error)))
  })
}
spindle.commands.register([
  { id: 'sc-status', label: 'Summaryception: Status', description: 'Open memory layers and statistics', keywords: ['sc-status', 'memory'], scope: 'chat' },
  { id: 'sc-preview', label: 'Summaryception: Preview', description: 'Inspect the historical context injected into generation', keywords: ['sc-preview', 'memory'], scope: 'chat' },
  { id: 'sc-clear', label: 'Summaryception: Clear memory', description: 'Confirm clearing memory and restoring raw history', keywords: ['sc-clear', 'memory'], scope: 'chat' },
])
spindle.commands.onInvoked((command, context) => {
  const userId = context.chatId ? usersByChat.get(context.chatId) : undefined
  if (userId) spindle.sendToFrontend({ type: 'sc:command', command, chatId: context.chatId }, userId)
})
spindle.log.info('Summaryception backend loaded')
