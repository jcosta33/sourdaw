# Slicer Plugin UX

## Context

> **Codebase Annotation:** The Slicer plugin is **Completely Missing**. The word "Slicer" appears only in unrelated preset names. There is no frontend module, no Rust DSP, and no user-facing workflow for the "drop a loop → auto-slice → play on a 16-pad grid" interaction.

Relevant research: `.agents/research/factory/samples-slicer.md` (Section 2).

The Slicer is a distinct instrument from both the **drum machine** (`drum-machine.md`) and the **unified sampler suite** (`unified-sampler-suite.md`):

- The drum machine is a sound-design environment: per-pad synth engines, multi-layer sampling, deep modulation, and a 5-level progressive-disclosure UI.
- The unified sampler suite is a four-mode playback engine (Quick/Drum/Slice/Warp) that provides the shared voice pool and DSP primitives used by all sample-playing devices.
- The **Slicer** is the **opinionated workflow layer on top of the suite's Slice mode**: drop a loop, instantly play its slices on a 16-pad grid, sequence them with per-step parameter locks, route each slice to its own mixer channel. This is the Ableton Simpler "Slice to New MIDI Track" / MPC chop workflow done properly as a native plugin.

The Slicer reuses:
- The onset-detection algorithms in `unified-sampler-suite.md` Requirement 4 (SuperFlux / HFC / Complex Domain).
- The voice pool, disk streamer, and waveform mipmap infrastructure from the suite.
- The step sequencer primitives from `drum-machine.md` Part 3 (parameter locks, conditional triggers, swing).

It does NOT duplicate any of those. This spec defines what is new: the multi-block UI, the drop-loop-to-playable-pads workflow, the sensitivity slider behavior, dual-color markers, per-slice routing, and advanced Lab-tier algorithms.

---

## Goal

Deliver a Slicer plugin that converts any dropped audio loop into a playable 16-pad instrument in under one second with zero user configuration, surfaces a live sensitivity control that adds/removes slices deterministically, provides per-slice routing and sequencing, and exposes advanced transient/stretch algorithms in a collapsible Lab block.

---

## User-visible behavior

- **Drop-to-play in < 1 s** — drop an audio file into the Slicer; transient detection runs, slice markers auto-place, and the first 16 slices map to a playable pad grid. Hitting pad 1 plays slice 1 immediately.
- **Sensitivity slider is the primary control** — one knob sweeps from "fewer, confident slices" to "many, sensitive slices". Dragging it live updates the marker count monotonically. Drop-to-play uses a sane default (midpoint).
- **"Suggest" button** — a secondary action runs an ML-assisted pass that proposes slice points the threshold sweep missed (e.g. soft onsets, transients inside dense passages). Suggested markers appear in the manual color and can be individually accepted or rejected.
- **Dual-color markers** — auto markers are one hue (e.g. blue), manual/locked markers are another (e.g. orange). Locked markers are NOT moved or removed by sensitivity changes.
- **12-hue waveform palette** — slices are colored using a 12-hue palette that matches the pad colors; the waveform region under a pad is tinted the same color as that pad. Makes visual-to-tactile mapping obvious.
- **Draggable slice handles with zero-crossing snap** — dragging a marker snaps to the nearest zero-crossing within ±8 samples to prevent clicks.
- **16-pad grid** — default 16 pads (4×4). Velocity-sensitive. Per-pad tuning, envelope (ADSR), and gain controls.
- **16/32-step sequencer** — per-pad velocity, pitch offset, step retrigger (stutter), Roger Linn-style swing. Generative Chaos/Randomize buttons.
- **Per-slice routing** — each slice can be routed to a different DAW mixer channel; choke groups silence one pad when another triggers; velocity zones select between alternate slice variants.
- **Lab block (collapsible)** — switches transient-detection algorithm, per-slice time-stretch, REX2 import, "Send to Toaster".

---

## Scope

### In scope

