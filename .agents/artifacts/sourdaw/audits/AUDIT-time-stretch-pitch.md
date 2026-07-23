---
type: audit
id: AUDIT-time-stretch-pitch
title: Time-stretch and pitch audit — golden standard, approved spec, and current-state gap
repository: /Users/josecosta/dev/sourdaw
branch: audit/time-stretch-pitch
base: origin/main @ 756078ed00308b66992bf64e95a4fa66a61e1b21
spec: /Users/josecosta/.agents/artifacts/sourdaw/gaps campaign/SPEC-time-stretch-engine.md (status: ready)
date: 2026-07-23
---

# Time-stretch and pitch audit

Audit only. No fixes. Every claim anchors to `file:line`, a search result, or pasted output at the
frozen base `756078ed0`. Line numbers cite the worktree checkout of that commit.

Scope: browser + Tauri time-stretch and pitch-shift across ElasticAudio (warp/time-stretch),
Arrangement (warp markers, clip stretch truth), Transport (playback scheduling), Knead (pitch
correction), and `daw-dsp` DSP primitives/seeds. Measured against BOTH the industry golden standard
and the project's approved `SPEC-time-stretch-engine` (AC-001..AC-019). Excluded: Tuner scoring,
non-stretch Arrangement editing, unrelated device DSP.

**Severity tally:** 1 Blocker, 5 Major, 4 Minor, 1 positive/informational (11 findings).

---

## Golden Standard (citations)

First-class stretch/pitch in a DAW splits along two axes: **time-stretch** (change duration without
pitch) and **pitch-shift** (change pitch without duration), each with a real-time and an offline
path. The reference practice:

- **Phase vocoder (PV), frequency-domain.** STFT analysis, modify synthesis hop, reconstruct.
  Naive PV suffers "phasiness"/loss-of-presence from lost vertical phase coherence. The accepted
  cure is **phase locking** — identity phase locking (IPL) and scaled/rigid-region locking — which
  also halves cost. Best for sustained/tonal material; smears transients.
  *Laroche & Dolson, "Improved Phase Vocoder Time-Scale Modification of Audio," IEEE Trans. Speech
  & Audio Processing 7(3):323–332, 1999.*
  https://www.semanticscholar.org/paper/Improved-phase-vocoder-time-scale-modification-of-Laroche-Dolson/8312d42cab3f14152d8e6406a9c0463737b6aa45
- **Transient preservation / phase reset.** First-class PV detects transients and resets/re-inits
  phase at onsets so attacks are not smeared across synthesis frames.
  *Röbel, "A New Approach to Transient Processing in the Phase Vocoder," DAFx-03, London, 2003.*
  https://www.dafx.de/paper-archive/2003/
- **Formant handling.** Quality pitch-shift preserves formants (spectral envelope) independently of
  f0 so shifted vocals do not "chipmunk." Ableton's Formants control preserves the spectral envelope
  under transposition.
- **WSOLA, time-domain.** Overlap-add frames at synthesis positions, search a tolerance window for
  max waveform similarity in the overlap. Cheaper, transient-friendly, real-time-capable; degrades
  beyond ~2x on polyphonic content. PV↔WSOLA is a quality/content trade; hybrid DAWs switch by
  content class.
  *Verhelst & Roelands, "An overlap-add technique based on waveform similarity (WSOLA) for high
  quality time-scale modification of speech," ICASSP-93.* https://doi.org/10.1109/ICASSP.1993.319366
- **Warp-marker semantics (reference: Ableton).** Warp markers pin source positions to timeline
  beats; segment ratios derive from adjacent markers; a warp *mode* selects the stretch algorithm.
  Ableton's modes are the de-facto vocabulary: **Beats** (transient/percussive), **Tones**
  (monophonic pitched), **Texture** (noisy/polyphonic, grain-based), **Re-Pitch** (resample; pitch
  follows tempo — NOT a stretch), **Complex / Complex Pro** (full-mix spectral, Pro adds formant
  preservation).
  *Ableton Reference Manual — Audio Clips, Tempo, and Warping.*
  https://www.ableton.com/en/manual/audio-clips-tempo-and-warping/
