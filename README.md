# Summaryception for Lumiverse

**Recursive memory for long-running AI roleplay chats.** A native [Lumiverse](https://lumiverse.chat) Spindle extension by **Ryah**, adapted from [Lodactio's Summaryception for SillyTavern](https://github.com/Lodactio/Extension-Summaryception).

Summaryception turns older conversation passages into layered summaries while keeping recent exchanges verbatim. As memory grows, older snippets are condensed into higher layers, then injected into the chat prompt as historical context. Your original messages remain readable and unchanged.

## Features

- **Layered chat memory:** incremental summaries with recursive promotion of older snippets.
- **Non-destructive prompt compression:** summarized messages can be excluded from prompts without deleting, rewriting, or hiding them in the chat.
- **Automatic or manual processing:** summarize one batch, process an entire backlog, skip it, or cancel processing.
- **Independent summarizer connection:** use your active Lumiverse connection or select a dedicated native connection profile.
- **Editable memory:** search, edit, regenerate, or delete snippets; repair memory after source changes.
- **Customizable prompts:** Narrative and Game state presets, custom prompt slots, output-stripping strings, and an editable injection template.
- **Inspect and transfer:** preview the injected context, inspect Prompt Breakdown attribution, and export/import memory as JSON.
- **Persistent state:** per-user settings and per-chat memory survive extension restarts.

## Requirements

- **Lumiverse 1.2.4 or newer**, with access to extension management as an owner/admin.
- A working model/provider configured in Lumiverse **Connections**.
- **Bun** if you are building from source. Prebuilt release installations do not require you to build the extension separately.

This is a **Lumiverse extension**, not a SillyTavern extension. The original SillyTavern repository is linked for attribution, not installation or updates.

## Installation

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
