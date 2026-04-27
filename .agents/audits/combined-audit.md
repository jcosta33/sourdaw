---
name: combined-audit
description: Full cross-audit analysis plus merged content from retired backlog, faust-polyphony, MIDI, multi-track, and plugin-host audits.
type: audit
status: open
last_verified: '2026-04-28'
---

# Combined audit — analysis + merged source material (2026-04-28)

## Purpose and scope

**Section 1 (below)** is the re-verification analysis (what is stale vs current code).

**Section 2 (appendices A–E)** preserves **all** tabular and narrative text from the five audits that were retired into this file (`backlog`, `faust-polyphony`, `midi-coordinate-convention`, `multi-track-recording`, `plugin-host-contract`). Use appendices for exact issue IDs, file paths, “Needed” lists, resolved/retracted history, and adversarial notes — the analysis only interprets them.

**Method:** Read each audit in full; for every major claim, grep/read the referenced or implied paths in `src/` and `crates/daw-dsp/`. Some backlog rows are **not** fully traced (called out explicitly as “not verified this pass”).

---

## Executive summary

1. **Appendix B (Faust)** — **Largely stale as written.** The tree uses `FaustPolyDspGenerator` for `isInstrument`, `createNode(context, POLY_VOICES_DEFAULT)` for poly, `buildParamAddressCache` for O(1) bare names, and `scheduleFaustNote` / `scheduleDeviceKeyOn` (not raw `freq`/`gain`/`gate` AudioParams). **Remaining real issues:** `keyOn`/`keyOff` go through `setTimeout` in `faustDeviceFactory.ts` (documented there) — sample-accurate scheduling is still a product/DSP concern. The old “7 DSP files / additive without gain” inventory **no longer matches** `builtinDSP.ts` (instrument set changed; e.g. no separate `additive-synth` / `morphing-synth` in the current registration block reviewed).

2. **Appendix C (MIDI coordinates)** — **Core “outlier” bugs appear fixed** in code: AI `apply*ToTrack` files use `startBeat: note.startBeat`; `duplicateClipCore` copies `note.startBeat` without `beatDelta`. The **path table is partly stale** (wrong file paths/line numbers for `importMidiFile`, `applyMelody` line refs). MIDI import forcing `clip.startBeat: 0` is still in `src/modules/Arrangement/useCases/importMidiFile.ts` (~line 46), not `MIDI/useCases/importMidiFile.ts`. **M-02 / S-08 / S-09** were blocked on M-01; M-01 code fixes suggest **re-open status review** and optional **data migration** text for legacy sessions.

3. **Appendix D (Multi-track recording)** — **Still accurate:** single `recordingSession`, overwrite on each `startAudioRecording`, mono capture. `toggleRecording.ts` uses `getCompensationDelay` for **recorded clip** start trim — that is separate from multi-track capture.

4. **Appendix E (Plugin host)** — **Partially stale in “current behavior”.** `TrackNode.ts` is **~513 lines** (not 567); **`removeDevice` / `updateParam` / `scheduleParam` / `updateBypass` / `dispose`** delegate through `dn.controller` when present. **Toaster/Levain** use `Record<deviceId, State>` — singleton claim is **obsolete**. **Still valid:** Crust has no WASM in `wasmDeviceRegistry` → silent early return in `addDevice` if no factory; **I-01** `NativePluginBridgeNode` still async `tauriInvoke('process_plugin_audio')` per block; **I-06** needs nuance (see § PDC below). Marked “[RESOLVED]” items in that file are **directionally done** but the top “TrackNode branches everywhere” prose should be **rewritten** to match current code.

5. **Appendix A (Backlog)** — **Most rows unchallenged** where checked; **I-06 wording is too absolute**; several **file paths/lines are stale** (e.g. `TrackLevelSection`, `ChatPanel`, `PianoRoll`, `importMidiFile`).

---

## PDC and latency compensation (I-06) — important nuance

**Backlog claim:** “PDC latency reported by worklets to SAB but host never reads or compensates.”

**What the code actually does:**

- WASM processors **do** write `get_latency_samples()` into SAB views (`*Processor.ts`).
- **Host-side** compensation exists but is **not** driven by those SAB values:
  - `getDeviceLatencyMs` in `helpers.ts` uses `deviceLatencyMap` (built-ins + sidechain heuristic) and **`externalLatencyRegistry`**.
  - `reportLatency()` only **writes** to `externalLatencyRegistry` — **no production calls** to `reportLatency` were found (only definition + tests). So runtime **does not** ingest worklet-reported latency into the chain sum.
- **`getCompensationDelay`** is used from `toggleRecording.ts` when **finishing** recording to trim clip start by total latency — that uses `getTrackLatency` / static per-device numbers, **not** SAB-reported plugin lookahead.

**Conclusion:** The product **gap** (“true lookahead from each WASM instance’s `get_latency_samples()` is not folded into delay compensation”) remains **fair**. The blanket “host never compensates” is **misleading** — the host compensates **recording trim** with a **different** model. **Recommended backlog text:** split into (a) SAB latency not wired into `getDeviceLatencyMs` / `reportLatency`, (b) recording uses heuristic `getCompensationDelay`, (c) automation/monitoring alignment unverified.

