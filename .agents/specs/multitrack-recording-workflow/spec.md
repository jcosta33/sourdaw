---
type: spec
id: SPEC-multitrack-recording-workflow
title: Native multi-track recording, step recording, and count-in
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
  - intake/audit-deferred-fixes.md
---

# Native multi-track recording, step recording, and count-in

## Intent

Add a Rust-side recording path that captures multiple `cpal` input streams directly to
on-disk WAV via lock-free ring buffers (used under Tauri; the Web Audio worklet remains
the browser fallback), plus a step-recording workflow and a configurable count-in
preroll. Stereo input must record stereo without downmixing.

## Non-goals

- Offline bounce / stem export (deferred gap against `freeze-flatten-bounce`).
- Retrospective always-on capture (the separate `retrospective-capture` feature).
- MIDI FX / sequencing engine primitives (see `midi-engine-primitives`).

## Requirements

### AC-001 — Native multi-track capture with no xruns

A 32-channel record pass on a Tauri build must write 32 individual WAV files with zero
xruns at 48 kHz / 128-sample buffer on the reference machine.

Verify with: `pnpm cargo:test -- -p daw-io multitrack_record_no_xruns`

### AC-002 — Stereo input records stereo

A track configured for stereo input must record two independent channels (not a
duplicated mono signal); the input picker exposes a mono/stereo selector.

Verify with: `pnpm test:run -- recordingStereoInput`

### AC-003 — Step recording inserts at a step cursor

Step recording must insert notes one at a time at a visible step cursor without
advancing the transport; arrow keys move the cursor.

Verify with: `pnpm test:run -- stepRecording`

### AC-004 — Sample-accurate count-in

Count-in preroll (1–8 bars) must be sample-accurate: the first recorded sample aligns
with the first beat of the post-count-in region within ≤1 sample.

Verify with: `pnpm cargo:test -- -p daw-io count_in_sample_accurate`

### AC-005 — Browser fallback preserved

Browser-only builds must continue recording via the existing worklet at the browser's
channel limit, surfacing the limit as a non-blocking note.

Verify with: `pnpm test:run -- recordingBrowserFallback`

## Open questions

- [ ] (non-blocking) Default count-in length and whether it is per-project or per-record-pass.
  Default: per-project default with per-pass override.
- [ ] (non-blocking) (deferred-gap from intake/spec-of-the-gaps.md) Audio & platform gaps
  carried over from `audio-generation-browser.md` (intake §2.3): (a) refine the full
  fallback routing for browser-based AI generation; (b) verify WebGPU fallback robustness
  across browser versions; (c) optimize OPFS storage-cleanup logic for heavy use. These
  are browser AI-generation / platform-robustness debts, not native multi-track recording
  requirements — fold here only to keep them tracked; they do not gate this feature.

## Affected areas

- `crates/daw-io/` (cpal recording path), `src/modules/AudioEngine/` recording
- `src/modules/Arrangement/models/Track.ts` (`inputChannelCount`), input picker UI
- piano roll (step cursor), transport (count-in)

## Known risks

Present-state findings in the existing browser-worklet recording pipeline (the
fallback path AC-005 preserves). These are observations against the current code,
not requirements; the native Rust path should not reproduce them.

- OPFS recording temp file leaks when the worker is terminated mid-flush.
  `repositories/audioRecorder/recording.ts:240-247` calls `terminateWorker(session)`
  from `decodeAndDeliver` after `decodeAudioData` succeeds; the worker's
  `removeEntry(tmpName)` (`workers/recordingWorker.ts:130-136`) runs only AFTER it
  posts `{type:'wav', buffer}` (worker line 128). If main terminates the worker
  between the `postMessage` and the `removeEntry`, the temp file
  `rec-tmp-<timestamp>.pcm` survives in OPFS forever. Same leak if
  `recordingWorker.onerror` fires — its cleanup branch does not invoke OPFS file removal.
- `acquireSharedMediaStream` lacks Promise coalescing for the in-flight `getUserMedia`.
  `repositories/audioRecorder/recording.ts:62-68`: a second caller arriving during the
  first caller's `await` sees `stream === null` and starts a SECOND `getUserMedia`; both
  resolve, both `usageCount++`, the later stream wins the assignment and the earlier
  stream's tracks are never `.stop()`ed (orphaned mic streams, activity light stays on).
- `recordingProcessor` has no `init`-completion ack, so start ordering races.
  `services/recordingProcessor.ts:30-37`: the `init` handler runs on the audio thread and
  may queue behind a long `process()` call. Main sends `init` then `start`
  (`recording.ts:148,175`); if `start` is processed before `init`, the worklet sets
  `_active = true` while `_ring` is still null and `process()` early-returns — the first
  ~hundreds of ms of audio are silently dropped.
- `recordingProcessor` does a per-sample modulo on the audio thread.
  `services/recordingProcessor.ts:62-64`: `this._ring[(head + index) % ringSize] = input[index] ?? 0`
  loops `% ringSize` once per sample × 128 samples per render quantum, plus the `?? 0`
  branch. A `firstChunk = min(input.length, ringSize - (head % ringSize))` computed once
  followed by two `subarray + .set` copies is allocation-free and ~30× faster.
- WebMIDI input state is held in module-level singletons that are not HMR-persistent.
  `repositories/webMidi/state.ts:13-18,39-40`: `_midiAccess`, `_activeInput`,
  `_targetTrackId`, `_tauriEventUnlisten`, `activeNotes`, and `channelToNote` are bare
  module-level mutables. On hot-reload the module re-runs and these reset to `null`/empty
  while the actual `MIDIAccess` callbacks remain wired to the previous module instance.
  Duplicate MIDI handlers stay active, so every keypress fires twice — which during a dev
  session double-inserts notes into step recording (AC-003) and the live MIDI record path.
  The recording module already uses `createHmrPersistentState`
  (`repositories/audioRecorder/recording.ts:47`); the webMidi state does not.

## Dropped from sources

- None new — folds the audit Group G stereo-recording fix into the native recording feature.