- **Pitch correction (Knead-class).** PSOLA / TD-PSOLA pitch-marks the signal at f0 epochs and
  overlap-adds grains at re-spaced synthesis marks; formant-corrected variants preserve the envelope.
  Pitch is tracked first (YIN / autocorrelation-class).
  *Moulines & Charpentier, "Pitch-synchronous waveform processing techniques for text-to-speech
  synthesis using diphones," Speech Communication 9(5–6), 1990.*
  https://doi.org/10.1016/0167-6393(90)90021-Z ·
  *de Cheveigné & Kawahara, "YIN, a fundamental frequency estimator for speech and music," JASA
  111(4), 2002.* https://doi.org/10.1121/1.1458024
- **Quality metrics.** Transient smearing (onset displacement), phasiness, f0 deviation under
  stretch, RMS/level stability at ratio 1.0, finite-sample guarantees, and — for real-time — zero
  render-thread allocation/lock/blocking.

Golden bar in one line: **the algorithm named in the UI must be the algorithm that runs, time-stretch
must decouple pitch from tempo, warp markers must reach playback, and pitch-shift must preserve
channels and formants.** The spec below encodes exactly this.

---

## Spec Commitments (from SPEC-time-stretch-engine, status: ready)

The approved spec supersedes the source elastic-audio "no new stretch DSP" non-goal (user decision
2026-07-18). Committed shape:

- **One canonical family, three honest algorithms.** ElasticAudio MUST offer exactly `repitch`,
  `phase-vocoder`, `wsola` and route each to its named executor (AC-002). Élastique, Rubber Band,
  and all third-party backends are **explicitly excluded**.
- **In-house engines seeded from Crumbs.** The existing offline Crumbs PV and WSOLA are the
  mandatory implementation seed, adapted behind a shared streaming contract, retained via
  differential goldens until every consumer migrates (AC-004).
- **Canonical ratio.** `playbackRateRatio = sourceSpanSeconds / outputSpanSeconds`, one reciprocal
  only at an inverse-duration adapter (AC-001).
- **Real-time topology.** Rust/WASM in an `AudioWorkletProcessor` on the single live `AudioContext`;
  no Worker pre-render or CPAL as substitute proof (AC-008); allocation-free streaming `process()`
  with frame-exact ratio changes, stable `latencyFrames`, typed failures (AC-009, AC-013).
- **Warp markers are core v1.** Deterministic warp map with implicit clip-in/out anchors, sorted
  strictly-increasing coordinates, owning-clip intrinsic-tempo evidence (AC-010); invalid-marker
  fail-closed with typed repair + disclosed repitch fallback (AC-011); Transport segment scheduling
  with window clipping, discontinuity reset, next-pass marker invalidation (AC-012).
- **Migration.** Map the 9 legacy algorithm names → `{repitch, phase-vocoder, wsola}`, resolve
  enablement/scalar precedence, fail marker maps without intrinsic tempo closed (AC-003, AC-017,
  AC-018, AC-019).
- **Conformance.** PV: mean f0 deviation <1%, finite, stereo-preserving, ±3 dB RMS at ratio 1.0
  (AC-005). WSOLA: 0.5–2.0 range, finite, stereo-preserving, 16-onset within 5 ms (AC-006). Repitch
  preserved exactly (AC-007).
- **Offline/export parity.** Same validated segment map + shared engines, per-segment match within
  one 128-frame quantum (AC-014).
- **Typed availability/fallback**, no silent substitution (AC-015). Dependency ordering behind
  performance DG-001..DG-005 and shared-DSP / Elastic Wave 6 (AC-016).