---

## Faust (Appendix B) — claim-by-claim

| Claim in audit | Verdict | Evidence |
| -------------- | ------- | -------- |
| Only `FaustMonoDspGenerator` for all modules | **False** | `compilerEngine.ts` ~165: `mod.isInstrument ? new FaustPolyDspGenerator() : new FaustMonoDspGenerator()` |
| Poly never imported | **False** | Same file imports `FaustPolyDspGenerator` |
| `setParam` bare name fails; only suffix fallback O(N) | **Superseded** | `faustDeviceFactory.ts`: `buildParamAddressCache` from `AudioParam` map; `setParam` uses `paramAddressCache.get(name) ?? name` |
| Notes use `scheduleDeviceParam('freq'…)` | **False for current scheduler** | `scheduleFaustNote.ts` uses `scheduleDeviceKeyOn` / `scheduleDeviceKeyOff` |
| N-24 race | **Retracted in audit** | Still valid retraction |

**Open (still real):** timer-based `scheduleCall` for `keyOn`/`keyOff` in `faustDeviceFactory.ts` (not sample-accurate). **Inventory** of instrument DSP files and “additive without gain” **must be re-derived** from current `builtinDSP.ts` + `dsp/*.dsp` list.

---

## MIDI coordinates (Appendix C) — claim-by-claim

| Claim | Verdict | Evidence |
| ----- | ------- | -------- |
| `applyMelodyToTrack` timeline-absolute `startBeat + note.startBeat` | **False now** | `applyToTrack.ts` maps `startBeat: note.startBeat` |
| Chord / drum apply same bug | **False now** | `generateChordProgression/applyToTrack.ts`, `generateDrumPattern/applyToTrack.ts` use `note.startBeat` |
| `duplicateClipCore` adds `beatDelta` to notes | **False now** | `duplicateClipCore.ts` copies `startBeat: note.startBeat` |
| `importMidiFile` line 52 forces `startBeat = 0` | **Right idea, wrong path/line** | `Arrangement/useCases/importMidiFile.ts` ~46: `startBeat: 0` on new clip |
| Table line numbers for `clipDrawing`, `scheduleMidiNotes`, etc. | **Unverified / likely drift** | Not re-validated line-by-line in this pass |

**Status field `closed`:** Consider **reopening** or adding a “2026-04-27 code verification” note — convention bugs in the named files look **fixed**; **migration** for old projects may remain a **data** task.

---

## Multi-track recording (Appendix D) — claim-by-claim

| Claim | Verdict | Evidence |
| ----- | ------- | -------- |
| Single global `recordingSession` | **True** | `recording.ts` `createHmrPersistentState` single object |
| Each `startAudioRecording` overwrites session | **True** | Assigns `mediaStream`, `onRecordingComplete`, nodes in place |
| Mono `channelCount: 1` | **True** | `recording.ts` ~95-100 |
| `startRecording` creates clips for all armed | **True** | `startRecording.ts`: loop `armedTracks`, `newClips.push` per track (with MIDI overdub exceptions) |
| Independent of `selectedTrackId` | **Plausible** | Recording uses `armed` in `toggleRecording` loop |

---

### Plugin host (Appendix E) — claim-by-claim

| Claim | Verdict | Evidence |
| ----- | ------- | -------- |
| Four methods full of per-plugin branches only | **Mostly stale** | `TrackNode.ts` uses `dn.controller` for `updateParam`, `scheduleParam`, `updateBypass`, `removeDevice`, `dispose` |
| Toaster/Levain singleton | **False** | `toasterStore` / `levainStore` are `Record<string, …>` + `getXState(deviceId)` |
| Crust silent add | **True** | No `crust` in `wasmDeviceRegistry`; `addDevice` returns if `!findWasmDescriptor` |
| Native bridge per-block `tauriInvoke` | **True** | `NativePluginBridgeNode.ts` ~46–59 |
| PDC to SAB, host does nothing | **See § PDC nuance** | SAB written; host uses different compensation path; `reportLatency` unused |

**Adversarial / “Final resolution” block:** Treat as **historical** unless re-run with current `removeDevice`/`dispose` + store teardown tests.

---

## Backlog (Appendix A) — row status (verified / partial / stale path / not checked)

**Legend:** ✓ checked in repo this pass · ~ partial / nuance · ✗ stale file/line · ? not checked

### AI Runtime

| ID | Status | Notes |
| -- | ------ | ----- |
| I-02 | ? | `sendChatMessage`, `executeDsoEdit`, `inference` not traced end-to-end |
| I-04 | ✓ | `executeDsoEdit.ts` ~254–262: binary Automerge snapshots before/after edit |
| I-16 | ✓ / ~ | `ChatPanel.tsx` uses `useStore(chatStore, …)`; line **74–86** not 77–82 — effect deps on `chatState?.messages` — **re-renders on message updates**; whether “every token” needs profiling |
| S-06 | ? | Surveillance only |

### DSP (crates)

