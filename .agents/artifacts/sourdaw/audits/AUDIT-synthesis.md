---
type: audit-synthesis
id: AUDIT-synthesis
title: Sourdaw DAW-subsystem audit campaign — cross-ranked findings and remediation program
scope: Synthesis of all ten merged area audits (offline-export, midi-handling, automation, dsp-engines, rt-engine-core, plugin-hosting, effects-routing, rust-wasm-boundary, time-stretch-pitch, collab-crdt-audio)
ledger: issue #691
date: 2026-07-23
method: cluster area findings by shared root cause into workstreams; rank by user harm × breadth × remediation leverage × dependency order
disposition: PLANNING INPUT — every claim traces to an area finding id or a ledger comment; no new unverified assertions.
---

# Campaign synthesis — cross-ranked findings and remediation program

This is not a concatenation of the ten area audits. It clusters their findings by **shared root
cause** into named workstreams, ranks the workstreams against an explicit harm model, and sequences a
remediation program where one fix retires many findings. Every finding id below is defined in its area
artifact; nothing new is invented. Two Blockers are already remediated (FX-1 → PR #703 merged; TS-1 →
PR #709 merged) and one is in flight (CC-4). The campaign surfaced **9 Blocker-or-Major clusters**
spanning **~99 findings** across ten areas.

Total finding inventory (area-artifact counts of record):

| Area | Blocker | Major | Minor | Polish | Other |
| --- | --- | --- | --- | --- | --- |
| Offline export (OE-1…11) | 0 | 5 | 5 | 1 | — |
| MIDI (MD-1…8) | 2 | 2 | 3 | 1 | — |
| Automation (AU-1…12) | 0 | 5 | 7 | 0 | — |
| DSP engines (DSP-1…9) | 0 | 4 | 4 | 1 | — |
| RT engine core (RT-1…10) | 0 | 5 | 4 | 1 | — |
| Effects & routing (FX-1…9) | 1 | 3 | 5 | 0 | — |
| Rust/WASM boundary (WB-1…9) | 0 | 5 | 3 | 1 | — |
| Plugin hosting (PH-1…14) | 1 | 8 | 4 | 1 | — |
| Time-stretch & pitch (TS-1…11) | 1 | 5 | 4 | 0 | 1 positive |
| Collab/CRDT (CC-1…9) | 1 | 3 | 4 | 1 | 5 sound |
| **Totals** | **6** | **45** | **43** | **7** | — |

(Severity-count anomalies vs the ledger summary comments are recorded in the Anomalies section; the
per-artifact finding headers are treated as authoritative.)

---

## 1. Ranking criteria (stated explicitly)

Workstreams and remediation waves are ranked by four factors, in this precedence:

1. **User harm — a strict ordering.**
   `silent data loss > deliverable-audio corruption > wrong live monitoring > missing/absent capability`.
   - *Data loss*: truth the user created that the app can never read back (CC-4).
   - *Deliverable corruption*: shipped/exported audio is wrong (MD-4, FX-1, OE-1).
   - *Wrong monitoring*: what the user hears live ≠ what they get, or unstable audio (FX-4, RT-1, AU-2).
   - *Missing capability*: a promised feature is absent or inert (TS-3, PH-6). A **dead control** —
     UI that claims a capability the code does not provide — ranks *above* an honestly-absent feature
     because it actively misleads (MD-2, FX-3, TS-1).
2. **Breadth** — how many sessions/exports the finding fires on. "Every save→reload" and "every
   sidechained export" outrank "edit-heavy multi-bus sessions only."
3. **Remediation leverage** — one fix retiring many findings (a single-source-of-truth engine kills a
   whole parity cluster; a fingerprint gate kills a recurrence class).
4. **Dependency order** — build integrity and shared-engine substrate must land before the fixes that
   ride on them (e.g. PH-4 latency reporting is a precondition for RT-4/FX-4 live PDC).

---

## 2. Cross-ranked workstreams (clustered by root cause)

Nine workstreams. Each names its member findings, its single root cause, its worst harm class, and its
leverage. Ordered by the ranking criteria above.

### WS-1 — Live↔offline parity as a systemic architecture defect (the campaign's dominant thread)
**Root cause.** The live engine and the offline/bounce renderer are **two independently
hand-maintained implementations** of the same signal graph, math, and state, with **no conformance
gate** between them. Every place the two are edited separately, they drift.
**Members:**
- Automation math duplicated: **AU-1** (two curve implementations, already drifting on `stairs`
  clamping, no cross-conformance test — #616 deleted the one that existed), **AU-2** (live device-param
  slew has no offline counterpart → monitor ≠ bounce), **AU-3** (offline ignores linked lanes → silent
  bounce), **AU-12** (clip-scoped automation possibly absent offline).
- State split: **OE-4** (solo lives on engine nodes, never the project store the exporter reads → solo
  invisible to export), **OE-3** (offline device-param automation frozen for any device outside a
  hardcoded map + 3 opt-in nodes).
- Routing/latency asymmetry: **FX-4** (PDC applied offline but **never live** → live flam, the inverse
  parity break), **FX-1** (offline double-wired the sidechain key, +6 dB over-duck — a #616
  reconciliation regression; **FIXED PR #703**).
- Timbre: **MD-4** (freeze/bounce renders every MIDI instrument as a triangle oscillator — see WS-3),
  **RT-5** (live automation neither PDC-compensated nor sample-accurate — the live half of the
  automation-parity gap).
- Stretch: **TS-2** / **TS-10** (offline render ignores `stretchRatio` entirely; live is resample-only).
**Worst harm.** Deliverable-audio corruption + wrong monitoring, on every automated/soloed/sidechained
export. **Breadth:** every non-trivial mix. **Leverage: very high** — routing *both* runtimes through
one shared evaluator (curve math, automation targeting, solo/audibility read model, PDC path) with a
conformance assertion retires AU-1/2/3/12, OE-3/4, FX-4, RT-5, TS-10 at once. This is the highest-value
architectural investment in the campaign.

### WS-2 — Plugin-delay compensation, end to end
**Root cause.** Latency is reported and compensated in fragments: WASM devices report; native plugins
do not; compensation runs offline but not live; the sidechain key is never aligned.
**Members:** **PH-4** (CLAP `CLAP_EXT_LATENCY` never queried; `latency_samples` hard-coded 0 — the
hosting-side root), **RT-4** (native plugin latency never reaches `externalLatencyRegistry`/PDC),
**FX-4** (offline-only compensation; no live `DelayNode`), **FX-5** (sidechain key not time-aligned to
the detector), **RT-6** (built-in `DynamicsCompressorNode` ~6 ms lookahead unqueryable → zero-reported).
**Worst harm.** Wrong live monitoring (flam) + latent deliverable smear on latency-bearing chains.
**Leverage: high** — PH-4 unblocks RT-4; RT-4 + a single live-PDC `DelayNode` path (FX-4) subsumes
FX-5 and RT-6. One PDC substrate, consumed identically live and offline (converges with WS-1).

### WS-3 — Freeze/bounce real-synth convergence
**Root cause.** The offline freeze/bounce path (`Arrangement/.../freezeBounce/renderOffline.ts`) never
instantiates the real instrument nodes; and the real synths are **not addressable per-note** off the
audio thread. One shared root, two symptoms.
**Members:** **MD-4** (Blocker — triangle-oscillator stub bakes into frozen buffers and bounced clips
that enter exports; deliverable corruption for every non-drum MIDI instrument track), **MD-2** (Blocker
— MPE per-note expression never reaches any real instrument; a user-facing dead control on the
PianoRoll toolbar + GrandBoule panels).
**Worst harm.** Deliverable-audio corruption (MD-4) + dead control (MD-2). **Leverage: high but
L-sized** — the MIDI audit prescribes *converging freeze/bounce onto `AudioEngine/renderOffline.ts`
through the actual instrument nodes* rather than improving the stub, and giving worklet instruments a
per-note expression surface used by both live and scheduled paths. One engine-addressing change fixes
both Blockers.

### WS-4 — Plugin-host spec-implementation gap
**Root cause.** `SPEC-plugin-hosting-clap` (draft) prescribes the correct architecture; almost none is
implemented. The whole subsystem is a spec-conformance backlog.
**Members:** **PH-2** (Blocker — third-party `plugin.process` runs inline on the CPAL audio thread; no
`catch_unwind`/sandbox/subprocess; any plugin crash kills the DAW — largest single blast radius, but
Decision 0003 lists out-of-process as a current non-goal, so *known/accepted* debt), **PH-1**
(in-process scanning, no denylist), **PH-3** (plugin state chunk serialized but **zero callers** → all
plugin state lost on reopen), **PH-4** (latency — feeds WS-2), **PH-5** (per-block audio over Tauri IPC,
not SAB rings), **PH-6** (VST3 silent passthrough presented as active; AU unsupported), **PH-7**
(load-failure swallowed; no error slot/retry, violates Decision 0003), **PH-8** (CLAP thread-model
violated: start/stop_processing off the audio thread), **PH-9** (plugin output events discarded → vendor
GUI is the only control path), **PH-10** (editor resize/idle-pump unimplemented), **PH-11** (transport
never forwarded → tempo-sync plugins free-run), **PH-12** (scan metadata placeholder), **PH-13**
(path-derived identity orphans references on move/upgrade), **PH-14** (`eprintln!` on callback paths).
**Worst harm.** Whole-app termination (PH-2) + persisted-project data loss (PH-3) + dead/misleading
slots (PH-6). **Leverage: medium, mostly L** — PH-3 and PH-4 are M-sized high-value wins independent of
the L-sized crash-isolation and SAB efforts.

### WS-5 — Artifact/build integrity (the #657 recurrence class)
**Root cause.** wasm binaries + glue are hand-committed with **no CI gate** rebuilding them against
crate source; the toolchain is unpinned; a stale mismatched twin binary is still tracked.
**Members:** **WB-1** (no fingerprint/rebuild-diff gate → #657 drift class recurs silently; established
as dev-local artifact corruption CI never saw), **WB-2** (stale schema-mismatched
`src/.../daw_dsp_bg.wasm`, hash `5549…` vs live `344f…`, still tracked — the latent trap), **WB-3**
(glue transform is an unguarded `String.replace` that silently no-ops on a wasm-bindgen line change,
re-arming WB-2), **WB-4** (hand-maintained `.d.ts` drift — the compiler checks against a mirror), **WB-8**
(unpinned `wasm-pack`/`wasm-opt`; crate `wasm-bindgen` caret `"0.2"`), **WB-6** (no
`console_error_panic_hook`, no explicit `panic="abort"` → Rust panics are opaque traps that poison the
worklet instance; compounds **DSP-8**), **WB-9** (latin1-only `TextDecoder` polyfill).
**Worst harm.** Silent schema drift shipping to production (already fired once as #657) + unobservable
audio-thread device death (WB-6). **Leverage: very high, low cost** — WB-1's rebuild-and-diff gate +
WB-2 removal + WB-3's replacement-count assertion + WB-8's pin close the entire recurrence class for
~M-total effort and are a **precondition** for safely doing any WS-7 DSP work.

### WS-6 — CRDT projection architecture
**Root cause.** The projection layer is neither complete (a slot is written but never read back) nor
purely derived (it writes back into the document) nor incremental (it re-projects everything on every
change). Lineage: the #658 deferred-visibility and #687 re-entrancy incidents.
**Members:** **CC-4** (Blocker — `modulationStore` is a write-only CRDT truth slot; every modulation
setup silently lost on reload and never synced to peers; **fix in flight**), **CC-2** (`hydrate()`
back-writes → projection is a second writer; re-entrant O(n²) storm; cross-project stale-bleed), **CC-1**
(full 15-store re-projection with O(project-size) `JSON.stringify` on every change, local included; the
action-history post-commit write doubles it), **CC-3** (every inbound sync wipes all action-replay
capabilities → collaborative revert-from-history is inert during live sessions), **CC-5/CC-7** (discard/
prepare-failure terminals don't recompute/re-arm), **CC-8** (full-save/compaction on the main thread).
**Confirmed sound (honored):** presence-channel isolation (G4), sync loop guard, unknown-doc rejection,
autosave starvation cap, §138.1 single-doc sync.
**Worst harm.** Silent data loss (CC-4) — the single highest-harm finding in the campaign under the
harm model. **Leverage: high** — CC-4's fix is S-sized *and* ships a projection-completeness CI
assertion (every `DOC_PREFIX_ROOT` slot has exactly one projection consumer) that prevents the entire
write-only-slot class. CC-2's back-write removal + cache-clear-on-switch kills both the storm and the
stale-bleed.

### WS-7 — DSP quality-bar unification
**Root cause.** Golden-standard DSP techniques **exist in-crate** (Gluten's Giannoulis ballistics,
Bacteria's 5th-order elliptic half-band oversampling, Toaster's ADAA, Fermenter/Crumbs TPT SVF,
ProofChamber denormal flush) but are **applied unevenly** across the ~14 device families.
**Members:** **DSP-1** (Proof limiter advertises true-peak/dBTP but detects sample peak only — no
oversampled limiting path; couples with **OE-1**/**OE-7** export clipping), **DSP-2** (denormal flush in
only 3 of ~11 families, no FTZ anywhere → wasm feedback paths exposed), **DSP-3** (Grinder tube stages
fake oversampling with a 2-point box average while siblings ship real polyphase/ADAA), **DSP-4** (Proof
EQ/dyn-EQ swap biquad coefficients instantly → zipper under the new offline automation driving; couples
with the WS-1 automation cluster), **DSP-5** (DF-I biquad topology), **DSP-6** (fixed one-pole limiter
release), **DSP-7** (linear-phase EQ FIR redesign may allocate on the RT thread — open), **DSP-8** (no
NaN/Inf sanitization at the wasm output boundary — one NaN poisons the downstream graph; compounds
**WB-6**), **DSP-9** (two divergent, magic-numbered denormal thresholds).
**Worst harm.** Deliverable corruption (DSP-1 inter-sample clipping into the encoder) + engine-wide
xruns (DSP-2). **Leverage: medium** — a shared `flush_denormal` primitive (DSP-2/DSP-9) and a shared
`sanitize_block` output guard (DSP-8) are S-sized cross-family wins; DSP-1's true-peak path directly
improves export headroom (OE-1/OE-7).

### WS-8 — Honest-surface debt (UI claims the code does not honor)
**Root cause.** User-facing controls that write state nothing consumes, or advertise capabilities the
engine does not provide.
**Members:** **TS-1** (Blocker — ElasticAudio dropdown advertised zplane élastique / Rubber Band branded
engines over plain resample; **FIXED PR #709**, plus a third branded palette command the audit missed),
**FX-3** (Routing Matrix panel writes `routingMatrixStore` that no engine code reads — every toggle a
no-op), **MD-2** (MPE dead control — also in WS-3), **TS-3** (full warp-marker editor over inert
in-memory data — no warp map, no scheduler consumer, lost on save), **PH-6** (VST3 shown "active" while
silently passing through), **PH-9** (vendor-GUI-only control path), **OE-8** (FLAC silently emits 16-bit
regardless of the user's bit-depth selection), **AU-8** (`virginTerritory` UI-only, no playback effect),
**AU-9** (`lane.enabled` enforced by neither apply path).
**Worst harm.** Dead controls actively mislead (ranked above honest absence). **Breadth:** anyone who
opens the affected panel. **Leverage: high, low cost** — most are S/M "wire it or retire it" decisions;
TS-1 proved the pattern (honest availability metadata + hide until a real backend exists).

### WS-9 — Real-time-thread hygiene
**Root cause.** The RT-correct patterns exist in-repo (Grinder's cached views + a-rate `AudioParam`,
Proof's seqlock, GrandBoule's lock-free ring) but are not uniformly adopted.
**Members:** **RT-1** (per-quantum `Float32Array` view allocation in 7 of the WASM processors — the exact
rule is written into `kneadProcessor.ts` then violated elsewhere), **RT-2** (telemetry seqlock in only
1 of 5 SAB devices → torn reads), **RT-3** (Fermenter `postMessage` + allocation from inside
`process()`), **RT-7** (cache-at-init processors don't revalidate views on `memory.grow()` — a
correctness precondition for the RT-1 fix), **RT-9** (non-atomic scalar meter — deliberate, needs a
note), **RT-10** (no xrun/dropout observability → RT-1/RT-3 glitches leave no trace), **DSP-7** (RT-thread
FIR allocation — shared concern), **WB-7** (unbounded non-shared wasm memory; growth off the render
callback today).
**Worst harm.** Intermittent audio dropouts (GC on the render thread) — wrong monitoring, undiagnosable.
**Leverage: medium** — adopt the knead/grinder cached-view pattern *with* buffer-identity revalidation
across the seven processors as one reviewable RT invariant; RT-10's counter makes the rest measurable.

---

## 3. Sequenced remediation program

Waves are dependency-ordered. Sizes are the area artifacts' own S/M/L. **S-sized quick wins** and
**L engine-work** are called out per the mission. Each item lists the findings it retires.

### Wave 0 — Already landed / in flight (honest-surface + data-loss quick wins)
- **FX-1** (Blocker, S) — offline sidechain wired once. **DONE — PR #703 merged.** Red-first proof:
  key-edge count 2→1.
- **TS-1** (Blocker, S/M) — third-party-branded warp surface removed; honest availability metadata.
  **DONE — PR #709 merged.**
- **CC-4** (Blocker, S) — register `modulationStore` projection + projection-completeness assertion.
  **IN FLIGHT.** *This is the highest-harm finding in the campaign (silent data loss) and must close
  the wave.*

### Wave 1 — Stop-the-bleeding: S-sized data-loss + build-integrity + dead-control fixes
Highest harm-per-effort; several are preconditions for later waves.
- **WB-1 + WB-2 + WB-3 + WB-8** (M/S) — wasm rebuild-and-diff **fingerprint gate**, remove the stale
  `5549…` twin, assert the glue `.replace` matched exactly once, pin the CLI trio + exact
  `wasm-bindgen`. *Precondition for all WS-7 DSP work.* **Quick-win anchor.**
- **PH-3** (M) — wire `get/set_plugin_state` into project save/load; store the chunk in project truth;
  missing-plugin placeholder. *Stops persisted-project plugin-state loss.*
- **OE-2** (S) — collision-free stem filenames (key off the unique `track.id`). *Stops silent stem
  overwrite.*
- **FX-3** (M) — wire the Routing Matrix to `setSend`/`setTrackOutput` **or** retire the panel
  (product decision first — see Open Questions). **DSP-8** (S) + **WB-6** (S/M) — shared
  `sanitize_block` NaN/Inf output guard and `console_error_panic_hook` + `panic="abort"`, so a bad
  block surfaces instead of invisibly poisoning the worklet.
- **WB-4** (M) — regenerate the `.d.ts` in the gen scripts (as proof-chamber already does).

### Wave 2 — Single-source-of-truth parity substrate (WS-1) — the flagship architectural investment
- **AU-1** (M) — collapse the two curve implementations to one shared evaluator; restore the
  cross-conformance test #616 deleted. **Quick structural win with a permanent gate.**
- **OE-4** (M) — close the store-vs-engine solo split: an effective-audibility (mute ∪ solo) read model
  both `applySoloLogic` (live) and the offline paths consume.
- **OE-3** (M/L) — route offline device-param automation through one capability every automatable device
  implements + a coverage assertion (no more hardcoded allow-list + 3 opt-in nodes).
- **AU-2 / AU-3 / AU-12** (M) — give offline the live device-param smoothing, follow linked lanes
  offline, confirm/close clip-scoped automation offline.
- **RT-5** (M/L) — apply `getCompensationDelay` to live automation and move continuous automation onto
  sample-accurate `AudioParam` (Grinder's a-rate path is the template) — the live half of parity.
- **TS-10** (M) — offline stretch parity adapter (rides the same segment map once WS-8/stretch lands).
- **AU-4** (S) — reset the automation slew on seek/loop discontinuity (kills the ~90 ms glide at every
  locate). **AU-5** (M) — thin recorded gestures on flush; dedupe the two RDP implementations.

### Wave 3 — PDC end to end (WS-2)
Depends on PH-4 (Wave 1-adjacent) reporting real latency.
- **PH-4** (M) — query `CLAP_EXT_LATENCY`, provide `clap_host_latency`, implement `request_restart`,
  thread the value into `externalLatencyRegistry`.
- **RT-4** (M) — native plugin latency into PDC (rides PH-4).
- **FX-4** (L) — insert per-track live-PDC `DelayNode`s driven by the same `getCompensationDelay`; one
  PDC path live and offline. **FX-5** (M) — sidechain key alignment on that path. **RT-6** (M) —
  document/estimate the `DynamicsCompressorNode` latency constant.

### Wave 4 — Freeze/bounce real-synth convergence (WS-3) — L engine-work
- **MD-4 + MD-2** (Blocker remediation, L) — converge freeze/bounce onto `AudioEngine/renderOffline.ts`
  through the real instrument nodes; give worklet instruments a per-note expression surface used by both
  live (`handleWebMidi*`) and scheduled (`scheduleMidiNotes` mpe branch). Retires both MIDI Blockers.
- **MD-1 / MD-3** (M) — thread `event.timeStamp` into an output-side schedule-ahead; one ordered queue
  for note + expression events (drop the sync/async split).

### Wave 5 — DSP quality-bar unification (WS-7) — gated behind Wave 1's fingerprint gate
- **DSP-2 + DSP-9** (M/S) — one shared `flush_denormal` primitive across feedback families.
- **DSP-1** (M) — oversampled true-peak limiting path (improves OE-1/OE-7 export headroom).
- **DSP-4** (M) — coefficient smoothing/crossfade on Proof EQ/dyn-EQ (now driven continuously by
  offline automation).
- **DSP-3** (M/L) — route Grinder tube ODE through real polyphase OS or ADAA.

### Wave 6 — RT-thread hygiene (WS-9)
- **RT-1 + RT-7** (M) — adopt cached views **with** buffer-identity revalidation across the seven
  processors; make "no view allocation in steady-state `process()`" a reviewable RT invariant.
- **RT-3** (S) — move Fermenter telemetry to a SAB slot. **RT-2** (M) — apply the Proof seqlock to the
  other four devices (or downgrade the documented guarantee). **RT-10** (M) — dropout/xrun counter
  through `getHealth()`. **RT-8/RT-9** (S) — re-arm resume listeners; annotate the scalar-meter choice.

### Wave 7 — Export delivery + IPC robustness
- **OE-1 + OE-8** (M) — single shared float→PCM stage (gain/normalize + TPDF dither on any bit-depth
  reduction) all three encoders consume; thread bit-depth through FLAC. **OE-5 = WB-5 = M-109** (S/M) —
  replace `Array.from(bytes)` with a Tauri byte channel / raw request body.
- **OE-6 / OE-11** (M) — segmented `suspend()` render with real cancel + honest progress.
- **OE-7 / OE-9 / OE-10** (S/M) — optional R128/true-peak stage (rides DSP-1), device-declared tails,
  seeded/no-dither option.

### Wave 8 — CRDT projection architecture (WS-6) — beyond the CC-4 quick win
- **CC-2** (M) — remove the `hydrate()` back-write; give every slot a `hydrateMissing` default; clear
  project-store caches on authority switch (kills the re-entrant storm and stale-bleed).
- **CC-1** (M) — incremental per-slot projection; skip re-projection for local-origin writes; identity/
  heads check before `JSON.stringify`.
- **CC-3** (S) — scope replay-authority invalidation to touched docs/entries. **CC-8** (M) — offload
  `save`/compaction to the CRDT worker. **CC-6/CC-5/CC-7** (S/M) — conflict-aware undo replay; fix the
  discard/prepare-failure terminals.

### Wave 9 — In-house time-stretch engine (WS-8 remainder) — L engine-work
Per `SPEC-time-stretch-engine` run-order (AC-016 dependency gates).
- **TS-5** (L) — adapt the Crumbs PV/WSOLA seeds behind the streaming contract: FFT not DFT, stereo,
  preallocated `process()`, transient/phase reset (Röbel), differential goldens (AC-004/005/006).
- **TS-3** (L) — `buildWarpMap`/`validateWarpMap`, move warp state off the in-memory `Map` onto the CRDT
  write path (AC-010/011; also a WS-6 concern), migrate the four stretch vocabularies (**TS-11**).
- **TS-4** (L) — `ElasticAudio/engine/` worklet surface where PV/WSOLA become honestly selectable.
- **TS-6 / TS-7 / TS-8** (M) — restore true stereo in Knead offline commit, give `clip.fileId` a
  producer, fix the unvoiced L→R replacement.

### Wave 10 — Plugin-host L efforts (WS-4 remainder)
- **PH-2 + PH-1** (Blocker/Major, L) — out-of-process scan + host boundary + denylist per AC-002.
  *Known/accepted debt (Decision 0003 non-goal); largest blast radius — schedule deliberately, not by
  default.* **PH-7** (M) — instantiation error-slot + retry (Decision 0003). **PH-5** (L) — SAB rings
  replace per-block IPC (AC-003/011/012). **PH-6** (M) — VST3 COM processing or visibly non-processing.
  **PH-8/PH-9/PH-11** (M) — audio-thread start/stop_processing, consume output events, forward
  transport. **PH-10/12/13/14** (minor/polish).

### Wave 11 — Ergonomics & polish
- **FX-2** (M, self-send/cycle guard), **FX-6** (S, bus-removal reconciliation), **FX-7** (M, dB/
  equal-power laws), **FX-8** (M, pre-fader send mute/solo policy), **FX-9** (S/M, stem sidechain
  policy). **MD-5/6/7/8** (S/M, MIDI re-emit-on-edit, panic, 14-bit CC, RPN bend range). **AU-6…AU-11**
  (AutoMatch, 'off' restore, virginTerritory, lane.enabled, gain-clamp intent, base unification).
  **DSP-5/6/7** (topology, program-dependent release, RT FIR alloc). **WB-7/WB-9** (memory bound,
  UTF-8 polyfill). **CC-9** (recording durability window).

### Top-5 sequenced items (the leading edge)
1. **CC-4** — register the `modulation` projection + projection-completeness CI assertion (S). *Silent
   data loss, highest harm class, S-sized, kills the write-only-slot class. In flight.*
2. **WS-5 build-integrity gate: WB-1 (+WB-2/WB-3/WB-8)** — wasm rebuild-and-diff fingerprint gate (M).
   *Kills the #657 recurrence class; precondition for safe DSP work.*
3. **WS-1 parity substrate: AU-1 + OE-4 + OE-3 (+AU-2/AU-3/RT-5)** — one shared evaluator both runtimes
   consume, with a conformance gate (M–L). *Retires the largest cross-artifact cluster; deliverable
   corruption + wrong monitoring across every mix.*
4. **WS-2 PDC: PH-4 → RT-4 → FX-4** — report native latency, feed PDC, add the live `DelayNode` path
   (M→L). *One substrate fixes RT-4/FX-4/FX-5/RT-6; wrong-monitoring flam on every latency-bearing
   session.*
5. **WS-3 freeze/bounce real-synth: MD-4 + MD-2** — converge freeze/bounce onto the real instrument
   nodes with a per-note expression surface (L). *Retires both MIDI Blockers; deliverable corruption on
   every non-drum MIDI instrument freeze/bounce.*

---

## 4. Scorecard

Grades are against each area's own golden standard (A = first-class throughout; F = broken on common
paths). "Fixed" reflects merged/in-flight remediation, not the artifact-of-record counts.

| Area | Blk | Maj | Min | Pol | Fixed already | Top item | Grade |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Offline export | 0 | 5 | 5 | 1 | — | OE-1 per-format loudness divergence | **C** — no Blocker; verified master-chain parity (§2a), but per-format level/clip divergence corrupts deliverables |
| MIDI handling | 2 | 2 | 3 | 1 | — | MD-4 freeze/bounce triangle stub | **D** — two Blockers reach deliverable audio + a dead MPE control, atop a genuinely sample-accurate scheduler |
| Automation | 0 | 5 | 7 | 0 | — | AU-1/AU-2 live↔offline drift | **C−** — dual curve/slew implementations with no conformance gate; monitor ≠ bounce |
| DSP engines | 0 | 4 | 4 | 1 | — | DSP-1 sample-peak "true-peak" limiter | **B−** — golden-class DSP exists in-crate (Gluten/Bacteria/Toaster) but applied unevenly |
| RT engine core | 0 | 5 | 4 | 1 | — | RT-1 per-quantum heap allocation | **B−** — strong substrate (single context, two-clocks scheduler, GrandBoule ring); RT-clean pattern not uniformly adopted |
| Effects & routing | 1 | 3 | 5 | 0 | **FX-1 (PR #703)** | FX-3 dead Routing Matrix / FX-4 live-PDC gap | **C** (**C+** post-fix) — Blocker retired; dead control + live/offline PDC asymmetry remain |
| Rust/WASM boundary | 0 | 5 | 3 | 1 | — | WB-1 no wasm freshness gate | **C−** — #657 drift class can recur silently; stale twin binary still tracked |
| Plugin hosting | 1 | 8 | 4 | 1 | — | PH-2 no crash isolation (audio-thread inline) | **D** — spec exists, largely unimplemented; largest blast radius; CLAP partially works, VST3 is passthrough |
| Time-stretch & pitch | 1 | 5 | 4 | 0 | **TS-1 (PR #709)** | TS-3 inert warp editor | **D+** (**C−** post-fix) — 16/19 ACs absent; but Knead PSOLA/YIN pitch is golden-class (TS-9) |
| Collab/CRDT | 1 | 3 | 4 | 1 | **CC-4 in flight** | CC-4 write-only modulation slot | **B−** — 5 axes confirmed sound, disciplined write path; one silent-data-loss Blocker, projection storm |

Campaign posture: **no area is broken across the board**; the recurring pattern is *a correct core with
an uneven or incomplete edge* — parity, projection completeness, latency reporting, and artifact
freshness are the systemic gaps rather than any single subsystem's competence.

---

## 5. Standards debt register

The ≥3-citation golden standards now on file per area, with what the repo **already meets** (verified
strengths the audits recorded — honored here, not re-litigated) vs the outstanding debt.

**Offline export (EBU R128/BS.1770, dither-once, stem tails/naming, offline↔live parity).**
- Met: master-track device chain applied in **both** runtimes (§2a, graph-topology proof).
- Debt: true-peak/loudness (OE-1/OE-7), dither-once-per-format (OE-1/OE-10), collision-free stems
  (OE-2), tails (OE-9), parity (OE-3/OE-4).

**MIDI (two-clocks lookahead, event-timestamp, sub-ms jitter, MPE per-note, note-off guarantees,
tempo-map integral).**
- Met: sample-accurate scheduled playback, note-off on stop (`stopAllScheduled`), analytically-correct
  tempo-ramp integral (`log1p` closed form), seeded deterministic probability shared live↔offline.
- Debt: event-timestamp (MD-1), MPE per-note to real instruments (MD-2), jitter budget (MD-1/MD-3).

**Automation (Write/Touch/Latch/Trim + AutoMatch, canonical param identity, zipper boundary,
interpolation parity).**
- Met: gain/pan zipper-safe via engine `setTargetAtTime`; recording modes present.
- Debt: single curve source + parity (AU-1/2/3), AutoMatch release ramp (AU-6), 'off'/virginTerritory/
  enabled semantics (AU-7/8/9), discontinuity slew reset (AU-4), record thinning (AU-5).

**DSP (denormal defense, TPT filters under modulation, Giannoulis + true-peak dynamics, oversampling
of nonlinearities, NaN hygiene).**
- Met: Gluten Giannoulis soft-knee + branching smoother; Bacteria 5th-order elliptic half-band OS;
  Toaster ADAA; Fermenter/Crumbs TPT SVF; ProofChamber denormal flush.
- Debt: cross-family denormal + FTZ (DSP-2/9), true-peak limiting (DSP-1), Grinder OS (DSP-3), EQ coeff
  smoothing (DSP-4), NaN output guard (DSP-8).

**RT engine core (no-alloc callback, SAB+seqlock telemetry, two-clocks scheduler, AudioParam
automation, PDC, single context, xrun observability).**
- Met: single live `AudioContext`; correct transport SAB seqlock; two-clocks scheduler with epochs;
  GrandBoule lock-free ring; `allNotesOff` fan-out; Grinder as the RT-clean reference processor.
- Debt: no-alloc across all processors (RT-1), seqlock coverage (RT-2), no port-send in `process()`
  (RT-3), live PDC + sample-accurate automation (RT-4/5), xrun counter (RT-10).

**Effects & routing (pre/post-fader sends, sidechain key tap, cycle prevention, PDC live+offline,
signal-flow parity).**
- Met: pre/post-fader tap honored with gap-free crossfade; offline sidechain tap matches live; device
  order deterministic across runtimes; sends/keys from a frozen track keep working (baked buffer injects
  pre-fader).
- Debt: single-wire keys (FX-1, **fixed**), cycle/self-send guard (FX-2), live control that routes
  audio (FX-3), live PDC + key alignment (FX-4/5), bus-removal reconciliation (FX-6), level laws (FX-7),
  send mute/solo policy (FX-8/9).

**Rust/WASM boundary (paired glue+binary fingerprint, initSync pre-fetched bytes, panic hook +
abort-awareness, Tauri byte IPC, reproducible toolchain).**
- Met: `--target web` + `initSync` with pre-fetched bytes cached per URL; dead #657 dirs removed;
  public-side glue/binary hashes consistent (`344f…`).
- Debt: freshness gate (WB-1), stale twin removal (WB-2), guarded glue transform (WB-3), `.d.ts`
  regeneration (WB-4), byte IPC (WB-5), panic hook (WB-6), toolchain pin (WB-8), UTF-8 polyfill (WB-9).

**Plugin hosting (out-of-process scan + denylist, thread-model contracts, pumped native editors,
lock-free RT comm, crash isolation + recovery, chunk state persistence, truthful latency).**
- Met: lock-free `PendingParameterQueue`; RT `with_process` CAS-acquire-or-passthrough; scan
  authorization policy; Faust web-plugin path functional.
- Debt: essentially the whole standard — PH-1 (scan isolation), PH-2 (runtime isolation), PH-3 (state
  persistence), PH-4 (latency), PH-5 (SAB RT comm), PH-6 (VST3), PH-7 (failure semantics), PH-8 (thread
  model), PH-9 (output events), PH-10/11/12/13.

**Time-stretch & pitch (phase-vocoder phase-locking, transient/phase reset, formant preservation,
WSOLA, warp-marker semantics, PSOLA/YIN pitch correction).**
- Met: Knead's YIN (de Cheveigné & Kawahara) + PSOLA (Moulines–Charpentier COLA) pitch DSP is
  golden-class (TS-9); RT shift preserves stereo.
- Debt: honest algorithm surface (TS-1, **fixed**), real stretch vs resample (TS-2), warp map + engine +
  persistence (TS-3/4), in-house seeds FFT/stereo/streaming/transient-reset (TS-5), Knead offline stereo
  + formants (TS-6/8), offline parity (TS-10).

**Collab/CRDT (G1 batch changes, G2 derived-incremental projection with no second writer, G3
undo/intention preservation, G4 ephemeral-channel separation, G5 heavy WASM off-thread).**
- Met (G4 fully): presence on an isolated unreliable/unordered channel; sync loop guard; unknown-doc
  rejection; autosave starvation cap; §138.1 single-doc sync; automation-recording batched write
  (avoids per-sample CRDT storm, CC-9 tradeoff acknowledged).
- Debt: projection completeness (CC-4), derived-only/incremental projection (CC-1/CC-2), undo intention
  under sync (CC-3/CC-6), save/compaction off-thread (CC-8).

---

## Anomalies (for the orchestrator)

1. **Severity-tally drift between ledger summary comments and final artifacts.** Two areas' artifact
   finding-headers do not match the counts posted in the #691 progress comments:
   - **Automation:** ledger comment says *4 Major · 8 Minor*; the artifact headers grade **AU-1…AU-5 as
     Major** → **5 Major · 7 Minor** (AU-5 "Recorded gestures never thinned" is `**major**` in its
     header and in the roadmap table). This synthesis uses the artifact (5/7).
   - **Plugin hosting:** ledger comment says *7 Major · 5 Minor*; the artifact headers grade
     **PH-1,3,4,5,6,7,8,9 as Major** → **8 Major · 4 Minor** (PH-10…13 Minor, PH-14 Polish). This
     synthesis uses the artifact (8/4). Total (14) agrees either way.
   Neither changes any ranking; flagged for ledger hygiene.
2. **CC-4 fix "in flight" has no discoverable PR yet.** `gh pr list --search "CC-4 modulation
   projection"` returns only the audit PR #707. Treated as in-flight per the mission brief; the top-5
   list assumes it lands as an S-sized projection registration + completeness assertion.
3. **Duplicate finding across three areas — the byte-IPC inflation** (`Array.from(bytes)`) is filed as
   **OE-5**, re-verified as **WB-5**, and both map to register row **M-109**. Counted once in the
   remediation program (Wave 7), cross-referenced, not triple-counted.
4. **FX audit corrected its own prompt.** The effects lane recorded that the assigned "pre-fader tap"
   hint for the offline sidechain was **incorrect** (both live and offline tap post-fader:
   `analyserNode` / `outputNode`); the finding set was re-derived from code. Noted so the correction is
   not lost.
5. **Two Blockers are remediation-verified against the artifacts, not superseded in them.** Per ledger
   policy the artifacts remain the finding-of-record for FX-1 and TS-1 even though the code is fixed;
   the scorecard's "Fixed already" column carries the post-fix status while the counts stay at
   artifact-of-record values.
