// Summaryception for Lumiverse. Adapted from Lodactio's Summaryception; AGPL-3.0-only.
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import * as v from 'valibot'
import { DEFAULT_SETTINGS, PROMPT_PRESETS, type Settings, type Store, type Snippet } from './engine.js'

const count = v.pipe(v.number(), v.integer(), v.minValue(0))
const settingsSchema = v.object({
  enabled: v.boolean(), verbatimTurns: count, turnsPerSummary: count,
  snippetsPerLayer: count, snippetsPerPromotion: count, maxLayers: count,
  pauseSummarization: v.boolean(), disableGhosting: v.boolean(), connectionId: v.string(),
  responseTokens: count, promptPreset: v.picklist(['narrative', 'gamestate', 'custom']),
  summarizerSystemPrompt: v.string(), summarizerUserPrompt: v.string(), injectionTemplate: v.string(),
  stripPatterns: v.array(v.string()), savedCustomPrompts: v.record(v.string(), v.string()),
  lastCustomPrompt: v.string(), debugMode: v.boolean(),
})
const storeSchema = v.object({
  version: v.literal(1), chatId: v.string(),
  layers: v.array(v.array(v.object({ id: v.string(), text: v.string(), start: count, end: count, timestamp: v.number() }))),
  sources: v.array(v.object({ id: v.string(), fingerprint: v.string() })), skipped: count,
})
const stateSchema = v.object({
  chatId: v.nullable(v.string()), settings: settingsSchema, store: v.nullable(storeSchema),
  preview: v.string(), eligibleTurns: count, ghostedCount: count, ghostedIds: v.array(v.string()), busy: v.boolean(),
  progress: v.nullable(v.object({ completed: count, total: count })),
  connections: v.array(v.object({ id: v.string(), name: v.string() })), error: v.nullable(v.string()),
})
const payloadSchema = v.variant('type', [
  v.object({ type: v.literal('sc:state'), state: stateSchema }),
  v.object({ type: v.literal('sc:response'), requestId: v.string(), ok: v.boolean(), error: v.optional(v.string()), state: v.optional(stateSchema), data: v.optional(v.unknown()) }),
  v.object({ type: v.literal('sc:command'), command: v.picklist(['sc-status', 'sc-preview', 'sc-clear']), chatId: v.optional(v.nullable(v.string())) }),
])
type State = v.InferOutput<typeof stateSchema>
type Page = 'memory' | 'settings' | 'prompts' | 'preview' | 'transfer'
type Pending = { chatId: string | null; epoch: number; action: string; timer: number; resolve: (value: unknown) => void; reject: (reason: Error) => void }

const CSS = `
.sc-shell,.sc-shell *{box-sizing:border-box}
.sc-shell{width:100%;min-width:0;padding:16px;color:var(--lumiverse-text,#eee);font:inherit;font-size:13px;line-height:1.5;background:var(--lumiverse-bg-dark,transparent)}
.sc-shell h2{font-size:20px;margin:0}.sc-shell h3{font-size:15px;margin:0 0 10px}.sc-shell p{margin:6px 0 12px}
.sc-muted{color:var(--lumiverse-text-muted,#aaa);font-size:12px}.sc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sc-between{justify-content:space-between}
.sc-card{padding:14px;border:1px solid var(--lumiverse-border,rgba(128,128,128,.3));border-radius:var(--lumiverse-radius,10px);background:var(--lumiverse-fill-subtle,rgba(128,128,128,.04));margin-top:12px;min-width:0}
.sc-shell button,.sc-shell input,.sc-shell select,.sc-shell textarea{font:inherit;color:var(--lumiverse-text,#eee);border:1px solid var(--lumiverse-border,rgba(128,128,128,.35));border-radius:7px;background:var(--lumiverse-bg-deep,#18181d)}
.sc-shell button{min-height:34px;padding:6px 11px;cursor:pointer;background:var(--lumiverse-fill-subtle,rgba(128,128,128,.09))}.sc-shell button:hover:not(:disabled){border-color:var(--lumiverse-primary,var(--lumiverse-accent,#999))}
.sc-shell button:disabled{opacity:.45;cursor:not-allowed}.sc-shell button.sc-primary{background:var(--lumiverse-primary-020,rgba(128,128,128,.2));border-color:var(--lumiverse-primary,var(--lumiverse-accent,#999))}
.sc-shell button.sc-danger{color:var(--lumiverse-danger,#ef9292)}.sc-shell :focus-visible{outline:2px solid var(--lumiverse-primary,var(--lumiverse-accent,#999));outline-offset:2px}
.sc-shell input:not([type=checkbox]),.sc-shell select,.sc-shell textarea{width:100%;min-width:0;padding:8px}.sc-shell textarea{resize:vertical;min-height:108px;line-height:1.5}.sc-shell input[type=checkbox]{width:17px;height:17px;accent-color:var(--lumiverse-primary,#999)}
.sc-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px}.sc-tabs button[aria-selected=true]{border-color:var(--lumiverse-primary,var(--lumiverse-accent,#999));background:var(--lumiverse-primary-010,rgba(128,128,128,.12))}
.sc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px}.sc-field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}.sc-toggle{display:flex;gap:9px;align-items:flex-start;margin:10px 0}.sc-toggle input{flex-shrink:0;margin-top:3px}.sc-toggle span{display:block}
.sc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px}.sc-stat{padding:9px;border-radius:7px;background:var(--lumiverse-fill-subtle,rgba(128,128,128,.06))}.sc-stat strong{display:block;font-size:20px}
.sc-error{color:var(--lumiverse-danger,#ef9292);white-space:pre-wrap;overflow-wrap:anywhere}.sc-notice{white-space:pre-wrap;overflow-wrap:anywhere}.sc-shell [hidden]{display:none!important}.sc-shell progress{width:100%;accent-color:var(--lumiverse-primary,#999);height:12px}
.sc-snippet{border-top:1px solid var(--lumiverse-border,rgba(128,128,128,.25));padding-top:12px;margin-top:12px}.sc-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0;font:inherit;max-height:320px;overflow:auto}.sc-preview{max-height:60dvh;min-height:120px;padding:12px;border-radius:7px;background:var(--lumiverse-bg-deep,rgba(0,0,0,.1))}
.sc-confirm{border-color:var(--lumiverse-warning,#d8aa55)}.sc-ghost-marker{display:inline-block;margin:6px 10px;padding:3px 8px;border-radius:6px;color:var(--lumiverse-text-muted,#aaa);background:var(--lumiverse-fill-subtle,rgba(128,128,128,.1));font-size:11px;pointer-events:none}
@media(max-width:500px){.sc-shell{padding:10px}.sc-card{padding:11px}.sc-row>button{flex:1 1 auto}.sc-tabs button{flex:1 1 auto}.sc-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
`