| ID | Status | Notes |
| -- | ------ | ----- |
| I-08 | ✓ | Cascaded split in `proof/crossover.rs` `process`, `bacteria/crossover.rs` `process_sample` — topology as described |
| I-12 | ~ | `crumbs/voice.rs` uses cubic Hermite; **“no AA”** is a **quality** claim, not a one-line disproof |
| I-22 | ✓ | `limiter.rs` ~85: `fold` on `gain_buffer` per sample |
| I-30 | ? | Meta-row |

### Proof

| ID | Status | Notes |
| -- | ------ | ----- |
| N-19 | ✓ | `setProofParamWithPatch.ts` only handles a subset of keys; `syncEqBands` / `syncDynBands` / `syncImager` / `syncExciter` / `syncFullPatch` carry arrays and more — **aligns** with table |
| S-05 | ? | — |
| I-06 | ~ | **See § PDC** — refine wording |

### UI & state

| ID | Status | Notes |
| -- | ------ | ----- |
| S-01 | ✓ | `setTrackGain` updates store + engine + `maybeRecordAutomation` + Toaster — **high write volume** plausible; `TrackLevelSection` is **`Workspace/.../TrackLevelSection.tsx`**, lines ~50–55 for slider (not `TrackLevelSection.tsx:39-41` under Arrangement) |
| S-02 | ✓ | `trackStore` still `selectedTrackId: string \| null` |
| I-14 – I-28 | ? | Not checked this pass |

### Timeline / browser / features

| T-04 – T-08, B-01 – B-03, S-07 – S-14, N-23, N-34 | ? | `clipDrawing` has no `visualShift` string — **T-04** may still be open under different code shape; needs dedicated pass |

**Previously resolved / retracted lists** in **Appendix A** — **retain**; not re-proven in this pass.

---

## Deduplication map (for workers)

- **S-03 + I-29** ↔ **Appendix D** (authoritative for capture design).
- **I-06** ↔ **Appendix E** §6 + **Appendix A** Proof row — **merge wording** when fixing PDC story.
- **N-19** ↔ **Appendix A** N-19 table; unrelated to Faust (Appendix B).
- **Crust** ↔ **Appendix E** S-04; add a backlog row in **Appendix A** if tracking there.

---

## Recommended documentation edits (apply within this file’s appendices)

1. **Appendix B** — Keep historical narrative; add margin note that **§ Executive summary** states current code path; refresh DSP inventory from `builtinDSP.ts`.
2. **Appendix C** — Align path table with `Arrangement/.../importMidiFile.ts`; mark rows **fixed** where analysis applies.
3. **Appendix E** — Add one-line note that singleton / branch prose is partially superseded (see analysis).
4. **Appendix A** — Fix **I-16** / **S-01** paths; **refine I-06** per **§ PDC**.
5. **Appendix D** — Refresh line numbers vs `recording.ts` when editing code.

---

## Gaps and limits of this pass

- No **profile** of Chat or fader (behavioral, not just structure).
- No **plugin-by-plugin** proof pass for I-30.
- **Timeline (T-*)** and **browser (B-*)** mostly **unread**.
- **Knead, Fermenter, LocalStorage, scoring** (I-14, I-15, I-28, N-34) **not** opened.

When those matter for a release, schedule a **scoped** audit or extend the appendices below with proof when an ID closes.

---

## Appendix A — Open Issue Backlog (merged from `backlog.md`)

Issues below were tracked as real but lower priority than dedicated area audits. Cross-reference: `faust-polyphony`, `midi-coordinate-convention`, `multi-track-recording`, `plugin-host-contract` (now sections of this file).

### AI Runtime

| ID   | Issue                                      | Severity | File                                                      |
| ---- | ------------------------------------------ | -------- | --------------------------------------------------------- |
| I-02 | Parallel AI backend-dispatch layers        | Medium   | `sendChatMessage.ts`, `executeDsoEdit.ts`, `inference.ts` |
| I-04 | Full Automerge snapshot on each DSO commit | Medium   | `executeDsoEdit.ts:252,258`                               |
| I-16 | Chat UI re-renders on every token          | Medium   | `ChatPanel.tsx:77-82`                                     |
| S-06 | WebLLM model mismatch (Qwen3 tools)        | Low      | Surveillance — close if logs clean                        |

### DSP

| ID   | Issue                                                                                                                                     | Severity | File                                                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-08 | LR4 crossover cascade does NOT sum flat — bands pass through different numbers of allpass stages causing comb-filtering on reconstruction | High     | `crates/daw-dsp/src/proof/crossover.rs:87-92` and `bacteria/crossover.rs:163-193` — same cascaded topology in both. Fix: parallel LR4s with allpass compensation |
| I-12 | Crumbs pitch-up no anti-aliasing                                                                                                          | Medium   | `crates/daw-dsp/src/crumbs/voice.rs:218-240`                                                                                                                     |
| I-22 | **[FIXED]** Limiter O(window×N) scan                                                                                                                  | Medium   | Fixed: `crates/daw-dsp/src/proof/limiter.rs` now uses amortized O(1) max peak tracking.                                                                                                                      |
| I-30 | DSP claims needing re-verification                                                                                                        | Mixed    | Per-plugin — see original audit history                                                                                                                          |

### Proof Plugin