- **Frontend module** `src/modules/Slicer/` containing the multi-block UI, state stores, interaction logic, and view composition.
- **Five UI blocks** arranged vertically in progressive-disclosure order: Play & Macros, Generators & Layers, Sequencing & Build, Routing & FX, Advanced / Lab.
- **Drop-to-play pipeline** binding to onset detection in `daw-dsp` (reuse from unified sampler), sensitivity threshold mapping, and zero-crossing refinement.
- **Dual-color marker model** with auto vs. manual/locked classification persisted in the plugin state.
- **Per-pad controls** (tune, ADSR, gain) that drive the shared sampler voice engine — no new voice code.
- **Step sequencer** wiring reusing the drum-machine sequencer primitives (parameter locks, conditional trigs, swing).
- **Per-slice routing** via the DAW's existing mixer-channel/bus routing — not a new mixer.
- **"Suggest" AI detection** hook point with a deterministic rule-based implementation (onset-type heuristic) for v1; pluggable for an ML model later.
- **12-hue palette** design tokens and integration into the waveform renderer.
- **REX2 import path** (file-level only — decode + map slices into the Slicer state).
- **"Send to Toaster"** action that hands off all slices as a multi-sample pad kit to the drum-machine/Toaster sampler.

### Non-goals (explicitly out of scope)

- **Voice engine / RT DSP** — owned by `unified-sampler-suite.md`. The Slicer drives the engine; it does not reimplement it.
- **Onset-detection algorithms themselves** — owned by the sampler suite spec. This spec specifies the control surface and defaults.
- **Drum synthesis** — owned by `drum-machine.md`. The Slicer only plays back sliced audio.
- **ML model training** — "Suggest" ships with a heuristic; an actual model is a follow-up spec.
- **Multi-track slicing / spectral separation** — entirely out of scope.
- **Loop quantization to project BPM** — reuses existing warp-clip quantization; not a new system.
- **Time-stretch DSP** — uses algorithms already in the sampler suite (WSOLA, Phase Vocoder). The Lab block switches between them.

---

## Requirements

### R1 — Multi-block UI architecture

The plugin view consists of 5 vertically stacked blocks, each independently collapsible. Only block 1 ("Play & Macros") is expanded by default.

- **Block 1 — Play & Macros**: the drop zone, the waveform with slice markers, the 16-pad grid, the sensitivity slider, the "Suggest" button, macro knobs (tune, decay, filter color, swing).
- **Block 2 — Generators & Layers**: per-pad sample source (primary slice + up to 3 alternate layers for velocity zones or round-robin), per-pad tuning, envelope (ADSR), per-pad gain and pan.
- **Block 3 — Sequencing & Build**: 16/32-step sequencer grid. Per-step: velocity, pitch offset, retrigger count (stutter), probability, parameter locks (Elektron-style). Swing knob (Roger Linn mapping). Chaos / Randomize buttons.
- **Block 4 — Routing & FX**: per-pad output routing (master, bus, direct-out to DAW channel), choke groups (at least 16), velocity zone mapping, per-pad FX slot chain (reuses existing FX primitives; this spec does not define new FX).
- **Block 5 — Advanced / Lab**: transient-detection algorithm selector (HFC, Spectral Flux, Complex Domain), per-slice time-stretch algorithm (off, Resample, WSOLA, Phase Vocoder), REX2 import button, "Send to Toaster" button, zero-crossing snap strength.

**Acceptance:**
- AC1: Each block renders independently; collapsing block N MUST NOT affect any other block's state or DOM beyond its own body.
- AC2: The full plugin mounts and renders within 150 ms of being added to a track (first paint, not counting loaded sample decode).
- AC3: All block interactions are keyboard-accessible (tab order, arrow-key parameter adjustment).

### R2 — Drop-loop auto-slice

- Dropping an audio file into the Slicer's drop zone MUST: (a) decode the file off the UI thread, (b) run onset detection using the default algorithm (SuperFlux, shared from unified sampler suite R4), (c) refine each onset to the nearest zero-crossing (±8 sample window), (d) place up to 64 slice markers, (e) map the first 16 slices to pads 1–16 in order, (f) render the waveform + markers + pad assignments.
- The full pipeline MUST complete within **1000 ms** on a 2 MB (≈10 s stereo 44.1 kHz) loop on a 2020-era laptop, from drop event to first-pad-playable.
- If the file has > 16 detected slices, slices 17+ MUST remain visible on the waveform but unmapped; the user can drag them onto pads.
- If the file has < 16 detected slices, unmapped pads MUST display an empty state (no silent triggers).
- Re-dropping a second file MUST replace the current state cleanly with a single undo step — no leftover markers from the previous drop.

