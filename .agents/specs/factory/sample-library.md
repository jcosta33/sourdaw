# Sample Library Browser

## Context

> **Codebase Annotation:** The Sample Library Browser is **Completely Missing**. No Rust data models (`PackIndex`, `SampleEntry`), no Tauri commands (`search_samples`, `import_pack`, etc.), and no frontend components exist. The existing sampler suite (`unified-sampler-suite.md`) assumes a sample source — this spec defines that source.

Relevant research: `.agents/research/factory/samples-slicer.md` (Section 1).

Sourdaw needs a first-class sample library browser that unifies three distinct worlds:

1. **Online discovery** — Freesound's 700k+ CC/Public-Domain samples require OAuth2 authentication and a rate-limited HTTPS API.
2. **Offline curated libraries** — GitHub-hosted CC0 asset packs (VCSL, LMMS Assets, Iowa MIS) ship as ZIPs and must be indexed locally.
3. **User-local content** — user's own drag-dropped folders must be watched, indexed, and searched identically to the curated libraries.

All three paths must converge into a single browser UI with fuzzy search, tag faceting, waveform preview, and drag-to-instrument workflows — with p95 query latency under 50 ms on a 100k-sample index.

Related specs:

- `unified-sampler-suite.md` — the consumer of sample drops (Quick/Drum/Slice modes).
- `drum-machine.md` — pad assignments consume library items via drag-drop.
- `slicer.md` — receives dropped loops from the library (this spec).

This spec does **not** define slicing, the drum engine, or the unified sampler's internal DSP — see the specs above.

---

## Goal

Deliver a Rust-backed sample library service and React browser that: (a) authenticates with Freesound via OAuth2, (b) indexes offline CC0 packs and user folders into a content-addressed store, (c) serves fuzzy-ranked, faceted search results in under 50 ms p95 on a 100k-item library, (d) streams audio previews without blocking the UI, and (e) displays license/attribution for every visible sample.

---

## User-visible behavior

- **Unified browser panel** — a single left-dock browser with three top-level sources: `Freesound`, `Factory Packs`, `My Library`. Users do not need to know which is online vs offline for filtering/search.
- **Sign in to Freesound** — first Freesound click opens a browser OAuth2 flow. Token persists across sessions. Signed-out state shows a prompt, not an error.
- **Type-ahead search** — results update as the user types. Query "bass kick 808" matches "808_Kick_Dirty.wav" via subsequence/fuzzy ranking — no exact-substring requirement.
- **Tag + category facets** — browseable category tree (Drums > Kick > 808) with counts per leaf. Multi-select facets narrow the search.
- **Hover or click preview** — audio plays within 200 ms of the click, with a synchronized waveform overlay and playback cursor. Stops on next click elsewhere or ESC.
- **Drag to any instrument** — dragging an item over a pad (Drum/Toaster), slice marker (Slicer), or track drop zone previews it, and on drop hands off a resolved local file path + attribution record.
- **Import pack** — a "Install Pack" button downloads a curated pack ZIP, extracts it into a managed location, and makes items browseable within 30 seconds for a 200 MB pack.
- **Live folder watching** — dropping a file into a watched user folder makes it appear in the browser within 500 ms, with a subtle "new" indicator.
- **Attribution on hover + at drop** — every item surfaces license and source. On drop, the attribution record (license, author, source URL, sample ID) is recorded into the project so credits can be exported.

---

## Scope

### In scope

- **Rust crate `daw-samples`** containing `PackIndex`, `SampleEntry`, blake3 content-addressing, on-disk `index.json` format, and migration helpers.
- **Freesound integration:** OAuth2 Authorization Code flow (PKCE), token storage in OS keychain via `keyring`, search API client, download-by-id, rate-limit backoff.
- **Offline pack integration:** manifest format describing supported GitHub-hosted packs; ZIP download + extraction + index build pipeline.
- **Tauri command surface:** typed commands for search, metadata, preview, pack import, library rescan, attribution.
- **In-memory index:** `nucleo-matcher`-backed fuzzy search with `BTreeMap` category trees; warm-start from disk cache.
- **Audio preview:** `rodio` playback on a dedicated thread using `symphonia` for decode; single active preview at a time.
- **Waveform peak cache:** pre-decoded peak mipmaps per sample, invalidated on file mtime/size change.
- **Filesystem watching:** `notify-debouncer-full` on all user-designated library roots with 500 ms debounce.
- **Attribution model:** every `SampleEntry` carries license + source metadata; dropped samples emit an `attribution` record consumed by the project model.
- **React UI:** three-source browser, fuzzy type-ahead, facets, waveform preview, drag handoff.