| ID   | Issue                                                                                                                                                                                                                                       | Severity | File                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| N-19 | **[FIXED]** Param bridge array params only sync on patch load | High     | Fixed: `setProofParamWithPatch.ts` now instantly syncs `eqBands`, `dynBands`, `imgBandWidth`, `excBands`, `chainOrder`, `ditherMode`, and `ditherBits` on change. |
| S-05 | Engine-side param verification                                                                                                                                                                                                              | Medium   | Needs XOI runtime test                                      |
| I-06 | PDC latency from SAB not consumed by host `getDeviceLatencyMs` / `reportLatency`                                                                                                                                                                 | Medium   | Worklets call `get_latency_samples()`; recording uses static trim, automation unaligned |

#### Proof param coverage table (N-19 detail)

| Field             | Bridge Type                     |
| ----------------- | ------------------------------- |
| name              | Never                           |
| chainOrder        | Load-only (via `syncFullPatch`) |
| inputGain         | Per-change                      |
| outputGain        | Per-change                      |
| eqBypassed        | Per-change                      |
| eqBands           | Load-only (via `syncEqBands`)   |
| dynBypassed       | Per-change                      |
| dynCrossoverFreqs | Load-only (via `syncDynBands`)  |
| dynBands          | Load-only (via `syncDynBands`)  |
| imgBypassed       | Per-change                      |
| imgBandWidth      | Load-only (via `syncImager`)    |
| imgAutoMonoBass   | Per-change                      |
| imgMonoBassFreq   | Per-change                      |
| excBypassed       | Per-change                      |
| excBands          | Load-only (via `syncExciter`)   |
| limBypassed       | Per-change                      |
| limCeiling        | Per-change                      |
| limRelease        | Per-change                      |
| limLookahead      | Per-change                      |
| ditherMode        | Load-only (via `syncFullPatch`) |
| ditherBits        | Load-only (via `syncFullPatch`) |
| target            | Never                           |
| targetLufs        | Never                           |

### UI & State

| ID   | Issue                                        | Severity | File                                                  |
| ---- | -------------------------------------------- | -------- | ----------------------------------------------------- |
| S-01 | **[FIXED]** Fader write-path storm                       | High     | `Workspace/.../TrackLevelSection.tsx`, `setTrackGain.ts`, `setTrackPan.ts` fixed by introducing `isTransient` flag for drags |
| S-02 | Multi-track selection missing                | High     | `trackStore.ts:22-28` — scalar `selectedTrackId`      |
| I-14 | Knead/action history not persistent          | Medium   | `kneadStore.ts`, `actionHistoryStore.ts`              |
| I-15 | **[FIXED]** Fermenter telemetry at audio-rate            | Medium   | Fixed: `fermenterStore.ts` now batches and throttles telemetry updates to 60fps via `requestAnimationFrame`. |
| I-27 | PianoRoll subscribes to whole stores         | Medium   | `PianoRoll.tsx:98-99`                                 |
| I-25 | Plugin module duplication (Proof vs Plugin/) | Low      | Product decision                                      |
| I-28 | Legacy brand-CMS keys in LocalStorage        | Low      | `LocalStorageKeys.ts:14-94` — needs legal review      |

### Timeline Editing

| ID   | Issue                            | Severity | File                                                   |
| ---- | -------------------------------- | -------- | ------------------------------------------------------ |
| T-04 | MIDI drag preview "stay behind"  | Major    | `clipDrawing.ts` — needs `visualShift` in render model |
| T-06 | MIDI stretching not implemented  | Major    | Needs spec                                             |
| T-07 | MIDI looping visual distortion   | Minor    | Bundled with T-04                                      |
| T-08 | Missing preview for stretch/trim | Minor    | Groundwork done — wire preview phase                   |

### Browser AI

| ID   | Issue                                   | Severity | File                                            |
| ---- | --------------------------------------- | -------- | ----------------------------------------------- |
| B-01 | OPFS model load path (JS heap copy)     | Medium   | `storageManager.ts:100-101`                     |
| B-02 | DiffSinger inter-stage tensor residency | Medium   | `onnxInferenceWorker.ts:130-137`                |
| B-03 | DDSP/TFJS stub                          | Medium   | `tfjsInferenceWorker.ts` — blocked on ONNX port |

### Feature Gaps

| ID   | Issue                           | Severity                                                            |
| ---- | ------------------------------- | ------------------------------------------------------------------- |
| S-07 | SharedArrayBuffer/COEP residual | Medium — env-specific                                               |
| S-10 | Delay tempo sync                | Low                                                                 |
| S-11 | TrackDevicesSection menu huge   | Low                                                                 |
| S-12 | Minimap non-resizable           | Low                                                                 |
| S-13 | Levain boot time                | Low — measure first                                                 |
| S-14 | "Improve the templates"         | Low — product decision                                              |
| N-23 | Extension script unsandboxed    | Low — documented risk; only runs user-authored editor content today |
| N-34 | Scoring DPI scaling             | Low                                                                 |

### Previously resolved (for reference)