**Acceptance:**
- AC1: Dropping a 10 s drum loop produces a playable kit within 1000 ms on a reference laptop (measured, checked in as a perf test).
- AC2: Pad 1 triggers the correct slice (from slice-1-start to slice-2-start) — verified by offline render comparison to the source file.

### R3 — Sensitivity slider

- The slider value $s \in [0, 1]$ MUST map monotonically to a threshold $\tau(s)$ over the pre-computed onset-strength signal. Lower $s$ = higher $\tau$ = fewer slices.
- Adjusting the slider MUST update the slice markers in real time (≥ 30 Hz visual update) without re-running onset detection — only the peak-picking threshold changes.
- **Monotonicity guarantee**: for any $s_1 \leq s_2$, the set of auto-slices at $s_1$ MUST be a subset of the set at $s_2$. Moving the slider higher never drops an auto-slice while adding others.
- **Locked markers are immune** to the slider: moving the slider does not add, remove, or move any marker in the manual/locked set.
- The slider's range endpoints MUST correspond to: $s=0$ → 1 slice (full loop, no internal cuts); $s=1$ → up to 64 slices bounded by the onset count the ODF produced.

**Acceptance:**
- AC1: Dragging the slider from 0 → 1 produces a slice-count sequence $n_0 \leq n_1 \leq \ldots \leq n_k$ (monotonic, verified by property test).
- AC2: Locking 3 markers manually then sweeping the slider from 0 → 1 → 0 leaves those 3 markers untouched (exact equality check pre/post).
- AC3: The slider maintains ≥ 30 Hz marker redraw rate while dragging on a 60 s source file.

### R4 — "Suggest" AI detection

- The "Suggest" button MUST run a secondary detection pass using an algorithm complementary to the currently-selected ODF (e.g. if SuperFlux is active, Suggest runs Complex Domain + onset-type heuristic).
- Suggested markers MUST appear in a distinct visual state ("proposed") — a third color/style that is neither the auto hue nor the manual hue — with per-marker `Accept` / `Reject` affordances.
- Accepted suggestions become manual/locked markers. Rejected suggestions are discarded and do NOT reappear on subsequent Suggest runs (session-scoped — reset on file drop).
- The v1 implementation of Suggest MUST be deterministic: given identical file bytes, ODF settings, and internal state, the same suggestions MUST be produced.
- The interface MUST be pluggable so a future ML model (transient + onset-type classifier) can replace the v1 heuristic without changing the UI surface.

**Acceptance:**
- AC1: Running Suggest on a loop with soft onsets (e.g. a vinyl breakbeat) proposes at least one marker that the sensitivity-slider pass did not produce at its default position.
- AC2: Rejecting a suggestion then re-running Suggest does NOT re-propose the same marker.

### R5 — Dual-color markers

- Every marker has a `kind: Auto | Manual | Proposed` enum and is rendered with a distinct color.
- Markers created by the sensitivity slider are `Auto`. Markers created by dragging a new handle onto the waveform, or by accepting a Suggest, are `Manual`.
- `Auto` markers MUST be convertible to `Manual` via a "Lock" action (right-click or a lock toggle) — this is the path users take to protect a marker before adjusting sensitivity.
- `Manual` markers MUST be convertible back to `Auto` via "Unlock", returning them to the sensitivity-controlled set.
- The colors MUST be WCAG AA contrast against the waveform background in both light and dark themes.

**Acceptance:**
- AC1: Locking an Auto marker changes its color immediately and excludes it from future sensitivity sweeps.
- AC2: Unlocking a Manual marker re-includes it in the sensitivity set only if its position matches an ODF onset (with a small tolerance ±16 samples); otherwise it remains but is flagged as orphaned.

### R6 — Per-pad controls

