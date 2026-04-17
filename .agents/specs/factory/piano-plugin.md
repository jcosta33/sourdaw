# Spec: Flagship Piano Physical Modeling Plugin

## Reference research

- `.agents/research/factory/piano-plugin.md` — two-part document:
  - **Part 1 (§§1–6, lines 1–257):** strategic report — competitive landscape (must-haves, differentiators, pain points), synthesis algorithm options, deployment targets (Tauri / cpal / WASM AudioWorklet / MIDI 2.0 / VST3-CLAP-AU), three-layer architecture, lock-free param/command paths, WASM performance risk, CoOP/COEP / SharedArrayBuffer, pre-allocated voice pool scoring (§4), Rust ecosystem (`basedrop`, `nih-plug` Smoother, `assert_no_alloc`).
  - **Part 2 (§§1–20, lines 258–1301):** implementation spec — stiff string PDE (§2), hammer nonlinearity (§3), coupled strings / two-stage decay (§4), biquad modal resonator core & numerical-stability notes (§5, §5.4), soundboard options A/B/C (§6–6.4), dampers and per-register behavior (§7), pedals including repedaling catch timing (§8), sympathetic resonance (§9), phantom partials / longitudinal modes (§10), duplex scale resonance (§11), tuning and temperaments (§12), mechanical noise (§13), parameter tables (§14), Rust layout (§15), Pianoteq comparison (§16), perceptual priority ranking (§17), reference pseudocode (§18), open-source references (§19), paths to surpass Pianoteq (§20).

All equations, measured parameter tables (string/hammer/damping coefficients per note), filter coefficient derivations, ML training approaches, historical temperament offsets, and dataset links live in the research file. This spec references them by section but does not re-embed them. If an implementer needs a number, they go to the research file; if they need a requirement, they stay here.

**Citation / pointer hygiene:** Earlier drafts of this spec cited research "appendix" IDs (`A1`–`A11`) that do not exist in the current research file — the research uses numeric section IDs (`§4`, `§5.1`, `§12`, etc.) throughout. Spec references below have been updated to that scheme. Benchmark / perceptual references (MAESTRO, MAPS, Salamander, University of Iowa, PEMO, Bernays & Traube) are product/QA decisions for this spec and do not need to appear in the research file; where a spec requirement depends on data the research file does not contain, that is called out explicitly (see Open questions OQ2–OQ5).

---

## Context

Sourdaw currently has no first-party sampled or modeled piano instrument. A flagship piano is a user-visible differentiator (every DAW ships or integrates one) and exercises the full vertical slice we otherwise have no excuse to build: polyphonic voice pool, RT-safe Rust DSP, Tauri-to-WebAudio shared DSP, MIDI 2.0 plumbing, and a non-trivial plugin UI. Physical modeling is chosen over sampling because the single-codebase multi-target deployment we already committed to (native Tauri + browser WASM) cannot ship 40–240 GB of sample libraries through an `AudioWorkletProcessor`; a ~50 MB model can.

### Legal and IP constraint

