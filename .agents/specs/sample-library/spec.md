---
type: spec
id: SPEC-sample-library
title: Sample library browser
status: in-progress
owner: The Sourdaw team
sources:
  - research.md
  - ../bakery/research.md
---

# Sample library browser

## Intent

Give Sourdaw one sample browser that unifies Freesound discovery, curated CC0 packs, and the
user's own folders behind fuzzy search, faceting, waveform preview, and drag-to-instrument —
backed by a Rust index with content-addressed IDs and license-aware attribution.

## Non-goals

- Sample editing, slicing, or onset detection (owned by the slicer and sampler specs).
- Per-pad assignment, round-robin, or velocity layering (owned by consuming instruments).
- Cloud-sync of user libraries.
- Commercial-license packs (Splice, Loopcloud).
- ML-based auto-tagging of user samples.

## Requirements

### AC-001 — Content-addressed sample IDs

A `SampleId` must be the blake3 hash of the file's raw bytes, identical across runs and
unchanged by rename or move.

Verify with: `pnpm cargo:test -- -p daw-samples sample_id`

### AC-002 — Fuzzy search meets the latency target

`search_samples` must return ranked results with p95 latency under 50 ms on a 100k-entry
index.

Verify with: `pnpm cargo:test -- -p daw-samples search`

### AC-003 — Fuzzy ranking matches by subsequence

The query "kick 808" must rank "808_Kick_Dirty.wav" within the top results without an
exact-substring match.

Verify with: `pnpm cargo:test -- -p daw-samples search`

### AC-004 — Facet counts update incrementally

Removing one entry must decrement its ancestor category counts by exactly one without a full
rebuild.

Verify with: `pnpm cargo:test -- -p daw-samples facets`

### AC-005 — Freesound OAuth2 with PKCE persists tokens

Signing in must complete the Authorization Code + PKCE flow and store tokens in the OS
keychain across restarts.

Verify with: `manual` — sign in to Freesound and confirm the token survives an app restart

### AC-006 — Rate-limit backoff on 429

On a 429 response the Freesound client must back off with exponential jitter and retry.

Verify with: `pnpm cargo:test -- -p daw-samples freesound`

### AC-007 — Pack install verifies checksum

`import_pack` must stream, verify sha256, extract, and index a pack.

Verify with: `pnpm cargo:test -- -p daw-samples packs`

### AC-008 — Peak cache invalidates on file change

`get_waveform_peaks` must recompute when the source file's mtime or size changes.

Verify with: `pnpm cargo:test -- -p daw-samples peaks`

### AC-009 — Folder watcher surfaces new files

A new audio file dropped into a watched root must appear in a search result within 500 ms.

Verify with: `pnpm cargo:test -- -p daw-samples watcher`

### AC-010 — Preview runs off the DAW audio thread

`preview_sample` must play through a dedicated rodio thread and never touch the DAW's
real-time audio thread.

Verify with: `manual` — click a sample with the transport stopped and confirm playback within ~200 ms

### AC-011 — Attribution recorded on drop

Dropping a sample must hand the project a frozen attribution record carrying the sample ID,
license, attribution, and a used-at timestamp.

Verify with: `pnpm test:run -- SampleLibrary`

### AC-012 — No cross-module internal imports

This feature must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-013 — Preview decodes the full audio format set

`preview_sample` must decode WAV (PCM/float), AIFF, FLAC, MP3, Ogg Vorbis, and Opus.

Verify with: `pnpm cargo:test -- -p daw-samples preview_formats`

### AC-014 — Watcher ignores non-audio, dotfiles, and symlink cycles

The folder watcher must ignore non-audio files and hidden/dotfiles.

Verify with: `pnpm cargo:test -- -p daw-samples watcher_filters`

### AC-015 — Full Tauri command surface and coalesced progress events

The command surface must expose `search_samples`, `get_sample_metadata`, `get_waveform_peaks`,
`preview_sample`, `stop_preview`, `import_pack`, `list_installed_packs`, `uninstall_pack`,
`add_user_library_root`, `remove_user_library_root`, and `get_attribution`, plus the
`pack-import-progress`, `library-scan-progress`, and `library-updated` progress events
coalesced at a maximum of 10 Hz.