**Delivered so far:** exactly the dormant foundation. `TASK-time-stretch-dsp-contract-fixtures`
(merged PR #541) added the zero-caller `primitives::time_stretch` contract, ratio types, conformance
harness, and 48 kHz fixtures + BASELINE. It claims **no** AC. All engine, warp-map, scheduling,
topology, migration, and parity ACs remain open by the task's own statement.

---

## Current-State Map

### Real playback path (the only thing that stretches audio today)

`src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts`:
- `:129` `const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1;`
- `:165` `source.playbackRate.value = stretchRatio;`
- `:200,204,207,215` duration/offset math all scale by `stretchRatio` on the buffer source.

This is **playback-rate resampling** on `AudioBufferSourceNode` — pitch and duration are coupled
(chipmunk). Every non-`off` `stretchMode` collapses to the same resample; nothing distinguishes
`repitch` from `timestretch`.

### Clip stretch truth

`src/modules/Arrangement/models/Track.ts:79` `type StretchMode = 'off' | 'repitch' | 'timestretch'`;
`:102-103` optional `stretchMode`/`stretchRatio` on `Clip`. Durable, drives the resample above.

### Warp markers — data + editor, no engine

- Model: `src/modules/Arrangement/models/WarpMarker.ts` (`WarpMarker`, `WarpState` with
  `markers`, `stretchMode: 'repitch'|'complex'|'texture'|'beats'`, `originalTempo: number|null`).
- Store: `src/modules/Arrangement/stores/warpStates.ts:10` `export const warpStates = new Map<...>()`
  — **in-memory only**, not CRDT-backed (M-017: lost on save/reload, never synced).
- Use cases: `Arrangement/useCases/warp/{addManualWarpMarker,moveWarpMarker,removeWarpMarker,
  commitWarpMarkerBeatDrag,updateWarpMarkerBeat,setStretchMode,enableWarp,disableWarp}.ts`.
- Editor: `ElasticAudio/presentations/views/ElasticEditorPanel.tsx` (detect, quantize, add/move/
  remove/lock markers, canvas).
- **Absent:** `buildWarpMap`, `validateWarpMap`, `scheduleWarpSegments`
  (`grep` across `src/modules` → no file). Transport scheduling never references `warpMarker`/
  `warpMap` (`grep` in `Transport` → 0 hits). Warp markers reach no audio.

### ElasticAudio module

`find src/modules/ElasticAudio -type f`: only `presentations/`, `stores/`, `useCases/`. **No
`engine/` directory.** None of the spec's engine specs exist (`TimeStretchWorkletNode`,
`TimeStretchWorkletProcessor`, `timeStretchWasmBinding`, `timeStretchFailureState`). No AudioWorklet,
no WASM binding, no executor.

- `stores/audioWarp.ts:9-19` — `WarpAlgorithm` = 9 names: `elastique-pro`, `elastique-efficient`,
  `elastique-soloist`, `rubber-band-r3`, `rubber-band-rt`, `complex`, `complex-pro`, `repitch`,
  `slice`. `ClipWarpSettings` carries `formantPreservation`, `transientSensitivity`.
- `useCases/audioWarping/getAlgorithmInfo.ts` — per-name metadata claiming `quality:'high'`,
  `cpuCost`, `realTime:true`, "formant preservation".
- `presentations/views/ElasticEditorPanel.tsx:37-46` renders all 9 in an "Algorithm" `<select>`
  (`:398-410`, labels from `getAlgorithmInfo(algo).name`), plus a "Stretch" `<select>` of Ableton
  names `:33-35`.
- `useCases/audioWarping/enableWarping.ts:11` writes `audioWarpStore` — but `clipSettings` reaches
  no consumer (M-103, write-only dead state). The scheduler reads `clip.stretchMode`/`stretchRatio`
  from Arrangement, never `audioWarpStore`.

### daw-dsp seeds (mandatory in-house seed per AC-004)

- `crates/daw-dsp/src/crumbs/warp/repitch.rs` — only ratio conversion helpers
  (`semitones_to_ratio`, `bpm_match_ratio`); no processor.