Each of the 16 pads exposes:
- **Tune** — coarse semitones (−24 to +24) + fine cents (−100 to +100).
- **Envelope** — A/H/D/S/R (attack, hold, decay, sustain, release). Defaults: 0/0/200 ms/0/20 ms (one-shot-friendly). Reuses the sampler suite's AHDSR engine (R5 of `unified-sampler-suite.md`).
- **Gain** — per-pad gain in dB, −inf to +12.
- **Pan** — −1.0 to +1.0 (left/right).
- **Playback mode** — `OneShot`, `Gated`, `Loop`, `Reverse`.

All parameter changes MUST be automatable by DAW automation lanes. All parameters MUST be persisted in the plugin's preset format.

**Acceptance:**
- AC1: Adjusting Tune by +12 semitones on pad 1 doubles playback speed and raises pitch by an octave (verified by pitch-detection in offline test).
- AC2: Envelope change does NOT introduce allocation on the audio thread (tested via `assert_no_alloc` in debug builds).

### R7 — 16/32-step sequencer

- Sequencer resolution: 16 or 32 steps per pattern (user-selectable).
- Per-step data: `active`, `velocity` (0–1), `pitch_offset_semitones` (−12 to +12), `retrigger_count` (0–8; 0 = normal, 1+ = stutter), `probability` (0–1), up to 4 `parameter_locks` (sparse overrides on any pad parameter).
- **Swing**: a single knob implementing Roger Linn's MPC-style swing mapping (50% = straight, 50–75% range) applied to alternating 8th or 16th notes.
- **Chaos / Randomize**: two distinct actions. `Randomize` fully regenerates velocities/probabilities with sensible distributions. `Chaos` applies a bounded jitter (± microtiming, ± velocity ≤ 20%) without destroying the existing pattern.
- Patterns MUST be undoable as atomic operations (Randomize = one undo step).

**Acceptance:**
- AC1: A 16-step pattern at 120 BPM with pad 1 on every step produces 8 hits/second on playback (verified by offline render).
- AC2: Swing 62% on a pattern with hits on every 16th note shifts alternating hits to the mathematically correct position within ±1 sample at 48 kHz.
- AC3: A parameter lock on step 5 that sets pad 1 Tune to +7 produces a single perfect-fifth-up hit on that step and unaffected hits on steps 1–4 and 6+.

### R8 — Per-slice routing

- Each pad MUST expose an output routing selector: `Master`, `Bus 1–8`, `Direct Out 1–16` (the last routes to a separate DAW mixer channel).
- The plugin MUST declare up to 16 direct-out channels to the DAW; the DAW's mixer is responsible for actually rendering those channels — this spec only requires the plugin's side of the contract.
- **Choke groups**: 16 groups (0 = none). Triggering a pad in group `g ≠ 0` MUST silence all currently-playing voices of OTHER pads in the same group with a 5–10 ms linear fade-out (reuses drum-machine voice manager).
- **Velocity zones**: each pad supports up to 4 zones with `[v_lo, v_hi]` ranges, each mapping to a different slice or alternate layer. Zones MUST be non-overlapping in the v1; overlap support is a v2 concern.

**Acceptance:**
- AC1: Routing pad 1 to Direct Out 3 and playing it produces audio on DAW channel "Slicer / Out 3" and silence on Master.
- AC2: Pads 5 and 6 in choke group 2: triggering 5, then 6, cuts pad 5 within 10 ms (measured at the output).
- AC3: Velocity zone v∈[0,63] = slice A, v∈[64,127] = slice B: hitting with v=63 produces A, v=64 produces B.

### R9 — Advanced transient algorithms (Lab)

- **Algorithm selector** — radio choice between `HFC` (percussive), `Spectral Flux` (general), `Complex Domain` (melodic). Default: Spectral Flux. Changing algorithm re-runs detection on the current file and updates auto markers (manual markers untouched).
- **Per-slice time-stretch** — each slice has a `stretch_algo: None | Resample | WSOLA | PhaseVocoder` setting. `None` = natural playback. `Resample` = pitch-tied-to-speed (classic sampler). `WSOLA` = transient-preserving, pitch-independent. `PhaseVocoder` = frequency-domain, tonal-friendly.
- **REX2 import** — importing a `.rx2` file MUST decode its slice metadata, use REX2 slice markers as `Manual` markers (not sensitivity-controlled), and preserve the original slice assignment order to pads.
- **"Send to Toaster"** — an action that hands off all current slices as a multi-sample pad kit to the drum-machine/Toaster sampler: each slice becomes one pad, per-pad tune/envelope/routing copied, and the Slicer is optionally closed. The action MUST NOT destroy the Slicer's state — it is a copy, not a move.