Verify with: `pnpm cargo:test -- -p daw-samples commands`

### AC-016 — Resumable downloads and clean uninstall

A partial pack download must resume via Range requests or restart cleanly leaving no corrupted
partials.

Verify with: `pnpm cargo:test -- -p daw-samples packs_download_uninstall`

### AC-017 — Per-entry extraction size limit rejects zip bombs

Pack extraction must reject any single archive entry whose extracted size exceeds 500 MB with
an error and without filling the disk.

Verify with: `pnpm cargo:test -- -p daw-samples zip_bomb`

### AC-018 — License and warning badges on every result

The browser must show a license badge on every visible result (iconographic for CC licenses,
text fallback otherwise).

Verify with: `pnpm test:run -- SampleLibrary`

### AC-019 — Export Credits produces a grouped Markdown file

A project-level "Export Credits" action must produce a Markdown file listing all dropped
samples grouped by license, with their source URLs.

Verify with: `pnpm test:run -- ExportCredits`

### AC-020 — Tampered pack archive is rejected and removed

A tampered pack archive must fail import and be removed.

Verify with: `pnpm cargo:test -- -p daw-samples packs`

### AC-021 — Unsupported or truncated formats fail cleanly

An unsupported or truncated format must fail with a clear error and never panic.

Verify with: `pnpm cargo:test -- -p daw-samples preview_formats`

### AC-022 — Symlink cycle detection stops traversal

The folder watcher must resolve each symlink once with cycle detection that logs and stops
rather than traversing infinitely.

Verify with: `pnpm cargo:test -- -p daw-samples watcher_filters`

### AC-023 — Uninstall removes a pack's directory and index entries

Uninstalling a pack must remove its directory and all of its index entries while leaving other
packs' entries intact.

Verify with: `pnpm cargo:test -- -p daw-samples packs_download_uninstall`

### AC-024 — Warning badge on commercial and unknown licenses

Samples with license `Commercial(_)` or `Unknown` must surface a warning badge.

Verify with: `pnpm test:run -- SampleLibrary`

### AC-025 — Preview crossfades between successive samples

When a new preview starts while a previous preview is still sounding, `preview_sample` must
crossfade from the outgoing to the incoming sample rather than hard-cutting.

Verify with: `pnpm cargo:test -- -p daw-samples preview_crossfade`

### AC-026 — Transparent token refresh on 401

On a 401 response, the Freesound client must transparently refresh the access token and retry
the original request before surfacing an error to the caller.

Verify with: `pnpm cargo:test -- -p daw-samples freesound`

### AC-027 — Revoked token triggers re-auth, not a crash

A revoked or otherwise unrecoverable token must trigger a re-authentication prompt rather than
crash the app.

Verify with: `pnpm cargo:test -- -p daw-samples freesound`

### AC-028 — Index carries an explicit schema version

`PackIndex` must carry an explicit `schema_version: u32`, and loading an older version must
either migrate forward or be rejected with a clear error — never silently corrupt.

Verify with: `pnpm cargo:test -- -p daw-samples index_schema_version`

### AC-029 — Ascending migration dispatch loads an old fixture

A `Migration` trait exposing `from_version() -> u32` and `migrate()` must be dispatched in
ascending version order, such that a `schema_version = 1` fixture `index.json` loads correctly
under the current codebase via migration.

Verify with: `pnpm cargo:test -- -p daw-samples index_migration`

### AC-030 — Cancelling a download frees all disk space

Cancelling a partially complete download (e.g. at 50%) must delete the temp file and free all
disk space it used, leaving no orphaned state.

Verify with: `pnpm cargo:test -- -p daw-samples packs_download_uninstall`

### AC-031 — Concurrent downloads are deterministic

Concurrent pack downloads must be serialized into a FIFO queue or capped at 2 simultaneous; the
chosen behavior must be deterministic.

Verify with: `pnpm cargo:test -- -p daw-samples packs_download_concurrency`

### AC-032 — Peak cache stays within its size bound

