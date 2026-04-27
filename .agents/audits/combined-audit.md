---
name: combined-audit
description: Full cross-audit analysis (2026-04-27). Supplements canonical audits; does not replace them.
type: audit
status: open
last_verified: '2026-04-27'
---

# Combined audit — analysis report (2026-04-27)

## Purpose and scope

This document is the **systematic** re-check of five canonical audits plus prior supplement notes:

| Canonical source (full detail, tables, history) |
| ----------------------------------------------- |
| [backlog.md](./backlog.md) |
| [faust-polyphony.md](./faust-polyphony.md) |
| [midi-coordinate-convention.md](./midi-coordinate-convention.md) |
| [multi-track-recording.md](./multi-track-recording.md) |
| [plugin-host-contract.md](./plugin-host-contract.md) |

**Do not delete those files.** They keep line-level tables, resolved/retracted indices, and adversarial narrative. This file answers: *what still matches the repo, what is stale, and what needs nuance.*

**Method:** Read each audit in full; for every major claim, grep/read the referenced or implied paths in `src/` and `crates/daw-dsp/`. Some backlog rows are **not** fully traced (called out explicitly as “not verified this pass”).

---

## Executive summary

1. **[faust-polyphony.md](./faust-polyphony.md)** — **Largely stale as written.** The tree uses `FaustPolyDspGenerator` for `isInstrument`, `createNode(context, POLY_VOICES_DEFAULT)` for poly, `buildParamAddressCache` for O(1) bare names, and `scheduleFaustNote` / `scheduleDeviceKeyOn` (not raw `freq`/`gain`/`gate` AudioParams). **Remaining real issues:** `keyOn`/`keyOff` go through `setTimeout` in `faustDeviceFactory.ts` (documented there) — sample-accurate scheduling is still a product/DSP concern. The old “7 DSP files / additive without gain” inventory **no longer matches** `builtinDSP.ts` (instrument set changed; e.g. no separate `additive-synth` / `morphing-synth` in the current registration block reviewed).

2. **[midi-coordinate-convention.md](./midi-coordinate-convention.md)** — **Core “outlier” bugs appear fixed** in code: AI `apply*ToTrack` files use `startBeat: note.startBeat`; `duplicateClipCore` copies `note.startBeat` without `beatDelta`. The **path table is partly stale** (wrong file paths/line numbers for `importMidiFile`, `applyMelody` line refs). MIDI import forcing `clip.startBeat: 0` is still in `src/modules/Arrangement/useCases/importMidiFile.ts` (~line 46), not `MIDI/useCases/importMidiFile.ts`. **M-02 / S-08 / S-09** were blocked on M-01; M-01 code fixes suggest **re-open status review** and optional **data migration** text for legacy sessions.

3. **[multi-track-recording.md](./multi-track-recording.md)** — **Still accurate:** single `recordingSession`, overwrite on each `startAudioRecording`, mono capture. `toggleRecording.ts` uses `getCompensationDelay` for **recorded clip** start trim — that is separate from multi-track capture.

4. **[plugin-host-contract.md](./plugin-host-contract.md)** — **Partially stale in “current behavior”.** `TrackNode.ts` is **~513 lines** (not 567); **`removeDevice` / `updateParam` / `scheduleParam` / `updateBypass` / `dispose`** delegate through `dn.controller` when present. **Toaster/Levain** use `Record<deviceId, State>` — singleton claim is **obsolete**. **Still valid:** Crust has no WASM in `wasmDeviceRegistry` → silent early return in `addDevice` if no factory; **I-01** `NativePluginBridgeNode` still async `tauriInvoke('process_plugin_audio')` per block; **I-06** needs nuance (see § PDC below). Marked “[RESOLVED]” items in that file are **directionally done** but the top “TrackNode branches everywhere” prose should be **rewritten** to match current code.

5. **[backlog.md](./backlog.md)** — **Most rows unchallenged** where checked; **I-06 wording is too absolute**; several **file paths/lines are stale** (e.g. `TrackLevelSection`, `ChatPanel`, `PianoRoll`, `importMidiFile`).

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

## [faust-polyphony.md](./faust-polyphony.md) — claim-by-claim

| Claim in audit | Verdict | Evidence |
| -------------- | ------- | -------- |
| Only `FaustMonoDspGenerator` for all modules | **False** | `compilerEngine.ts` ~165: `mod.isInstrument ? new FaustPolyDspGenerator() : new FaustMonoDspGenerator()` |
| Poly never imported | **False** | Same file imports `FaustPolyDspGenerator` |
| `setParam` bare name fails; only suffix fallback O(N) | **Superseded** | `faustDeviceFactory.ts`: `buildParamAddressCache` from `AudioParam` map; `setParam` uses `paramAddressCache.get(name) ?? name` |
| Notes use `scheduleDeviceParam('freq'…)` | **False for current scheduler** | `scheduleFaustNote.ts` uses `scheduleDeviceKeyOn` / `scheduleDeviceKeyOff` |
| N-24 race | **Retracted in audit** | Still valid retraction |

**Open (still real):** timer-based `scheduleCall` for `keyOn`/`keyOff` in `faustDeviceFactory.ts` (not sample-accurate). **Inventory** of instrument DSP files and “additive without gain” **must be re-derived** from current `builtinDSP.ts` + `dsp/*.dsp` list.