- `crates/daw-dsp/src/crumbs/warp/phase_vocoder.rs` — offline PV with IPL peak-locking, **mono**,
  allocates output in `process()`, **naive O(N·K) DFT** (not FFT); no transient reset, no formants,
  no streaming.
- `crates/daw-dsp/src/crumbs/warp/wsola.rs` — offline WSOLA, **mono**, allocates, no reset/stream.
- `crates/daw-dsp/src/crumbs/warp/granular.rs` — grain engine (Texture-class), also unused.
- **Callers:** `grep PhaseVocoder|WsolaProcessor|Granular` across all `.rs` → only
  `crates/daw-dsp/tests/time_stretch_contract.rs`. Zero production callers; the seeds are dead code.

### primitives::time_stretch (dormant contract, PR #541)

`crates/daw-dsp/src/primitives/time_stretch/{mod,contract,ratio}.rs` — streaming contract types,
`PlaybackRateRatio`/`OutputDurationRatio` (`ratio.rs:74-75,93` reciprocal exactly at the adapter,
per AC-001). **Zero production callers** (grep → none outside the module + its test). Fixtures +
`BASELINE.md` under `testdata/time_stretch/`.

### Knead (pitch correction)

- Rust: `crates/daw-dsp/src/knead/` — genuine **YIN** (`yin.rs`, cites de Cheveigné & Kawahara 2002)
  + genuine **PSOLA** (`psola.rs`, COLA Hann overlap-add, pitch-mark synthesis). RT engine
  `engine.rs:131 process_block(left, right)` processes channels separately; test
  `shift_preserves_stereo_separation` (`:587`) guards against L→R collapse in the RT shift path.
- Offline commit (native): `src-tauri/src/commands/pitch_edit.rs:36,146`
  `samples = all.into_iter().step_by(channels).collect()` (left channel only); `:140` comment "We
  only support mono or the left channel"; `:226` writes `channels: 1`.
- Offline commit (WASM): `src/modules/AudioEngine/useCases/audioAnalysis/processPitchEditWasm.ts:11`
  `originalBuffer.getChannelData(0)`; `:22` `numberOfChannels: 1`; result written back to
  `audioBufferCache`.
- TS entry `src/modules/Knead/useCases/pitch/commitPitchEdit.ts:31` `if (!targetClip?.fileId) return;`
  — `clip.fileId` has no producer (M-104): the commit path is currently unreachable.

### Spec-vs-code table

| AC | Commitment | Code state | Evidence |
|----|-----------|-----------|----------|
| AC-001 | Canonical ratio, one reciprocal | **Partial** — dormant `ratio.rs`; Transport uses raw `playbackRate` scalar | ratio.rs:74; scheduleAudioClips.ts:165 |
| AC-002 | Offer exactly repitch/PV/WSOLA, route to executor | **Absent/regressed** — offers 9 impostor names, routes none | audioWarp.ts:9-19; ElasticEditorPanel.tsx:398 |
| AC-003 | Legacy algorithm-name migration | **Absent** — no `elasticWarpMigration` | grep → none |
| AC-004 | Adapt Crumbs seeds behind contract | **Absent** — seeds dead, contract zero-caller | tests-only callers |
| AC-005 | PV conformance (f0<1%, stereo) | **Absent** — PV mono, unused, no harness pass | phase_vocoder.rs |
| AC-006 | WSOLA conformance (onset 5 ms, stereo) | **Absent** — WSOLA mono, unused | wsola.rs |
| AC-007 | Repitch preserved | **Present (implicit)** — resample is the only path | scheduleAudioClips.ts:165 |
| AC-008 | Rust/WASM AudioWorklet topology | **Absent** — no `ElasticAudio/engine/` | find → none |
| AC-009 | Streaming processor contract | **Stubbed** — dormant contract only | primitives/time_stretch |
| AC-010 | Deterministic warp map | **Absent** — no `buildWarpMap` | grep → none |
| AC-011 | Invalid-marker fail-closed | **Absent** — no `validateWarpMap` | grep → none |
| AC-012 | Segment scheduling + invalidation | **Absent** — scheduler ignores markers | Transport grep → 0 |
| AC-013 | RT safety, no-alloc, seams | **Absent** — no RT engine to measure | — |
| AC-014 | Offline/export parity | **Absent** — offline ignores stretch (M-029) | renderOffline.ts:268 |
| AC-015 | Typed availability/fallback | **Absent** — no engine, no capability state | — |
| AC-016 | Dependency ordering | **N/A** — no activation exists | — |
| AC-017 | Scalar+marker composition | **Absent** — markers inert | — |
| AC-018 | Legacy scalar precedence | **Absent** — no migration | — |
| AC-019 | Marker maps w/o intrinsic tempo fail closed | **Absent** — `originalTempo` nullable, unused | WarpMarker.ts:20 |