### Non-goals (explicitly out of scope)

- **Sample editing, slicing, or onset detection** — covered by `slicer.md` and `unified-sampler-suite.md`.
- **Per-pad assignment, round-robin, velocity layering** — owned by the consuming instruments.
- **Cloud-sync of user libraries** — each client owns its own index.
- **Commercial-license packs** (Splice, Loopcloud, etc.) — out of scope for this spec; extensibility hooks are noted but not implemented.
- **ML-based tagging / auto-categorization of user samples** — heuristics only.
- **Shipping the Freesound API key embedded in the binary** — see `Open questions`.

---

## Requirements

### R1 — Freesound OAuth2 integration

- The app MUST implement the OAuth2 Authorization Code flow with PKCE against Freesound's `/apiv2/oauth2/authorize/` and `/apiv2/oauth2/access_token/` endpoints.
- Access + refresh tokens MUST be stored in the OS keychain via the `keyring` crate — never in plain JSON on disk.
- On 401 responses, the client MUST transparently refresh the access token before retrying the original request.
- The search client MUST respect Freesound's rate limit (60 req/min default) using a token-bucket limiter; on 429, it MUST back off with exponential jitter (base 1 s, cap 30 s).
- Advanced search MUST support: `query`, `filter` (channels, duration, samplerate, license), `sort` (score, rating, downloads, duration), `page`, `page_size`, `fields`.
- Network errors MUST NOT block the UI thread; all Freesound work happens on a Tokio task.

**Acceptance:**
- AC1: Signing in opens a browser, redirects to `http://127.0.0.1:<port>/callback`, and the app receives the token within 60 s.
- AC2: Token survives app restart; revoked tokens trigger re-auth, not a crash.
- AC3: A test that stubs 429 responses verifies the client waits and retries with exponential backoff.

### R2 — Offline CC0 library support

- The app MUST ship with a curated `factory-packs.json` manifest listing: VCSL (Versilian Community Sample Library), LMMS Official Assets, University of Iowa Musical Instrument Samples, and at least 3 additional CC0 sources.
- Each manifest entry MUST include: `id`, `display_name`, `license`, `source_url`, `archive_url`, `sha256`, `version`, `uncompressed_size_mb`, `attribution_template`.
- A pack MUST be downloaded via streaming HTTPS, verified against its `sha256`, extracted to `$APP_DATA/packs/<id>-<version>/`, and indexed.
- Attribution MUST be displayed in the browser for every item from a pack (license + source URL + original author when present in metadata).
- Partial downloads MUST be resumable (Range requests) or restart cleanly on failure; no corrupted partial files may be left in the pack directory.

**Acceptance:**
- AC1: Installing a 200 MB pack on a 50 Mbps connection completes within 60 s and produces a queryable index.
- AC2: Tampering with a downloaded archive (modifying a byte) MUST cause install to fail with a checksum error and remove the bad file.
- AC3: Uninstalling a pack removes its directory AND all its index entries; other packs' entries remain.

### R3 — `PackIndex` / `SampleEntry` Rust data models

- A `SampleEntry` MUST include: `id: SampleId`, `relative_path: PathBuf`, `display_name: String`, `duration_ms: u32`, `channels: u8`, `sample_rate: u32`, `bit_depth: Option<u8>`, `format: AudioFormat`, `tags: Vec<String>`, `category_path: Vec<String>`, `license: License`, `attribution: Attribution`, `file_size_bytes: u64`, `file_mtime: SystemTime`, `peak_cache_path: Option<PathBuf>`.
- `SampleId` MUST be a newtype wrapping a `blake3::Hash` derived from the file's raw bytes — independent of path, filename, or filesystem metadata.
- `PackIndex` MUST be `Serialize + Deserialize` with an explicit `schema_version: u32`; loading an older version MUST either migrate forward or be rejected with a clear error — never silently corrupt.
- On-disk format: one `index.json` per pack root (human-inspectable) plus an optional `index.bin` binary cache for fast startup (bincode).
- A `Migration` trait MUST define `from_version() -> u32` and `migrate(&mut Value) -> Result<()>`; the dispatcher MUST run migrations in ascending order until current.

