---
type: spec
id: SPEC-freeze-flatten-bounce
title: Freeze, flatten, and bounce track operations
status: in-progress
owner: The Sourdaw team
sources:
  - research.md
---

# Freeze, flatten, and bounce track operations

## Intent

Let users render a track's plugin chain to audio to reclaim CPU — reversibly via
freeze, permanently via flatten, and selectively via bounce — while the mixer stays
live and the system detects when a frozen track's source has drifted out of date.
Background and the surveyed-DAW evidence live in `research.md`.

## Non-goals

- Partial freeze up to a chosen insert — deferred.
- Real-time freeze fallback — offline render only.
- Freezing external hardware inserts — blocked with an error.
- Cross-project freeze-file sharing — freeze files are project-local.
- Freezing folder tracks (flatten children first) and audio-to-MIDI on unfreeze.

## Requirements

### AC-001 — Freeze renders a track to bypassable audio

When the user freezes a track, the system must render its clips and device chain
offline to a 32-bit float WAV and play that buffer back with the live plugins bypassed.

Verify with: `pnpm test:run -- freezeTrack`

### AC-002 — Mixer controls stay live on a frozen track

When a track is frozen, its volume, pan, sends, mute, and solo must remain editable
and apply to the frozen audio.

Verify with: `pnpm test:run -- freezeTrack`

### AC-003 — Freeze moves through a defined state machine

The track freeze status must transition across `unfrozen → freezing → frozen → stale
→ error` and back to `unfrozen`, with no other states reachable.

Verify with: `pnpm test:run -- freezeState`

### AC-004 — Staleness is detected by content hash

When a frozen track's clips, positions, or device state change, the system must move
it to `stale` by comparing a recomputed source-content hash against the stored one.

Verify with: `pnpm test:run -- computeTrackHash`

### AC-005 — Unfreeze restores live processing

When the user unfreezes, the system must restore the live clips and devices, clear
the freeze metadata, and retain the freeze file under undo protection.

Verify with: `pnpm test:run -- unfreezeTrack`

### AC-006 — Flatten commits frozen audio in one undo step

When a non-stale frozen track is flattened, the system must replace its clips with a
single audio clip referencing the freeze file, clear its devices, and group the
mutation into one undo entry.

Verify with: `pnpm test:run -- flattenTrack`

### AC-007 — Bounce in place replaces a track with rendered audio

When the user bounces in place, the system must render the track and replace its
clips with the rendered audio, removing its devices.

Verify with: `pnpm test:run -- bounceInPlace`

### AC-008 — Bounce to new track renders to a fresh audio track

When the user bounces to a new track, the system must create a new audio track from
the render and mute the source track.

Verify with: `pnpm test:run -- bounceToNewTrack`

### AC-009 — Sidechain sources are included in the freeze render

When a frozen track has sidechain input, the render subgraph must include its
sidechain source tracks so the rendered audio is correct.

Verify with: `pnpm test:run -- freezeTrack`

### AC-010 — Render length covers plugin tails

The render duration must extend past content end by the maximum reported plugin
tail, falling back to silence detection for plugins reporting an infinite tail.

Verify with: `pnpm test:run -- renderFreeze`

### AC-011 — Unreferenced freeze files are garbage-collected

On project close, the system must delete freeze files not referenced by current
state or undo history.

Verify with: `pnpm test:run -- cleanupUnusedFreezeFiles`

### AC-012 — Concurrent freeze resolves last-writer-wins

When two peers freeze the same track concurrently, the later writer's freeze file
must win.

Verify with: `pnpm test:run -- freezeState`

### AC-013 — No cross-module internal imports

This feature must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-014 — Bounce exposes explicit per-render options

When the user invokes bounce, the system must offer controls for include inserts
(y/n), include sends (y/n), include volume/pan automation (y/n), tail handling
(auto/manual/off), and normalization (off/overload-protection/full).

Verify with: `pnpm test:run -- bounceTrack`

### AC-015 — Freeze render handles its five failure modes

The freeze render must handle disk-space exhaustion (pre-check with a 2× safety
margin and reject), plugin crash (abort, clean up, set `error` status), missing audio
buffer (continue with silence and warn), sidechain cycle (error dialog, abort), and
render timeout (auto-cancel, revert to `unfrozen`).

Verify with: `pnpm test:run -- renderFreeze`

### AC-016 — Plugin Delay Compensation is applied to freeze automation

During the freeze render, the system must apply Plugin Delay Compensation to
automation timing so automation on latency-inducing plugins does not drift.

Verify with: `pnpm test:run -- renderFreeze`

### AC-017 — Freeze reports progress, cancels cleanly, and self-recovers

While freezing, the system must report render progress (0.0–1.0), allow mid-render
cancellation that cleans up the temp file and reverts to `unfrozen`, and run a
5-minute watchdog that auto-reverts a stuck freeze operation.

Verify with: `pnpm test:run -- freezeTrack`

### AC-018 — Track header reflects every freeze state visually