---

## [midi-coordinate-convention.md](./midi-coordinate-convention.md) — claim-by-claim

| Claim | Verdict | Evidence |
| ----- | ------- | -------- |
| `applyMelodyToTrack` timeline-absolute `startBeat + note.startBeat` | **False now** | `applyToTrack.ts` maps `startBeat: note.startBeat` |
| Chord / drum apply same bug | **False now** | `generateChordProgression/applyToTrack.ts`, `generateDrumPattern/applyToTrack.ts` use `note.startBeat` |
| `duplicateClipCore` adds `beatDelta` to notes | **False now** | `duplicateClipCore.ts` copies `startBeat: note.startBeat` |
| `importMidiFile` line 52 forces `startBeat = 0` | **Right idea, wrong path/line** | `Arrangement/useCases/importMidiFile.ts` ~46: `startBeat: 0` on new clip |
| Table line numbers for `clipDrawing`, `scheduleMidiNotes`, etc. | **Unverified / likely drift** | Not re-validated line-by-line in this pass |

**Status field `closed`:** Consider **reopening** or adding a “2026-04-27 code verification” note — convention bugs in the named files look **fixed**; **migration** for old projects may remain a **data** task.

---

## [multi-track-recording.md](./multi-track-recording.md) — claim-by-claim

| Claim | Verdict | Evidence |
| ----- | ------- | -------- |
| Single global `recordingSession` | **True** | `recording.ts` `createHmrPersistentState` single object |
| Each `startAudioRecording` overwrites session | **True** | Assigns `mediaStream`, `onRecordingComplete`, nodes in place |
| Mono `channelCount: 1` | **True** | ~121–127 |
| `startRecording` creates clips for all armed | **True** | `startRecording.ts`: loop `armedTracks`, `newClips.push` per track (with MIDI overdub exceptions) |
| Independent of `selectedTrackId` | **Plausible** | Recording uses `armed` in `toggleRecording` loop |

---

## [plugin-host-contract.md](./plugin-host-contract.md) — claim-by-claim

| Claim | Verdict | Evidence |
| ----- | ------- | -------- |
| Four methods full of per-plugin branches only | **Mostly stale** | `TrackNode.ts` uses `dn.controller` for `updateParam`, `scheduleParam`, `updateBypass`, `removeDevice`, `dispose` |
| Toaster/Levain singleton | **False** | `toasterStore` / `levainStore` are `Record<string, …>` + `getXState(deviceId)` |
| Crust silent add | **True** | No `crust` in `wasmDeviceRegistry`; `addDevice` returns if `!findWasmDescriptor` |
| Native bridge per-block `tauriInvoke` | **True** | `NativePluginBridgeNode.ts` ~46–59 |
| PDC to SAB, host does nothing | **See § PDC nuance** | SAB written; host uses different compensation path; `reportLatency` unused |

**Adversarial / “Final resolution” block:** Treat as **historical** unless re-run with current `removeDevice`/`dispose` + store teardown tests.

---

## [backlog.md](./backlog.md) — row status (verified / partial / stale path / not checked)

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

**Previously resolved / retracted lists** in [backlog.md](./backlog.md) — **retain**; not re-proven in this pass.

---

## Deduplication map (for workers)

- **S-03 + I-29** ↔ [multi-track-recording.md](./multi-track-recording.md) (authoritative for capture design).
- **I-06** ↔ [plugin-host-contract.md](./plugin-host-contract.md) §6 + backlog Proof row — **merge wording** when fixing PDC story.
- **N-19** ↔ [backlog.md](./backlog.md) table + [faust-polyphony.md](./faust-polyphony.md) is unrelated; don’t conflate.
- **Crust** ↔ plugin-host S-04 + backlog only if you add a row.

---

## Recommended edits to canonical audits (editorial)

1. **faust-polyphony.md** — Replace “monophonic only” and poly never used with current architecture; add **keyOn scheduling** limitations; refresh DSP file list from `builtinDSP.ts`.
2. **midi-coordinate-convention.md** — Mark M-01 **fixed in main paths**; fix **file paths** (`Arrangement/.../importMidiFile.ts`); refresh line table or link to `rg` / search; decide **status: closed** vs **open (migration only)**.
3. **plugin-host-contract.md** — Rewrite “current behavior” to `controller` delegation; remove singleton claim; add **I-06 nuance** or link here.
4. **backlog.md** — Fix **I-16** / **S-01** file paths; **refine I-06**; bump `last_verified` per section as you go.
5. **multi-track-recording.md** — Minor line drift only if you want strict accuracy.

---

## Gaps and limits of this pass

- No **profile** of Chat or fader (behavioral, not just structure).
- No **plugin-by-plugin** proof pass for I-30.
- **Timeline (T-*)** and **browser (B-*)** mostly **unread**.
- **Knead, Fermenter, LocalStorage, scoring** (I-14, I-15, I-28, N-34) **not** opened.

When those matter for a release, schedule a **scoped** audit or extend this document — **without** removing rows from [backlog.md](./backlog.md) until each is explicitly retired with proof.

---

## Related

- [grinder/control-deck.md](./grinder/control-deck.md) and other area audits: not merged here.