**Acceptance:**
- AC1: Hashing the same file twice across separate process runs produces the identical `SampleId`.
- AC2: Renaming a file inside a watched folder does NOT change its `SampleId`; moving the same bytes to a different folder produces the same ID.
- AC3: A fixture `index.json` at `schema_version = 1` loads correctly under the current codebase via migration.

### R4 — Tauri commands

Typed via `tauri-specta` (per `AGENTS.md` — Typesync). All commands live exclusively in `src-tauri`.

- `search_samples({ query, sources, filters, page, page_size }) -> SearchPage` — unified search across all sources.
- `get_sample_metadata({ id }) -> SampleEntry` — full record for one item.
- `get_waveform_peaks({ id, mip_level }) -> PeakStrip` — binary peak mipmap for preview/waveform.
- `preview_sample({ id, start_ms, end_ms }) -> PreviewHandle` — starts preview, returns handle for cancel.
- `stop_preview({ handle })` — idempotent cancel.
- `import_pack({ pack_id }) -> ImportJob` — begins download; progress via event channel.
- `list_installed_packs() -> Vec<InstalledPack>`.
- `uninstall_pack({ pack_id }) -> Result<()>`.
- `add_user_library_root({ path }) -> Result<()>` — starts watching.
- `remove_user_library_root({ path }) -> Result<()>` — stops watching and removes entries.
- `get_attribution({ id }) -> Attribution` — for drop-time recording into project model.

Progress events: `pack-import-progress`, `library-scan-progress`, `library-updated` (coalesced, max 10 Hz).

**Acceptance:**
- AC1: Generated TypeScript bindings (`tauri-specta`) compile with zero `any` types in consuming modules.
- AC2: Every command is covered by at least one Rust unit test that exercises success + one error path.

### R5 — In-memory fuzzy search

- The engine MUST use `nucleo-matcher` for ranking. Each `SampleEntry` contributes a concatenated haystack of `display_name + tags + category_path`, lowercase-normalized.
- Category facets MUST be built as a `BTreeMap<String, CategoryNode>` tree with per-node item counts maintained incrementally on insert/remove.
- The full index MUST be held in RAM; startup MUST reconstruct from `index.bin` when present.
- Query pipeline: (a) subsequence prefilter via `nucleo`, (b) score + rank, (c) apply active facet filters, (d) return top-`page_size` with facet counts for the current result set.
- Incremental updates (add/remove single entry) MUST NOT require a full rebuild.

**Acceptance:**
- AC1: On a 100k-entry synthetic library, p95 query latency MUST be under 50 ms on a 2020-era laptop (measured with `criterion`).
- AC2: Query "kick 808" returns "808_Kick_Dirty.wav" ranked within the top 10 results on a factory-content index.
- AC3: Removing one entry reduces facet counts for its ancestor categories by exactly one — measured after an insert/remove pair returns counts to baseline.

### R6 — Audio preview

- Preview MUST use `rodio` for playback on a dedicated OS thread (NOT the UI thread, NOT the DAW audio thread).
- Decode MUST use `symphonia` and support: WAV (PCM, float), AIFF, FLAC, MP3, Ogg Vorbis, Opus. Unsupported formats MUST fail with a clear error, not a panic.
- On macOS, all `rodio`/`symphonia` calls MUST be confined to the dedicated thread; no `Send`-unsafe handles may cross threads (documented macOS `rodio` thread-safety constraint).
- Only one preview may play at a time. Starting a second preview MUST apply a 5–10 ms linear fade-out to the first before starting the second.
- Preview MUST begin audible output within 200 ms of the command being issued (measured end-to-end from UI click to first audio frame on a warm peak cache).

**Acceptance:**
- AC1: Clicking a sample while another is playing cuts over within one render quantum without clicks or pops.
- AC2: A broken/truncated file produces a UI-level error event and does NOT kill the preview thread.

### R7 — Waveform peak cache

- For each sample, peaks MUST be computed once and stored as a hierarchical mipmap: level 0 at block size 64 samples, subsequent levels as powers of two (128, 256, 512, …).
- Peaks MUST store `{min: f32, max: f32}` pairs per block for lossless min/max rendering at any zoom.
- Cache MUST be stored in `$APP_DATA/peaks/<blake3-first-2>/<blake3>.peaks` (sharded by first 2 hex chars of the ID).
- Cache MUST be invalidated when the source file's mtime OR size changes.
- Cache reads MUST be `mmap`-backed for zero-copy mipmap slicing.