**Fixed 2026-04-16:** I-07 (Dutch Oven stereo EQ), I-09 (TPDF dither), I-10 (imager width), I-11 (Crumbs filter L/R), I-13 (Automerge import), I-17 (ARIA), I-18 (DSO fallback), I-20 (worklet queue), I-23 (mono input), I-24 (dynBands mutation), Timeline §2 (MIDI split), Timeline §3 (MIDI duplicate), Timeline §5 (waveform squash).

**Retracted false positives (11 total):** N-09, N-15, N-22, N-24, N-25, N-26, N-33, N-35, N-38, N-39, DiffSinger cache key.

---

## Appendix B — Faust polyphony (merged from `faust-polyphony.md`)

**Note:** The analysis in **§ Executive summary** and **§ Faust (Appendix B) — claim-by-claim** documents where this text is **superseded by current code** (poly generator, param cache, `keyOn`). This appendix is retained for IDs (N-36, N-37, N-48), paths, and **N-24 retraction** text.

### Scope

Faust instrument compilation, node creation, parameter routing, and note scheduling. Covers N-36, N-37, N-48 from the original consolidated audit. N-24 retracted (not a real race).

### Goal

Faust instruments should support polyphonic playback (chords) and all knob changes should reach the DSP.

### Relevant code paths

- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts` — compilation + node creation
- `src/modules/Synth/useCases/faustInstrumentScheduler/startFaustNote.ts` — realtime note trigger
- `src/modules/Synth/useCases/faustInstrumentScheduler/scheduleFaustNote.ts` — clip playback note trigger
- `src/modules/AudioEngine/repositories/faustDeviceFactory.ts` — param bridge (setParam, scheduleParam)
- `src/modules/AudioEngine/engine/TrackNode.ts:481-499` — scheduleParam Faust branch
- `node_modules/@grame/faustwasm/src/FaustDspGenerator.ts` — Mono vs Poly generator API
- Faust DSP files in `src/modules/Plugin/useCases/faustEngine/dsp/*.dsp`

### Current behavior (as originally written; see analysis for current truth)

**Monophonic only.** `compilerEngine.ts:143` uses `FaustMonoDspGenerator` for every Faust module. A single WASM DSP instance handles one `freq`/`gain`/`gate` triplet. Playing a second note while the first is sounding interrupts the first note's envelope — users cannot play chords on Rhodes, Hammond B3, FM Synth, or any Faust instrument.

**Param routing.** `faustDeviceFactory.ts` has `setParam` (line 46) which uses `node.setParamValue(name, value)` — the `@grame/faustwasm` API. This API's internal param map is keyed by full addresses like `/FM_Synth/algorithm`. Passing bare names like `algorithm` would fail silently since `fParamAliases[path] || path` falls back to the bare name which doesn't exist in the DSP's param map.

`scheduleParam` (line 55-72) has a suffix fallback that iterates `audioNode.parameters` looking for `key.endsWith('/' + name)`. This works but is O(N) per param set.

### Findings (original)

- `FaustPolyDspGenerator` exists in `@grame/faustwasm` but is never imported or used anywhere in the codebase (verified via grep).
- The poly generator requires a `voices` count and a `mixerModule` (WASM voice mixer). The Faust compiler produces the mixer automatically for DSP files using standard `freq`/`gain`/`gate` convention.
- **All 5 current Faust DSP instrument files** (`fm-synth.dsp`, `rhodes.dsp`, `hammond-b3.dsp`, `minimoog-lead.dsp`, `acid-bass-303.dsp`) use the full `freq`/`gain`/`gate` convention. The old `additive-synth.dsp` and `morphing-synth.dsp` are no longer present in `builtinDSP.ts`.
- Note scheduling (`startFaustNote.ts` lines 13-15, `scheduleFaustNote.ts` lines 15-18) sets `freq`/`gain`/`gate` as raw AudioParam values via `scheduleDeviceParam`. For poly, `@grame/faustwasm`'s poly node accepts MIDI-style `keyOn(channel, pitch, velocity)` / `keyOff()` calls instead.
- ~~N-24 race condition~~ **RETRACTED** — `compilerEngine.ts:222` `resolveReg!()` is safe because Promise executors run synchronously per ECMAScript spec; `resolveReg` is always assigned before line 222 executes.

### Open issues (original wording)

#### 1. All Faust instruments are monophonic (N-37)

**Problem:** `compilerEngine.ts:143` — `new FaustMonoDspGenerator()`. One DSP instance, one voice.

**Needed:**

1. Switch to `FaustPolyDspGenerator` for instrument-type modules (effects stay mono).
2. Pass `voices: 8` (or configurable) and the mixer module to `createNode()`.
3. Replace `scheduleDeviceParam('freq'/'gain'/'gate')` with `keyOn(channel, pitch, velocity)` / `keyOff()` calls on the poly node.
4. Update `startFaustNote.ts` and `scheduleFaustNote.ts` to use the poly API.
5. ~~Add `gain` param to `additive-synth.dsp` or mark it as special-case mono.~~ (Superseded: additive-synth removed).

#### 2. Faust param routing fragile (N-36 / N-48)

**Problem:** `setParam` (partially fixed 2026-04-19) now uses the suffix fallback for bare names, but the fallback is O(N) per param set. If a DSP has 30 params and you batch 10 changes, that's 300 iterations per block.

**Needed:** Build a `Map<bareName, fullAddress>` once at node creation time, use O(1) lookup.

### Suggested approaches (original)

1. **Instrument vs effect detection:** Check if the DSP file declares `freq`/`gain`/`gate` params. If yes, compile as poly; if no, compile as mono. The Faust compiler metadata (`declare options "[nvoices:8]"`) can signal this.
2. **Voice count:** Default to 8 voices. Make configurable per-instrument preset if needed.
3. **Param map cache:** After `createFaustNode()`, iterate `audioNode.parameters` once, build `Map<bareName, fullAddress>`, store on the device node for O(1) lookups.

### Recommendation (original)

Fix N-37 first — monophonic instruments are the most user-visible limitation. The param routing fix (N-36) is already partially done (suffix fallback works); the O(1) cache is an optimization.

---

## Appendix C — MIDI note coordinate convention (merged from `midi-coordinate-convention.md`)

### Scope

Every code path that reads or writes `MidiNote.startBeat`. Covers M-01, M-02, T-01 (remaining), S-08, S-09 from the original consolidated audit. **Status in source file was `closed`.**

### Goal

One convention for `MidiNote.startBeat` across the entire codebase. Notes visible in both timeline preview and piano roll regardless of `clip.startBeat`.

### Relevant code paths (original table; line numbers may drift)

| File                              | Convention                                         | Line    | Formula                                                                                                                                 |
| --------------------------------- | -------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `clipDrawing.ts`                  | Clip-relative                                      | 386     | `relStart = (note.startBeat - midiOffset) - clip.startBeat + loopOffset`                                                                |
| `renderOffline.ts`                | **Correct for clip-relative**                      | 97      | `noteStart = (clip.startBeat - startBeat + note.startBeat) / tempo * 60` — adds clip offset from render start + note offset within clip |
| `duplicateClipCore.ts`            | **Fixed** (was adding clip delta)                  | 42      | `startBeat: note.startBeat`                                                                                                             |
| `usePianoRollRenderer.ts`         | Clip-relative                                      | 526     | `x = note.startBeat * beatWidth`                                                                                                        |
| `usePianoRollInteractions.ts`     | Clip-relative                                      | 435-469 | `beat = snap(x / beatWidth)`                                                                                                            |
| `applyMelodyToTrack.ts`           | **Fixed** (was timeline-absolute)                  | 42      | `startBeat: note.startBeat`                                                                                                             |
| `applyChordProgressionToTrack.ts` | **Fixed** (was timeline-absolute)                  | 44      | `startBeat: note.startBeat`                                                                                                             |
| `applyDrumPatternToTrack.ts`      | **Fixed** (was timeline-absolute)                  | 38      | `startBeat: note.startBeat`                                                                                                             |
| `PatternBrowser.tsx`              | Clip-relative                                      | 301     | `startBeat: note.startBeat` (template-local)                                                                                            |
| `scheduleMidiNotes.ts`            | Expects clip-relative                              | 388     | `rawStartBeat = clip.startBeat + iterOffset + (note.startBeat - midiOffset)` — adds `clip.startBeat` to convert                         |
| `Arrangement/.../importMidiFile.ts`| Masks issue                                        | ~46     | Forces `clip.startBeat = 0`                                                                                                             |

### Current behavior (original narrative)

The piano roll, pattern browser, MIDI import, offline render, and the standard playback scheduler all use **clip-relative** beats (0 = start of clip). The outliers are:

- The 3 AI apply functions (`applyMelodyToTrack`, `applyChordProgressionToTrack`, `applyDrumPatternToTrack`) which store timeline-absolute beats
- `duplicateClipCore` which converts clip-relative notes to timeline-absolute on duplicate by adding `beatDelta`

When `clip.startBeat = 0`, both conventions produce the same result — which is why the bug only surfaces when the playhead is at a non-zero position.

### Findings (original)

- **Clip-relative is the majority convention.** Piano roll editing, pattern insert, MIDI import, the standard scheduler, and `renderOffline` all treat `startBeat` as clip-relative. The outliers are: AI apply functions (3 files) and `duplicateClipCore`.
- **renderOffline is actually correct.** The formula `(clip.startBeat - startBeat + note.startBeat)` computes (clip offset from render start) + (note offset within clip) — this works correctly for clip-relative notes. No change needed.
- **The scheduler already expects clip-relative.** `scheduleMidiNotes.ts:388` computes `clip.startBeat + iterOffset + (note.startBeat - midiOffset)` — it adds `clip.startBeat` to convert from clip-relative to timeline-absolute at playback time.
- **All utility files are already compatible.** Verified: `arpeggiator.ts`, `pasteNotes.ts`, `legatoNotes.ts`, `splitNoteAtBeat.ts`, `quantizeNotes.ts`, `humanizeNotes.ts`, `retrogradeNotes.ts`, `applyGroove.ts`, `extractGroove.ts` — all operate within one clip's coordinate space or are convention-agnostic. **0 utility files need changes.**
- **Migration scope:** 4 files need changes + a data migration for existing projects that have AI-generated notes stored as absolute.

### Open issues (original)

#### 1. MidiNote.startBeat dual convention (M-01)

**Problem:** Half the codebase stores clip-relative, half stores timeline-absolute.

**Needed:**

1. Standardize on **clip-relative** (the majority convention).
2. Fix `applyMelodyToTrack.ts:42` — change `startBeat: startBeat + note.startBeat` to `startBeat: note.startBeat`.
3. Fix `applyChordProgressionToTrack.ts:44` — same change.
4. Fix `applyDrumPatternToTrack.ts:38` — same change.
5. Fix `duplicateClipCore.ts:42` — change `startBeat: note.startBeat + beatDelta` to `startBeat: note.startBeat` (notes are clip-relative; the clip's `startBeat` carries the offset; the scheduler adds `clip.startBeat + note.startBeat` at playback).
6. ~~renderOffline.ts~~ — **no change needed**. Formula is correct for clip-relative notes.
7. Write a data migration that detects absolute-stored notes and converts them.
8. Add test: clip at `startBeat = 8`, single note at beat 0 (clip-relative), assert visible in both timeline preview and piano roll.

#### 2. PatternBrowser empty clip at playhead > 0 (M-02)

**Blocked on M-01.** PatternBrowser already stores clip-relative — once M-01 lands, this path is correct.

#### 3. Fold contract for off-scale notes (S-08, S-09)

**Blocked on M-01.** The fold/scale-lock decision for chord helper notes depends on the coordinate spec. Once M-01 establishes clip-relative, the fold contract can be designed around a known coordinate space.

### Risks (original)

- **Data migration:** Existing projects may have AI-generated notes stored as timeline-absolute. A migration must detect and convert these without corrupting manually-entered clip-relative notes.
- **Scheduler regression:** The standard scheduler already expects clip-relative. Fixing the outlier paths should not break playback, but needs thorough testing.

### Recommendation (original)

Fix the 3 AI apply functions first (one-line each), then `duplicateClipCore`. Write the test before any code change. Data migration last. `renderOffline` needs no change.

---

## Appendix D — Multi-track audio recording (merged from `multi-track-recording.md`)

### Scope

The full recording lifecycle: arm → record → stop → clip creation. Covers S-03 and I-29 from the original consolidated audit.

### Goal

Arming N audio tracks and pressing record should capture N independent audio streams, one per track.

### Relevant code paths

- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts` — single `RecordingSession`
- `src/modules/AudioEngine/services/recordingProcessor.ts` — AudioWorklet ring buffer writer
- `src/modules/Transport/useCases/transportControls/toggleRecording.ts` — loops over armed tracks
- `src/modules/Arrangement/useCases/recording/startRecording.ts` — creates clips for armed tracks
- `src/modules/Arrangement/stores/trackStore.ts` — `track.armed` flag

### Current behavior (numbered; line numbers from source audit, may drift)

1. **Arm multiple tracks** — each track's `armed` flag set in `trackStore`.
2. **Press record** — `toggleRecording()` calls `beginActualRecording()`.
3. **`beginActualRecording()`** calls `startRecording()` which creates one clip per armed track (correct).
4. **Loop over armed audio tracks** (`toggleRecording.ts:~22`) — for each, calls `startAudioRecording(trackId, onComplete)`.
5. **`startAudioRecording`** **overwrites** the single global `recordingSession` (mediaStream, sourceNode, onRecordingComplete, recordingNode, recordingWorker).
6. **Each subsequent call replaces the previous session.** Only the last armed track's callback survives.
7. **Stop** — only one `onComplete` path delivers audio meaningfully to one clip.

**Result:** All clips are created, but only the last-armed track gets audio. Other tracks' clips remain empty.

### Findings (original)

- `recording.ts` holds a single `RecordingSession` via `createHmrPersistentState`. One `mediaStream`, one `sourceNode`, one `recordingNode`, one `onRecordingComplete`.
- The `recordingProcessor.ts` worklet writes to a single SAB ring buffer. Merged into one mono path.
- `recording.ts` — `channelCount: 1, channelInterpretation: 'discrete'`. Even a single-track stereo recording is downmixed.
- `startRecording.ts` correctly creates clips for ALL armed tracks. The clip creation is not the problem.
- Recording and track selection (S-02) are independent — `armed` flag, not `selectedTrackId`.

### Open issues (original)

#### 1. Single recording session (S-03)

**Needed:** `Map<trackId, RecordingSession>`; per-track pipeline; `stopAudioRecording` all vs one; per-track `onRecordingComplete`; per-track input device selection when required.

#### 2. Mono-only recording (I-29)

**Needed:** Parameterize by track input config (mono/stereo). Allocate SAB ring accordingly. UI for input channel selection per track.

### Risks (original)

- **Browser input limits:** `getUserMedia()` one device; different physical inputs need multiple calls or multi-channel API.
- **Performance:** N parallel worklets + SAB rings + OPFS writers — benchmark.

### Suggested approaches (original)

1. Session `Map<trackId, RecordingSession>`.
2. Shared input, separate sinks (same mic, separate worklet sinks / rings per track).
3. Stereo: `channelCount` 2 or configurable; ring size `bufferSize * channelCount`.
4. Ship recording fix before selection refactor; S-03 independent of S-02.

### Recommendation (original)

Start with the session map. Keep mono; stereo follow-up (I-29). Self-contained in `recording.ts` + `toggleRecording.ts`.

---

## Appendix E — Plugin host contract & device lifecycle (merged from `plugin-host-contract.md`)

### Scope

Plugin instantiation, parameter routing, bypass, disposal, and state management across all device types. Covers I-05, I-19, I-01, I-06, N-18, N-30, S-04 from the original consolidated audit.

### Goal

A uniform `DeviceController` interface that every plugin implements. TrackNode delegates to the interface instead of branching per device type. Plugin state is per-instance, not singleton.

### Relevant code paths (original; line/LOC counts may drift)

- `src/modules/AudioEngine/engine/TrackNode.ts` — 567 LOC with 4-6 device-specific branches per method
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts` — WASM device matchers
- `src/modules/AudioEngine/repositories/deviceStrategy/setupDeviceStrategies.ts` — device factory registry
- `src/modules/Toaster/stores/toasterStore.ts` — singleton store *(analysis: now per-`deviceId` — see § Executive summary)*
- `src/modules/Levain/stores/levainStore.ts` — singleton store *(same)*
- `src/modules/Fermenter/stores/fermenterStore.ts` — per-device (correct pattern)
- `src/modules/Crust/` — full UI, no DSP
- `src/modules/AudioEngine/engine/{GrinderNode,BacteriaNode,GlutenNode,FermenterNode}.ts` — per-plugin node classes with `destroy()`

### Current behavior (original — partially superseded; see analysis)

**TrackNode branches per device type in 4 methods:** `removeDevice`, `updateParam`, `scheduleParam`, `updateBypass` (fermenter, toaster, levain, grandBoule, wam, proof, etc.).

### Findings (original)

- All WASM plugin nodes have `destroy()`. TrackNode.dispose() may not have called all uniformly (historical; see [RESOLVED] below).
- Toaster and Levain singletons *(superseded if stores are `Record<deviceId, …>`)*.
- **Crust has no DSP** — `findWasmDescriptor('crust')` undefined → silent `return` in `addDevice`. Knobs do nothing.
- **NativePluginBridge (I-01)** per-block `tauriInvoke` — architectural ceiling, needs SAB transport.
- **PDC (I-06)** — `get_latency_samples()` in worklets, SAB; host consumption narrative refined in **§ PDC and latency compensation** in the analysis.

### Open issues (original)

#### 1. [RESOLVED] TrackNode hardcoded plugin branches (I-05 / I-19)

**Needed — DeviceController interface (sketch):**

```ts
interface DeviceController {
    setParam(name: string, value: number, sampleFrame?: number): void;
    scheduleParam(name: string, value: number, time: number): void;
    setBypass(state: boolean): void;
    destroy(): void;
}
```

#### 2. [RESOLVED] Toaster and Levain singletons (N-18 / I-03)

**Needed:** `Record<string, XState>` keyed by `deviceId`; Fermenter pattern.

#### 3. [RESOLVED] Crust silent-add (S-04)

**Needed:** Implement DSP, or `PluginNotImplementedError` + toast.

#### 4. [RESOLVED] Plugin device unregister hooks (N-30)

**Resolved by I-05** — uniform `controller.destroy()`.

#### 5. Native plugin transport (I-01) — *still open in analysis*

**Problem:** Per-block `tauriInvoke('process_plugin_audio')` in `NativePluginBridgeNode:51`.

**Needed:** SAB ring between worklet and Rust.

#### 6. PDC latency host-side consumption (I-06) — *refine with analysis § PDC*

**Needed:** Host-wide PDC that reads SAB latency views, sums chain, compensates recording + automation.

### Suggested approaches (original)

1. DeviceController first; Fermenter pilot; roll out.
2. Toaster/Levain fix independently (Fermenter pattern).
3. **Crust interim:** remove from `BUILTIN_PLUGINS` or `PluginNotImplementedError`; full DSP later.

### Recommendation (original)

Start with DeviceController (I-05); unblocks N-30, I-19. Toaster/Levain in parallel.

### Adversarial Review Update (2026-04-20)

Issues I-05, N-30, N-18, and I-03 were marked resolved but have failed verification under Adversarial Review. The refactor introduced a fatal Audio Engine crash upon native DSP track deletion (missing `destroy` hooks) and permanent memory leaks in the Toaster and Levain stores on unmount. See [`.agents/research/adversarial-review-plugin-host.md`](../research/adversarial-review-plugin-host.md) for the proof. These must be fixed before this branch can be merged.

### Final Resolution (2026-04-20)

All adversarial findings have been addressed by The Builder. The `destroy` hooks are now safely called and memory leaks in reactive stores have been eliminated.

---

## Related

- [grinder/control-deck.md](./grinder/control-deck.md) — separate area audit, not merged.
- Adversarial research: [adversarial-review-plugin-host.md](../research/adversarial-review-plugin-host.md)
inder/control-deck.md](./grinder/control-deck.md) — separate area audit, not merged.
- Adversarial research: [adversarial-review-plugin-host.md](../research/adversarial-review-plugin-host.md)