The UI must show a snowflake icon when frozen, a yellow overlay when stale, a
progress spinner/bar when freezing, a red error indicator with tooltip on error, and
a cross-hatched overlay on frozen clips in Arrangement view.

Verify with: `pnpm test:run -- FreezeIndicator`

### AC-019 — Multi-output instruments render each output as its own freeze file

When the user freezes a multi-output instrument track, the system must render every
output as a separate freeze file linked to the parent instrument.

Verify with: `pnpm test:run -- freezeTrack`

### AC-020 — CRDT changes sync to the audio engine in debounced batches

The system must debounce CRDT changes into 16ms (one-frame) batches, sending
incremental per-track updates when fewer than 10 tracks changed and a full project
snapshot otherwise.

Verify with: `pnpm test:run -- freezeFileCache`

### AC-021 — Flatten warns when plugin state changed since freeze

When the track's `deviceChainHash` differs from its frozen metadata at flatten time,
the system must show a warning dialog ("Plugin settings changed since this track was
frozen…") and let the user re-freeze first or proceed.

Verify with: `pnpm test:run -- flattenTrack`

### AC-022 — Freeze files are written atomically with a recoverable layout

Each freeze render must write to a `.tmp` file under `freeze/` and atomically rename
on completion, record 32-bit-float render settings (sampleRate/bitDepth/channelCount/
tailLength) in the freeze metadata, and delete stray `.tmp` files on startup.

Verify with: `pnpm test:run -- freezeFileCache`

### AC-023 — Losing render file becomes GC-eligible after concurrent freeze

When two peers freeze the same track concurrently, the losing render file must become
GC-eligible.

Verify with: `pnpm test:run -- freezeState`

### AC-024 — Offline bounce renders are deterministic bit-for-bit

When the same project state is bounced offline twice, the two rendered WAV files must
be bit-for-bit identical, verified by comparing the BLAKE3 hash of each render.

Verify with: `pnpm test:run -- bounceTrack`

### AC-025 — Exported WAV carries BWF bext provenance metadata

When the system exports a bounced/rendered WAV, the file must carry a BWF `bext` chunk
recording the project name, the render timestamp, and the source project's BLAKE3 hash.

Verify with: `pnpm test:run -- bounceTrack`

### AC-026 — Flatten promotes the freeze file to a permanent asset

When a non-stale frozen track is flattened, the system must move the freeze file out
of the project `freeze/` directory and into the project `audio/` directory, promoting
it from a GC-eligible freeze artifact to a permanent project asset, and repoint the
flattened track's audio clip at the new `audio/` location.

Verify with: `pnpm test:run -- flattenTrack`

### AC-027 — Flatten converts a MIDI track to an audio track

When a MIDI track is flattened, the system must change the track's type from MIDI to
audio (since its clips are replaced by a single rendered audio clip and its instrument
and devices are cleared). Tracks already of audio type are left unchanged.

Verify with: `pnpm test:run -- flattenTrack`

### AC-028 — Flatten warns that the commit is irreversible after project close

Before flattening, the system must warn the user that, although flatten is undoable
within the session via CRDT undo, it becomes irreversible once the project is closed
(matching Ableton/Logic behavior).

Verify with: manual

### AC-029 — A peer freeze shows a lock indicator and suppresses competing freezes

While any peer holds `freezeState.status === 'freezing'` for a track, every other peer
must show a lock/busy indicator on that track's freeze control and must suppress
client-side freeze commands for that track, reporting "freeze in progress on <peer>".

Verify with: `pnpm test:run -- freezeState`

### AC-030 — Periodic GC enforces a byte budget via a freeze manifest

The system must run a periodic garbage-collection sweep on a 10-minute interval (in
addition to the save and close triggers) that enforces a total `freeze/` byte budget
and deletes referenced-but-orphaned freeze candidates older than a 7-day age threshold
in active projects. GC metadata — last-seen references, the byte budget, and age
counters — must be persisted in `Project/freeze/.freeze-manifest.json`.

Verify with: `pnpm test:run -- cleanupUnusedFreezeFiles`

### AC-031 — Freeze state stays backward-compatible with the legacy `Track.frozen` boolean

The extended freeze state model must maintain backward compatibility with the existing
`Track.frozen` boolean: existing code and documents that read `track.frozen` must
continue to observe a correct frozen/unfrozen value derived from the new
`freezeState.status`.

Verify with: `pnpm test:run -- freezeState`

## Open questions

- [ ] Disk-space pre-check margin: is 2× the estimated render size sufficient, or is a
  3× safety margin warranted before rejecting a freeze?
- [ ] (non-blocking) Archive packing modes (Full / Minimal / Smart) — ship in v1 or
  defer? Smart packing depends on plugin-availability detection.
- [ ] (restored detail) Source-track handling on bounce to new track: AC-008 only
  mutes the source. Pro Tools Commit offers four discrete modes — Hide and Make
  Inactive (its recommended default, preserves the original), Make Inactive, Delete
  (destructive), and Do Nothing. Its dialog also exposes a consolidate-clips toggle
  (whether the rendered clips are joined into one or left as separate per-source
  clips). Should Sourdaw's bounce-to-new-track expose a choice among these source-track
  modes (or a subset) plus a consolidate toggle, and which is the default?
- [ ] (restored detail) Per-dimension UX-semantics matrix the design should choose a
  position on (the surveyed comparison table that research.md §evidence still points to
  but no longer reproduces). Across Ableton Freeze, Ableton Flatten/BIP, Logic Freeze,
  Logic BIP, Pro Tools Freeze, Pro Tools Commit, Cubase Render-in-Place, and Studio One
  Transform, the dimensions that diverge are: Reversible (yes vs undo-only vs
  via-hidden-source-track), creates-a-new-track, inserts baked in (Logic Source-Only
  bakes none, Pre-Fader bakes all; Cubase has 4-level control), sends baked in (none
  bake by default — only Cubase Complete-Path mode does), volume/pan baked (Logic bakes
  via automation and Studio One resets pan to default, whereas Ableton/Pro-Tools keep
  them live), partial freeze (only Pro Tools up-to-insert, Logic Source-Only, Cubase
  Dry, Reaper up-to-FX), tail handling (Ableton emits separate tail clips in
  Arrangement, Studio One auto-detects, Cubase is manual sec/bars), and file format
  (32-bit float for Ableton/Logic, session-format mono for Pro Tools Freeze, 16/24/32-bit
  selectable for Cubase). Which position does Sourdaw take per dimension, and which
  defaults?
- [ ] (restored detail) "Rest of the field" per-DAW gotchas to design around (the
  limitations column research.md no longer carries): Reaper bakes fader position into a
  stem render, causing double-attenuation, and has no one-click freeze button in its
  default UI; Studio One discards any volume changes made while transformed when you
  revert, and supports bidirectional audio↔instrument transform; Cubase multi-output
  rack instruments render ALL outputs even when only one is selected (AC-019 keeps
  per-output freeze files but not this whole-rack-render trap); Bitwig allows hybrid
  tracks (audio+MIDI coexisting), a custom source point picking any device in the chain,
  but offers no tail handling for Bounce In Place; FL Studio offers leave/cut-remainder
  options for tails and flexible rendering-quality settings but has no dedicated freeze
  feature. Which of these traps must Sourdaw explicitly avoid (e.g. never double-apply
  the fader on a stem render, render only the selected output of a multi-output
  instrument)?
- [ ] (non-blocking) Call VST3 plugins with `processMode = kOffline` during freeze,
  with a real-time render fallback? Currently deferred.
- [ ] (non-blocking) (deferred-gap from intake/implementation-gaps.md, item 7.8a
  "Rust-Native Stem Export & Offline Bounce") Render-backend architecture for offline
  bounce / stem export. Today offline bounce and stem export run through the browser
  `OfflineAudioContext` (WebKit limits: 44.1 kHz min, 10 ch max) plus IPC to the
  frontend (`ExportDialog.tsx`, `handleAiDenoiseClip.ts`); nothing parallelises stem
  bouncing and format coverage on WebKit is limited. Open scope: route offline bounce
  and stem export through a Rust-side pipeline in `daw-io` using `symphonia` (decode),
  `hound` (WAV write), and `rayon` (parallel per-stem rendering); keep browser-only
  builds working via the existing Web Audio fallback while marking the Tauri desktop
  pipeline authoritative; emit per-stem progress over a single Tauri
  `Channel<ExportProgress>` rather than per-frame IPC. Performance target: exporting N
  stems from a 32-track project completes in ≤ (single-stem time × max(1, N/cores)) on
  the reference machine (linear wall-clock speed-up to core count). Capability ceiling:
  WebKit-only runtimes still produce correct output via the Web Audio fallback but must
  not advertise the >2-channel / >96 kHz configurations that only the Rust path
  supports. See research `architecture-performance.md` §2. (The deterministic-render and
  BWF-`bext`-metadata sub-requirements of 7.8a are folded as AC-024 and AC-025.)

## Affected areas

- `src/modules/Arrangement/models/Track.ts` (`FreezeState`)
- `src/modules/Arrangement/useCases/{freezeTrack,unfreezeTrack,flattenTrack,bounceTrack}.ts`
- `src/modules/AudioEngine/useCases/renderFreeze.ts`
- `src/modules/AudioEngine/stores/freezeFileCache.ts`
- `src/modules/Arrangement/events/FreezeStateChangedEvent.ts`

## Dropped from sources

- Loro CRDT — Sourdaw uses its existing Automerge integration; migrating CRDT engines
  is out of scope and the freeze state model is simple enough for Automerge.
- Partial freeze up to an insert, hardware-insert freeze, and cross-project file
  sharing — scoped out (see Non-goals), each for the reason stated there.
- Premiere-style GC tuning (90-day cap, 10% volume cap) — the project-close + 7-day +
  10-minute sweep rules cover the common case.