**Acceptance:**
- AC1: After touching a source file's mtime, the next `get_waveform_peaks` call triggers re-decode; before the touch it does not.
- AC2: The on-disk peak size for a 1-minute stereo 48 kHz WAV stays under 256 KB (mipmap all levels).

### R8 — Filesystem watching

- User-designated library roots MUST be watched with `notify-debouncer-full` at a 500 ms debounce.
- Watcher events MUST be mapped into `IndexMutation` variants (`Added`, `Removed`, `Modified`, `Moved`) and applied atomically against the in-memory index + on-disk cache.
- Adding a single audio file to a watched folder MUST cause it to appear in a subsequent search query within 500 ms (end-to-end).
- Non-audio files and hidden files (dotfiles) MUST be ignored.
- Symlinks MUST be resolved once; cycles MUST be detected and logged, not traversed infinitely.

**Acceptance:**
- AC1: Dropping a `.wav` into a watched root surfaces it in a fuzzy-search result within 500 ms of the drop.
- AC2: Renaming `foo.wav` → `bar.wav` preserves its `SampleId` and updates only the `display_name` + `relative_path`.

### R9 — Downloader

- Pack downloads MUST use `reqwest` with streaming response bodies to a temp file, verified against `sha256` before being atomically renamed into place.
- Progress MUST be reported via the `pack-import-progress` event at up to 10 Hz (coalesced).
- Cancellation MUST be supported: cancelling deletes the temp file and leaves no orphaned state.
- Concurrent pack downloads MUST be serialized (FIFO queue) to avoid bandwidth contention, OR capped at 2 simultaneous — choice is an implementation detail, but behavior MUST be deterministic.
- Extraction MUST use `zip` (or `async_zip`) with per-entry size limits (reject any single entry > 500 MB to guard against zip bombs).

**Acceptance:**
- AC1: Cancelling a 50%-complete download frees all disk space used by the partial file.
- AC2: A zip bomb (entry with extracted size > 500 MB) is rejected with an error and does not fill the disk.

### R10 — Attribution & license display

- Every `SampleEntry` MUST carry a typed `License` (enum: `CC0`, `CC_BY`, `CC_BY_SA`, `CC_BY_NC`, `Public_Domain`, `Sampling_Plus_1_0`, `Commercial(String)`, `Unknown`) and an `Attribution { author: Option<String>, source_url: Option<String>, credit_line: String }`.
- The browser UI MUST show the license badge on every visible result (iconographic for CC licenses, text fallback otherwise).
- On drop into an instrument or track, the project model MUST be handed a frozen `AttributionRecord` containing the `SampleId`, `License`, `Attribution`, and a `used_at: DateTime`.
- A project-level "Export Credits" action MUST produce a Markdown file listing all dropped samples, grouped by license, with URLs.
- Samples with license `Commercial(_)` or `Unknown` MUST surface a warning badge and MUST NOT be auto-included in credit exports without user confirmation.

**Acceptance:**
- AC1: Hovering any result shows its license within 100 ms (tooltip or always-visible badge).
- AC2: Dropping a CC-BY sample into a project produces an attribution record retrievable via `get_project_attribution`.
- AC3: Exporting credits for a 3-sample project produces a stable, reproducible Markdown file.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`). Frontend code lives in `src/modules/SampleLibrary/`. Rust code lives in a new `daw-samples` crate consumed only by `src-tauri`.
- Audio preview MUST NOT touch the DAW's real-time audio thread; it uses its own `rodio` output stream.
- No `any` escape hatches in the TypeScript bindings; all Freesound payloads MUST be validated with Zod at the boundary.
- `pnpm deps:validate` MUST pass with zero violations after implementation.
- No `forwardRef`, no `useMemo`/`useCallback`/`React.memo` (React Compiler is active).
- All `#[tauri::command]` functions live in `src-tauri` only (per `AGENTS.md` — Backend Rust Tauri Architecture).

---

## Design decisions

### Decision: Content-addressed IDs via blake3