Net: **1 implicit (AC-007), 2 partial/stubbed (AC-001, AC-009), 16 absent.** The only merged work is
the dormant DSP foundation.

---

## Findings

Severity is judged against SHIPPED claims: a missing engine the UI does not advertise is a gap; a UI
control that implies real stretch while it resamples — or that names third-party licensed engines the
product does not run — is severity-worthy.

### TS-1 — ElasticAudio's live dropdown advertises named third-party licensed engines the product neither ships nor licenses; none exist; playback resamples. **Blocker**
Evidence: `audioWarp.ts:10-14` names **`elastique-pro`, `elastique-efficient`, `elastique-soloist`**
(zplane élastique Pro/Efficient/Soloist) and **`rubber-band-r3`, `rubber-band-rt`** (Rubber Band R3
and real-time) — real, commercially licensed third-party time-stretch products (`audioWarp.ts:9-19`
also adds `complex`/`complex-pro`/`repitch`/`slice`). `getAlgorithmInfo.ts` renders them with brand
display names ("élastique Pro", "Rubber Band R3") and claims `quality:'high'`, `realTime:true`, and
"formant preservation" per name; `ElasticEditorPanel.tsx:37-46,398-410` surfaces all 9 in a live
user-facing Algorithm `<select>`. Real path: `scheduleAudioClips.ts:165` `playbackRate` resample.

**Misrepresentation / trademark dimension (why this re-ranks to Blocker).** These are protected
product/brand names for engines that are **not present in the tree, not a dependency, and not
licensed** (grep for any élastique/rubber-band implementation → only the label strings; the spec
*explicitly excludes* Élastique, Rubber Band, and every third-party backend). Shipping a UI that
names, brands, and attributes quality/CPU/real-time/formant characteristics to zplane and Rubber
Band engines the product does not run is a false attribution to third-party trademark holders and a
false capability claim to the user — a legitimacy/legal exposure, not merely an unimplemented
control. It is severity-worthy on the audit's own rule (a UI control implying real, branded stretch
that in fact resamples) *and* independently on the misrepresentation of licensed third-party marks.

Failure mode: a user selecting "élastique Pro" / "Rubber Band R3" / "Complex Pro (formant preserve)"
hears plain resample — or nothing, because the store is disconnected (M-103). Firing condition: any
interaction with the Algorithm dropdown; the exposure exists whenever the app is shipped. Blast
radius: ElasticAudio UI legitimacy + third-party-mark exposure across the whole product surface.
Spec target: collapse to exactly `repitch/phase-vocoder/wsola` (AC-002). Cross-ref M-103. Remediation
is immediate and independent of any real-engine work (see Roadmap step 1).

### TS-2 — "Time-stretch" is playback-rate resampling; pitch couples to tempo. **Major**
Evidence: `scheduleAudioClips.ts:129,165`. `Clip.stretchMode` `'timestretch'` (`Track.ts:79`)
promises pitch-preserving stretch but resolves to the identical `playbackRate` resample as
`'repitch'`. Failure mode: warping a clip's tempo shifts its pitch (chipmunk); the `timestretch`
label is false. Firing condition: any clip with `stretchMode !== 'off'` and `stretchRatio !== 1`.
Blast radius: all audio-clip tempo adaptation. Spec target: `phase-vocoder`/`wsola` executors
(AC-002, AC-005, AC-006).