**Acceptance:**
- AC1: Switching from Spectral Flux to HFC on a percussive loop produces at least as many transient-confident markers (HFC has higher specificity on percussion).
- AC2: Setting pad 3 to `PhaseVocoder` and pitching it down 12 semitones preserves duration (offline render length within ±1 ms of original).
- AC3: Importing a REX2 file with 32 slices produces exactly 32 markers; the first 16 are pad-mapped; slice 1 plays the REX2's slice 1.
- AC4: "Send to Toaster" on a 16-slice state produces a 16-pad Toaster kit with matching tune/envelope — verified by preset diff.

### R10 — Waveform display

- Waveform MUST render using the shared mipmap infrastructure (`unified-sampler-suite.md` R4 waveform peaks).
- **12-hue palette** — a single palette table (12 entries) MUST be defined as CSS custom properties in `@theme` (`--color-slicer-hue-0` through `--color-slicer-hue-11`). Pad N is assigned `hue (N % 12)`. The waveform region under pad N is tinted that hue at ~25% alpha.
- **Draggable slice handles** — each marker has a 12 px wide hit zone around its x position. Dragging snaps to the nearest zero-crossing within ±8 samples.
- **Zero-crossing snap** MUST use the decoded sample data for the active file; if the snap target is further than ±8 samples (i.e. no zero-crossing nearby), the snap is skipped and the marker stays at the exact drag position.
- Zoom: cursor-anchored zoom via mousewheel. Maximum zoom: 1 screen pixel = 1 sample.
- **Performance**: dragging a marker MUST maintain ≥ 60 fps on a 60 s source (measured on reference hardware).