**Chosen:** `SampleId` = `blake3::hash(file_bytes)`.
**Considered and rejected:**
- `xxhash` — faster but not cryptographically robust; identical short hashes across different files are possible on large corpora (100k+ items).
- `sha256` — robust but 2–4× slower than blake3 on modern CPUs; identical security properties are unnecessary for an asset library.
- Path-based or UUID-based IDs — break on rename/move and duplicate the same audio data under multiple IDs. The whole point of content-addressing is that "the same audio" maps to "the same ID" everywhere.

### Decision: `nucleo-matcher` over alternatives

**Chosen:** `nucleo-matcher` for fuzzy ranking.
**Considered and rejected:**
- `fuzzy-matcher` (skim variant) — older algorithm, slower on long haystacks, less actively maintained.
- `tantivy` — full-text search engine with inverted indices; overkill for our 100k-item scale and introduces mandatory on-disk segment management we don't need.
- Hand-rolled subsequence scorer — reinvents a well-tuned wheel; nucleo is the ranker used by Helix and is already optimized for type-ahead UIs.

### Decision: JSON for `index.json`, bincode for `index.bin` startup cache

**Chosen:** human-readable `index.json` as the canonical form; `index.bin` (bincode) as an opaque performance cache regenerated from JSON on version mismatch.
**Considered and rejected:**
- JSON-only — startup on 100k entries takes 2–4 s which is user-visible.
- Bincode-only — makes the index opaque; debugging issues requires custom tooling. For a library of user-visible content, human-readable is cheap and valuable.
- SQLite — adds a heavyweight dependency and blurs the "index is a set of files you can copy" model that makes packs portable.

### Decision: Freesound OAuth2 with PKCE over client-credentials

**Chosen:** Authorization Code + PKCE.
**Considered and rejected:**
- Client credentials flow — tied to an app secret that MUST NOT ship in a client binary.
- Implicit flow — deprecated by the OAuth 2.0 Security BCP.

### Decision: `rodio` for preview, not the DAW engine

**Chosen:** preview runs through its own `rodio` OutputStream on a dedicated thread.
**Considered and rejected:**
- Route preview through the DAW's mixer — couples library to mixer topology, makes "preview while transport is stopped" awkward, and risks preview audio getting recorded into a bounced mix.
- WebAudio preview — works for frontend but duplicates the decoder stack we already ship in Rust; also loses native file-path access.

---

## Acceptance criteria

- [ ] OAuth2 sign-in completes end-to-end, tokens persist across restarts, refresh works automatically.
- [ ] At least 3 factory packs (VCSL, LMMS, Iowa MIS) are installable via `import_pack`.
- [ ] The same source file produces the same `SampleId` across runs, machines, and OSes.
- [ ] All Tauri commands listed in R4 exist, are typed via `tauri-specta`, and are exercised by Rust unit tests.
- [ ] `search_samples` p95 latency under 50 ms on a 100k synthetic corpus (benchmark checked in).
- [ ] Preview plays within 200 ms of click on a warm peak cache.
- [ ] Peak cache is invalidated on mtime change (regression test).
- [ ] Filesystem watcher surfaces new files within 500 ms (integration test with a tmp dir).
- [ ] Every visible result shows its license and source.
- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] `pnpm typecheck` passes with zero `any` in module boundaries.

---

## Implementation notes

- **Module layout** (frontend): `src/modules/SampleLibrary/` containing `useCases/` (searchSamples, previewSample, importPack, addLibraryRoot), `stores/` (browser UI state), `repositories/` (Tauri command wrappers), `presentations/views/LibraryBrowserView`, `models/` (local types; do NOT re-export across modules).
- **Crate layout**: `daw-samples` (pure index + Freesound + packs, no Tauri) consumed by `src-tauri` for commands. `daw-samples` MUST be Tauri-free per crate-split discipline in `AGENTS.md`.
- **Startup**: lazy-load the index off the main thread; show a skeleton browser within 100 ms, populate as ready.
- **Freesound token storage**: use `keyring` with service name `sourdaw.freesound` to leverage macOS Keychain / Windows Credential Manager / secret-service on Linux.
- **Peak cache layout**: shard by the first 2 hex chars of the `blake3` to avoid filesystem slowdowns at 100k+ entries in one directory.
- **UI**: use the existing virtualized list primitive (see `ui-patterns` skill) for result lists — do not invent a new one.

---

## Test plan