The on-disk peak cache for a 1-minute stereo 48 kHz WAV must stay under 256 KB across all
mipmap levels, stored as `{min: f32, max: f32}` pairs per block with a level-0 block size of 64
samples and subsequent levels at powers of two, and read back `mmap`-backed.

Verify with: `pnpm cargo:test -- -p daw-samples peaks`

## Open questions

- [ ] **[blocking]** Freesound API key distribution: ship the secret (discoverable, violates TOS), require per-user app registration, or proxy through a hosted token endpoint? Blocks the Freesound path.
- [ ] (non-blocking) Peak-cache storage budget — cap with LRU eviction, cap per-library, or grow unbounded?
- [ ] (non-blocking) Factory-pack distribution — bundle manifests with the binary or fetch from a remote URL?
- [ ] (non-blocking) MP3 surround support on Windows via symphonia — gate behind a flag or accept best-effort?
- [ ] (non-blocking) Support multiple watched "My Library" roots or one per install?
- [ ] (non-blocking) World-class browser & content intelligence layer (deferred-gap from intake/implementation-gaps.md §5.4 "World-Class Browser & Content System"). Beyond today's local-folder scanning and tag models, the researched-but-unbuilt scope is: (a) **Sound Similarity Search** driven by spectral embeddings ("find samples that sound like this one"); (b) **AI auto-tagging** of samples — note this conflicts with this spec's standing Non-goal "ML-based auto-tagging of user samples," so adopting it requires reopening that decision and would likely be scoped to factory/curated content rather than user folders; (c) **contextual drag-auditioning** that time-stretches/pitch-shifts the audition to the project's current tempo and key while dragging; (d) **mix-ready genre starter packs** shipped to expand the factory content. Treat as a forward content-intelligence epic, not a single requirement; similarity search and tempo/key-synced auditioning are the most self-contained candidates to graduate into ACs first.
- [ ] (non-blocking) (restored detail) Advanced-search parameter surface and manifest field list — concrete shapes dropped in the migration, recorded for fidelity rather than as a single behavior. Freesound advanced search is expected to expose: `query`, `filter` (channels, duration, samplerate, license), `sort` (score, rating, downloads, duration), `page`, `page_size`, `fields`. Each `factory-packs.json` manifest entry is expected to carry: `id`, `display_name`, `license`, `source_url`, `archive_url`, `sha256`, `version`, `uncompressed_size_mb`, `attribution_template`. Confirm or trim these surfaces when the command/manifest contracts are pinned (the `fields`/`sort` enumerations and the manifest schema are the most likely to drift).
- [ ] (non-blocking) Sample-library intelligence implementation specifics (deferred-gap from intake/spec-of-the-gaps.md §4.1 "Sample Library Intelligence"). The bulk of this gap is already captured by existing ACs (Blake3 content-addressing AC-001; Freesound OAuth2 AC-005/AC-006; CC0/offline packs AC-007/AC-016/AC-020; fuzzy search AC-002/AC-003; peak cache AC-008; dedicated-thread preview AC-010; preview crossfades AC-025). Two named specifics remain mechanism-level and are recorded here for fidelity rather than as requirements: the fuzzy matcher is intended to be the **`nucleo-matcher`** high-performance matcher, and pack downloads run through a **background pack downloader** (the resumable/coalesced-progress behavior of which is already constrained by AC-015/AC-016). Confirm `nucleo-matcher` is the matcher backing AC-002/AC-003 when implementing, or pick an equivalent that meets the 50 ms p95 target.

## Affected areas

- `src/modules/SampleLibrary/` (use cases, stores, repositories, `LibraryBrowserView`, local models)
- `crates/daw-samples` (`PackIndex`, `SampleEntry`, blake3 addressing, index format, migrations)
- `src-tauri` typed commands and progress events

## Dropped from sources

- Slicing, onset detection, and the sampler's internal DSP — owned by the slicer and unified-sampler specs.
- Per-pad assignment / round-robin / velocity layering — owned by consuming instruments.
- Cloud-sync, commercial packs, and ML auto-tagging — out of scope for this browser.
