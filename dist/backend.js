// node_modules/@noble/hashes/utils.js
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== undefined;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out, undefined, "digestInto() output");
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error('"digestInto() output" expected to be of length >=' + min);
  }
}
function clean(...arrays) {
  for (let i = 0;i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0;i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function createHasher(hashCons, info = {}) {
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(undefined);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
var oidNist = (suffix) => ({
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}

class HashMD {
  blockLen;
  outputLen;
  padOffset;
  isLE;
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0;pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (;blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos;i < blockLen; i++)
      buffer[i] = 0;
    view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen must be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0;i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to ||= new this.constructor;
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
}
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);

class SHA2_32B extends HashMD {
  constructor(outputLen) {
    super(64, outputLen, 8, false);
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0;i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16;i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0;i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
}

class _SHA256 extends SHA2_32B {
  A = SHA256_IV[0] | 0;
  B = SHA256_IV[1] | 0;
  C = SHA256_IV[2] | 0;
  D = SHA256_IV[3] | 0;
  E = SHA256_IV[4] | 0;
  F = SHA256_IV[5] | 0;
  G = SHA256_IV[6] | 0;
  H = SHA256_IV[7] | 0;
  constructor() {
    super(32);
  }
}
var sha256 = /* @__PURE__ */ createHasher(() => new _SHA256, /* @__PURE__ */ oidNist(1));

// src/engine.ts
var PASSAGE = `<player_name>
{{player_name}}
</player_name>

<prior_context>
{{context_str}}
</prior_context>

<passage_in_question>
{{story_txt}}
</passage_in_question>`;
var PROMPT_PRESETS = Object.freeze({
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
Write in short phrases, no more than 20; output must be a single line:`
});
var DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  verbatimTurns: 10,
  turnsPerSummary: 3,
  snippetsPerLayer: 20,
  snippetsPerPromotion: 3,
  maxLayers: 5,
  pauseSummarization: false,
  disableGhosting: false,
  connectionId: "",
  responseTokens: 512,
  promptPreset: "narrative",
  summarizerSystemPrompt: "Role: precise narrative-state tracker. Output only the summary line — no preamble, no commentary, no markdown.",
  summarizerUserPrompt: PROMPT_PRESETS.narrative,
  injectionTemplate: `

<auto_injected_historical_context>
[system guidance: this is a historical summary of messages that occurred prior to the oldest assistant message currently in context for this chat]
{{summary}}
</auto_injected_historical_context>

`,
  stripPatterns: ["<|channel>thought", "<channel|>", "<output>", "</output>", "<thinking>", "</thinking>"],
  savedCustomPrompts: {},
  lastCustomPrompt: "",
  debugMode: false
});
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeSettings(value) {
  const input = object(value) ? value : {};
  const result = { ...DEFAULT_SETTINGS, stripPatterns: [...DEFAULT_SETTINGS.stripPatterns], savedCustomPrompts: {} };
  for (const key of ["enabled", "pauseSummarization", "disableGhosting", "debugMode"]) {
    if (typeof input[key] === "boolean")
      result[key] = input[key];
  }
  const bounds = { verbatimTurns: [0, 1000], turnsPerSummary: [1, 1000], snippetsPerLayer: [1, 1000], snippetsPerPromotion: [2, 1000], maxLayers: [1, 20], responseTokens: [0, 32768] };
  for (const key of Object.keys(bounds)) {
    const number = input[key];
    if (typeof number === "number" && Number.isFinite(number))
      result[key] = Math.max(bounds[key][0], Math.min(bounds[key][1], Math.trunc(number)));
  }
  for (const key of ["connectionId", "summarizerSystemPrompt", "summarizerUserPrompt", "injectionTemplate", "lastCustomPrompt"]) {
    if (typeof input[key] === "string")
      result[key] = input[key];
  }
  if (input.promptPreset === "gamestate" || input.promptPreset === "custom" || input.promptPreset === "narrative")
    result.promptPreset = input.promptPreset;
  if (Array.isArray(input.stripPatterns))
    result.stripPatterns = input.stripPatterns.filter((pattern) => typeof pattern === "string" && pattern.length > 0);
  if (object(input.savedCustomPrompts)) {
    for (const [name, prompt] of Object.entries(input.savedCustomPrompts)) {
      if (name.trim() && typeof prompt === "string")
        Object.defineProperty(result.savedCustomPrompts, name, { value: prompt, enumerable: true, configurable: true, writable: true });
    }
  }
  if (result.promptPreset !== "custom")
    result.summarizerUserPrompt = PROMPT_PRESETS[result.promptPreset];
  else if (typeof input.summarizerUserPrompt !== "string" && result.lastCustomPrompt)
    result.summarizerUserPrompt = result.lastCustomPrompt;
  return result;
}
function fingerprint(message) {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([message.id, message.role, message.content, message.name || ""]))));
}
function sources(messages, end) {
  const result = [];
  const ids = new Set;
  for (let i = 0;i <= end; i++) {
    const message = messages[i];
    if (!message || typeof message.id !== "string" || !message.id || typeof message.role !== "string" || typeof message.content !== "string" || ids.has(message.id))
      throw new Error("Chat messages need unique stable identities and text.");
    ids.add(message.id);
    result.push({ id: message.id, fingerprint: fingerprint(message) });
  }
  return result;
}
function createStore(chatId) {
  return { version: 1, chatId, layers: [], sources: [], skipped: 0 };
}
var integer = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function checkLayers(layers, sourceCount) {
  const ids = new Set;
  const ranges = [];
  for (const layer of layers) {
    let previousEnd = -1;
    for (const snippet of layer) {
      if (!snippet.id || ids.has(snippet.id) || !snippet.text.trim() || !integer(snippet.start) || !integer(snippet.end) || snippet.start > snippet.end || snippet.end >= sourceCount || !Number.isFinite(snippet.timestamp) || snippet.timestamp < 0 || snippet.start <= previousEnd)
        throw new Error("Invalid or overlapping snippet source range.");
      ids.add(snippet.id);
      ranges.push(snippet);
      previousEnd = snippet.end;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1;i < ranges.length; i++)
    if (ranges[i].start <= ranges[i - 1].end)
      throw new Error("Memory snippets have overlapping coverage.");
}
function parseStoredStore(data, chatId) {
  if (!object(data) || data.version !== 1 || data.chatId !== chatId || !Array.isArray(data.layers) || !Array.isArray(data.sources) || !integer(data.skipped) || data.skipped > data.sources.length)
    throw new Error("Invalid memory store or mismatched chat.");
  const store = createStore(chatId);
  const ids = new Set;
  store.sources = data.sources.map((source) => {
    if (!object(source) || typeof source.id !== "string" || !source.id || ids.has(source.id) || typeof source.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(source.fingerprint))
      throw new Error("Invalid source fingerprints.");
    ids.add(source.id);
    return { id: source.id, fingerprint: source.fingerprint };
  });
  store.layers = data.layers.map((layer) => {
    if (!Array.isArray(layer))
      throw new Error("Memory layers must be arrays.");
    return layer.map((snippet) => {
      if (!object(snippet) || typeof snippet.id !== "string" || typeof snippet.text !== "string" || typeof snippet.start !== "number" || typeof snippet.end !== "number" || typeof snippet.timestamp !== "number")
        throw new Error("Invalid memory snippet.");
      return { id: snippet.id, text: snippet.text, start: snippet.start, end: snippet.end, timestamp: snippet.timestamp };
    });
  });
  store.skipped = data.skipped;
  checkLayers(store.layers, store.sources.length);
  return store;
}
function validateStore(data, chatId, messages) {
  if (object(data) && "version" in data) {
    const store = parseStoredStore(data, chatId);
    for (let i = 0;i < store.sources.length; i++) {
      if (!messages[i] || messages[i].id !== store.sources[i].id || fingerprint(messages[i]) !== store.sources[i].fingerprint)
        throw new Error("Imported memory does not match this chat history.");
    }
    return store;
  }
  if (!object(data) || !Array.isArray(data.layers) || !Number.isSafeInteger(data.summarizedUpTo) || data.summarizedUpTo < -1 || data.summarizedUpTo >= messages.length || "chatId" in data && data.chatId !== chatId)
    throw new Error("Invalid SillyTavern memory or mismatched chat.");
  const store = createStore(chatId);
  store.sources = sources(messages, data.summarizedUpTo);
  store.layers = data.layers.map((layer, layerIndex) => {
    if (!Array.isArray(layer))
      throw new Error("SillyTavern layers must be nested arrays.");
    return layer.map((snippet, index) => {
      if (!object(snippet) || typeof snippet.text !== "string" || !Array.isArray(snippet.turnRange) || snippet.turnRange.length !== 2 || typeof snippet.timestamp !== "number")
        throw new Error("Legacy promoted memory has no recoverable source range; import ranged snippets only.");
      return { id: `st-${layerIndex}-${index}`, text: snippet.text, start: snippet.turnRange[0], end: snippet.turnRange[1], timestamp: snippet.timestamp };
    });
  });
  checkLayers(store.layers, store.sources.length);
  store.skipped = store.sources.length - coveredIds(store).size;
  return store;
}
function reconcile(store, messages) {
  let mismatch = -1;
  for (let i = 0;i < store.sources.length; i++) {
    if (!messages[i] || store.sources[i].id !== messages[i].id || store.sources[i].fingerprint !== fingerprint(messages[i])) {
      mismatch = i;
      break;
    }
  }
  if (mismatch < 0)
    return false;
  let cutoff = mismatch;
  for (const layer of store.layers)
    for (const snippet of layer)
      if (snippet.end >= mismatch)
        cutoff = Math.min(cutoff, snippet.start);
  store.layers = store.layers.map((layer) => layer.filter((snippet) => snippet.end < cutoff));
  store.sources.length = cutoff;
  store.skipped = store.sources.length - coveredIds(store).size;
  return true;
}
function assistantIndices(messages) {
  const indices = [];
  for (let i = 0;i < messages.length; i++)
    if (messages[i].role === "assistant" && messages[i].content.trim())
      indices.push(i);
  return indices;
}
function eligibleIndices(store, messages, settings) {
  const assistants = assistantIndices(messages);
  const oldCount = Math.max(0, assistants.length - settings.verbatimTurns);
  const result = [];
  for (let i = 0;i < oldCount; i++)
    if (assistants[i] >= store.sources.length)
      result.push(assistants[i]);
  return result;
}
function eligibleCount(store, messages, settings) {
  return eligibleIndices(store, messages, settings).length;
}
function skipBacklog(store, messages, settings) {
  const eligible = eligibleIndices(store, messages, settings);
  if (!eligible.length)
    return;
  const nextSources = sources(messages, eligible[eligible.length - 1]);
  for (let i = 0;i < store.sources.length; i++) {
    if (nextSources[i].id !== store.sources[i].id || nextSources[i].fingerprint !== store.sources[i].fingerprint)
      throw new Error("Chat history changed; reconcile memory before skipping.");
  }
  store.sources = nextSources;
  store.skipped = store.sources.length - coveredIds(store).size;
}
function coveredIds(store) {
  const ids = new Set;
  for (const layer of store.layers)
    for (const snippet of layer) {
      for (let i = snippet.start;i <= snippet.end; i++)
        if (store.sources[i])
          ids.add(store.sources[i].id);
    }
  return ids;
}
function summaryText(store, downToLayer = 0) {
  const parts = [];
  for (let i = store.layers.length - 1;i >= Math.max(0, downToLayer); i--)
    for (const snippet of store.layers[i])
      parts.push(snippet.text);
  return parts.join(" ");
}
function injection(store, settings) {
  if (!settings.enabled)
    return "";
  const summary = summaryText(store);
  return summary ? settings.injectionTemplate.split("{{summary}}").join(summary) : "";
}
function cleanOutput(text, settings) {
  let output = text.replace(/<\|channel>thought[\s\S]*?(?:<channel\|>|$)/gi, "");
  output = output.replace(/<(thinking|think|reasoning|thought|reflect|inner_monologue)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "");
  output = output.replace(/<output\b[^>]*>([\s\S]*?)<\/output\s*>/gi, "$1");
  for (const pattern of settings.stripPatterns)
    if (pattern)
      output = output.split(pattern).join("");
  return output.replace(/\s+/g, " ").trim();
}
function abortIfNeeded(signal) {
  if (signal.aborted)
    throw signal.reason instanceof Error ? signal.reason : new DOMException("Summarization cancelled.", "AbortError");
}
var serial = 0;
function newSnippet(text, start, end) {
  const timestamp = Date.now();
  return { id: `sc-${bytesToHex(sha256(utf8ToBytes(JSON.stringify([timestamp, ++serial, start, end, text]))))}`, text, start, end, timestamp };
}
async function generate(story, context, settings, summarize, signal) {
  abortIfNeeded(signal);
  const raw = await summarize(story, context, signal);
  abortIfNeeded(signal);
  if (typeof raw !== "string")
    throw new Error("Summarizer returned no text.");
  const text = cleanOutput(raw, settings);
  if (!text)
    throw new Error("Summarizer returned an empty summary.");
  return text;
}
async function summarizeBatch(store, messages, settings, summarize, signal) {
  abortIfNeeded(signal);
  const eligible = eligibleIndices(store, messages, settings);
  if (!eligible.length)
    return false;
  const start = store.sources.length;
  const end = eligible[Math.min(settings.turnsPerSummary, eligible.length) - 1];
  const nextSources = sources(messages, end);
  for (let i = 0;i < start; i++)
    if (nextSources[i].fingerprint !== store.sources[i].fingerprint || nextSources[i].id !== store.sources[i].id)
      throw new Error("Chat history changed; reconcile memory before summarizing.");
  const lines = [];
  for (let i = start;i <= end; i++) {
    const message = messages[i];
    if (message.role !== "system" && message.content.trim())
      lines.push(`${message.name || (message.role === "user" ? "Player" : "Assistant")}: ${message.content.trim()}`);
  }
  const text = await generate(lines.join(`
`), summaryText(store) || "(none yet)", settings, summarize, signal);
  for (let i = 0;i <= end; i++)
    if (!messages[i] || messages[i].id !== nextSources[i].id || fingerprint(messages[i]) !== nextSources[i].fingerprint)
      throw new Error("Chat history changed during summarization.");
  if (store.sources.length !== start)
    throw new Error("Memory changed during summarization.");
  if (!store.layers[0])
    store.layers[0] = [];
  store.layers[0].push(newSnippet(text, start, end));
  store.sources = nextSources;
  return true;
}
async function promoteLayers(store, settings, summarize, signal) {
  abortIfNeeded(signal);
  const working = { ...store, layers: store.layers.map((layer) => [...layer]) };
  let changed = false;
  for (let index = 0;index < settings.maxLayers - 1; index++) {
    const layer = working.layers[index];
    if (!layer)
      continue;
    while (layer.length > settings.snippetsPerLayer) {
      abortIfNeeded(signal);
      const destination = working.layers[index + 1] || (working.layers[index + 1] = []);
      if (!destination.length) {
        destination.push(layer.shift());
        changed = true;
        continue;
      }
      let count = 1;
      while (count < Math.min(settings.snippetsPerPromotion, layer.length) && layer[count].start === layer[count - 1].end + 1)
        count++;
      if (count === 1) {
        destination.push(layer.shift());
        changed = true;
        continue;
      }
      const inputs = layer.slice(0, count);
      const text = await generate(inputs.map((snippet) => snippet.text).join(" "), summaryText(working, index + 1) || "(none yet)", settings, summarize, signal);
      const merged = newSnippet(text, inputs[0].start, inputs[count - 1].end);
      layer.splice(0, count);
      destination.push(merged);
      changed = true;
    }
  }
  abortIfNeeded(signal);
  if (changed)
    store.layers = working.layers;
}

// node_modules/valibot/dist/index.js
var store;
function getGlobalConfig(config2) {
  return {
    lang: config2?.lang ?? store?.lang,
    message: config2?.message,
    abortEarly: config2?.abortEarly ?? store?.abortEarly,
    abortPipeEarly: config2?.abortPipeEarly ?? store?.abortPipeEarly
  };
}
var store2;
function getGlobalMessage(lang) {
  return store2?.get(lang);
}
var store3;
function getSchemaMessage(lang) {
  return store3?.get(lang);
}
var store4;
function getSpecificMessage(reference, lang) {
  return store4?.get(reference)?.get(lang);
}
function _stringify(input) {
  const type = typeof input;
  if (type === "string") {
    return `"${input}"`;
  }
  if (type === "number" || type === "bigint" || type === "boolean") {
    return `${input}`;
  }
  if (type === "object" || type === "function") {
    return (input && Object.getPrototypeOf(input)?.constructor?.name) ?? "null";
  }
  return type;
}
function _addIssue(context, label, dataset, config2, other) {
  const input = other && "input" in other ? other.input : dataset.value;
  const expected = other?.expected ?? context.expects ?? null;
  const received = other?.received ?? _stringify(input);
  const issue = {
    kind: context.kind,
    type: context.type,
    input,
    expected,
    received,
    message: `Invalid ${label}: ${expected ? `Expected ${expected} but r` : "R"}eceived ${received}`,
    requirement: context.requirement,
    path: other?.path,
    issues: other?.issues,
    lang: config2.lang,
    abortEarly: config2.abortEarly,
    abortPipeEarly: config2.abortPipeEarly
  };
  const isSchema = context.kind === "schema";
  const message2 = other?.message ?? context.message ?? getSpecificMessage(context.reference, issue.lang) ?? (isSchema ? getSchemaMessage(issue.lang) : null) ?? config2.message ?? getGlobalMessage(issue.lang);
  if (message2 !== undefined) {
    issue.message = typeof message2 === "function" ? message2(issue) : message2;
  }
  if (isSchema) {
    dataset.typed = false;
  }
  if (dataset.issues) {
    dataset.issues.push(issue);
  } else {
    dataset.issues = [issue];
  }
}
function _getStandardProps(context) {
  return {
    version: 1,
    vendor: "valibot",
    validate(value2) {
      return context["~run"]({ value: value2 }, getGlobalConfig());
    }
  };
}
function _isValidObjectKey(object2, key) {
  return Object.hasOwn(object2, key) && key !== "__proto__" && key !== "prototype" && key !== "constructor";
}
function _joinExpects(values2, separator) {
  const list = [...new Set(values2)];
  if (list.length > 1) {
    return `(${list.join(` ${separator} `)})`;
  }
  return list[0] ?? "never";
}
var ValiError = class extends Error {
  constructor(issues) {
    super(issues[0].message);
    this.name = "ValiError";
    this.issues = issues;
  }
};
function getFallback(schema, dataset, config2) {
  return typeof schema.fallback === "function" ? schema.fallback(dataset, config2) : schema.fallback;
}
function getDefault(schema, dataset, config2) {
  return typeof schema.default === "function" ? schema.default(dataset, config2) : schema.default;
}
function literal(literal_, message2) {
  return {
    kind: "schema",
    type: "literal",
    reference: literal,
    expects: _stringify(literal_),
    async: false,
    literal: literal_,
    message: message2,
    get "~standard"() {
      return _getStandardProps(this);
    },
    "~run"(dataset, config2) {
      if (dataset.value === this.literal) {
        dataset.typed = true;
      } else {
        _addIssue(this, "type", dataset, config2);
      }
      return dataset;
    }
  };
}
function object2(entries2, message2) {
  return {
    kind: "schema",
    type: "object",
    reference: object2,
    expects: "Object",
    async: false,
    entries: entries2,
    message: message2,
    get "~standard"() {
      return _getStandardProps(this);
    },
    "~run"(dataset, config2) {
      const input = dataset.value;
      if (input && typeof input === "object") {
        dataset.typed = true;
        dataset.value = {};
        for (const key in this.entries) {
          const valueSchema = this.entries[key];
          if (key in input || (valueSchema.type === "exact_optional" || valueSchema.type === "optional" || valueSchema.type === "nullish") && valueSchema.default !== undefined) {
            const value2 = key in input ? input[key] : getDefault(valueSchema);
            const valueDataset = valueSchema["~run"]({ value: value2 }, config2);
            if (valueDataset.issues) {
              const pathItem = {
                type: "object",
                origin: "value",
                input,
                key,
                value: value2
              };
              for (const issue of valueDataset.issues) {
                if (issue.path) {
                  issue.path.unshift(pathItem);
                } else {
                  issue.path = [pathItem];
                }
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) {
                dataset.issues = valueDataset.issues;
              }
              if (config2.abortEarly) {
                dataset.typed = false;
                break;
              }
            }
            if (!valueDataset.typed) {
              dataset.typed = false;
            }
            dataset.value[key] = valueDataset.value;
          } else if (valueSchema.fallback !== undefined) {
            dataset.value[key] = getFallback(valueSchema);
          } else if (valueSchema.type !== "exact_optional" && valueSchema.type !== "optional" && valueSchema.type !== "nullish") {
            _addIssue(this, "key", dataset, config2, {
              input: undefined,
              expected: `"${key}"`,
              path: [
                {
                  type: "object",
                  origin: "key",
                  input,
                  key,
                  value: input[key]
                }
              ]
            });
            if (config2.abortEarly) {
              break;
            }
          }
        }
      } else {
        _addIssue(this, "type", dataset, config2);
      }
      return dataset;
    }
  };
}
function optional(wrapped, default_) {
  return {
    kind: "schema",
    type: "optional",
    reference: optional,
    expects: `(${wrapped.expects} | undefined)`,
    async: false,
    wrapped,
    default: default_,
    get "~standard"() {
      return _getStandardProps(this);
    },
    "~run"(dataset, config2) {
      if (dataset.value === undefined) {
        if (this.default !== undefined) {
          dataset.value = getDefault(this, dataset, config2);
        }
        if (dataset.value === undefined) {
          dataset.typed = true;
          return dataset;
        }
      }
      return this.wrapped["~run"](dataset, config2);
    }
  };
}
function picklist(options, message2) {
  return {
    kind: "schema",
    type: "picklist",
    reference: picklist,
    expects: _joinExpects(options.map(_stringify), "|"),
    async: false,
    options,
    message: message2,
    get "~standard"() {
      return _getStandardProps(this);
    },
    "~run"(dataset, config2) {
      if (this.options.includes(dataset.value)) {
        dataset.typed = true;
      } else {
        _addIssue(this, "type", dataset, config2);
      }
      return dataset;
    }
  };
}
function record(key, value2, message2) {
  return {
    kind: "schema",
    type: "record",
    reference: record,
    expects: "Object",
    async: false,
    key,
    value: value2,
    message: message2,
    get "~standard"() {
      return _getStandardProps(this);
    },
    "~run"(dataset, config2) {
      const input = dataset.value;
      if (input && typeof input === "object") {
        dataset.typed = true;
        dataset.value = {};
        for (const entryKey in input) {
          if (_isValidObjectKey(input, entryKey)) {
            const entryValue = input[entryKey];
            const keyDataset = this.key["~run"]({ value: entryKey }, config2);
            if (keyDataset.issues) {
              const pathItem = {
                type: "object",
                origin: "key",
                input,
                key: entryKey,
                value: entryValue
              };
              for (const issue of keyDataset.issues) {
                issue.path = [pathItem];
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) {
                dataset.issues = keyDataset.issues;
              }
              if (config2.abortEarly) {
                dataset.typed = false;
                break;
              }
            }
            const valueDataset = this.value["~run"]({ value: entryValue }, config2);
            if (valueDataset.issues) {
              const pathItem = {
                type: "object",
                origin: "value",
                input,
                key: entryKey,
                value: entryValue
              };
              for (const issue of valueDataset.issues) {
                if (issue.path) {
                  issue.path.unshift(pathItem);
                } else {
                  issue.path = [pathItem];
                }
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) {
                dataset.issues = valueDataset.issues;
              }
              if (config2.abortEarly) {
                dataset.typed = false;
                break;
              }
            }
            if (!keyDataset.typed || !valueDataset.typed) {
              dataset.typed = false;
            }
            if (keyDataset.typed) {
              dataset.value[keyDataset.value] = valueDataset.value;
            }
          }
        }
      } else {
        _addIssue(this, "type", dataset, config2);
      }
      return dataset;
    }
  };
}
function string(message2) {
  return {
    kind: "schema",
    type: "string",
    reference: string,
    expects: "string",
    async: false,
    message: message2,
    get "~standard"() {
      return _getStandardProps(this);
    },
    "~run"(dataset, config2) {
      if (typeof dataset.value === "string") {
        dataset.typed = true;
      } else {
        _addIssue(this, "type", dataset, config2);
      }
      return dataset;
    }
  };
}
function unknown() {
  return {
    kind: "schema",
    type: "unknown",
    reference: unknown,
    expects: "unknown",
    async: false,
    get "~standard"() {
      return _getStandardProps(this);
    },
    "~run"(dataset) {
      dataset.typed = true;
      return dataset;
    }
  };
}
function parse(schema, input, config2) {
  const dataset = schema["~run"]({ value: input }, getGlobalConfig(config2));
  if (dataset.issues) {
    throw new ValiError(dataset.issues);
  }
  return dataset.value;
}
function safeParse(schema, input, config2) {
  const dataset = schema["~run"]({ value: input }, getGlobalConfig(config2));
  return {
    typed: dataset.typed,
    success: !dataset.issues,
    output: dataset.value,
    issues: dataset.issues
  };
}

// src/backend.ts
var RequestSchema = object2({
  type: literal("sc:request"),
  requestId: string(),
  action: string(),
  chatId: optional(string()),
  settings: optional(record(string(), unknown())),
  mode: optional(picklist(["one", "all"])),
  snippetId: optional(string()),
  text: optional(string()),
  data: optional(unknown())
});
var ResponseSchema = object2({ content: optional(string()), finish_reason: optional(string()) });
var settingsByUser = new Map;
var queues = new Map;
var jobs = new Map;
var errors = new Map;
var usersByChat = new Map;
var key = (userId) => userId || "owner";
var path = (chatId) => `chats/${encodeURIComponent(chatId)}.json`;
var errorText = (error) => error instanceof Error ? error.message : String(error);
function exclusive(userId, work) {
  const id = key(userId);
  const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(work);
  queues.set(id, next);
  next.finally(() => {
    if (queues.get(id) === next)
      queues.delete(id);
  }).catch(() => {});
  return next;
}
function settings(userId) {
  const id = key(userId);
  let pending = settingsByUser.get(id);
  if (!pending) {
    pending = spindle.userStorage.getJson("settings.json", { fallback: DEFAULT_SETTINGS, userId }).then(normalizeSettings);
    settingsByUser.set(id, pending);
    pending.catch(() => settingsByUser.delete(id));
  }
  return pending;
}
async function messages(chatId, userId) {
  if (!await spindle.chats.get(chatId, userId))
    throw new Error("Chat is unavailable to this user.");
  if (userId)
    usersByChat.set(chatId, userId);
  return spindle.chat.getMessages(chatId);
}
async function load(chatId, userId) {
  const current = await messages(chatId, userId);
  const raw = await spindle.userStorage.getJson(path(chatId), { fallback: null, userId });
  const store = raw === null ? createStore(chatId) : parseStoredStore(raw, chatId);
  reconcile(store, current);
  return { store, messages: current };
}
async function save(store, userId) {
  await spindle.userStorage.setJson(path(store.chatId), store, { userId });
}
function excludedIds(store, current, config) {
  if (!config.enabled || config.disableGhosting)
    return new Set;
  const assistants = [];
  for (let index = 0;index < current.length; index++) {
    if (current[index].role === "assistant" && current[index].content.trim())
      assistants.push(index);
  }
  const oldCount = Math.max(0, assistants.length - config.verbatimTurns);
  const boundary = oldCount ? assistants[oldCount - 1] + 1 : 0;
  const covered = coveredIds(store);
  return new Set(current.slice(0, boundary).filter((message) => message.role !== "system" && covered.has(message.id)).map((message) => message.id));
}
async function state(chatId, userId) {
  const config = await settings(userId);
  const selected = chatId === undefined ? (await spindle.chats.getActive(userId))?.id || null : chatId;
  const loaded = selected ? await load(selected, userId) : null;
  const job = jobs.get(key(userId));
  const profiles = await spindle.connections.list(userId);
  const ghostedIds = loaded ? [...excludedIds(loaded.store, loaded.messages, config)] : [];
  return {
    chatId: selected,
    settings: config,
    store: loaded?.store || null,
    preview: loaded ? injection(loaded.store, config) : "",
    eligibleTurns: loaded ? eligibleCount(loaded.store, loaded.messages, config) : 0,
    ghostedCount: ghostedIds.length,
    ghostedIds,
    busy: !!job,
    progress: job ? { completed: job.completed, total: job.total } : null,
    connections: profiles.map(({ id, name }) => ({ id, name })),
    error: errors.get(key(userId)) || null
  };
}
async function publish(chatId, userId) {
  spindle.sendToFrontend({ type: "sc:state", state: await state(chatId, userId) }, userId);
}
function wait(ms, signal) {
  signal.throwIfAborted();
  const { promise, resolve, reject } = Promise.withResolvers();
  const abort = () => {
    clearTimeout(timer);
    reject(signal.reason);
  };
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", abort);
    resolve();
  }, ms);
  signal.addEventListener("abort", abort, { once: true });
  return promise;
}
function retryDelay(error, attempt) {
  const e = error;
  const text = errorText(error);
  const status = e?.status || e?.statusCode || e?.response?.status || Number(text.match(/\b(429|500|502|503|504)\b/)?.[1]);
  if (![429, 500, 502, 503, 504].includes(status) && !/network|fetch|timeout|rate limit|overloaded|ECONNRESET|ECONNREFUSED/i.test(text))
    return null;
  const header = e?.retryAfter ?? e?.response?.headers?.get?.("retry-after") ?? e?.response?.headers?.["retry-after"];
  if (header !== undefined && header !== null) {
    const seconds = Number(header);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(header)) - Date.now();
    if (Number.isFinite(delay))
      return Math.max(0, delay);
  }
  return Math.min(60000, 2000 * 2 ** attempt + Math.random() * 500);
}
async function summarizer(config, userId) {
  const persona = await spindle.personas.getActive(userId);
  const playerName = persona?.name || "User";
  return async (story, context, signal) => {
    const vars = { player_name: playerName, context_str: context, story_txt: story };
    const render = (text) => text.replace(/\{\{(player_name|context_str|story_txt)\}\}/g, (_, name) => vars[name]);
    for (let attempt = 0;; attempt++) {
      signal.throwIfAborted();
      if (config.debugMode)
        spindle.log.info(`Summaryception request ${attempt + 1}: ${story.length} passage characters, ${context.length} context characters, ${config.connectionId || "active connection"}`);
      const timeout = AbortSignal.timeout(120000);
      const requestSignal = AbortSignal.any([signal, timeout]);
      try {
        const result = parse(ResponseSchema, await spindle.generate.quiet({
          type: "quiet",
          userId,
          connection_id: config.connectionId || undefined,
          messages: [{ role: "system", content: render(config.summarizerSystemPrompt) }, { role: "user", content: render(config.summarizerUserPrompt) }],
          parameters: { temperature: 0.2, ...config.responseTokens ? { max_tokens: config.responseTokens } : {} },
          reasoning: { source: "off" },
          signal: requestSignal
        }));
        signal.throwIfAborted();
        if (result.finish_reason === "length" || result.finish_reason === "max_tokens")
          throw new Error("Summary was truncated. Increase the response token limit before retrying.");
        const content = cleanOutput(result.content || "", config);
        if (!content)
          throw new Error("Summarizer returned an empty response. History was not excluded.");
        return content;
      } catch (error) {
        signal.throwIfAborted();
        const failure = timeout.aborted ? new Error("Summarizer request timeout") : error;
        const delay = retryDelay(failure, attempt);
        if (attempt >= 5 || delay === null)
          throw failure;
        spindle.log.warn(`Summaryception retry ${attempt + 1}: ${errorText(failure)}`);
        await wait(delay, signal);
      }
    }
  };
}
async function commit(candidate, userId, signal) {
  signal.throwIfAborted();
  const latest = await messages(candidate.chatId, userId);
  if (reconcile(candidate, latest))
    throw new Error("Source messages changed during summarization. No new memory was committed; retry with the updated chat.");
  signal.throwIfAborted();
  await save(candidate, userId);
}
function startJob(chatId, mode, userId, snippetId) {
  const id = key(userId);
  if (jobs.has(id))
    throw new Error("Stop the running summary operation first.");
  const job = { chatId, controller: new AbortController, completed: 0, total: 0 };
  jobs.set(id, job);
  errors.delete(id);
  (async () => {
    const config = await settings(userId);
    if (!config.enabled)
      throw new Error("Enable Summaryception before generating memory.");
    let loaded = await load(chatId, userId);
    const summarize = await summarizer(config, userId);
    const signal = job.controller.signal;
    job.total = snippetId ? 1 : Math.ceil(eligibleCount(loaded.store, loaded.messages, config) / config.turnsPerSummary);
    await publish(chatId, userId);
    if (snippetId) {
      const candidate = structuredClone(loaded.store);
      const snippet = candidate.layers.flat().find((s) => s.id === snippetId);
      if (!snippet)
        throw new Error("Snippet no longer exists.");
      const prior = candidate.layers.flat().filter((s) => s.end < snippet.start).sort((a, b) => a.start - b.start).map((s) => s.text).join(" ");
      const passage = loaded.messages.slice(snippet.start, snippet.end + 1).filter((m) => m.role !== "system").map((m) => `${m.name || m.role}: ${m.content}`).join(`

`);
      snippet.text = await summarize(passage, prior, signal);
      snippet.timestamp = Date.now();
      await commit(candidate, userId, signal);
      job.completed = 1;
    } else {
      do {
        signal.throwIfAborted();
        const candidate = structuredClone(loaded.store);
        if (!await summarizeBatch(candidate, loaded.messages, config, summarize, signal))
          break;
        await commit(candidate, userId, signal);
        job.completed++;
        await publish(chatId, userId);
        const promoted = structuredClone(candidate);
        await promoteLayers(promoted, config, summarize, signal);
        await commit(promoted, userId, signal);
        loaded = await load(chatId, userId);
      } while (mode === "all" && eligibleCount(loaded.store, loaded.messages, config) > 0);
    }
  })().catch((error) => {
    if (!job.controller.signal.aborted) {
      errors.set(id, errorText(error));
      spindle.log.error(`Summaryception: ${errorText(error)}`);
    }
  }).finally(async () => {
    if (jobs.get(id) === job)
      jobs.delete(id);
    await publish(chatId, userId).catch((error) => spindle.log.error(errorText(error)));
  });
}
spindle.onFrontendMessage((payload, userId, frontendSessionId) => {
  const parsed = safeParse(RequestSchema, payload);
  if (!parsed.success)
    return;
  const request = parsed.output;
  exclusive(userId, async () => {
    let selected = request.chatId;
    let data;
    try {
      if (request.action === "stop")
        jobs.get(key(userId))?.controller.abort();
      else if (request.action !== "state") {
        if (jobs.has(key(userId)))
          throw new Error("Stop the running summary operation first.");
        errors.delete(key(userId));
        if (request.action === "settings") {
          const config = normalizeSettings({ ...await settings(userId), ...request.settings });
          await spindle.userStorage.setJson("settings.json", config, { userId });
          settingsByUser.set(key(userId), Promise.resolve(config));
        } else {
          selected = request.chatId || (await spindle.chats.getActive(userId))?.id || null;
          if (!selected)
            throw new Error("Open a chat first.");
          const loaded = await load(selected, userId);
          const config = await settings(userId);
          switch (request.action) {
            case "summarize":
              startJob(selected, request.mode === "all" ? "all" : "one", userId);
              break;
            case "regenerate":
              if (!request.snippetId)
                throw new Error("Select a snippet first.");
              startJob(selected, "one", userId, request.snippetId);
              break;
            case "skip":
              skipBacklog(loaded.store, loaded.messages, config);
              await save(loaded.store, userId);
              break;
            case "clear":
              await save(createStore(selected), userId);
              break;
            case "repair":
              await save(loaded.store, userId);
              break;
            case "export":
              data = loaded.store;
              break;
            case "import":
              await save(validateStore(request.data, selected, loaded.messages), userId);
              break;
            case "edit": {
              const snippet = loaded.store.layers.flat().find((s) => s.id === request.snippetId);
              if (!snippet)
                throw new Error("Snippet no longer exists.");
              const text = request.text?.trim();
              if (!text)
                throw new Error("A snippet cannot be empty; use Delete to restore its source messages.");
              snippet.text = text;
              snippet.timestamp = Date.now();
              await save(loaded.store, userId);
              break;
            }
            case "delete": {
              const snippet = loaded.store.layers.flat().find((s) => s.id === request.snippetId);
              if (!snippet)
                throw new Error("Snippet no longer exists.");
              loaded.store.layers = loaded.store.layers.map((layer) => layer.filter((s) => s.end < snippet.start));
              loaded.store.sources.length = snippet.start;
              loaded.store.skipped = loaded.store.sources.length - coveredIds(loaded.store).size;
              await save(loaded.store, userId);
              break;
            }
            default:
              throw new Error("Unknown Summaryception action.");
          }
        }
      }
      spindle.sendToFrontend({ type: "sc:response", requestId: request.requestId, ok: true, state: await state(selected, userId), data }, userId, frontendSessionId ? { frontendSessionId } : undefined);
    } catch (error) {
      spindle.sendToFrontend({ type: "sc:response", requestId: request.requestId, ok: false, error: errorText(error) }, userId, frontendSessionId ? { frontendSessionId } : undefined);
    }
  });
});
spindle.registerInterceptor(async (prompt, context) => {
  const config = await settings(context.userId);
  if (!config.enabled || !context.chatId)
    return prompt;
  const { store, messages: current } = await load(context.chatId, context.userId);
  context.signal.throwIfAborted();
  const preview = injection(store, config);
  if (!preview)
    return prompt;
  const excluded = excludedIds(store, current, config);
  const kept = prompt.filter((message) => !(message.__isChatHistory && message.sourceMessageId && excluded.has(message.sourceMessageId)));
  const historyIndex = kept.findIndex((message) => message.__isChatHistory);
  const position = historyIndex < 0 ? kept.length : historyIndex;
  kept.splice(position, 0, { role: "user", content: preview });
  return { messages: kept, breakdown: [{ messageIndex: position, name: "Summaryception memory" }] };
}, { priority: 100, required: true });
spindle.on("GENERATION_ENDED", (payload, userId) => {
  if (payload.error || !payload.messageId || !payload.chatId)
    return;
  exclusive(userId, async () => {
    if (jobs.has(key(userId)))
      return;
    const config = await settings(userId);
    if (!config.enabled || config.pauseSummarization)
      return;
    const loaded = await load(payload.chatId, userId);
    const count = eligibleCount(loaded.store, loaded.messages, config);
    if (count >= config.turnsPerSummary && count <= config.turnsPerSummary * 2)
      startJob(payload.chatId, "one", userId);
    else
      await publish(payload.chatId, userId);
  }).catch((error) => spindle.log.error(errorText(error)));
});
for (const event of ["CHAT_SWITCHED", "CHAT_CHANGED", "MESSAGE_EDITED", "MESSAGE_DELETED", "MESSAGE_SWIPED", "SWIPE_EDITED"]) {
  spindle.on(event, (payload, userId) => {
    if (!payload || typeof payload !== "object" || !("chatId" in payload))
      return;
    const chatId = payload.chatId;
    if (chatId !== null && typeof chatId !== "string")
      return;
    if (event.startsWith("MESSAGE_") || event === "SWIPE_EDITED") {
      const job = jobs.get(key(userId));
      if (job?.chatId === chatId)
        job.controller.abort();
    }
    publish(chatId, userId).catch((error) => spindle.log.error(errorText(error)));
  });
}
spindle.commands.register([
  { id: "sc-status", label: "Summaryception: Status", description: "Open memory layers and statistics", keywords: ["sc-status", "memory"], scope: "chat" },
  { id: "sc-preview", label: "Summaryception: Preview", description: "Inspect the historical context injected into generation", keywords: ["sc-preview", "memory"], scope: "chat" },
  { id: "sc-clear", label: "Summaryception: Clear memory", description: "Confirm clearing memory and restoring raw history", keywords: ["sc-clear", "memory"], scope: "chat" }
]);
spindle.commands.onInvoked((command, context) => {
  const userId = context.chatId ? usersByChat.get(context.chatId) : undefined;
  if (userId)
    spindle.sendToFrontend({ type: "sc:command", command, chatId: context.chatId }, userId);
});
spindle.log.info("Summaryception backend loaded");