**Acceptance:**
- AC1: A marker dragged near a zero-crossing snaps to within ±8 samples of it (verified by inspecting marker position vs. sample data).
- AC2: All 16 pads have visually distinct colors drawn from the 12-hue palette (pads 13–16 reuse hues 0–3, by design).
- AC3: Waveform drag at maximum zoom (1 sample/px) maintains 60 fps on a 10-minute file on reference hardware.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`). Frontend lives in `src/modules/Slicer/`. No new Rust crate — reuses `daw-dsp` primitives and the unified sampler's voice engine.
- Audio thread MUST NOT allocate, lock, or block (inherited from sampler suite constraints).
- `pnpm deps:validate` MUST pass with zero violations after implementation.
- No `forwardRef`, no `useMemo`/`useCallback`/`React.memo` (React Compiler).
- No `&&` for conditional rendering — ternaries or early returns only.
- All per-pad/per-step/per-slice types MUST live inside `src/modules/Slicer/models/` and MUST NOT be exported across module boundaries (per `AGENTS.md` — Model isolation).
- Styling MUST use Tailwind V4 with `@theme` variables; the 12-hue palette is declared there.

---

## Design decisions

### Decision: 16 pads default

**Chosen:** 16 pads (4×4) as the default and canonical grid.
**Considered and rejected:**
- **8 pads** — insufficient for common drum-loop slicing (kick/snare/hat/OH/perc easily exceed 8 slots).
- **32 pads** — double the screen real estate for a workflow where most users use ≤16 slots; clutters the UI.
- **Variable grid (user-configurable 8/16/32)** — adds state-management complexity without a clear user demand. Can be added later if needed; 16 is the MPC-canonical starting point.

### Decision: Per-slice mixer-channel routing over global bus

**Chosen:** each pad may route to its own direct-out DAW channel.
**Considered and rejected:**
- **Single stereo bus** — trivially simple but defeats a major pro workflow (parallel-compress the kick, bus-EQ the hats). Puts the Slicer on the wrong side of the build/performance divide.
- **Internal submixer with fixed buses (Bus 1–4)** — intermediate; useful but doesn't reach the "fully exposed to DAW mixer" experience that NI Battery and Bitwig Drum Machine provide and users expect.

### Decision: Sensitivity slider with monotonicity guarantee

**Chosen:** $s \in [0,1]$ → $\tau(s)$ monotonic threshold on a pre-computed ODF.
**Considered and rejected:**
- **Re-run onset detection at every slider position** — too expensive; violates the 30 Hz real-time redraw requirement.
- **Discrete slice-count slider (snap to 8/16/32/64)** — loses the intuitive "dial in the feel" UX that is the Slicer's hook.
- **Non-monotonic thresholding** — confusing: raising the slider could drop existing slices and add new ones simultaneously, making the interaction feel random.

### Decision: Dual-color markers with Lock/Unlock

**Chosen:** `Auto` vs `Manual` classification with explicit lock/unlock.
**Considered and rejected:**
- **One-color markers with a hidden "is_manual" flag** — users can't tell at a glance which markers are slider-controlled. Leads to "why did my marker move?" confusion.
- **Auto markers always win (re-detection overwrites manual)** — destroys user edits; violates user-intent hierarchy.

### Decision: Reuse onset detection from unified-sampler-suite

**Chosen:** Slicer consumes the onset detection defined in `unified-sampler-suite.md` R4 (SuperFlux default; HFC and Complex Domain selectable).
**Considered and rejected:**
- **Slicer-specific onset detector** — would fragment the detector ecosystem and create parallel implementations for the same problem. Violates `AGENTS.md` "survey existing patterns first — do not reinvent" principle.

---

## Acceptance criteria

- [ ] Drop a 10 s loop → playable 16-pad grid within 1000 ms on reference hardware.
- [ ] Sensitivity slider sweep produces monotonic auto-slice sets (property test, 100 random files).
- [ ] Manual/locked markers are immune to the slider (property test).
- [ ] "Suggest" proposes at least one additional marker on a vinyl-breakbeat fixture file.
- [ ] Dual-color (Auto/Manual/Proposed) markers visibly distinct, WCAG AA contrast in both themes.
- [ ] All 5 UI blocks render correctly, collapse/expand independently, are keyboard-accessible.
- [ ] Per-pad Tune + Envelope + Gain + Pan + playback mode all automatable + persisted.
- [ ] 16/32-step sequencer with parameter locks, swing, randomize, chaos — all round-trip through preset save/load.
- [ ] Per-slice routing (master/bus/direct-out) visible in DAW mixer.
- [ ] Choke groups cut within 10 ms (measured on the output).
- [ ] Lab block: algorithm switch, per-slice stretch, REX2 import, "Send to Toaster" all work end-to-end.
- [ ] Waveform uses the 12-hue palette; drag snaps to zero-crossing within ±8 samples.
- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] `pnpm typecheck` passes with zero `any` escapes.

---

## Implementation notes

- **Module layout**: `src/modules/Slicer/` with standard sub-folders (`useCases/`, `events/`, `stores/`, `repositories/`, `presentations/views/SlicerView`, `presentations/components/`, `presentations/hooks/`, `models/`, `services/`).
- **State stores**: a single `sliceStore` (markers, kinds, assignments), a `padStore` (per-pad controls), a `sequencerStore` (pattern data, running state). Cross-store orchestration lives in `useCases/`.
- **Engine binding**: the Slicer pushes slice tables and pad assignments to the shared sampler engine via its existing SPSC command queue. No new RT code should be needed.
- **Waveform**: reuse the existing canvas/WebGL waveform renderer; extend it to accept a `hue` per region rather than forking.
- **REX2 decoder**: may be a thin Rust dependency (e.g. `rex-loops` if license-compatible) or a custom decoder for the public `.rx2` format subset (slice chunks only, not Propellerhead's proprietary compression). Evaluate at implementation time.
- **"Send to Toaster"**: implement as a use case `sendSlicesToToaster` in `src/modules/Slicer/useCases/` that calls into the drum-machine module's public `importPadKit` use case (cross-module, via root `index.ts` barrel only — no deep imports).
- **Testing**: property tests for monotonicity and lock-invariance; golden-render tests for slice-to-audio correctness; perf tests for the drop-to-play budget.

---

## Test plan

- [ ] Unit (Vitest): sensitivity→threshold mapping is monotonic; marker kind transitions are well-defined; sequencer parameter-lock application.
- [ ] Property (Vitest / fast-check): 100 random files — dragging the slider 0→1→0 leaves the locked marker set bit-identical.
- [ ] Integration (Vitest + mock engine): drop → slices → pad 1 plays the correct buffer range.
- [ ] Perf: drop-to-playable time < 1000 ms on reference loop file (regression test with CI-stable timing).
- [ ] Golden-render (Rust offline): a 10 s loop sliced at default sensitivity produces a known hash of boundary sample positions.
- [ ] Manual: drop a breakbeat, sweep sensitivity, lock two markers, Suggest, reject one, accept one, randomize sequencer, verify no glitches on export.
- [ ] Manual: send a sliced loop to Toaster; confirm kit shows up in Toaster with matching pad assignments and no hanging voices.

---

## Open questions

- [ ] **[CRITICAL]** Choke-group interaction with voice stealing. The sampler suite's voice-stealing priority (R2 in `unified-sampler-suite.md`) includes "choke group" as the second tier — but the Slicer adds per-pad polyphony. Scenario: pad 1 has polyphony=4 and is in choke group 2 with pad 2. Pressing pad 2 — does it kill ALL 4 voices of pad 1, or only the oldest? Semantic choice affects both UX and voice-pool sizing. Must be resolved before R8 implementation.
- [ ] **[MAJOR]** REX2 license compatibility. `.rx2` is a proprietary format (Propellerhead / Reason Studios). The slice metadata chunk is reverse-engineered in several OSS projects. Is shipping a REX2 reader in Sourdaw legally safe given the format's proprietary status? Alternatives: support only the documented subset (slice markers, PCM payload) or require users to export from Reason/ReCycle to WAV+slice-markers-JSON. Blocks R9 AC3.
- [ ] **[MAJOR]** "Suggest" algorithm for v1. Heuristic (onset-type classifier on ODF residual) is simple and deterministic but may under-propose on polyphonic loops. Do we ship the heuristic as v1 and plan an ML follow-up, or block on a usable ML model? Leaning toward heuristic v1 — documenting the decision here.
- [ ] **[MINOR]** Default number of initial auto-slices at drop. Current spec says "up to 64 markers, first 16 mapped to pads". Do we prefer a default that maps exactly 16 slices (so all pads are populated) vs. whatever the ODF produces at the default threshold? The former is "every pad plays something"; the latter is "slices reflect the file". Probably file-driven is correct but should be validated with users.
- [ ] **[MINOR]** Direct-out channel naming in the DAW mixer. "Slicer / Out 3" is clear but collides when multiple Slicer instances exist on the same track/project. Do we prefix with the track name, the plugin instance name, or require the user to rename?

---

## Tradeoffs and risks

- **"One-second drop-to-play" is a tight budget**. Decoding + onset detection + zero-crossing snap + UI render in 1000 ms on a 10 s stereo file is achievable but not generous. If we miss this budget, the Slicer loses its instant-gratification hook. Mitigation: run onset detection on a downsampled signal (22.05 kHz, mono-sum) — accurate enough for marker placement, 4× faster.
- **Sensitivity-slider monotonicity on pathological files**. Extremely quiet or extremely loud files may produce degenerate ODF distributions where the monotonicity guarantee holds but the UX is poor (the slider has a tiny "sweet spot" in the middle and either-end plateaus). Mitigation: auto-normalize the ODF before applying the threshold; document edge cases.
- **12-hue palette vs. accessibility**. Distinct hues in a 12-slot palette requires care with saturation/lightness to stay WCAG AA on both themes. Risk is that two adjacent pads become visually confusable. Mitigation: use an LCh-space palette with equal lightness and evenly spaced hues; validate with color-contrast tooling.
- **"Send to Toaster" action cross-module coupling**. Creates a direct dependency from Slicer to the drum-machine module's public use-case surface. Must route through root `index.ts` barrels and use-case functions only. If the drum-machine's import-kit surface is not yet stable, this feature may lag the rest of the Slicer — acceptable since it is additive.
- **REX2 import is a legal risk, not a technical one**. If legal clearance blocks the import path entirely, R9 AC3 is unfulfillable and we drop the feature — the rest of the spec stands.