### TS-3 — Warp markers are a full editor over inert data; markers never reach playback and never persist. **Major**
Evidence: model/editor/use-cases present (`WarpMarker.ts`, `ElasticEditorPanel.tsx`,
`Arrangement/useCases/warp/*`), but `warpStates.ts:10` is an in-memory `Map` (M-017: not
CRDT-backed, lost on save/reload, never synced), and `buildWarpMap`/`validateWarpMap`/
`scheduleWarpSegments` do not exist (grep → none); Transport never reads markers (grep → 0). Failure
mode: users detect transients, add/quantize/lock warp markers, and none of it affects audio or
survives a reload. Firing condition: any warp-marker edit. Blast radius: the entire core-v1 warp
feature. Spec target: AC-010/011/012 + persistence via `CHANGE-elastic-audio-ownership-and-worker`.
Cross-ref M-017, M-102, M-249.

### TS-4 — No ElasticAudio engine surface exists. **Major**
Evidence: `find src/modules/ElasticAudio` → no `engine/`; none of the spec's engine specs exist. No
AudioWorklet, no WASM binding, no executor, no typed capability/fallback state (AC-015). Failure
mode: there is no place for a real stretch algorithm to run in the browser. Blast radius: AC-002,
AC-008, AC-009, AC-013, AC-015 all unrealizable until built. Not itself a shipped false claim — a
structural gap — but the precondition TS-1/TS-2 depend on.

### TS-5 — Mandatory in-house seed engines are dead, mono, whole-buffer, and use a naive DFT. **Major** (quality risk to the committed engine)
Evidence: `phase_vocoder.rs` (mono, allocates in `process()`, O(N·K) DFT not FFT — BASELINE records
~433 ms per 4096-frame characterization input; no transient reset, no formant path),
`wsola.rs` (mono, allocates, no streaming/reset), zero production callers (grep → tests only), not
adapted behind `primitives::time_stretch` (AC-004 open). Failure mode: as-is the seeds cannot meet
AC-005/006 (stereo identity, streaming, finite RT) or AC-013 (no-alloc) without substantial rework;
the PV's per-frame DFT is unusable at scale. Blast radius: the quality ceiling of the entire shipped
family. Golden-standard gaps: missing transient/phase reset (Röbel), missing formant preservation,
FFT not DFT, mono only.

### TS-6 — Knead offline pitch-commit collapses stereo to mono (both native and WASM paths). **Major** (DSP correctness) — currently latent (see TS-7)
Evidence: native `src-tauri/src/commands/pitch_edit.rs:36,146` (`step_by(channels)` = left only),
`:140` comment, `:226` `channels:1`; WASM `processPitchEditWasm.ts:11` `getChannelData(0)`, `:22`
`numberOfChannels:1`, result written back to `audioBufferCache`. Failure mode: committing a manual
pitch edit on a stereo clip destroys the right channel and rewrites the clip as mono. Blast radius:
every stereo clip pitch-edited via the commit path. Cross-ref M-040. Contrasts with the RT engine,
which preserves stereo (`engine.rs` `shift_preserves_stereo_separation`).

### TS-7 — Knead pitch-commit path is inert (`clip.fileId` has no producer). **Minor** (dead surface; tempers TS-6)
Evidence: `Knead/useCases/pitch/commitPitchEdit.ts:31` `if (!targetClip?.fileId) return;`;
`clip.fileId` has no writer in the repo (M-104). Consequence: the stereo-collapse of TS-6 cannot
fire in normal use today because the commit never proceeds — it is a latent correctness bug behind a
dead gate. Any future work that populates `fileId` re-arms TS-6. Cross-ref M-104.

