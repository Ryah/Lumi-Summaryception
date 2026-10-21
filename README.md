# Summaryception for Lumiverse

**Recursive memory for long-running AI roleplay chats.** A native [Lumiverse](https://lumiverse.chat) Spindle extension by **Ryah**, adapted from [Lodactio's Summaryception for SillyTavern](https://github.com/Lodactio/Extension-Summaryception).

---

# 🧠 Summaryception

### Layered Recursive Memory for SillyTavern

> Your AI remembers **thousands of turns** in under **20k tokens**. No context bloat. No lost plot threads. No compromises.

Summaryception is a non-destructive, context-aware memory system for [SillyTavern](https://github.com/SillyTavern/SillyTavern) that replaces brute-force context stuffing with intelligent layered summarization. It keeps your most recent turns verbatim while compressing older conversation into ultra-compact summary snippets — organized in recursive layers that scale indefinitely.

---

## ✨ The Problem

Every roleplayer hits the same wall:

| Approach | What happens |
|---|---|
| **No summary** | Context fills up → hard truncation → everything before the cutoff is **gone forever** |
| **Basic summarization** | Lossy single summary → important details vanish → you compensate by keeping 20+ verbatim turns → context still bloats |
| **More verbatim turns** | 20 turns × 1,500 tokens = 30k tokens of mostly atmospheric prose the LLM has to process → attention degrades → coherence drops anyway |

The conventional wisdom — *"keep more raw turns"* — is a band-aid for bad compression.

## 💡 The Solution

Summaryception flips the approach: **compress aggressively, lose nothing.**

A context-aware summarizer prompt examines each batch of turns against what's *already been summarized*, outputting only the **narrative delta** — new plot points, state changes, character decisions. Nothing repeated, nothing lost.

**Real example** — 3 turns, ~5,200 raw tokens, compressed to:

> *Alina kisses Lodactio; he reciprocates; she grows to human size, straddling him; she squeezes his crotch and intends to undo his pants.*

**27 tokens. 125:1 compression. Every plot-relevant beat preserved.**

And because each snippet is written with knowledge of all previous snippets, they get *more efficient over time* — the summarizer doesn't re-establish characters, settings, or relationships that are already recorded. Early snippets might be 40 tokens. By snippet 10, you're seeing 15-token summaries.

---

## 🔄 How It Works

```
YOUR CHAT (e.g., 200 turns)
│
│  Turns 1-180: Ghosted (hidden from LLM, still readable by you)
│  Turns 181-200: Kept VERBATIM (7 most recent assistant turns)
│
│  The ghosted turns have been compressed into:
│
│  ┌──────────────────────────────────────────┐
│  │  LAYER 2 (Deep Memory)                   │
│  │  Ultra-compressed summaries of Layer 1   │
│  │  Each covers ~27 turns                   │
│  ├──────────────────────────────────────────┤
│  │  LAYER 1 (Meta-Summaries)                │
│  │  Compressed summaries of Layer 0         │
│  │  Each covers ~9 turns                    │
│  ├──────────────────────────────────────────┤
│  │  LAYER 0 (Turn Summaries)                │
│  │  Direct summaries of conversation turns  │
│  │  Each covers ~3 turns                    │
│  ├──────────────────────────────────────────┤
│  │  VERBATIM TURNS (most recent 7)          │
│  │  Sent word-for-word to the LLM           │
│  └──────────────────────────────────────────┘
│
│  Total context: ~12k tokens
│  Total narrative coverage: EVERYTHING
```

### The "Ception" — Recursive Layer Promotion

When a layer fills up (default: 30 snippets), the oldest snippets are promoted to the next deeper layer:

1. **Seed promotion** — The very first time a deeper layer opens, the oldest snippet is promoted **directly** as a seed, no LLM call, preserving maximum information as the foundation for that layer.
2. **Subsequent promotions** — Additional overflow snippets (default: 3 at a time) are summarized together against the destination layer's existing content (including the seed) as prior context.
3. **Cascade** — If the destination layer also fills up, the process repeats, creating Layer 2, Layer 3, etc.

Each layer multiplies the turn coverage per snippet while maintaining coherent narrative continuity.

---

## 📊 The Math

*Using ~70 tokens per snippet as a working median. Actual snippets range from ~30 tokens (late-layer, minimal delta) to ~100 tokens (early context establishment). Your results will vary based on narrative density.*

### Default Settings (30 snippets/layer, 3 turns/batch, 3 snippets/promotion)

Each promotion merges 3 snippets into 1, so each layer multiplies turn coverage by 3×.

| Layer | Snippets | Turns per Snippet | Total Turns Covered | ~Tokens |
|---|---|---|---|---|
| Verbatim | 7 turns | — | 7 | ~5,000 |
| Layer 0 | 30 | 3 | 90 | ~2,100 |
| Layer 1 | 30 | 9 | 270 | ~2,100 |
| Layer 2 | 30 | 27 | 810 | ~2,100 |
| Layer 3 | 30 | 81 | 2,430 | ~2,100 |
| Layer 4 | 30 | 243 | 7,290 | ~2,100 |
| **Total** | — | — | **~10,897 turns** | **~15,500 tokens** |

> **Nearly 11,000 turns of narrative history in ~16k tokens.**

### Conservative Estimate (smaller snippets at deeper layers)

In practice, deeper layers produce shorter snippets as they compress already-compressed material. A more realistic breakdown:

| Layer | Snippets | Turns per Snippet | ~Tokens/Snippet | ~Layer Tokens |
|---|---|---|---|---|
| Verbatim | 7 turns | — | — | ~5,000 |
| Layer 0 | 30 | 3 | ~80 | ~2,400 |
| Layer 1 | 30 | 9 | ~70 | ~2,100 |
| Layer 2 | 30 | 27 | ~60 | ~1,800 |
| Layer 3 | 30 | 81 | ~50 | ~1,500 |
| Layer 4 | 30 | 243 | ~40 | ~1,200 |
| **Total** | — | — | — | **~14,000 tokens** |

> **~11,000 turns in ~14k tokens.** The raw conversation? Roughly **15–25 million tokens.** That's a compression ratio approaching **1,000:1**.

For comparison, most roleplayers hit 17,500 tokens by **turn 10** with verbatim context. Summaryception uses the same budget to remember **eleven thousand**.

---

## 👻 Non-Destructive Ghost Mode

Summaryception never deletes your messages. Summarized turns are **ghosted** — hidden from the LLM context but fully visible and readable in your chat UI. Scroll up anytime to read the original prose.

- 👻 Ghosted messages show a system icon in the chat
- Clear Memory unghosts everything instantly
- Your chat file is never modified destructively

---

## 🧹 Clean Prompt Isolation

When Summaryception calls the summarizer, it **temporarily disables all Chat Completion preset toggles** — your creative writing prompts, character instructions, scenario text, everything. The summarizer sees only its own system prompt and the passage to summarize.

This means:
- ✅ No 4k tokens of story-writing instructions competing with a 200-token summarization task
- ✅ Budget models perform like premium models on the focused extraction task
- ✅ Your preset is restored instantly after, whether the call succeeds or fails

---

## 🔁 Context-Aware Incremental Summaries

This is the core innovation. The summarizer prompt receives:

| Variable | Contents |
|---|---|
| `{{player_name}}` | Your active persona name |
| `{{context_str}}` | **That layer's existing summaries** — everything already recorded |
| `{{story_txt}}` | The new passage to summarize |

The instruction: *"Summarize only necessary elements to coherently continue the Prior Context. Exclude anything already covered."*

This means:
- **Snippet 1** has to establish characters, setting, relationships (~80–100 tokens)
- **Snippet 5** only records new events — characters and setting are established (~50–70 tokens)
- **Snippet 10** is pure narrative delta — just what changed (~30–50 tokens)
- **Layer promotions** work the same way — each deeper layer summarizes against its own existing content

Every summary is a **minimal diff**, not a redundant recap.

---

## 🛡️ Resilient API Handling

- **Exponential backoff** with jitter for rate limits (429) and server errors (500/502/503/504)
- **Retry-After header** respected when the server provides one
- Retries up to 5 times with delays from 2s → 60s
- **Failed batches are never ghosted** — turns stay visible for the next attempt
- Network errors, timeouts, and empty responses are all handled gracefully

---

## 📦 Backlog Detection

Opening an existing chat with 100+ messages? Summaryception detects the backlog and offers you a choice:

| Option | What it does |
|---|---|
| **Process Entire Backlog** | Summarizes everything with a cancelable progress bar |
| **Skip Backlog** | Ignores old turns, only tracks new ones going forward |
| **Just One Batch** | Processes a single batch now, handles the rest incrementally |

Progress is saved continuously — cancel anytime and pick up where you left off.

---

## ⚙️ Configuration

All settings are adjustable from the SillyTavern Extensions panel:

| Setting | Default | Description |
|---|---|---|
| Verbatim Turns | 10 | Recent assistant turns kept word-for-word |
| Turns per Batch | 3 | Oldest turns summarized together per trigger |
| Snippets per Layer | 30 | Max snippets before promoting to next layer |
| Snippets per Promotion | 3 | How many snippets merge on promotion |
| Max Layers | 5 | Maximum recursion depth |

### Prompt Presets

| Preset | Best For | Focus |
|---|---|---|
| **Narrative State** (default) | Character RP, drama, thrillers, romance | Interactions, emotions, relationships, atmosphere, subtext |
| **Game State** | Roguelites, strategy, mechanical games | Plot points, quests, locations, interactables, state changes |
| **Custom** | Your own prompt | Whatever you write |

Select a preset from the dropdown in Summary Prompts, or edit the prompt directly — it auto-switches to Custom.

Plus fully customizable:
- 📝 Summarizer system prompt
- 📝 Summarizer user prompt (with `{{player_name}}`, `{{context_str}}`, `{{story_txt}}` variables)
- 📝 Injection wrapper template

---

## 🔌 Connection Settings

Summaryception can use different backends for summarization, independent of your main chat connection:

| Source | Description |
|---|---|
| **Default** | Uses SillyTavern's active connection — simplest setup |
| **OpenAI Compatible** | Direct endpoint with URL, API key, and model — bypasses all ST formatting |
| **Ollama** | Local Ollama instance with model browser |
| **Connection Profile** | Uses an ST Connection Profile (⚠️ inherits preset formatting — may degrade summary quality) |

> 💡 **Recommended:** Use **Default** or **OpenAI Compatible** for cleanest results. Connection Profiles inject preset formatting into summary requests, which can cause the model to roleplay instead of summarize.

---

## 🗂️ Built-in Tools

- **Layer Stats** — Live view of snippet counts per layer and ghosted message count
- **Injection Preview** — See exactly what gets sent to the LLM
- **Snippet Browser** — Browse, edit, regenerate, and delete individual snippets across all layers
- **Export/Import** — Save and restore memory as JSON
- **Force Summarize** — Manually trigger summarization
- **Stop** — Abort any running summarization, progress saved
- **Repair** — Find and fix orphaned hidden messages
- **Slash Commands** — `/sc-status`, `/sc-preview`, `/sc-clear`

---

## 🧠 Why This Works Better

| | Traditional Summary | Summaryception |
|---|---|---|
| **Compression** | ~10:1, lossy | ~125:1 per snippet, lossless |
| **Context at turn 100** | 30k+ tokens or truncated | ~10k tokens |
| **Context at turn 1,000** | Impossible without truncation | ~13k tokens |
| **Context at turn 10,000** | Literally impossible | ~16k tokens |
| **Lost information** | Lots — hedged by keeping more raw turns | None — every state change is tracked |
| **Coherence over time** | Degrades as context grows | Stable indefinitely |
| **Works with budget models** | Poorly — needs powerful summarizer | Excellently — prompt does the heavy lifting |

---

## 📥 Installation

### Inside Lumiverse
1. Paste this URL into Lumiverse extension install: `https://github.com/Ryah/Lumi-Summaryception`

### From a release ZIP

1. Open this repository's **Releases** page and download the attached `Summaryception-<version>.zip`, when available. Choose the extension asset, **not** GitHub's automatically generated “Source code” ZIP.
2. Extract the extension ZIP into your Lumiverse installation's `data/extensions/` directory. The resulting manifest path must be:

   ```text
   data/extensions/summaryception/repo/spindle.json
   ```

3. In Lumiverse, open **Extensions → Import Local** as an owner/admin.
4. Import **Summaryception**, review and grant its requested permissions, and enable it.
5. Open a chat, then open the **Memory / Summaryception** drawer tab.

The archive includes compiled bundles, corresponding source, build scripts, and license notices. If there is no release asset yet, build one from source below.

### From source or GitHub “Download ZIP”

Clone this repository or extract its source ZIP. Open a terminal in the project directory, then run:

```sh
bun install --frozen-lockfile
bun run verify
bun run package
```

This creates `release/Summaryception-1.0.0.zip`. Install it using the release-ZIP steps above. Future archive names follow the version in `spindle.json`.

**Source downloads are not ready-to-install packages:** `dist/` and `release/` are intentionally ignored by Git. Building creates `dist/backend.js` and `dist/frontend.js`; packaging includes both bundles.

For a local development checkout directly alongside Lumiverse's `data/` directory, `bun run package --stage-local` also stages the packaged files at `../data/extensions/summaryception/repo`. It refuses to overwrite an existing installation. Staging does not import, grant permissions, or enable the extension.

## First use

1. Open **Settings** in the Summaryception drawer.
2. Choose the active connection or a dedicated **Summarization connection profile**. Configure endpoints, models, and credentials in Lumiverse **Connections**, not in this extension.
3. Review the memory limits and click **Save settings**.
4. For an existing chat, choose how to handle eligible older history:
   - **One batch:** summarize a single passage.
   - **Process entire backlog:** summarize all eligible history and promote older snippets as needed.
   - **Skip backlog:** leave that history unsummarized and in prompts; begin with future eligible turns.
5. Inspect **Memory** and **Preview** before relying on the summaries.

After successful chat generation, automatic processing handles one eligible batch unless paused. A backlog larger than two batches waits for an explicit choice rather than automatically processing the whole conversation.

Summarization makes additional model requests. Large backlogs can take time and incur provider costs. Summary accuracy depends on your model and prompts; inspect important story details and edit snippets when needed.

### Default settings

| Setting | Default |
| --- | --- |
| Recent non-empty assistant turns kept verbatim | 10 |
| Assistant turns per summary batch | 3 |
| Snippets per layer before promotion | 20 |
| Older snippets merged per promotion | 3 |
| Maximum memory layers | 5 |
| Summary response token limit | 512 |
| Prompt preset | Narrative |
| Summarizer connection | Active Lumiverse connection |

Intervening user messages are retained with recent assistant turns. The deepest layer may continue growing rather than discard memory. Set the response token limit to `0` to use the preset/provider default.

### Pause, disable, and keep originals

- **Pause automatic summarization:** stops automatic processing; existing memory still injects and prompt filtering stays active. Manual processing remains available.
- **Disable Summaryception:** stops memory injection, prompt filtering, and automatic processing. Stored snippets remain available.
- **Keep summarized messages in prompts:** retains the original passages alongside their summaries. This disables filtering only and can increase prompt size.

Prompt filtering (“ghosting”) uses original message IDs. It does not change native hidden flags or delete messages; readable markers indicate summarized passages. Other memory systems, including Memory Cortex, remain independent and may also inject context.

## Memory tools and prompts

Use **Memory** to browse/search layers, edit or regenerate snippets, repair memory, and clear the current chat's memory. Editing, swiping, deleting, or changing the identity of source messages invalidates affected snippets and dependent later memory. **Repair memory** saves that reconciliation. Deleting a snippet also invalidates later dependent summaries so their sources can be processed again.

**Preview** shows the historical context block. Command-palette entries are also available: **Summaryception: Status**, **Summaryception: Preview**, and **Summaryception: Clear memory**. Clearing requires confirmation and leaves original messages untouched.

In **Prompts**, customize the system/user prompts, save named custom user-prompt slots, choose literal strings to strip from generated output, and edit the injection wrapper. Supported placeholders:

| Placeholder | Meaning |
| --- | --- |
| `{{player_name}}` | Active persona/player name |
| `{{context_str}}` | Existing summarized context |
| `{{story_txt}}` | Original passage being summarized |
| `{{summary}}` | Memory text in the injection wrapper |

### Import and export

Use **Import / Export** to save memory as JSON. Keep an export before importing or clearing memory.

- Native exports must match the current chat ID, source identities, and fingerprints.
- Original SillyTavern exports can be bound to the corresponding current chat only when every snippet contains an explicit `turnRange`.
- Legacy merged/promoted SillyTavern snippets without recoverable source ranges are rejected; there is not enough provenance to safely exclude their originals.

Memory exports can contain private story content. Do not commit them or attach them to public issues without reviewing and redacting them.

## Permissions and privacy

The manifest requests `generation`, `interceptor`, `chat_mutation`, `chats`, `personas`, and `ui_panels` for summarization, prompt filtering, reading chat/persona context, and the native drawer UI. Despite the `chat_mutation` permission name, Summaryception does not delete, rewrite, or mark original messages hidden.

Summary requests send the selected passage and existing memory to your configured model provider. Credentials are managed by Lumiverse. Memory stores source IDs and SHA-256 fingerprints instead of copies of the full original text, alongside the generated summaries. Debug mode logs request diagnostics without source text.

Completed batches are persisted before promotion. Failed, empty, truncated, or cancelled requests do not exclude uncommitted source passages from prompts. Cancellation does not undo batches already completed.

## Development and publishing

Built against `lumiverse-spindle-types` **0.6.40**. Install the locked dependencies before running these commands:

| Command | Purpose |
| --- | --- |
| `bun run typecheck` | Check TypeScript without emitting files |
| `bun run test` | Run behavioral engine regression tests |
| `bun run build` | Build the backend and frontend bundles |
| `bun run verify` | Run typechecking, tests, and the build |
| `bun run package` | Create a local-import ZIP with bundles and corresponding source |

To publish on GitHub:

1. Upload the source repository, including `bun.lock`, `spindle.json`, build scripts, license, and notices. The `.gitignore` excludes dependencies, build output, release archives, local environment files, databases, and editor artifacts. It does not remove files already tracked by Git; review what you upload for private content.
2. Run the source-build commands above.
3. Create a GitHub Release for the version and attach `release/Summaryception-<version>.zip`. The ignored archive is uploaded as a release asset, not committed to the repository.
4. Keep the release's source and version aligned with the packaged files. Package again after changing metadata or documentation so the downloaded archive contains those changes.

The manifest intentionally does not point to the upstream SillyTavern repository for GitHub installation or updates. Use the packaged local-import workflow documented here.

For bug reports, include your Lumiverse version, extension version, reproduction steps, and any redacted error output. Never include API keys or unredacted chat/memory exports.

## Credits and license

- **Lumiverse port author:** Ryah.
- **Original Summaryception:** [Lodactio](https://github.com/Lodactio/Extension-Summaryception), based on v5.5.4 at commit `6a0afdc84fbd8f410db53738fa0f91d6a009eeb6`.
- **Port modifications began:** 2026-10-12.

Licensed under **AGPL-3.0-only**, without warranty. See [LICENSE](LICENSE), [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), and [CHANGELOG.md](CHANGELOG.md). Release packages include corresponding source and build scripts; preserve the applicable license, attribution, and source-availability obligations when redistributing or modifying this extension.
