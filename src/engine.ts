// Adapted from Lodactio/Extension-Summaryception (AGPL-3.0).
// This module has no host/runtime imports: it is shared by the backend and UI.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
export interface Settings {
  enabled: boolean;
  verbatimTurns: number;
  turnsPerSummary: number;
  snippetsPerLayer: number;
  snippetsPerPromotion: number;
  maxLayers: number;
  pauseSummarization: boolean;
  disableGhosting: boolean;
  connectionId: string;
  responseTokens: number;
  promptPreset: 'narrative' | 'gamestate' | 'custom';
  summarizerSystemPrompt: string;
  summarizerUserPrompt: string;
  injectionTemplate: string;
  stripPatterns: string[];
  savedCustomPrompts: Record<string, string>;
  lastCustomPrompt: string;
  debugMode: boolean;
}
export interface Message { id: string; role: string; content: string; name?: string }
export interface Snippet { id: string; text: string; start: number; end: number; timestamp: number }
export interface Source { id: string; fingerprint: string }
export interface Store { version: 1; chatId: string; layers: Snippet[][]; sources: Source[]; skipped: number }
export type Summarize = (story: string, context: string, signal: AbortSignal) => Promise<string>;

const PASSAGE = `<player_name>
{{player_name}}
</player_name>

<prior_context>
{{context_str}}
</prior_context>

<passage_in_question>
{{story_txt}}
</passage_in_question>`;
export const PROMPT_PRESETS = Object.freeze({
  narrative: `${PASSAGE}

Summarize only the necessary elements from the passage_in_question to coherently continue the prior_context. If the passage_in_question has 2nd person point of view, 'you' pronoun in prose refers to the player. Use the player name in the final response instead of 'you'.

IF prior_context has no content: include establishing details in the generated summary, extend the maximum number of short phrases up to 40.

Priority Elements: Time + location changes + narrative themes and subtext + sensory details that establish tone + atmosphere + mood + plot developments + proper names + character motivations + character interactions + dialogue tone + relationship dynamics + emotional beats + unresolved tensions.

Exclude anything insubstantial, fluff, or events already covered in prior_context.

Write in short *phrases* — up to 20; final response must be a single line:`,
  gamestate: `${PASSAGE}

Summarize only the necessary elements from the passage_in_question to coherently continue the prior_context.

Focus on: story progression, plot points, plans, tasks, quests; location changes and current location (reference by name); location interactables encountered, used, or discovered; significant changes to player, NPCs, locations, world, or setting.

Exclude anything insubstantial, fluff, atmospheric details, or events already covered in Prior Context.
Skip any passages that are empty, unclear, or lack significant content.
Write in short phrases, no more than 20; output must be a single line:`,
});
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  enabled: true, verbatimTurns: 10, turnsPerSummary: 3, snippetsPerLayer: 20,
  snippetsPerPromotion: 3, maxLayers: 5, pauseSummarization: false, disableGhosting: false,
  connectionId: '', responseTokens: 512, promptPreset: 'narrative',
  summarizerSystemPrompt: 'Role: precise narrative-state tracker. Output only the summary line — no preamble, no commentary, no markdown.',
  summarizerUserPrompt: PROMPT_PRESETS.narrative,
  injectionTemplate: '\n\n<auto_injected_historical_context>\n[system guidance: this is a historical summary of messages that occurred prior to the oldest assistant message currently in context for this chat]\n{{summary}}\n</auto_injected_historical_context>\n\n',
  stripPatterns: ['<|channel>thought', '<channel|>', '<output>', '</output>', '<thinking>', '</thinking>'],
  savedCustomPrompts: {}, lastCustomPrompt: '', debugMode: false,
});
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function normalizeSettings(value: unknown): Settings {
  const input = object(value) ? value : {};
  const result: Settings = { ...DEFAULT_SETTINGS, stripPatterns: [...DEFAULT_SETTINGS.stripPatterns], savedCustomPrompts: {} };
  for (const key of ['enabled', 'pauseSummarization', 'disableGhosting', 'debugMode'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  const bounds = { verbatimTurns: [0, 1000], turnsPerSummary: [1, 1000], snippetsPerLayer: [1, 1000], snippetsPerPromotion: [2, 1000], maxLayers: [1, 20], responseTokens: [0, 32768] } as const;
  for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
    const number = input[key];
    if (typeof number === 'number' && Number.isFinite(number)) result[key] = Math.max(bounds[key][0], Math.min(bounds[key][1], Math.trunc(number)));
  }
  for (const key of ['connectionId', 'summarizerSystemPrompt', 'summarizerUserPrompt', 'injectionTemplate', 'lastCustomPrompt'] as const) {
    if (typeof input[key] === 'string') result[key] = input[key];
  }
  if (input.promptPreset === 'gamestate' || input.promptPreset === 'custom' || input.promptPreset === 'narrative') result.promptPreset = input.promptPreset;
  if (Array.isArray(input.stripPatterns)) result.stripPatterns = input.stripPatterns.filter((pattern): pattern is string => typeof pattern === 'string' && pattern.length > 0);
  if (object(input.savedCustomPrompts)) {
    for (const [name, prompt] of Object.entries(input.savedCustomPrompts)) {
      if (name.trim() && typeof prompt === 'string') Object.defineProperty(result.savedCustomPrompts, name, { value: prompt, enumerable: true, configurable: true, writable: true });
    }
  }
  if (result.promptPreset !== 'custom') result.summarizerUserPrompt = PROMPT_PRESETS[result.promptPreset];
  else if (typeof input.summarizerUserPrompt !== 'string' && result.lastCustomPrompt) result.summarizerUserPrompt = result.lastCustomPrompt;
  return result;
}

export function fingerprint(message: Message): string {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([message.id, message.role, message.content, message.name || '']))));
}
function sources(messages: Message[], end: number): Source[] {
  const result: Source[] = [];
  const ids = new Set<string>();
  for (let i = 0; i <= end; i++) {
    const message = messages[i];
    if (!message || typeof message.id !== 'string' || !message.id || typeof message.role !== 'string' || typeof message.content !== 'string' || ids.has(message.id)) throw new Error('Chat messages need unique stable identities and text.');
    ids.add(message.id); result.push({ id: message.id, fingerprint: fingerprint(message) });
  }
  return result;
}
export function createStore(chatId: string): Store {
  return { version: 1, chatId, layers: [], sources: [], skipped: 0 };
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function checkLayers(layers: Snippet[][], sourceCount: number): void {
  const ids = new Set<string>();
  const ranges: Snippet[] = [];
  for (const layer of layers) {
    let previousEnd = -1;
    for (const snippet of layer) {
      if (!snippet.id || ids.has(snippet.id) || !snippet.text.trim() || !integer(snippet.start) || !integer(snippet.end) || snippet.start > snippet.end || snippet.end >= sourceCount || !Number.isFinite(snippet.timestamp) || snippet.timestamp < 0 || snippet.start <= previousEnd) throw new Error('Invalid or overlapping snippet source range.');
      ids.add(snippet.id); ranges.push(snippet); previousEnd = snippet.end;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) if (ranges[i].start <= ranges[i - 1].end) throw new Error('Memory snippets have overlapping coverage.');
}
/** Parse trusted persisted memory structurally, then reconcile it against current messages. */
export function parseStoredStore(data: unknown, chatId: string): Store {
  if (!object(data) || data.version !== 1 || data.chatId !== chatId || !Array.isArray(data.layers) || !Array.isArray(data.sources) || !integer(data.skipped) || data.skipped > data.sources.length) throw new Error('Invalid memory store or mismatched chat.');
  const store = createStore(chatId);
  const ids = new Set<string>();
  store.sources = data.sources.map(source => {
    if (!object(source) || typeof source.id !== 'string' || !source.id || ids.has(source.id) || typeof source.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(source.fingerprint)) throw new Error('Invalid source fingerprints.');
    ids.add(source.id); return { id: source.id, fingerprint: source.fingerprint };
  });
  store.layers = data.layers.map(layer => {
    if (!Array.isArray(layer)) throw new Error('Memory layers must be arrays.');
    return layer.map(snippet => {
      if (!object(snippet) || typeof snippet.id !== 'string' || typeof snippet.text !== 'string' || typeof snippet.start !== 'number' || typeof snippet.end !== 'number' || typeof snippet.timestamp !== 'number') throw new Error('Invalid memory snippet.');
      return { id: snippet.id, text: snippet.text, start: snippet.start, end: snippet.end, timestamp: snippet.timestamp };
    });
  });
  store.skipped = data.skipped;
  checkLayers(store.layers, store.sources.length);
  return store;
}
/** Native imports must match the current chat. Legacy ST imports bind explicit ranges to it. */
export function validateStore(data: unknown, chatId: string, messages: Message[]): Store {
  if (object(data) && 'version' in data) {
    const store = parseStoredStore(data, chatId);
    for (let i = 0; i < store.sources.length; i++) {
      if (!messages[i] || messages[i].id !== store.sources[i].id || fingerprint(messages[i]) !== store.sources[i].fingerprint) throw new Error('Imported memory does not match this chat history.');
    }
    return store;
  }
  if (!object(data) || !Array.isArray(data.layers) || !Number.isSafeInteger(data.summarizedUpTo) || (data.summarizedUpTo as number) < -1 || (data.summarizedUpTo as number) >= messages.length || ('chatId' in data && data.chatId !== chatId)) throw new Error('Invalid SillyTavern memory or mismatched chat.');
  const store = createStore(chatId);
  store.sources = sources(messages, data.summarizedUpTo as number);
  store.layers = data.layers.map((layer, layerIndex) => {
    if (!Array.isArray(layer)) throw new Error('SillyTavern layers must be nested arrays.');
    return layer.map((snippet, index) => {
      if (!object(snippet) || typeof snippet.text !== 'string' || !Array.isArray(snippet.turnRange) || snippet.turnRange.length !== 2 || typeof snippet.timestamp !== 'number') throw new Error('Legacy promoted memory has no recoverable source range; import ranged snippets only.');
      return { id: `st-${layerIndex}-${index}`, text: snippet.text, start: snippet.turnRange[0] as number, end: snippet.turnRange[1] as number, timestamp: snippet.timestamp };
    });
  });
  checkLayers(store.layers, store.sources.length);
  store.skipped = store.sources.length - coveredIds(store).size;
  return store;
}
export function reconcile(store: Store, messages: Message[]): boolean {
  let mismatch = -1;
  for (let i = 0; i < store.sources.length; i++) {
    if (!messages[i] || store.sources[i].id !== messages[i].id || store.sources[i].fingerprint !== fingerprint(messages[i])) { mismatch = i; break; }
  }
  if (mismatch < 0) return false;
  let cutoff = mismatch;
  for (const layer of store.layers) for (const snippet of layer) if (snippet.end >= mismatch) cutoff = Math.min(cutoff, snippet.start);
  store.layers = store.layers.map(layer => layer.filter(snippet => snippet.end < cutoff));
  store.sources.length = cutoff;
  store.skipped = store.sources.length - coveredIds(store).size;
  return true;
}
function assistantIndices(messages: Message[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < messages.length; i++) if (messages[i].role === 'assistant' && messages[i].content.trim()) indices.push(i);
  return indices;
}
function eligibleIndices(store: Store, messages: Message[], settings: Settings): number[] {
  const assistants = assistantIndices(messages);
  const oldCount = Math.max(0, assistants.length - settings.verbatimTurns);
  const result: number[] = [];
  for (let i = 0; i < oldCount; i++) if (assistants[i] >= store.sources.length) result.push(assistants[i]);
  return result;
}
export function eligibleCount(store: Store, messages: Message[], settings: Settings): number {
  return eligibleIndices(store, messages, settings).length;
}
export function skipBacklog(store: Store, messages: Message[], settings: Settings): void {
  const eligible = eligibleIndices(store, messages, settings);
  if (!eligible.length) return;
  const nextSources = sources(messages, eligible[eligible.length - 1]);
  for (let i = 0; i < store.sources.length; i++) {
    if (nextSources[i].id !== store.sources[i].id || nextSources[i].fingerprint !== store.sources[i].fingerprint) throw new Error('Chat history changed; reconcile memory before skipping.');
  }
  store.sources = nextSources;
  store.skipped = store.sources.length - coveredIds(store).size;
}
export function coveredIds(store: Store): Set<string> {
  const ids = new Set<string>();
  for (const layer of store.layers) for (const snippet of layer) {
    for (let i = snippet.start; i <= snippet.end; i++) if (store.sources[i]) ids.add(store.sources[i].id);
  }
  return ids;
}
export function summaryText(store: Store, downToLayer = 0): string {
  const parts: string[] = [];
  for (let i = store.layers.length - 1; i >= Math.max(0, downToLayer); i--) for (const snippet of store.layers[i]) parts.push(snippet.text);
  return parts.join(' ');
}
export function injection(store: Store, settings: Settings): string {
  if (!settings.enabled) return '';
  const summary = summaryText(store);
  return summary ? settings.injectionTemplate.split('{{summary}}').join(summary) : '';
}
export function cleanOutput(text: string, settings: Settings): string {
  // Remove reasoning BEFORE stripping the tag delimiters, or their contents leak.
  let output = text.replace(/<\|channel>thought[\s\S]*?(?:<channel\|>|$)/gi, '');
  output = output.replace(/<(thinking|think|reasoning|thought|reflect|inner_monologue)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  output = output.replace(/<output\b[^>]*>([\s\S]*?)<\/output\s*>/gi, '$1');
  for (const pattern of settings.stripPatterns) if (pattern) output = output.split(pattern).join('');
  return output.replace(/\s+/g, ' ').trim();
}
function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Summarization cancelled.', 'AbortError');
}
let serial = 0;
function newSnippet(text: string, start: number, end: number): Snippet {
  const timestamp = Date.now();
  return { id: `sc-${bytesToHex(sha256(utf8ToBytes(JSON.stringify([timestamp, ++serial, start, end, text]))))}`, text, start, end, timestamp };
}
async function generate(story: string, context: string, settings: Settings, summarize: Summarize, signal: AbortSignal): Promise<string> {
  abortIfNeeded(signal);
  const raw = await summarize(story, context, signal);
  abortIfNeeded(signal);
  if (typeof raw !== 'string') throw new Error('Summarizer returned no text.');
  const text = cleanOutput(raw, settings);
  if (!text) throw new Error('Summarizer returned an empty summary.');
  return text;
}
export async function summarizeBatch(store: Store, messages: Message[], settings: Settings, summarize: Summarize, signal: AbortSignal): Promise<boolean> {
  abortIfNeeded(signal);
  const eligible = eligibleIndices(store, messages, settings);
  if (!eligible.length) return false;
  const start = store.sources.length;
  const end = eligible[Math.min(settings.turnsPerSummary, eligible.length) - 1];
  const nextSources = sources(messages, end);
  for (let i = 0; i < start; i++) if (nextSources[i].fingerprint !== store.sources[i].fingerprint || nextSources[i].id !== store.sources[i].id) throw new Error('Chat history changed; reconcile memory before summarizing.');
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    const message = messages[i];
    if (message.role !== 'system' && message.content.trim()) lines.push(`${message.name || (message.role === 'user' ? 'Player' : 'Assistant')}: ${message.content.trim()}`);
  }
  const text = await generate(lines.join('\n'), summaryText(store) || '(none yet)', settings, summarize, signal);
  for (let i = 0; i <= end; i++) if (!messages[i] || messages[i].id !== nextSources[i].id || fingerprint(messages[i]) !== nextSources[i].fingerprint) throw new Error('Chat history changed during summarization.');
  if (store.sources.length !== start) throw new Error('Memory changed during summarization.');
  if (!store.layers[0]) store.layers[0] = [];
  store.layers[0].push(newSnippet(text, start, end));
  store.sources = nextSources;
  return true;
}
/** Each invocation is transactional: even free seeds roll back if a later call fails. */
export async function promoteLayers(store: Store, settings: Settings, summarize: Summarize, signal: AbortSignal): Promise<void> {
  abortIfNeeded(signal);
  const working: Store = { ...store, layers: store.layers.map(layer => [...layer]) };
  let changed = false;
  for (let index = 0; index < settings.maxLayers - 1; index++) {
    const layer = working.layers[index];
    if (!layer) continue;
    while (layer.length > settings.snippetsPerLayer) {
      abortIfNeeded(signal);
      const destination = working.layers[index + 1] || (working.layers[index + 1] = []);
      if (!destination.length) {
        destination.push(layer.shift()!); changed = true; continue;
      }
      let count = 1;
      while (count < Math.min(settings.snippetsPerPromotion, layer.length) && layer[count].start === layer[count - 1].end + 1) count++;
      // Never turn a skipped/deleted gap into summarized coverage.
      if (count === 1) { destination.push(layer.shift()!); changed = true; continue; }
      const inputs = layer.slice(0, count);
      const text = await generate(inputs.map(snippet => snippet.text).join(' '), summaryText(working, index + 1) || '(none yet)', settings, summarize, signal);
      const merged = newSnippet(text, inputs[0].start, inputs[count - 1].end);
      layer.splice(0, count); destination.push(merged); changed = true;
    }
  }
  abortIfNeeded(signal);
  if (changed) store.layers = working.layers;
}