### TS-8 — RT Knead engine can replace the right channel with the left on unvoiced frames. **Minor** (DSP correctness, uncertain)
Evidence: `crates/daw-dsp/src/knead/engine.rs:192,261` — `analyze_and_shift` requires
`pitch_marks.len() >= 3`; when unvoiced/empty the shift is skipped and the register records the right
channel being replaced by the left (M-174, marked UNCERTAIN). Firing condition: unvoiced material
under active shift. Blast radius: stereo integrity of Knead RT output on unvoiced regions. Needs a
dynamic run to confirm.

### TS-9 — Knead's pitch algorithm IS PSOLA/YIN-class; the gap is integration, not algorithm quality. **Positive / informational**
Evidence: `yin.rs` (de Cheveigné & Kawahara 2002), `psola.rs` (Moulines–Charpentier-style COLA
overlap-add, span-aware for RT continuity). Unlike time-stretch, Knead's core DSP meets the
golden-standard algorithm class for pitch correction. The deficits are stereo collapse (TS-6),
reachability (TS-7), unvoiced handling (TS-8), and absent formant-correction — not the base method.

### TS-10 — Live/offline stretch are non-parity even for the resample. **Minor**
Evidence: offline render ignores `stretchRatio` for audio clips (`renderOffline.ts:268`, M-029);
no `timeStretchOfflineParity` path (AC-014 absent). Failure mode: a warped clip renders/exports at
its unstretched length and pitch. Blast radius: freeze/bounce/consolidate/export of any stretched
clip. Cross-ref M-029.

### TS-11 — Four incompatible stretch vocabularies coexist; the spec's canonical set matches none of them and the migration is unbuilt. **Minor**
Evidence: `Clip.stretchMode` = `off|repitch|timestretch` (`Track.ts:79`); `WarpState.stretchMode` /
editor = `repitch|complex|texture|beats` (`WarpMarker.ts:19`, `ElasticEditorPanel.tsx:33`);
`WarpAlgorithm` = 9 élastique/rubber-band/complex names (`audioWarp.ts:9`); spec canonical =
`repitch|phase-vocoder|wsola` (AC-002). AC-003/AC-018 define the mapping, but no migration code
exists. Failure mode: any consolidation must reconcile four namespaces; risk of silent misrouting.

### None-observed statements
- No third-party stretch library, binary, or copied fixture is present in the tree (grep for
  élastique/rubberband implementations → only the TS name strings; fixtures are in-house synthetic
  per BASELINE). The 9 names are labels only — which is precisely the basis of TS-1's
  misrepresentation finding.
- No second phase-vocoder/WSOLA implementation exists beyond the Crumbs seeds and the dormant
  contract (grep → none).

---

## Remediation Roadmap

Sequence to reach the spec's committed first-class engine. Follows the spec's own run-order and
dependency gates (AC-016); sizes are S/M/L. First-class only — no shims that re-advertise fake
algorithms.

1. **IMMEDIATE — remove or honestly rename the third-party-branded algorithm surface (independent of
   and prior to any real-engine work).** Delete the élastique/Rubber Band/Complex-Pro names,
   brand-display labels, and unbacked `quality`/`cpuCost`/`realTime`/formant claims from
   `audioWarp.ts:9-19`, `getAlgorithmInfo.ts`, and the `ElasticEditorPanel.tsx` Algorithm/Stretch
   `<select>`s. Reduce the user-facing surface to the spec's `repitch|phase-vocoder|wsola`, and gate
   PV/WSOLA behind a typed "engine unavailable → disclosed repitch fallback" state until real
   executors exist (AC-002, AC-015). This is the Blocker fix (TS-1): it removes the misrepresentation
   of licensed third-party marks and the false capability claim without waiting on any DSP. — **S/M**