- [ ] Unit (Rust, `daw-samples`): blake3 determinism across runs; JSON schema migration; peak cache mtime invalidation.
- [ ] Unit (Rust, Freesound client): rate-limit back-off with stubbed 429; token refresh on 401; OAuth2 PKCE code verifier round-trip.
- [ ] Unit (Rust, packs): checksum verification; zip-bomb rejection; cancel-cleanup.
- [ ] Integration (Rust): 100k-entry synthetic index + `search_samples` `criterion` benchmark confirming p95 < 50 ms.
- [ ] Integration (Rust): `notify-debouncer-full` with a tmp dir, verify 500 ms visibility.
- [ ] Frontend (Vitest): Zod schemas reject malformed Freesound payloads; browser store reducers.
- [ ] E2E (manual): OAuth sign-in round-trip against Freesound staging; install VCSL pack; drag sample into Drum Machine pad; export credits.

---

## Open questions

- [ ] **[CRITICAL]** Freesound API key distribution. We need a `client_id` + `client_secret` pair for OAuth2. Options: (a) ship the secret in the binary (revocable but discoverable — violates Freesound TOS), (b) require each user to register their own Freesound app and paste credentials (highest friction), (c) proxy through a Sourdaw-hosted token endpoint (requires us to operate infrastructure but keeps the secret off-client). **Blocks R1 implementation.**
- [ ] **[MAJOR]** Storage budget for the peak cache. A 100k-entry library at ~50 KB/entry peaks is ~5 GB. Do we cap total cache size (LRU eviction), cap per-library, or let it grow unbounded? Eviction requires recomputing on re-access — is that acceptable UX?
- [ ] **[MAJOR]** Factory pack distribution channel. Do we ship pack manifests with the app binary (requires app update to add a pack) or fetch the manifest from a remote URL (lets us add packs post-release but introduces a dependency on our infra)?
- [ ] **[MINOR]** Audio format support on Windows: `symphonia` covers most formats but has patchy MP3 surround support. Do we gate MP3 surround behind a flag or accept best-effort decoding?
- [ ] **[MINOR]** Should the "My Library" source support multiple watched roots or just one per install? Multiple roots complicate the facet tree but is likely what power users expect.

---

## Tradeoffs and risks

- **Rate-limit ceilings**: Freesound's default 60 req/min is a hard wall. Power users searching rapidly WILL hit 429 responses. Our backoff keeps the UI responsive but results may briefly stall. Mitigation: aggressive client-side caching of recent queries keyed on `(query, filters)`.
- **Index memory**: a 100k-entry in-memory index is roughly 40–80 MB depending on tag density. For users with 500k+ sample libraries (not uncommon among producers), this could approach 400 MB of RAM — acceptable but worth measuring. If this becomes a problem, we can page facet counts or move to a disk-backed index — but not in scope for v1.
- **OS-keychain availability**: on some Linux environments (headless, minimal desktop) `secret-service` may be absent. Fallback: encrypted-at-rest file in `$APP_DATA` using the user's OS account as the key source. Worse than a real keychain but not catastrophic.
- **Content hashing at scale**: blake3 at ~3 GB/s on a modern CPU hashes a 100k-sample (avg 2 MB) library in ~65 s of pure CPU. First-time indexing on large libraries is noticeable — must be a background job with a progress indicator, and incremental (only hash files we haven't seen by `(path, size, mtime)`).
- **Legal exposure**: shipping factory packs means we are redistributing third-party content. Every entry MUST carry license + attribution so users cannot unknowingly use incompatible samples. We MUST verify each pack's redistribution terms before adding it to the factory manifest — this is a human responsibility not a code responsibility.

---

## Implementation Status

- **What is implemented:** A local-first sample library module (`src/modules/SampleLibrary`) exists with basic folder indexing (`LibraryRoot`), sample record management (`SampleRecord`), folder tree building, and metadata analysis (BPM, key, spectral descriptors). It also includes a spatial map for sample similarity.
- **What is not implemented:** The core requirements of this spec are missing: Freesound OAuth2 integration, offline CC0 library support (packs), the specific Rust `PackIndex` and `SampleEntry` models (the current model is in TypeScript), `nucleo-matcher` fuzzy search, advanced audio preview with dedicated thread and crossfades, waveform peak cache, pack downloader, and attribution/license display.
- **What is done well:** The existing local folder scanning and metadata analysis are functional and follow the module architecture.
- **What needs refactoring:** The existing TypeScript models and stores need to be migrated or replaced by the Rust-backed architecture described in this spec to support content-addressing (blake3) and high-performance fuzzy search.
