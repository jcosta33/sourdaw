---
name: backlog
description: Lower-priority open issues not covered by dedicated audits. Kept for tracking.
type: audit
status: open
last_verified: '2026-04-20'
---

# Open Issue Backlog

Issues below are real but lower priority than the items covered by dedicated audits (`faust-polyphony.md`, `midi-coordinate-convention.md`, `multi-track-recording.md`, `plugin-host-contract.md`).

## AI Runtime

| ID   | Issue                                      | Severity | File                                                      |
| ---- | ------------------------------------------ | -------- | --------------------------------------------------------- |
| I-02 | Parallel AI backend-dispatch layers        | Medium   | `sendChatMessage.ts`, `executeDsoEdit.ts`, `inference.ts` |
| I-04 | Full Automerge snapshot on each DSO commit | Medium   | `executeDsoEdit.ts:252,258`                               |
| I-16 | Chat UI re-renders on every token          | Medium   | `ChatPanel.tsx:77-82`                                     |
| S-06 | WebLLM model mismatch (Qwen3 tools)        | Low      | Surveillance — close if logs clean                        |

## DSP

| ID   | Issue                                                                                                                                     | Severity | File                                                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-08 | LR4 crossover cascade does NOT sum flat — bands pass through different numbers of allpass stages causing comb-filtering on reconstruction | High     | `crates/daw-dsp/src/proof/crossover.rs:87-92` and `bacteria/crossover.rs:163-193` — same cascaded topology in both. Fix: parallel LR4s with allpass compensation |
| I-12 | Crumbs pitch-up no anti-aliasing                                                                                                          | Medium   | `crates/daw-dsp/src/crumbs/voice.rs:218-240`                                                                                                                     |
| I-22 | Limiter O(window×N) scan                                                                                                                  | Medium   | `crates/daw-dsp/src/proof/limiter.rs:84-92`                                                                                                                      |
| I-30 | DSP claims needing re-verification                                                                                                        | Mixed    | Per-plugin — see original audit history                                                                                                                          |

## Proof Plugin

| ID   | Issue                                                                                                                                                                                                                                       | Severity | File                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| N-19 | Param bridge: 12 scalar per-change, 7 array load-only (eqBands, dynBands, dynCrossoverFreqs, excBands, imgBandWidth, ditherMode, ditherBits), 3 never (name, target, targetLufs). Array params only sync on patch load via `syncFullPatch`. | High     | `setProofParamWithPatch.ts`, `syncFullPatch.ts`             |
| S-05 | Engine-side param verification                                                                                                                                                                                                              | Medium   | Needs XOI runtime test                                      |
| I-06 | PDC latency reported by worklets to SAB but host never reads or compensates                                                                                                                                                                 | Medium   | Worklets call `get_latency_samples()`; no host-side PDC bus |

### Proof param coverage table (N-19 detail)

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

## UI & State

| ID   | Issue                                        | Severity | File                                                  |
| ---- | -------------------------------------------- | -------- | ----------------------------------------------------- |
| S-01 | Fader write-path storm                       | High     | `TrackLevelSection.tsx:39-41`, `setTrackGain.ts:9-14` |
| S-02 | Multi-track selection missing                | High     | `trackStore.ts:22-28` — scalar `selectedTrackId`      |
| I-14 | Knead/action history not persistent          | Medium   | `kneadStore.ts`, `actionHistoryStore.ts`              |
| I-15 | Fermenter telemetry at audio-rate            | Medium   | `fermenterStore.ts`                                   |
| I-27 | PianoRoll subscribes to whole stores         | Medium   | `PianoRoll.tsx:98-99`                                 |
| I-25 | Plugin module duplication (Proof vs Plugin/) | Low      | Product decision                                      |
| I-28 | Legacy brand-CMS keys in LocalStorage        | Low      | `LocalStorageKeys.ts:14-94` — needs legal review      |

## Timeline Editing

| ID   | Issue                            | Severity | File                                                   |
| ---- | -------------------------------- | -------- | ------------------------------------------------------ |
| T-04 | MIDI drag preview "stay behind"  | Major    | `clipDrawing.ts` — needs `visualShift` in render model |
| T-06 | MIDI stretching not implemented  | Major    | Needs spec                                             |
| T-07 | MIDI looping visual distortion   | Minor    | Bundled with T-04                                      |
| T-08 | Missing preview for stretch/trim | Minor    | Groundwork done — wire preview phase                   |

## Browser AI

| ID   | Issue                                   | Severity | File                                            |
| ---- | --------------------------------------- | -------- | ----------------------------------------------- |
| B-01 | OPFS model load path (JS heap copy)     | Medium   | `storageManager.ts:100-101`                     |
| B-02 | DiffSinger inter-stage tensor residency | Medium   | `onnxInferenceWorker.ts:130-137`                |
| B-03 | DDSP/TFJS stub                          | Medium   | `tfjsInferenceWorker.ts` — blocked on ONNX port |

## Feature Gaps

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

## Previously resolved (for reference)

**Fixed 2026-04-16:** I-07 (Dutch Oven stereo EQ), I-09 (TPDF dither), I-10 (imager width), I-11 (Crumbs filter L/R), I-13 (Automerge import), I-17 (ARIA), I-18 (DSO fallback), I-20 (worklet queue), I-23 (mono input), I-24 (dynBands mutation), Timeline §2 (MIDI split), Timeline §3 (MIDI duplicate), Timeline §5 (waveform squash).

**Retracted false positives (11 total):** N-09, N-15, N-22, N-24, N-25, N-26, N-33, N-35, N-38, N-39, DiffSinger cache key.