2. **(Done) DSP foundation** — dormant `primitives::time_stretch` contract + fixtures (PR #541). No
   AC claimed. — *shipped.*
3. **Crumbs convergence (Wave: shared-DSP 6 + Crumbs stretch).** Adapt PV/WSOLA behind the streaming
   contract: FFT (not DFT), stereo, preallocated streaming `process()`, transient detection + phase
   reset (Röbel), latency/tail/drain; differential goldens vs the frozen seeds; prove zero private
   callers before removing duplicates (AC-004, AC-005, AC-006). — **L**
4. **Arrangement warp map + persistence.** `buildWarpMap`/`validateWarpMap`, implicit clip-in/out
   anchors, intrinsic-tempo evidence, fail-closed invalid/missing-tempo repair, and move warp state
   off the in-memory `Map` onto the CRDT write path so markers survive save/reload/undo (AC-010,
   AC-011, AC-017, AC-018, AC-019; fixes TS-3, M-017). Migrate the four vocabularies (AC-003; TS-11).
   — **L**
5. **Transport segment scheduling.** `scheduleWarpSegments`: clip map to active windows, source time
   from intrinsic evidence, project-tempo integration, canonical ratio + frame-exact times,
   discontinuity reset, next-pass marker invalidation (AC-012). — **M/L**
6. **ElasticAudio engine surface.** `ElasticAudio/engine/`: `TimeStretchWorkletProcessor` (Rust/WASM
   in an AudioWorkletProcessor on the single AudioContext), WASM binding, typed capability/failure
   state (AC-008, AC-009, AC-015; fixes TS-4). Gated behind performance DG-001..DG-005 (AC-013,
   AC-016). This is where step 1's `phase-vocoder`/`wsola` options become honestly selectable. — **L**
7. **Offline/export parity adapter.** Consume the same validated segment map + shared engines in the
   offline graph; per-segment match within one 128-frame quantum (AC-014; fixes TS-10, M-029). Gated
   behind offline DG-002/Wave-2. — **M**
8. **Knead stereo + reachability.** Restore true stereo in the offline commit (both native and WASM)
   or explicitly document mono-only; fix the unvoiced L→R replacement; give `clip.fileId` a producer
   so the commit path is reachable and tested (fixes TS-6, TS-7, TS-8; M-040, M-104, M-174).
   Optional: formant-corrected shifting to reach the pitch-correction golden bar. — **M**

---

## Open Questions

1. **AC-007 provenance.** Is the current `playbackRate` resample the intended permanent `repitch`
   executor, or a placeholder to be re-expressed through the streaming contract? The spec preserves
   its observables (AC-007) but the honest-selector step (roadmap 1) must not regress them.
2. **Warp-state persistence owner.** `warpStates` is a deliberate in-memory store to break an
   AudioEngine↔Arrangement cycle (see its doc comment). Confirm the CRDT-backed replacement path with
   `CHANGE-elastic-audio-ownership-and-worker` before roadmap 4 to avoid re-introducing the cycle.
3. **TS-8 dynamic confirmation.** The unvoiced L→R replacement (M-174) is UNCERTAIN — needs a
   `cargo test`/harness run over an unvoiced stereo fixture to confirm before grading past Minor.
4. **Knead mono decision.** Is mono-only offline pitch commit an accepted product limitation, or a
   defect to fix? PG-001/PG-003 in the task packet imply behavior preservation; the spec does not
   own Knead. Needs an explicit product call.
5. **Granular/Texture mode.** `granular.rs` and the editor's `texture`/`beats` Stretch modes have no
   spec home (spec canonical = repitch/PV/WSOLA). Delete, or map Texture→granular as a future
   engine? Out of current spec scope.

---

## Unverified areas / missing evidence

- All timing/allocation/finite-sample claims about the seeds are read from source + BASELINE, not
  re-run here (no dynamic execution performed in this audit). AC-005/006/013-class behavior requires
  the Rust workload runner to confirm.
- TS-8 (M-174) is static-only and register-marked UNCERTAIN.
- Runtime confirmation that `audioWarpStore.clipSettings` reaches no consumer relies on grep +
  M-103; not exercised in a live app.
- The trademark/licensing basis of TS-1 rests on the absence of any élastique/Rubber Band
  implementation or dependency in-tree (grep → label strings only) plus the spec's explicit
  exclusion; it is not a legal opinion.