All synthesis code must be clean-room, derived only from public-domain or open-license (MIT/Apache/CC) acoustic physics literature. No patented algorithm (notably Modartt's Pianoteq patent US7915515B2) may be implemented or reverse-engineered. Parameter tables cited from published research are acceptable when the publication license permits derived works; the implementer must record the license of each source in code comments next to the imported constants.

---

## Goal

Ship a physically-modeled 88-key concert-grand piano that runs from a single Rust DSP crate in two deployment targets — native Tauri (via `cpal`) and browser WASM (via `AudioWorkletProcessor`) — with a React 19 + WebGPU front-end, that is perceptually competitive with Pianoteq-tier commercial plugins on the three features listeners weight most heavily (coupled-string double decay, velocity-dependent spectral envelope, inharmonicity with stretched tuning) and that integrates cleanly with Sourdaw's arrangement, transport, and routing modules.

---

## User-visible behavior

- **Play a MIDI keyboard and hear a grand piano.** Velocity continuously modulates timbre (no audible velocity-layer jumps). Release, pedal, and mechanical noises are present and calibrated.
- **Pedals are continuous.** Sustain (CC64) supports half-pedaling and repedaling; una corda (CC67) produces an audible timbral shift; sostenuto (CC66) sustains only notes held at engagement.
- **Pitch is stretched.** Notes follow a Railsback-style curve; perfect octave doubling sounds correct, not beaty.
- **Presets load without audio glitch.** Selecting a new piano model does not click, pop, or drop voices in flight.
- **UI shows live state.** The WebGPU panel renders an interactive 3D piano (hammers and dampers animate on note events), a string-vibration view, and a spectral waterfall.
- **Footprint is small.** Full plugin installs in under 100 MB.
- **Native is richer.** Native mode offers higher polyphony and full soundboard modeling; browser mode offers a reduced-quality tier with the same parameter UI.

---

## Scope

### In scope

- Rust `daw-dsp` modal-synthesis engine (RT-safe, pre-allocated voice pool).
- Three-layer architecture: React UI / TypeScript project state (Vanilla `Store<T>`) / Rust DSP engine.
- Native Tauri integration via `cpal`; browser path via `AudioWorkletProcessor` with Rust→WASM build.
- Lock-free command path: `AtomicF32` for scalar parameters, `rtrb` (native) / `ringbuf.js` over `SharedArrayBuffer` (browser) SPSC ring buffers for structural changes.
- Coupled-string (trichord) modeling with two-stage decay, adjustable unison detuning, global sympathetic resonance bank, continuous half-pedaling, una corda, sostenuto, mechanical noise bursts.
- Inharmonicity with stretched tuning; historical temperament table (Werckmeister III, Kirnberger III, Vallotti, Young II, ¼-comma Meantone) selectable from UI.
- Hybrid attack pathway: optional sample-based attack transient (first 10–50 ms) crossfaded into modal sustain, behind a preset flag.
- MIDI 1.0 input (velocity, CC64/66/67) at v1. High-resolution velocity is expressed internally as `f32` in [0, 1] so MIDI 2.0 integration can replace the MIDI 1.0 input stage later.
- WebGPU visualization views: 3D piano, string vibration, spectral waterfall.
- Preset load / parameter change must not allocate or lock on the audio thread.

### Non-goals (explicitly out of scope for v1)

- **MIDI 2.0 UMP transport, per-note controllers, or 16-bit velocity.** The engine accepts normalized `f32` velocity so MIDI 2.0 can be added without re-engineering DSP; wiring MIDI 2.0 into the I/O stack is a later workstream.
- **VST3/CLAP/AU plugin packaging.** v1 is an internal Sourdaw instrument only.
- **User-authored piano-model marketplace or preset sharing service.**
- **User-authored velocity curve editor UI.** (Default curves only. A static set of curve presets ships; per-user curve editing is deferred.)
- **Neural post-processing layer** ("warmth" network) from the research file. The perceptual target must be met without runtime ML inference.
- **Full 2D FEM-precomputed soundboard.** v1 soundboard is a parametric biquad bank plus optional commuted-IR convolution; generating the IR via offline FEM is a follow-up task.
- **Per-note edit of all 30+ physical parameters.** v1 exposes a fixed small parameter panel (lid, hammer hardness, unison detune, sympathetic amount, mic mix, temperament). Full per-note editing is deferred.
- **Microphone positions beyond three (close / player / room).**
- **Mobile/tablet deployment.** Desktop native + desktop browser only for v1.
- **Offline rendering optimizations beyond the online-RT path.**
- **Recording, capturing, or distributing audio of any commercial reference piano.** Perceptual benchmarks use only open datasets (MAESTRO, MAPS, University of Iowa, Salamander). These datasets are a spec-level QA decision and are not documented in the research file; the license of each dataset must be confirmed at adoption time (see OQ4).
- **Phantom partials / longitudinal string modes.** Research Part 2 §10 describes the physics and ranks them #8 in the perceptual priority list (research §17); v1 relies on transverse-mode inharmonicity and the primary partial bank only. Revisit if perceptual gate (OQ3) fails.
- **Duplex-scale resonance.** Research Part 2 §11 documents the physics; deferred past v1 unless WASM/native budget allows and the perceptual gate demands it.
- **Progressive per-voice cost reduction (nonlinear → linear decay for old voices).** Research Part 1 §5.1 suggests dropping already-decaying voices to a cheaper linear-decay model to reclaim CPU; v1 uses a single quality tier per voice and relies on voice-stealing instead. Revisit if polyphony budget (OQ1) forces it.

---

## Requirements

Each requirement has at least one verifiable acceptance criterion.

### R1. Rust DSP engine is RT-safe

The `daw-dsp` piano engine performs zero heap allocation, takes no mutex locks, and does no blocking I/O on the audio thread across any supported playing scenario (idle, single note, 64-note pedal chord, preset change, temperament change).

**Acceptance criteria:**

- A test that wraps the audio callback in `assert_no_alloc` runs for 60 s of the stress scenario described in §Acceptance / Release gate and does not panic.
- All parameter paths and structural-change paths are verified: smoke test flips temperament, model preset, and sustain pedal under `assert_no_alloc`.
- `cargo test -p daw-dsp --release` passes with zero warnings from `#[deny(clippy::mem_forget, clippy::arithmetic_side_effects)]`.

### R2. Voice pool is fixed-size and lock-free

A fixed-capacity voice pool (N=256 native, N=64 WASM) holds pre-allocated voice structures. Voice state transitions (Idle / Attack / Sustain / Release / PedalSustain / Stealing) use `AtomicU32` compare-and-swap. Voice stealing uses a scored heuristic and a 1 ms exponential fade-out.

**Acceptance criteria:**

- Pool allocation is performed exactly once per engine instance at initialization; a unit test asserts the `Vec<Voice>` capacity does not change for the lifetime of the engine.
- Under a "stuck pedal" stress test — 200 MIDI note-ons within 500 ms while sustain is held — no steal produces a click audible above −60 dBFS in the output (measured by peak-hold on the transient-detection test signal).
- Same-note retrigger starts a new voice while the previous voice enters Release; both are observable in the voice-state log for at least one frame.

### R3. Inharmonicity and stretched tuning are correctly implemented

Partial frequencies follow `f_n = n · f₁ · √(1 + B · n²)` with `B` drawn from the research Part 2 §12 tuning tables and §14 string parameter tables. The piano follows a Railsback-style curve at default tuning (research Part 2 §12.1).

**Acceptance criteria:**

- For a held mf A1, mf C4, mf A4, mf C7 note sampled at steady state (t = 500 ms), the measured partial frequencies of the first 16 partials match the research Part 2 §5.1 / §12 prediction to within **±2 cents for partials up to the 8th and ±5 cents for partials 9–16**. (Measured via FFT peak-picking over a 2-second analysis window.)
- A1 fundamental sits at **−19 ± 3 cents** and C8 fundamental sits at **+35 ± 5 cents** relative to equal-tempered reference (Railsback-style stretch, research Part 2 §12.1). The exact reference envelope file ID is recorded in the test fixture; if no peer-reviewed table matches, the spec falls back to the Railsback derivation in research Part 2 §12.1 and the tolerance is recomputed from implementation variance (see OQ2).
- Historical temperament selection applies the published cent offsets (Werckmeister III, Kirnberger III, Vallotti, Young II, ¼-comma Meantone) exactly; A4 remains at 0 cents in all temperaments.

### R4. Coupled strings produce two-stage decay

String count by register follows research Part 2 §4.4 (roughly: A0–E1 single string, F1–E2 two strings, F2 and above three strings — exact boundaries deferred to the implementation's constants table). Each note is driven by its register-appropriate unison bank detuned by a user-exposed parameter defaulting to **0.3 cents**; the research Part 2 §12.3 table lists 0.5–2.0 cents as the typical synthesis range, and the spec default of 0.3 c is deliberately tighter — values up to 5 c remain available via the UI. Modal coefficients produce a distinguishable prompt (fast, ≲ 2 s) and aftersound (slow, > 5 s) decay envelope per partial, per Weinreich coupled-string theory (research Part 2 §4).

**Acceptance criteria:**

- For mf C4, the RMS envelope measured in a 1/3-octave band centered on the fundamental exhibits two distinguishable exponential decay regions: a prompt slope whose fitted T60 is in **[0.3 s, 2 s]** and an aftersound slope whose fitted T60 is in **[5 s, 30 s]** (research Part 2 §4.2 two-stage decay ranges).
- Setting unison detune to 0.0 cents eliminates the aftersound region in the same measurement (validates the coupling implementation vs a single-string path).
- Unison detune parameter is bounded by the UI to [0 cents, 5 cents]; values above 2 cents should produce an audible beating in the spectral waterfall test (qualitative visual check).

### R5. Attack spectrum varies continuously with velocity

Velocity-dependent spectral tilt is implemented per research Part 2 §3 (Stulov three-parameter hammer OR approximate velocity-dependent lowpass at excitation) such that no velocity-layer boundary is audible across the MIDI velocity range.

**Acceptance criteria:**

- Sweep MIDI velocity from 1 to 127 in 1-step increments on C4. For each step, compute the spectral centroid over the first 100 ms. The resulting centroid-vs-velocity curve is monotonically non-decreasing and has no step of more than **10%** of the curve's total range between any two adjacent velocities. (Continuous-curve test.)
- First-50-ms RMS envelope of a mf C4 note matches the decay shape of the MAESTRO reference recording for C4 at MIDI velocity 80 **within ±3 dB** across that 50 ms window (reference: MAESTRO test split, pick one recording; the exact reference file ID is recorded in the test fixture and committed).
  > Note: numerical tolerance is the implementer's best estimate; see open question OQ2.

### R6. Pedals behave continuously

Sustain (CC64) implements half-pedaling: the damping applied to each partial is a continuous function of pedal position (0–127), monotonically decreasing with pedal depth. Una corda (CC67) reduces hammer stiffness and shifts sympathetic coupling. Sostenuto (CC66) selectively sustains only notes that were depressed at the moment of engagement.

**Acceptance criteria:**

- Sweep CC64 from 0 to 127 at 1 unit/frame while holding a mf C4. The measured fundamental RMS envelope is a monotonically increasing function of CC64 between CC64 = 30 and CC64 = 110 (sigmoid-like response per research Part 2 §7 / §8 half-pedal physics). No step in the response has a derivative sign change.
- Una corda (CC67 = 127) reduces the first-partial attack amplitude of a mf C4 by **2–6 dB** relative to CC67 = 0 and increases the energy in partials 3–5 (research Part 2 §8 una corda description: 2-of-3-string strike).
- Sostenuto test: depress C4 → CC66=127 → release C4 → play E4 → release E4 → CC66=0. C4 must ring until CC66=0; E4 must decay normally on its own release. Asserted via voice-state event log.
- **Repedaling catch:** if sustain is re-engaged within **~50–100 ms** of release (research Part 2 §8.1), string energy is not fully damped compared to a longer release-then-sustain gap. Acceptance: a scripted MIDI fixture (note-on → note-off → CC64-down 75 ms later) shows the measured fundamental RMS at the re-engagement instant remains within 3 dB of a continuous-sustain reference; a 250 ms gap reference drops by ≥ 6 dB.
- **Damper absence above ~C7:** the physical piano has no dampers above roughly C7 (research Part 2 §7). In that range, notes ring freely regardless of CC64; the voice model must not attempt to damp them and the test suite asserts that C7♯+ held notes have effectively identical decay at CC64 = 0 and CC64 = 127.

### R7. Sympathetic resonance is gated and bounded

A global sympathetic resonator bank of 12–24 biquads (count configurable per quality tier) is driven by an aggregate bridge-force signal and gated by damper state. The bank never exceeds O(N) cost in active voices.

**Acceptance criteria:**

- With no notes held and sustain pedal up, sympathetic output RMS is below **−80 dBFS** (gate correctness).
- With pedal down and a single struck mf C4, sympathetic output at E5 fundamental frequency (perfect fifth harmonic relationship) is at least **6 dB higher** than at F#5 fundamental frequency (non-harmonic). This validates harmonic selectivity.
- Sympathetic CPU cost scales linearly (within 10%) with number of enabled resonators in an isolated benchmark.

### R8. Mechanical noise layer is present

Short filtered noise bursts are triggered on key-down, hammer let-off, damper lift, and pedal-down events. Each burst is shaped by an envelope and bandpass filter per research Part 2 §13 mechanical-noise parameter table.

**Acceptance criteria:**

- Playing C4 at pp (velocity 20) on a silent background, the key-down burst is audible with a peak between **−50 dBFS and −30 dBFS** and a duration of 5–15 ms.
- Toggling the "mechanical noise" master switch to off zeroes all noise-burst outputs (verified in rendered file via null test against noise-on baseline — residual must be ≤ −120 dBFS).

### R9. Presets and structural changes never glitch the audio stream

Changes to temperament, piano model, and mic configuration are sent as commands through an SPSC ring buffer. The DSP thread applies them crossfaded over multiple processing blocks without recomputing the entire voice graph.

**Acceptance criteria:**

- In a rendered 60-second capture that includes 10 temperament switches, 5 model switches, and 20 mic-config changes during active note playback, no sample exceeds the instantaneous-level delta threshold of **12 dB per sample** (click detector). Manual A/B listening on this capture shows no audible click at any switch point.
- Preset load time (model + parameter set) as measured from UI click to first audible parameter change is **< 100 ms** in native mode on reference hardware.

### R10. Three-layer state architecture using Vanilla `Store<T>`

Project state (selected model, parameter values, preset metadata, temperament, MIDI mapping, automation) is held in Vanilla `Store<T>` instances created via `createStore` from `#/infra/store/createStore`. React components consume via `useStore` from `#/infra/store/useStore`. **No Zustand, no Redux, no third-party global state library.** Runtime/engine state (voice slots, filter coefficients, smoothed parameter targets) lives in Rust and is reconstructed from project state on load.

**Acceptance criteria:**

- `pnpm deps:validate` passes with zero violations after the piano-plugin module is added.
- No file under `src/modules/PianoPlugin/**` imports from `zustand`, `redux`, `jotai`, or any similar package. Enforced by grep in CI.
- Each parameter surface in the plugin UI reads from a `Store<T>` via `useStore` and writes through a use case in `src/modules/PianoPlugin/useCases/`.

### R11. Module structure follows AGENTS.md

The plugin lives at `src/modules/PianoPlugin/` with subdirectories `useCases/`, `events/`, `stores/`, `presentations/views/`, `handlers/`, `models/`, `repositories/`, `engine/`, `services/`. The module's root `index.ts` re-exports only `useCases/`, `events/`, `stores/`, and `presentations/views/`. Cross-module imports to internals are forbidden (enforced by `pnpm deps:validate`).

**Acceptance criteria:**

- `pnpm deps:validate` passes.
- Every file in `useCases/` and `repositories/` exports exactly one function (enforced by existing lint rules).
- `index.ts` does not re-export from `models/`, `handlers/`, `repositories/`, `engine/`, `services/`.

### R12. Tauri / WASM parity

Both deployment targets present the same public API surface (same use cases, same parameter IDs, same events) from the TypeScript perspective. Platform differences are encapsulated inside `repositories/` following the Tauri-platform skill.

**Acceptance criteria:**

- A single test suite in `src/modules/PianoPlugin/__tests__/` runs against both transports using dependency injection, with `@test/only-native` or `@test/only-browser` annotations gating platform-specific cases.
- Tauri audio pipeline does not route audio through `invoke`; audio output stays inside Rust/`cpal`.
- Browser audio pipeline does not block the main thread; all DSP runs inside `AudioWorkletProcessor`.

### R13. WebGPU visualization views are non-blocking

The 3D piano, string-vibration, and spectral-waterfall views read from GPU-visible buffers populated by the audio thread via lock-free queues. Frame rate degrades gracefully when audio is under load: visualization frames may drop, but audio must not.

**Acceptance criteria:**

- A stress test that forces 60 fps visualization + 60% CPU audio load maintains audio buffer-underrun count at zero for a 60-second run.
- Visualization views correctly detect WebGPU unavailability and fall back to a "visualization unavailable" placeholder without crashing the plugin.

### R14. Numerical stability at low fundamentals

Modes with fundamental below ~200 Hz (A3 and downward — especially A0–E1) must remain stable at 48 kHz over long held notes without denormal floor, NaN blow-up, or slow-drift into instability. Research Part 2 §5.4 recommends **f64 coefficients** or a **coupled-form oscillator** for the low-register biquads; the spec treats this as an RT-correctness requirement, not a quality tier.

**Acceptance criteria:**

- A held A0 at mf, rendered for 30 s at 48 kHz on both native and WASM targets, produces zero denormal/NaN samples (detected by a post-render NaN/denormal sweep on the output buffer).
- The same fixture passes `assert_no_alloc` (R1 regression).
- A dedicated unit test pins each low-register biquad (A0, C1, C2, C3) against a golden output for 1 s and fails on any divergence beyond numerical-precision tolerance.

### R15. Delay-free-loop discipline in coupled hammer↔string models

The hammer↔string feedback path is an implicit delay-free loop in the continuous model and must be resolved by a documented technique (e.g. Bank 2000 / Borin K-method — research Part 2 §3.4). Implementations must not paper over the loop with an uncontrolled one-sample delay that biases inharmonicity or damping.

**Acceptance criteria:**

- The implementation choice (K-method, Bank 2000, or another documented technique) is recorded in the module's top-level comment and linked to research Part 2 §3.4.
- A unit test at C4 mf compares hammer contact duration and peak force against the research target range; a naive one-sample-delay fallback that violates the target range fails this test.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`): module boundaries, one-function-per-file in `useCases/` and `repositories/`, cross-module access only via the module's root `index.ts`.
- Must follow Sourdaw TypeScript soundness rules (`AGENTS.md` § TypeScript — soundness): no `any` without immediate narrowing at a boundary, no assertion-based error silencing, discriminated unions for modal states.
- No `useMemo`/`useCallback`/`React.memo` (React Compiler handles memoization).
- No `forwardRef` (React 19 passes `ref` as a regular prop).
- Must follow the `web-audio-engine` skill for browser-side RT discipline and the `tauri-platform` skill for Rust/Tauri placement.
- Audio thread must be allocation-free, lock-free, and non-blocking.
- No codemods or AST-altering scripts for cross-module changes.

---

## Design decisions

### Decision: Modal synthesis (parallel biquads) over pure digital waveguides

**Chosen:** Modal synthesis with a parallel biquad bank per partial per string, driven by an oversampled nonlinear hammer ODE. Soundboard is a parametric biquad bank (50–100 modes) with optional commuted-IR convolution for quality-tier users.

**Considered and rejected:**

- **Pure digital waveguide loops:** Simpler per-voice arithmetic but harder to parameterize per-partial and harder to expose to per-note editing later. Less SIMD-friendly (state is serial through a delay line).
- **Full FEM + FDTD solver in real-time:** Too expensive for WASM; appropriate for offline parameter extraction only.
- **Pure sampling:** Incompatible with WASM deployment (4 GB linear memory limit, no disk I/O from AudioWorklet).

Rationale: modal synthesis exposes per-partial parameters in an SoA-friendly layout, composes cleanly with the coupled-string junction, and degrades gracefully by truncating the partial count under CPU pressure.

### Decision: Vanilla `Store<T>` for project state (not Zustand)

**Chosen:** Project state is held in `Store<T>` instances created via `createStore` from `#/infra/store/createStore`. React reads via `useStore` from `#/infra/store/useStore`. Writes go through use cases.

**Considered and rejected:** Zustand was proposed in an earlier draft of this spec. Rejected — `AGENTS.md` mandates Vanilla `Store<T>` for cross-domain UI state; this is an architectural hard rule, not a technical preference.

### Decision: Three-layer boundary (React UI / TS project state / Rust engine)

**Chosen:** UI is React 19, project state is TypeScript in `stores/` with use cases for mutation, engine is Rust in `daw-dsp` (modal synth + voice pool) + `daw-engine` (transport integration) + `src-tauri` (Tauri bridge). Engine state is ephemeral and reconstructed from project state on load.

**Considered and rejected:** Carrying engine state in TypeScript. Rejected because it would force audio-rate state into the JS heap and through IPC, which our RT constraint forbids.

### Decision: Ring-buffer commands + atomic parameters, no DSP graph rebuilds on parameter change

**Chosen:** Scalars go through `AtomicF32` with per-sample smoothing (`current += (target - current) * coeff`); structural changes (model load, temperament) go through `rtrb` SPSC commands applied over multiple blocks with crossfade. Topology never changes at runtime.

**Considered and rejected:** Rebuilding the voice graph on model change. Rejected — causes audible discontinuity and cannot be done without allocation on the audio thread.

### Decision: v1 MIDI 1.0 with `f32` velocity internal representation

**Chosen:** Input stage accepts MIDI 1.0 (7-bit velocity, CC64/66/67), normalizes velocity to `f32 ∈ [0, 1]`, and feeds this into the hammer model. MIDI 2.0 is a later input-stage change only.

**Considered and rejected:** Full MIDI 2.0 UMP at v1. Rejected because the transport stack does not yet handle UMP and doing it here would block the plugin on unrelated infrastructure. Requirement R5's velocity-continuity test still holds under the `f32` internal representation.

### Decision: Hybrid attack path is optional and default-off

**Chosen:** Pure modal sustain is the default. The optional sample-based attack pathway (first 10–50 ms, crossfaded into modal) ships behind a preset flag for users who find pure modeling insufficient. Samples must be from a license-compatible source (e.g. Salamander Grand Piano, public domain as of 2022).

**Considered and rejected:** Hybrid-always. Rejected because it requires shipping sample assets that enlarge the install footprint and complicate the browser build; making it opt-in keeps the baseline install small.

### Decision: Sympathetic resonance via global bank, not per-voice coupling

**Chosen:** 12–24 biquad resonators tuned to lowest piano fundamentals, driven by summed bridge force, gated by damper state. Optional partitioned-FFT IR convolution path for native quality tier.

**Considered and rejected:** O(N²) per-voice sympathetic coupling (every string exciting every other). Rejected on cost grounds — 256 voices × 256 potential couplings × 50 partials is well over the per-block budget in WASM.

---

## Acceptance criteria / release gate

The plugin is considered shippable when ALL of the following are true:

- [ ] All R1–R13 per-requirement acceptance criteria pass.
- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] `pnpm typecheck` passes.
- [ ] `cargo test -p daw-dsp --release` passes.
- [ ] The **stress scenario** renders cleanly: play the MAESTRO test-split file `<TBD — implementer records chosen ID>` through the plugin in both native and browser targets at 48 kHz, 256-voice native / 64-voice browser. Output must have zero buffer underruns (tracked via `cpal` stream callback error count and AudioWorklet processor-error count, both zero for 60 s of playback).
- [ ] The **perceptual gate**: an informal 3-listener blind A/B against the Salamander Grand Piano rendering of the same MIDI passes with median identification rate ≥ chance + 1σ (see OQ3 — this is a weak gate; it is a filter for "obviously wrong," not a realism proof).
- [ ] Self-review section in the task file is fully answered with pasted command outputs.

---

## Implementation notes

- Start by getting a single C4 note playing through the native pipeline with the full signal chain (hammer → modal bank → soundboard → output) before adding polyphony, coupled strings, or UI. The simplest integration test surface is `daw-dsp::render_note(key, velocity, duration) -> Vec<f32>`.
- Implementation primitives for inharmonicity (`partial_freq`, `inharmonicity_coeff`, `stretch_cents`) are in research Part 2 §5.1 / §12 and are copy-safe.
- For the hammer ODE, prefer Stulov's three-parameter Voigt-like form (research Part 2 §3) over the four-parameter hereditary form — no convolution integral, one multiply per sample.
- The voice pool scoring heuristic is specified numerically in **research Part 1 §4** (subsection "Pre-allocated lock-free voice pool", lines 148–157) — use those constants; protect the highest and lowest held notes from stealing per that section.
- **Soundboard path selection (research Part 2 §6.3–6.4).** Option A (parametric biquad bank, ~50–100 modes) is the default and must ship for v1. Option B (commuted-IR convolution) is a quality-tier add-on gated behind a preset flag; choose partitioned-FFT convolution when implemented. Option C (full modal plate via Ducceschi / ~2,400 modes) is research-only — not in v1.
- **Low-register stability (R14).** Implement the low-register biquads in f64 or coupled form per research Part 2 §5.4; tolerate a small CPU bump over a long-term correctness bug.
- **Delay-free loop (R15).** Document the chosen hammer↔string loop technique (Bank 2000 / K-method) in the module's top-level comment.
- Offline parameter extraction (ML-based) from a reference recording is not required for v1; if it ships, it must produce a static parameter table — no runtime inference (per Non-goal).
- **Rust ecosystem (research Part 1 §5.5 / §15).** Prefer `assert_no_alloc` as the RT-safety guard; `basedrop` is the recommended pattern for deferred deallocation of voice data structures; NIH-plug's `Smoother` is a reference for parameter smoothing even though the plugin does not ship under nih-plug. These are reference patterns only, not hard dependencies.
- **Open-source references (research Part 2 §19).** Qiano, FAUST pianoteq-style patches, NESS, MAESSTRO, and related projects are documented in the research file for implementers; none are v1 dependencies.
- For WebGPU, use the existing `#/infra/gpu/` helpers if any; otherwise define new ones under `src/modules/PianoPlugin/presentations/views/` and only promote them to infra if another module later needs them.

---

## Test plan

- [ ] **Unit** — biquad coefficient math, partial-frequency math, inharmonicity math, temperament offset math, hammer ODE step. All in `daw-dsp/src/piano/__tests__/` and `src/modules/PianoPlugin/**/__tests__/` per testing-file-layout skill.
- [ ] **Integration** — Rust `render_note` generates expected partial frequencies and RMS envelopes (R3, R4, R5) under a deterministic test fixture.
- [ ] **RT-safety** — 60-second `assert_no_alloc`-guarded stress run covering every structural-change path (R1).
- [ ] **Voice pool** — stuck-pedal stress with click detector (R2).
- [ ] **Pedal** — scripted CC64 sweep asserting monotonic envelope (R6).
- [ ] **Sympathetic** — harmonic selectivity and gate-correctness tests (R7).
- [ ] **Preset switch** — rendered 60-second clip with 35 preset/temperament/mic changes; click detector asserts no sample delta > 12 dB (R9).
- [ ] **Cross-target parity** — same test suite runs native and browser with DI-injected platform repositories (R12).
- [ ] **Manual** — 5-minute free-play session per deployment target by two developers; note any audible artifacts and log them.
- [ ] **Perceptual smoke test** — 3-listener blind A/B (release-gate weak filter, not a proof).

---

## Open questions

- [ ] **[CRITICAL] OQ1 — WASM performance envelope for modal synthesis.** The research claims 95%+ of native performance is achievable with WASM SIMD, but the piano workload (hundreds of biquads × 64 voices × 48 kHz) has not been measured in this repo. Before committing to the browser target, prototype a single-voice modal bank in Rust, compile to WASM, run in `AudioWorkletProcessor` on Chrome/Firefox/Safari on reference mid-range hardware (M1 MacBook Air, mid-range Windows laptop), and measure the per-voice cost and max sustainable polyphony at 48 kHz. If measured polyphony < 32 voices in browser at target quality, the browser scope must be renegotiated (e.g. lower sample rate, lower partial count, or drop browser deployment for v1). Block on this measurement.
- [ ] **[CRITICAL] OQ2 — Numerical tolerance for the spectral-envelope realism criterion (R5).** The "±3 dB across first 50 ms" in R5 is currently an unvalidated guess. Before implementation starts, the implementer must either (a) measure the inter-performance variance of the chosen MAESTRO reference piece across multiple recordings to derive a principled tolerance, or (b) replace the criterion with the PEMO auditory-model distance (Osses & Kohlrausch, research A1) with a published threshold, or (c) escalate that a tight numerical target is not achievable and downgrade the acceptance criterion to perceptual-panel only. Block on this decision.
- [ ] **[CRITICAL] OQ3 — Realism target and evaluation methodology.** The research shows that even Pianoteq fails to be statistically distinguishable from real recordings only under controlled conditions (Bernays & Traube 2014). For a v1 first-party plugin, "how good is good enough" must be stated before we can call the plugin done. Two alternatives: (a) aim for "no audible glitches, artifacts, or category errors" (easier, achievable) and explicitly disclaim perceptual competitiveness with Pianoteq; (b) aim for "passes a formal MUSHRA-style listening test with N listeners, target score ≥ X" (expensive, high-risk, needs ethics/IRB considerations even informally). The product owner must choose one before implementation. Block on this decision.
- [ ] **[CRITICAL] OQ4 — Reference parameter source and license audit.** The research cites several measured parameter sets (Euphonics Broadwood CC BY-NC-SA 4.0, Chabassier Steinway D, Conklin 1996). The NC clause in CC BY-NC-SA 4.0 is incompatible with commercial Sourdaw distribution. Before any parameter table is imported into `daw-dsp`, a license audit must confirm that each imported constant is either (a) public domain, (b) permissive-licensed (MIT/Apache/CC0/BY), or (c) derived from a measurement the implementer makes from a license-compatible recording. Block on this audit for every parameter table.
- [ ] **[CRITICAL] OQ5 — Sample source for the optional hybrid attack pathway.** The hybrid attack path needs short attack samples. Salamander Grand Piano (public domain as of 2022, research A11) is the current assumption but must be verified file-by-file. Block on confirmation before shipping the hybrid path.
- [ ] **[MAJOR] OQ6 — Soundboard approach for v1.** Parametric biquad bank (simple, always works) or commuted-FFT IR (better sounding but needs a pre-generated IR asset and partitioned-FFT code path)? Parametric is the default; the commuted path is gated behind a quality tier. Confirm we are not shipping both in v1.
- [ ] **[MAJOR] OQ7 — Visualization is in-scope for v1 but how much?** Three views are listed. If WebGPU prototyping reveals any one of them is disproportionately expensive, which one drops? Suggested priority: 3D piano > string vibration > spectral waterfall.
- [ ] **[MINOR] OQ8 — Velocity curve presets.** How many ship? Suggested: Linear, Soft, Hard, Exponential. Confirm with product.
- [ ] **[MINOR] OQ9 — Pedal noise bank.** Research lists four event types (key-down, hammer let-off, damper lift, pedal-down). Are all four required in v1, or is a subset acceptable? Suggested v1: key-down and pedal-down only.

---

## Tradeoffs and risks

- **Perceptual risk.** Pure physical modeling of piano remains hard; the research's Bernays & Traube study is the only peer-reviewed evidence that it can match recordings in blind tests, and that was against Pianoteq — a mature product with 15+ years of development. Cost of being wrong: a v1 that sounds acceptable but not flagship-grade. Mitigation: opt-in hybrid attack path, soundboard quality knobs, clear non-goal on perceptual parity (OQ3).
- **Performance risk (WASM).** Per OQ1, the browser-target polyphony budget is unverified. Cost of being wrong: browser deployment drops out of v1. Mitigation: early WASM SIMD benchmark before committing the full feature set to the browser.
- **Licensing risk.** Patent US7915515B2 (Pianoteq) imposes a clean-room discipline; parameter tables from academic sources may have NC clauses. Cost of being wrong: plugin has to be withdrawn or rewritten. Mitigation: OQ4 license audit before importing any constant.
- **RT-safety regression risk.** Adding UI paths that forget the atomic/ring-buffer discipline will silently allocate on the audio thread. Cost: audio dropouts during live performance. Mitigation: `assert_no_alloc` test in CI on every PR that touches `daw-dsp`.
- **Scope creep.** Per-note editing of 30+ parameters, microtuning to 1/512 of a semitone, model marketplace, and neural warmth layer are all seductive additions. Cost: never shipping. Mitigation: they are in Non-goals and moving one of them in-scope requires an explicit spec revision and sign-off.

## Implementation Status

- **What is implemented:** The Rust DSP engine is robustly implemented in `crates/daw-dsp/src/grand_boule`. It includes the modal string resonator, hammer nonlinearity, coupled strings, sympathetic resonance, soundboard, and pedals.
- **What is not implemented:** The frontend UI module (`src/modules/PianoPlugin` or `GrandBoule`) is missing. There is no dedicated React interface to expose the piano parameters.
- **What is done well:** The physical modeling DSP in Rust is very comprehensive and adheres to the physical equations described in the research.
- **What needs refactoring:** A dedicated frontend module needs to be created to wrap the `grand_boule` DSP engine and fulfill the React/WebGPU UI requirements.