export function setup(ctx: SpindleFrontendContext): () => void {
  const removeStyle = ctx.dom.addStyle(CSS)
  const tab = ctx.ui.registerDrawerTab({ id: 'summaryception', title: 'Summaryception', shortName: 'Memory', headerTitle: 'Summaryception', description: 'Recursive chat memory, summaries, and prompt preview', keywords: ['summary', 'memory', 'backlog', 'sc-status', 'sc-preview', 'sc-clear'] })
  const shell = document.createElement('div')
  shell.className = 'sc-shell'
  tab.root.append(shell)
  const cleanups: (() => void)[] = []
  const pending = new Map<string, Pending>()
  const markers = new Map<string, Element>()
  const downloads = new Map<string, number>()
  const pages: Record<Page, HTMLElement> = {} as Record<Page, HTMLElement>
  const nav: Record<Page, HTMLButtonElement> = {} as Record<Page, HTMLButtonElement>
  let destroyed = false
  let epoch = 0
  let requestSequence = 0
  let chatId = ctx.getActiveChat().chatId || null
  let state: State | null = null
  let page: Page = 'memory'
  let localError = ''
  let notice = ''
  let markerFrame: number | null = null
  let settingsDirty = false
  let drafts: Settings = structuredClone(DEFAULT_SETTINGS)
  let edit: { chatId: string; snippetId: string; text: string } | null = null
  let confirmation: { chatId: string; action: string; args: Record<string, unknown>; text: string } | null = null
  let commandAfterLoad: 'sc-clear' | null = null

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  function button(text: string, handler: () => void, className = ''): HTMLButtonElement {
    const node = el('button', className, text)
    node.type = 'button'
    node.addEventListener('click', handler)
    return node
  }
  function field(label: string, input: HTMLElement, help = ''): HTMLLabelElement {
    const node = el('label', 'sc-field')
    node.append(el('span', '', label), input)
    if (help) node.append(el('span', 'sc-muted', help))
    return node
  }
  function card(parent: HTMLElement, title: string, help = ''): HTMLElement {
    const node = el('section', 'sc-card')
    node.append(el('h3', '', title))
    if (help) node.append(el('p', 'sc-muted', help))
    parent.append(node)
    return node
  }

  const heading = el('div', 'sc-row sc-between')
  heading.append(el('h2', '', 'Summaryception'), button('Refresh', () => { void refresh() }))
  shell.append(heading, el('p', 'sc-muted', 'Recursive memory with recent assistant turns kept verbatim. Native Lumiverse connections; no separate API credentials.'))
  const status = el('div', 'sc-card sc-notice')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const errors = el('div', 'sc-card sc-error')
  errors.setAttribute('role', 'alert')
  const noticeBox = el('div', 'sc-notice sc-muted')
  shell.append(status, errors, noticeBox)
  const tabs = el('div', 'sc-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Summaryception sections')
  shell.append(tabs)
  const pageLabels: Record<Page, string> = { memory: 'Memory', settings: 'Settings', prompts: 'Prompts', preview: 'Preview', transfer: 'Import / Export' }
  for (const name of Object.keys(pageLabels) as Page[]) {
    const control = button(pageLabels[name], () => { page = name; renderNavigation() })
    control.setAttribute('role', 'tab')
    control.id = `sc-tab-${name}`
    control.setAttribute('aria-controls', `sc-panel-${name}`)
    nav[name] = control
    tabs.append(control)
    const panel = el('div')
    panel.id = `sc-panel-${name}`
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', control.id)
    pages[name] = panel
    shell.append(panel)
  }
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const order = Object.keys(pageLabels) as Page[]
    const index = order.indexOf(page)
    page = event.key === 'Home' ? order[0] : event.key === 'End' ? order[order.length - 1] : order[(index + (event.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length]
    event.preventDefault()
    renderNavigation()
    nav[page].focus()
  })
  const confirmBox = el('section', 'sc-card sc-confirm')
  confirmBox.setAttribute('role', 'alert')
  const confirmText = el('p')
  const confirmActions = el('div', 'sc-row')
  confirmActions.append(button('Confirm', () => {
    const selected = confirmation
    confirmation = null
    render()
    if (selected && selected.chatId === ctx.getActiveChat().chatId) void perform(selected.action, selected.args, selected.chatId)
  }, 'sc-danger'), button('Cancel', () => { confirmation = null; render() }))
  confirmBox.append(confirmText, confirmActions)
  shell.append(confirmBox)

  const overview = card(pages.memory, 'Chat memory')
  const stats = el('div', 'sc-stats')
  overview.append(stats)
  const backlog = card(pages.memory, 'Backlog', 'Choose explicitly how to handle older unsummarized assistant turns. One batch creates a snippet; processing the entire backlog also promotes older snippets into higher layers.')
  const backlogText = el('p')
  const progress = el('progress')
  const progressLabel = el('p', 'sc-muted')
  const actions = el('div', 'sc-row')
  const one = button('One batch', () => { void perform('summarize', { mode: 'one' }) }, 'sc-primary')
  const all = button('Process entire backlog', () => { void perform('summarize', { mode: 'all' }) })
  const skip = button('Skip backlog', () => ask('skip', {}, 'Skip the currently eligible backlog? These original messages remain in prompts and are not ghosted.'))
  const stop = button('Cancel processing', () => { void perform('stop') }, 'sc-danger')
  actions.append(one, all, skip, stop)
  backlog.append(backlogText, progress, progressLabel, actions)
  const memoryTools = el('div', 'sc-row')
  const repair = button('Repair memory', () => { void perform('repair') })
  const clear = button('Clear chat memory', () => ask('clear', {}, 'Clear all Summaryception memory and skipped progress for this chat? Original chat messages are untouched. Summarized messages will return to the prompt immediately.'), 'sc-danger')
  memoryTools.append(repair, clear)
  overview.append(el('p', 'sc-muted', 'Repair reconciles memory against edited, deleted, or swiped source messages. Deleting a snippet also invalidates its dependent later summaries.'), memoryTools)
  const snippets = card(pages.memory, 'Snippets by layer', 'Higher layers hold compact older memories. Layer 1 contains the most recent summaries.')
  const search = el('input')
  search.type = 'search'
  search.placeholder = 'Search snippet text'
  search.setAttribute('aria-label', 'Search snippet text')
  search.addEventListener('input', renderSnippets)
  const snippetList = el('div')
  snippets.append(search, snippetList)

  const settingsCard = card(pages.settings, 'Memory behavior', 'Settings apply across your chats. Saving does not automatically process a backlog.')
  const settingsForm = el('form')
  settingsCard.append(settingsForm)
  const inputs: Partial<Record<keyof Settings, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>> = {}
  function toggle(key: 'enabled' | 'pauseSummarization' | 'disableGhosting' | 'debugMode', title: string, help: string): void {
    const input = el('input')
    input.type = 'checkbox'
    inputs[key] = input
    input.addEventListener('change', () => { drafts[key] = input.checked; settingsDirty = true; renderSettingsStatus() })
    const label = el('label', 'sc-toggle')
    const text = el('span')
    text.append(el('span', '', title), el('span', 'sc-muted', help))
    label.append(input, text)
    settingsForm.append(label)
  }
  toggle('enabled', 'Enable Summaryception', 'Disabled: no memory injection, prompt filtering, or automatic summaries. Stored snippets remain available.')
  toggle('pauseSummarization', 'Pause automatic summarization', 'Paused: existing memory still injects and ghosting remains active. Manual processing is still available.')
  toggle('disableGhosting', 'Keep summarized messages in prompts', 'Ghosting opt-out: retain originals alongside memory. Host message visibility / hidden flags are never changed.')
  const numberGrid = el('div', 'sc-grid')
  settingsForm.append(numberGrid)
  const numeric: { key: 'verbatimTurns' | 'turnsPerSummary' | 'snippetsPerLayer' | 'snippetsPerPromotion' | 'maxLayers' | 'responseTokens'; title: string; min: number; max: number; help: string }[] = [
    { key: 'verbatimTurns', title: 'Recent assistant turns', min: 0, max: 1000, help: 'Kept verbatim; user/system messages are not counted as assistant turns.' },
    { key: 'turnsPerSummary', title: 'Assistant turns per batch', min: 1, max: 1000, help: 'Size of each new summary.' },
    { key: 'snippetsPerLayer', title: 'Snippets per layer', min: 1, max: 1000, help: 'Threshold before older snippets are promoted.' },
    { key: 'snippetsPerPromotion', title: 'Snippets per promotion', min: 2, max: 1000, help: 'Older snippets merged per recursive summary.' },
    { key: 'maxLayers', title: 'Maximum layers', min: 1, max: 20, help: 'Limits recursive memory depth.' },
    { key: 'responseTokens', title: 'Summary response tokens', min: 0, max: 32768, help: 'Native connection generation output limit. 0 uses the preset / provider default.' },
  ]
  for (const spec of numeric) {
    const input = el('input')
    input.type = 'number'
    input.min = String(spec.min)
    input.max = String(spec.max)
    input.step = '1'
    input.required = true
    inputs[spec.key] = input
    input.addEventListener('input', () => {
      if (input.value !== '' && input.validity.valid) drafts[spec.key] = Number(input.value)
      settingsDirty = true
      renderSettingsStatus()
    })
    numberGrid.append(field(spec.title, input, spec.help))
  }
  const connection = el('select')
  inputs.connectionId = connection
  connection.addEventListener('change', () => { drafts.connectionId = connection.value; settingsDirty = true; renderSettingsStatus() })
  settingsForm.append(field('Summarization connection profile', connection, 'Use the active native connection by default, or select a dedicated profile. Manage endpoints and credentials in Lumiverse Connections.'))
  toggle('debugMode', 'Debug mode', 'Enable backend diagnostic logging.')
  const saveSettings = button('Save settings', () => { void saveDrafts() }, 'sc-primary')
  const discardSettings = button('Discard unsaved changes', () => { if (state) drafts = structuredClone(state.settings); settingsDirty = false; syncInputs(); render() })
  const settingsStatus = el('p', 'sc-muted')
  settingsForm.append(el('div', 'sc-row'), settingsStatus)
  settingsForm.lastElementChild?.previousElementSibling?.append(saveSettings, discardSettings)
  settingsForm.addEventListener('submit', event => { event.preventDefault(); void saveDrafts() })

  const promptCard = card(pages.prompts, 'Summarizer prompts', 'Narrative and Game state are built-in presets. Custom prompts and named slots are saved with your settings.')
  const promptForm = el('form')
  promptCard.append(promptForm)
  const preset = el('select')
  for (const [value, label] of [['narrative', 'Narrative'], ['gamestate', 'Game state'], ['custom', 'Custom']]) {
    const option = el('option', '', label)
    option.value = value
    preset.append(option)
  }
  inputs.promptPreset = preset
  preset.addEventListener('change', () => {
    if (drafts.promptPreset === 'custom') drafts.lastCustomPrompt = userPrompt.value
    const selected = preset.value
    if (selected !== 'narrative' && selected !== 'gamestate' && selected !== 'custom') return
    drafts.promptPreset = selected
    drafts.summarizerUserPrompt = selected === 'custom' ? drafts.lastCustomPrompt || DEFAULT_SETTINGS.summarizerUserPrompt : PROMPT_PRESETS[selected]
    userPrompt.value = drafts.summarizerUserPrompt
    settingsDirty = true
    renderSettingsStatus()
  })
  promptForm.append(field('Prompt preset', preset))
  const systemPrompt = el('textarea')
  const userPrompt = el('textarea')
  const injectionTemplate = el('textarea')
  const stripPatterns = el('textarea')
  inputs.summarizerSystemPrompt = systemPrompt
  inputs.summarizerUserPrompt = userPrompt
  inputs.injectionTemplate = injectionTemplate
  inputs.stripPatterns = stripPatterns
  for (const [key, input] of [['summarizerSystemPrompt', systemPrompt], ['summarizerUserPrompt', userPrompt], ['injectionTemplate', injectionTemplate]] as const) {
    input.addEventListener('input', () => {
      drafts[key] = input.value
      if (key === 'summarizerUserPrompt') { drafts.promptPreset = 'custom'; drafts.lastCustomPrompt = input.value; preset.value = 'custom' }
      settingsDirty = true
      renderSettingsStatus()
    })
  }
  stripPatterns.addEventListener('input', () => { drafts.stripPatterns = stripPatterns.value.split('\n').filter(line => line.trim()); settingsDirty = true; renderSettingsStatus() })
  promptForm.append(field('System prompt', systemPrompt), field('User prompt', userPrompt, 'Placeholders: {{story_txt}} for source text, {{context_str}} for existing memory, {{player_name}} for the player.'), field('Memory injection template', injectionTemplate, 'Include {{summary}} where the recursive memory should appear.'), field('Output stripping strings', stripPatterns, 'One literal string per line, removed from generated summaries. Reasoning blocks are removed automatically.'))
  const slots = el('select')
  slots.setAttribute('aria-label', 'Saved custom prompt slot')
  const slotName = el('input')
  slotName.type = 'text'
  slotName.maxLength = 120
  slotName.placeholder = 'Named prompt slot'
  slotName.setAttribute('aria-label', 'New custom prompt slot name')
  const loadSlot = button('Load slot', () => {
    if (!Object.hasOwn(drafts.savedCustomPrompts, slots.value)) return
    drafts.summarizerUserPrompt = drafts.savedCustomPrompts[slots.value]
    drafts.lastCustomPrompt = drafts.summarizerUserPrompt
    drafts.promptPreset = 'custom'
    settingsDirty = true
    syncInputs()
    renderSettingsStatus()
  })
  const saveSlot = button('Save named slot', () => {
    const name = slotName.value.trim()
    if (!name) { localError = 'Enter a name for the custom prompt slot.'; render(); return }
    drafts.savedCustomPrompts = { ...drafts.savedCustomPrompts, [name]: userPrompt.value }
    settingsDirty = true
    renderSlots(name)
    renderSettingsStatus()
  })
  const deleteSlot = button('Delete slot', () => {
    const name = slots.value
    if (!Object.hasOwn(drafts.savedCustomPrompts, name)) return
    const remaining = { ...drafts.savedCustomPrompts }
    delete remaining[name]
    drafts.savedCustomPrompts = remaining
    settingsDirty = true
    renderSlots()
    renderSettingsStatus()
  }, 'sc-danger')
  promptForm.append(field('Saved custom prompts', slots), field('Slot name (saving the same name replaces it)', slotName), el('div', 'sc-row'))
  promptForm.lastElementChild?.append(loadSlot, saveSlot, deleteSlot)
  const savePrompts = button('Save prompts and settings', () => { void saveDrafts() }, 'sc-primary')
  promptForm.append(el('p', 'sc-muted', 'Named slots store the user prompt. Click Save prompts and settings to persist all changes.'), savePrompts)
  promptForm.addEventListener('submit', event => { event.preventDefault(); void saveDrafts() })

  const previewCard = card(pages.preview, 'Exact injected memory', 'This is the backend-generated memory block, not an estimate of the entire host prompt. Disabling Summaryception removes it; pausing leaves it active.')
  const previewStats = el('p', 'sc-muted')
  const previewText = el('pre', 'sc-text sc-preview')
  previewText.tabIndex = 0
  previewCard.append(previewStats, previewText)
  const transferCard = card(pages.transfer, 'Export / Import', 'Exports contain chat memory and source fingerprints, not connection credentials or original message text. Imports replace current memory after backend provenance validation. Compatible original Summaryception exports are supported.')
  const exportButton = button('Download memory JSON', () => { void downloadExport() })
  const file = el('input')
  file.type = 'file'
  file.accept = '.json,application/json'
  file.addEventListener('change', () => {
    const selected = file.files?.[0]
    const selectedChat = chatId
    const selectedEpoch = epoch
    if (!selected) return
    void selected.text().then(text => {
      if (destroyed || selectedEpoch !== epoch || selectedChat !== ctx.getActiveChat().chatId) return
      importText.value = text
      notice = 'File loaded. Review it and click Import memory.'
      render()
    }).catch(error => { if (selectedEpoch === epoch) { localError = error instanceof Error ? error.message : String(error); render() } })
  })
  const importText = el('textarea')
  importText.placeholder = 'Paste a Summaryception memory export as JSON'
  const importButton = button('Import memory', () => {
    let data: unknown
    try { data = JSON.parse(importText.value) } catch { localError = 'Import is not valid JSON.'; render(); return }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { localError = 'Import must be a memory JSON object.'; render(); return }
    ask('import', { data }, 'Replace this chat’s current memory with the imported export? Source ranges and fingerprints must match this chat. Export your existing memory first if you want a backup.')
  }, 'sc-primary')
  transferCard.append(exportButton, field('Load JSON file', file), field('Import JSON', importText), importButton)

  function renderNavigation(): void {
    for (const name of Object.keys(pages) as Page[]) {
      pages[name].hidden = name !== page
      nav[name].setAttribute('aria-selected', String(name === page))
      nav[name].tabIndex = name === page ? 0 : -1
    }
  }
  function renderSettingsStatus(): void {
    settingsStatus.textContent = settingsDirty ? 'Unsaved changes. Save either settings or prompts to apply all changes.' : 'Settings are saved.'
    saveSettings.disabled = savePrompts.disabled = !state || locked()
  }
  function renderSlots(selected = slots.value): void {
    slots.replaceChildren()
    const placeholder = el('option', '', 'Select a saved custom prompt')
    placeholder.value = ''
    slots.append(placeholder)
    for (const name of Object.keys(drafts.savedCustomPrompts).sort()) { const option = el('option', '', name); option.value = name; slots.append(option) }
    slots.value = selected
  }
  function syncInputs(): void {
    for (const [key, input] of Object.entries(inputs)) {
      if (!input) continue
      const value = drafts[key as keyof Settings]
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = value === true
      else input.value = Array.isArray(value) ? value.join('\n') : String(value)
    }
    renderConnections()
    renderSlots()
    renderSettingsStatus()
  }
  function renderConnections(): void {
    const selected = settingsDirty ? connection.value || drafts.connectionId : drafts.connectionId
    const options = [{ id: '', name: 'Active Lumiverse connection (default)' }, ...(state?.connections || [])]
    if (selected && !options.some(item => item.id === selected)) options.push({ id: selected, name: 'Selected profile unavailable — choose another' })
    connection.replaceChildren()
    for (const item of options) { const option = el('option', '', item.name); option.value = item.id; connection.append(option) }
    connection.value = selected
  }
  function locked(): boolean {
    return !!state?.busy || Array.from(pending.values()).some(item => item.action !== 'state' && item.action !== 'stop' && item.epoch === epoch)
  }
  function ask(action: string, args: Record<string, unknown>, text: string): void {
    syncChat()
    if (!chatId || !state || locked()) return
    confirmation = { chatId, action, args, text }
    render()
    confirmBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  function render(): void {
    if (destroyed) return
    renderNavigation()
    const ready = !!state && state.chatId === chatId
    const busy = !!state?.busy
    const disabled = !ready || !chatId || locked()
    status.textContent = !ready ? 'Loading Summaryception state…' : !chatId ? 'No active chat. Open a chat to manage memory; global settings are available below.' : `${state?.settings.enabled ? state.settings.pauseSummarization ? 'Automatic summaries paused · memory remains active' : 'Summaryception enabled' : 'Summaryception disabled · no memory injection or ghosting'}\nChat: ${chatId}${busy ? '\nProcessing summaries. You may cancel safely; completed batches are retained.' : ''}`
    errors.textContent = localError || state?.error || ''
    errors.hidden = !errors.textContent
    noticeBox.textContent = notice
    noticeBox.hidden = !notice
    confirmBox.hidden = !confirmation
    confirmText.textContent = confirmation?.text || ''
    for (const control of [one, all, skip]) control.disabled = disabled || !state?.eligibleTurns
    for (const control of [repair, clear, exportButton, importButton, file, importText]) control.disabled = disabled
    stop.disabled = !busy
    stop.hidden = !busy
    backlogText.textContent = chatId ? `${state?.eligibleTurns || 0} eligible older assistant turn(s). The most recent ${state?.settings.verbatimTurns ?? drafts.verbatimTurns} assistant turns remain verbatim.` : 'Open a chat to inspect its backlog.'
    progress.hidden = progressLabel.hidden = !busy
    progress.max = Math.max(1, state?.progress?.total || 1)
    progress.value = state?.progress?.completed || 0
    progressLabel.textContent = state?.progress ? `${state.progress.completed} of ${state.progress.total} batch(es) completed` : 'Starting…'
    stats.replaceChildren()
    const store = state?.store
    const metrics = [ ['Snippets', store?.layers.reduce((total, layer) => total + layer.length, 0) || 0], ['Layers', store?.layers.filter(layer => layer.length).length || 0], ['Ghosted messages', state?.ghostedCount || 0], ['Processed messages', store?.sources.length || 0], ['Skipped prefix', store?.skipped || 0] ] as const
    for (const [label, value] of metrics) { const stat = el('div', 'sc-stat'); stat.append(el('strong', '', String(value)), el('span', 'sc-muted', label)); stats.append(stat) }
    previewText.textContent = state?.preview || (chatId ? 'No memory is currently injected.' : 'Open a chat to preview its memory.')
    previewStats.textContent = `${state?.preview.length || 0} characters · ${state?.settings.disableGhosting ? 'Originals retained in prompts' : 'Covered originals excluded only while enabled'} · ${state?.settings.enabled ? 'Injection enabled' : 'Injection disabled'}`
    renderSettingsStatus()
    for (const input of Object.values(inputs)) if (input) input.disabled = !ready || locked()
    for (const control of [slots, slotName, loadSlot, saveSlot, deleteSlot, discardSettings]) control.disabled = !ready || locked()
    for (const control of confirmActions.querySelectorAll('button')) control.disabled = disabled
    tab.setBadge(busy ? '…' : state?.eligibleTurns ? String(state.eligibleTurns) : null)
    renderSnippets()
    scheduleMarkers()
  }
  function renderSnippets(): void {
    snippetList.replaceChildren()
    const store = state?.store
    if (!store || !store.layers.some(layer => layer.length)) { snippetList.append(el('p', 'sc-muted', chatId ? 'No snippets yet. Summarize one batch or process the backlog to create memory.' : 'Open a chat to browse its snippets.')); return }
    const query = search.value.toLocaleLowerCase()
    let found = 0
    for (let index = store.layers.length - 1; index >= 0; index--) {
      const matching = store.layers[index].filter(snippet => snippet.text.toLocaleLowerCase().includes(query))
      if (!matching.length) continue
      const group = el('section', 'sc-card')
      group.append(el('h3', '', `Layer ${index + 1} · ${matching.length} snippet(s)`))
      for (const snippet of matching) { group.append(snippetCard(snippet, store)); found++ }
      snippetList.append(group)
    }
    if (!found) snippetList.append(el('p', 'sc-muted', 'No snippets match the search.'))
  }
  function snippetCard(snippet: Snippet, store: Store): HTMLElement {
    const node = el('article', 'sc-snippet')
    const date = new Date(snippet.timestamp)
    node.append(el('div', 'sc-muted', `Messages ${snippet.start + 1}–${snippet.end + 1} · ${Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString()}`))
    const controls = el('div', 'sc-row')
    const selectedChat = store.chatId
    const editing = edit?.chatId === selectedChat && edit.snippetId === snippet.id
    if (editing) {
      const input = el('textarea')
      input.value = edit?.text || ''
      input.setAttribute('aria-label', 'Edit snippet text')
      input.disabled = locked()
      input.addEventListener('input', () => { if (edit?.chatId === selectedChat && edit.snippetId === snippet.id) edit.text = input.value })
      node.append(input)
      controls.append(button('Save snippet', () => {
        if (!edit || edit.chatId !== selectedChat) return
        const text = edit.text.trim()
        if (!text) { localError = 'Snippet text cannot be empty. Use Delete to restore its source messages.'; render(); return }
        void perform('edit', { snippetId: snippet.id, text }, selectedChat).then(ok => { if (ok && edit?.chatId === selectedChat && edit.snippetId === snippet.id) { edit = null; render() } })
      }, 'sc-primary'), button('Discard edit', () => { edit = null; renderSnippets() }))
    } else {
      node.append(el('pre', 'sc-text', snippet.text))
      controls.append(button('Edit', () => { if (ctx.getActiveChat().chatId !== selectedChat) return; edit = { chatId: selectedChat, snippetId: snippet.id, text: snippet.text }; renderSnippets() }))
    }
    controls.append(button('Regenerate', () => { void perform('regenerate', { snippetId: snippet.id }, selectedChat) }), button('Delete', () => {
      if (ctx.getActiveChat().chatId !== selectedChat) return
      ask('delete', { snippetId: snippet.id }, 'Delete this snippet and every later summary that depends on it? Their source messages return to the prompt and become eligible for summarization again.')
    }, 'sc-danger'))
    for (const control of controls.querySelectorAll('button')) control.disabled = locked() || !state || state.chatId !== selectedChat
    node.append(controls)
    return node
  }

  async function saveDrafts(): Promise<void> {
    if (!state || locked()) return
    for (const spec of numeric) {
      const input = inputs[spec.key]
      if (!input || !(input instanceof HTMLInputElement) || !input.reportValidity() || input.value === '') return
      drafts[spec.key] = Number(input.value)
    }
    const changes: Partial<Settings> = {}
    for (const key of Object.keys(drafts) as (keyof Settings)[]) {
      if (JSON.stringify(drafts[key]) !== JSON.stringify(state.settings[key])) Object.assign(changes, { [key]: drafts[key] })
    }
    const saved = structuredClone(drafts)
    const selectedEpoch = epoch
    if (await perform('settings', { settings: changes })) {
      if (destroyed || selectedEpoch !== epoch) return
      if (JSON.stringify(saved) === JSON.stringify(drafts)) { settingsDirty = false; if (state) drafts = structuredClone(state.settings); syncInputs() }
      notice = 'Settings and prompts saved.'
      render()
    }
  }
  function send(action: string, args: Record<string, unknown> = {}, selectedChat = chatId): Promise<unknown> {
    const deferred = Promise.withResolvers<unknown>()
    const requestId = `sc-${Date.now()}-${++requestSequence}`
    const timer = window.setTimeout(() => {
      const item = pending.get(requestId)
      if (!item) return
      pending.delete(requestId)
      item.reject(new Error('Summaryception did not respond. Refresh to reconnect before trying again.'))
    }, 60000)
    pending.set(requestId, { chatId: selectedChat, epoch, action, timer, resolve: deferred.resolve, reject: deferred.reject })
    try { ctx.sendToBackend({ type: 'sc:request', requestId, action, ...(selectedChat ? { chatId: selectedChat } : {}), ...args }) }
    catch (error) { pending.delete(requestId); window.clearTimeout(timer); deferred.reject(error instanceof Error ? error : new Error(String(error))) }
    render()
    return deferred.promise
  }
  async function perform(action: string, args: Record<string, unknown> = {}, selectedChat = chatId): Promise<boolean> {
    syncChat()
    if (selectedChat !== chatId || destroyed || (action !== 'stop' && locked())) return false
    const selectedEpoch = epoch
    localError = ''
    notice = ''
    try {
      await send(action, args, selectedChat)
      if (selectedEpoch !== epoch || destroyed) return false
      notice = action === 'stop' ? 'Cancellation requested. Completed batches remain saved.' : action === 'repair' ? 'Memory reconciled with current chat sources.' : action === 'skip' ? 'Backlog skipped without ghosting its original messages.' : action === 'clear' ? 'Chat memory cleared. Original messages are untouched.' : action === 'import' ? 'Memory imported.' : ''
      return true
    } catch (error) { if (selectedEpoch === epoch && !destroyed) localError = error instanceof Error ? error.message : String(error); return false }
    finally { render() }
  }
  async function refresh(): Promise<void> {
    syncChat()
    if (Array.from(pending.values()).some(item => item.action === 'state' && item.epoch === epoch)) return
    const selectedEpoch = epoch
    try { await send('state') } catch (error) { if (selectedEpoch === epoch && !destroyed) { localError = error instanceof Error ? error.message : String(error); render() } }
  }
  async function downloadExport(): Promise<void> {
    const selectedChat = chatId
    const selectedEpoch = epoch
    if (!selectedChat || locked()) return
    localError = ''
    try {
      const data = v.parse(storeSchema, await send('export', {}, selectedChat))
      if (destroyed || selectedEpoch !== epoch || selectedChat !== ctx.getActiveChat().chatId) return
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = el('a')
      link.href = url
      link.download = `summaryception-${selectedChat.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
      shell.append(link)
      link.click()
      link.remove()
      const timer = window.setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url) }, 1000)
      downloads.set(url, timer)
      notice = 'Memory export downloaded.'
    } catch (error) { if (selectedEpoch === epoch) localError = error instanceof Error ? error.message : String(error) }
    finally { render() }
  }
  function clearMarkers(): void {
    for (const marker of markers.values()) ctx.dom.uninject(marker)
    markers.clear()
  }
  function scheduleMarkers(): void {
    if (destroyed || markerFrame !== null) return
    markerFrame = requestAnimationFrame(() => {
      markerFrame = null
      if (destroyed) return
      const active = ctx.getActiveChat().chatId
      const covered = state && active === state.chatId && state.settings.enabled && !state.settings.disableGhosting ? new Set(state.ghostedIds) : new Set<string>()
      for (const [id, marker] of markers) if (!covered.has(id)) { ctx.dom.uninject(marker); markers.delete(id) }
      if (!covered.size || typeof ctx.dom.listMessageElements !== 'function') return
      for (const { messageId, element } of ctx.dom.listMessageElements()) {
        if (!covered.has(messageId) || markers.has(messageId)) continue
        const marker = ctx.dom.inject(element, '<span class="sc-ghost-marker">Summaryception: covered by memory · excluded from prompt</span>', 'beforeend')
        markers.set(messageId, marker)
      }
    })
  }
  function syncChat(): void {
    const current = ctx.getActiveChat().chatId || null
    if (current === chatId) return
    chatId = current
    epoch++
    state = null
    localError = ''
    notice = ''
    edit = null
    confirmation = null
    commandAfterLoad = null
    importText.value = ''
    file.value = ''
    search.value = ''
    clearMarkers()
    render()
    void refresh()
  }
  cleanups.push(ctx.onBackendMessage((payload: unknown) => {
    if (destroyed) return
    const parsed = v.safeParse(payloadSchema, payload)
    if (!parsed.success) {
      if (payload && typeof payload === 'object' && 'type' in payload && typeof payload.type === 'string' && payload.type.startsWith('sc:')) { localError = 'Received an invalid Summaryception response. Refresh to reconnect.'; render() }
      return
    }
    syncChat()
    const message = parsed.output
    if (message.type === 'sc:command') {
      if (message.chatId && message.chatId !== chatId) return
      tab.activate()
      page = message.command === 'sc-preview' ? 'preview' : 'memory'
      if (message.command === 'sc-clear') { if (state) ask('clear', {}, 'Clear all memory for this chat? Original messages remain untouched.'); else commandAfterLoad = 'sc-clear' }
      render()
      void refresh()
      return
    }
    let incoming: State | undefined
    if (message.type === 'sc:response') {
      const item = pending.get(message.requestId)
      if (!item) return
      pending.delete(message.requestId)
      window.clearTimeout(item.timer)
      if (item.epoch !== epoch || item.chatId !== chatId) { item.reject(new Error('The active chat changed.')); render(); return }
      if (!message.ok) { item.reject(new Error(message.error || 'Summaryception operation failed.')); render(); return }
      incoming = message.state
      if (incoming && incoming.chatId !== chatId) { item.reject(new Error('The response belongs to another chat. Refresh the current chat.')); render(); return }
      item.resolve(message.data)
    } else incoming = message.state
    if (incoming && incoming.chatId === chatId && (!incoming.store || incoming.store.chatId === chatId)) {
      state = incoming
      localError = ''
      if (!settingsDirty) { drafts = structuredClone(incoming.settings); syncInputs() } else renderConnections()
      if (commandAfterLoad && chatId && !locked()) { commandAfterLoad = null; ask('clear', {}, 'Clear all memory for this chat? Original messages remain untouched.') }
    } else if (incoming && state?.busy !== incoming.busy) void refresh()
    render()
  }))
  for (const event of ['CHAT_SWITCHED', 'CHAT_CHANGED', 'SETTINGS_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'SWIPE_EDITED', 'GENERATION_ENDED']) {
    cleanups.push(ctx.events.on(event, () => { syncChat(); void refresh() }))
  }
  cleanups.push(tab.onActivate(() => { syncChat(); void refresh(); scheduleMarkers() }))
  const chatWatch = window.setInterval(syncChat, 1250)
  const observer = new MutationObserver(records => {
    if (!markers.size && !state?.ghostedIds.length) return
    if (records.some(record => !shell.contains(record.target))) scheduleMarkers()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  syncInputs()
  render()
  void refresh()
  return () => {
    destroyed = true
    epoch++
    observer.disconnect()
    window.clearInterval(chatWatch)
    if (markerFrame !== null) cancelAnimationFrame(markerFrame)
    for (const item of pending.values()) { window.clearTimeout(item.timer); item.reject(new Error('Summaryception frontend was unloaded.')) }
    pending.clear()
    for (const [url, timer] of downloads) { window.clearTimeout(timer); URL.revokeObjectURL(url) }
    downloads.clear()
    for (const cleanup of cleanups) cleanup()
    clearMarkers()
    tab.destroy()
    removeStyle()
  }
}
