---
type: research
id: RESEARCH-unified-sampler-suite
title: Architecture for a unified DAW sampler on Tauri v2
status: open
owner: The Sourdaw team
sources:
  - "Question: what architecture unifies best-in-class sampler workflows while keeping the RT audio thread safe?"
---

# Research: Architecture for a unified DAW sampler on Tauri v2

> Co-located research doc for `specs/unified-sampler-suite/spec.md`. The findings below
> (R-001…R-008) summarise the inquiry; the **Restored from sources** section at the end
> carries verbatim deep-design material recovered from the pre-migration research files
> (`research/factory/unified-sampler-suite.md`, `research/factory/bakery.md`).

## Question

What Rust/React architecture unifies the best-in-class sampler workflows (Ableton speed,
Logic intelligence, FL per-slice control, Bitwig modulation) while keeping the real-time
audio thread allocation- and lock-free?

## Findings

### R-001 — No DAW sampler is complete; eight persistent gaps recur

- **Claim:** Each leader excels in isolation (Ableton speed, Logic auto-analysis, FL articulators, Bitwig modulation); users consistently want context-aware defaults, record-to-pad, decoupled time-stretch, unified granular/slice modes, universal auto-pitch/BPM, in-place slicing, deep per-slice modulation, and smart loop points.
- **Evidence:** Competitor UX matrix and forum analysis across Reddit/KVR/Gearspace.
- **Confidence:** medium
- **Bears on:** AC-005 (context-aware defaults).

### R-002 — RAM-cached attack + disk-streamed sustain is the convergent pattern

- **Claim:** Professional samplers preload the attack and stream the sustain over lock-free ring buffers; 128 voices fit in ~76 MB (12 KB preload, 64 KB ring per voice).
- **Evidence:** Kontakt DFD and HISE streaming engine; `rtrb` SPSC boundary with priority-queued I/O thread.
- **Confidence:** high
- **Bears on:** AC-004 (streaming).

### R-003 — Atomic-bitfield allocation with composite stealing is lock-free

- **Claim:** Two `AtomicU64` words track 128 voices; `trailing_zeros` + `compare_exchange_weak` claim a voice; stealing cascades same-note → choke → releasing → oldest → quietest with a 1–5 ms fade.
- **Evidence:** Analysis of Kontakt, Surge XT, HISE, MPC allocators.
- **Confidence:** high
- **Bears on:** AC-002, AC-003.

### R-004 — A dual-mode warp engine covers transient and tonal content

- **Claim:** WSOLA handles transients/percussive, phase vocoder with identity phase locking handles tonal; Rubber Band R3 or Signalsmith are optional higher-quality tiers.
- **Evidence:** Algorithm selection matrix; Elastique Pro is best-in-class but proprietary.
- **Confidence:** high
- **Bears on:** the warp design and the dropped higher-quality tiers.

### R-005 — Onset detection ranks SuperFlux highest among classical methods

- **Claim:** SuperFlux (~87–88% F-measure, vibrato-robust) is the best general classical ODF; HFC is fast for percussive, Complex Domain for melodic; a CNN tier (~90%+) is optional via `ort`.
- **Evidence:** Böck & Widmer 2013; aubio HFC default; Schlüter & Böck 2014.
- **Confidence:** high
- **Bears on:** AC-007 (slicing).

### R-006 — YIN for root note, cubic Hermite for playback, rubato for SRC

- **Claim:** YIN with parabolic refinement detects root note; 4-point cubic Hermite is the default interpolation; `rubato` handles load-time sample-rate conversion off the RT thread.
- **Evidence:** de Cheveigné & Kawahara 2002; rubato SIMD resampler.
- **Confidence:** high
- **Bears on:** AC-006 (root detection).

### R-007 — The TPT SVF is stable under modulation

- **Claim:** Andrew Simper's trapezoidal SVF (Zavalishin TPT) stays stable under fast cutoff sweeps where direct-form biquads become unstable, with simultaneous LP/HP/BP/notch/peak/allpass outputs.
- **Evidence:** Simper's optimized SVF derivation; KVR DSP forum analysis.
- **Confidence:** high
- **Bears on:** AC-010 (no zipper noise).

### R-008 — Never send audio over IPC; send binary peak mipmaps

- **Claim:** Audio flows through cpal directly; IPC carries only control, metadata, and pre-computed peak mipmaps as raw `ArrayBuffer` via `tauri::ipc::Response`.
- **Evidence:** Tauri v2 IPC binary-response capability; ~15 KB per 1920 px view.
- **Confidence:** high
- **Bears on:** AC-011 (binary IPC).

## Open questions

- [ ] Q-001 — Memory budget for multi-GB instruments: cap, pitch-ratio promotion threshold, and stream/RAM control granularity.
- [ ] Q-002 — Missing/relocated sample files at load and the RT contract for a triggered missing sample.
- [ ] Q-003 — Sample-rate mismatch handling and the authoritative rubato variant.
- [ ] Q-004 — MPE protocol surface (full 1.0 vs simplified per-note vs deferred).

## Recommendation

Adopt the three-thread model (RT audio / engine management / disk I/O) with a shared voice
engine across all modes (R-002, R-003), a dual-mode warp engine (R-004), analysis-driven
smart defaults (R-001, R-005, R-006), the TPT SVF (R-007), and audio-free binary IPC (R-008).
Keep higher-quality stretch and CNN onset as deferred tiers the architecture can absorb
without a rewrite.

---

## Restored from sources

This section restores deep-design material that was dropped during the docs migration.
Wording is verbatim from the cited origin where practical; headings name the origin and the
loss item each block answers. The matching engine requirements are formalised as acceptance
criteria in `spec.md`.

### RS-1 — Crumb advanced-sampler deep design (origin: `research/factory/bakery.md` §2 "Crumb (Advanced Sampler)")

Recovers the Crumb-specific deep design not individually carried forward: the 2D mapping
space, SFZ import as a CORE requirement, the hierarchical data model, mapping engine,
playback modes, interpolation tiers, and looping system. Verbatim from the origin:

> # Crumb for Sourdaw — AI Implementation Guide
>
> ## Purpose
>
> Crumb is Sourdaw’s general-purpose sampler: a high-performance instrument for multisampling, slicing, warping, granular playback, disk streaming, and expressive modulation.
>
> ## 1. Product Definition
>
> Crumb handles single-shot, multisampled instruments, round robin, tempo-aware warping, slicing, granular synthesis, disk streaming.
>
> ## 2. Architectural Principles
>
> - Immutable patch description vs. Stateful runtime voice engine vs. Lock-free control bridge.
> - Subsystems: asset_pool, import, mapping, voice_engine, resampler, warp, granular, slicing, streaming, modulation, effects, routing, analysis, ui_bridge.
>
> ## 3. Hierarchical Data Model
>
> 1. Instrument
> 2. Layer
> 3. Group
> 4. Zone
> 5. Sample Asset
>    (Parameters inherit downward).
>
> ## 4. Rust Data Structures
>
> `Zone` structs with sample references, key/velocity ranges, playback offsets, loop settings, and trigger logic.
>
> - Use shared ownership for decoded sample assets (`Arc<SampleAsset>`).
> - Pre-allocated voice pools.
>
> ## 5. Mapping Engine
>
> - 2D Mapping Space (X: key, Y: velocity).
> - UI supports drag-to-move, overlapping logic, batch assignment.
>
> ## 6. Velocity Crossfades
>
> Equal-power crossfades for overlapping velocity layers using cosine/sine curves to preserve energy.
>
> ## 7. Trigger Logic and Articulation
>
> Declarative triggers for note-on, release, legato, keyswitch, round-robin, cycle, mute groups.
>
> ## 8. Playback Modes
>
> One-Shot, Classic Gated, Slice, Granular, Warp/Tempo-Sync, Reverse.
>
> ## 9. Resampling and Interpolation
>
> - Linear (draft)
> - Cubic Hermite (default sweet spot)
> - Windowed Sinc (highest quality, 32/64-tap)
>
> ## 10. Anti-Aliasing Strategy
>
> Multi-Resolution Source Pyramids (prefiltered source caches).
>
> ## 11. Warping and Time-Stretching
>
> - Signalsmith Stretch integration for premium tonal stretching.
> - Policies: Beats, Tones, Texture, Complex.
>
> ## 12. Slice Engine
>
> Spectral-flux-based onset detection. Slices mapped chromatically or to pads.
>
> ## 13. Granular Engine
>
> Sample-accurate grain scheduler, density, spray, envelope shapes (Hann, Gaussian).
>
> ## 14. Analysis Engine
>
> pYIN root note detection, BPM detection for loops, silence/trim detection.
>
> ## 15. Non-Destructive Editing
>
> All edits (offsets, fades, normalizations) are metadata only.
>
> ## 16. Looping System
>
> Forward, ping-pong, reverse. Zero-crossing snapping and crossfade looping.
>
> ## 17. Release Triggers and Legato Polish
>
> Alignment via zero-cross search, short handoff crossfade, or envelope matching.
>
> ## 18. Modulation System
>
> Visual-first drag-and-drop modulation. Voice-level, Group-level, Global-level scopes.
>
> ## 19. Effects Architecture
>
> Per-zone, per-group, master inserts using `daw-dsp`.
>
> ## 20. Import and Interoperability
>
> - **SFZ Import:** Core requirement. Must parse `<global>`, `<control>`, `<group>`, `<region>`.
> - Support for key ranges, velocity ranges, tune, loop, ampeg, round-robin, off_by.
>
> ## 21 - 33. UI, Disk Streaming, WebGPU, React 19 Frontend
>
> - Direct-from-disk streaming with preload buffers.
> - Unified UI Architecture with modular blocks.
> - WebGPU for waveform rendering, modulation rings, spectral analysis.

### RS-2 — AHDSR envelope state machine (origin: `research/factory/unified-sampler-suite.md` Addendum §4)

Recovers the AHDSR finding/recommendation: the 6-state machine (Idle/Attack/Hold/Decay/Sustain/Release),
the EarLevel single-multiply exponential curve via `target_ratio`, and the retrigger/legato notes.
Verbatim from the origin:

> ### Per-sample exponential curve via multiplier
>
> The standard approach (used by EarLevel Engineering's widely-referenced implementation and virtually all professional synthesizers) computes an exponential transition iteratively using a single multiply per sample. Given a transition from `start_level` to `end_level` over `length_samples`:
>
> ```rust
> // target_ratio controls curve shape:
> //   small (0.0001) = nearly exponential
> //   large (1.0+)   = nearly linear
> fn calculate_multiplier(
>     start: f32, end: f32, length: usize, target_ratio: f32
> ) -> (f32, f32, f32) {  // returns (base, multiplier, offset)
>     let offset = (end - start) * if end > start {
>         (1.0 + target_ratio) / target_ratio
>     } else {
>         (1.0 + target_ratio).recip() * -target_ratio
>     };
>     let base = start - offset;
>     let coeff = ((base + offset) / base).ln() / length as f32;
>     let multiplier = coeff.exp();
>     (base, multiplier, offset)
> }
>
> // Per-sample: level = base * multiplier^n + offset
> // Iteratively: level = (level - offset) * multiplier + offset
> ```
>
> ### State machine with 6 states
>
> ```rust
> enum EnvState { Idle, Attack, Hold, Decay, Sustain, Release }
> ```
> (Full `AhdsrEnvelope` struct and `process()`/`note_on()`/`note_off()` impl in the origin; the
> attack targets a value above 1.0 and clamps for the analog RC-charging concave-down shape.)
>
> ### Key design notes
>
> - **Attack shape**: The classic analog capacitor-charging curve (concave downward) is produced by targeting a value above 1.0 (e.g. 1.0001) and clamping. This is the natural shape of `RC` charging and matches hardware synthesizer behavior per the EarLevel Engineering analysis.
> - **Retrigger behavior**: On retriggering during release, the attack starts from the current level, not from zero. This prevents clicks. For a "hard retrigger" option, reset to zero with a 1ms fade.
> - **Legato mode**: Skip the attack phase entirely on retrigger; just update the pitch. The envelope remains in whatever state it was in.
> - **`target_ratio` as curve control**: A value near 0.0001 gives a steep exponential curve. A value near 1.0 approaches linear. This single parameter replaces complex curve-type selectors and is how EarLevel's implementation (widely cited on KVR forums) achieves adjustable curves with trivial computation.

### RS-3 — Loop modes (origin: `research/factory/unified-sampler-suite.md` Addendum §6)

Recovers the four loop modes (NoLoop, Forward, PingPong, Reverse) with equal-power crossfade
at loop points and the 50–500 sample (1–10ms) user-adjustable crossfade. Verbatim from the origin:

> ### Four loop modes with crossfade
>
> Every professional sampler (Kontakt, Bitwig, Studio One) supports at minimum: no loop, forward loop, ping-pong (forward-reverse alternating), and reverse loop. The crossfade at loop boundaries is essential for click-free looping.
>
> ```rust
> enum LoopMode { NoLoop, Forward, PingPong, Reverse }
> ```
> (Full `LoopState` struct and `advance(pitch_ratio)` per-mode position logic in the origin.)
>
> ### Equal-power crossfade at loop point
>
> For forward looping, when the read position is within `crossfade_len` samples of `loop_end`, blend the current region with audio from `loop_start`:
>
> ```rust
>         // Equal-power crossfade
>         let gain_main = (fade * PI * 0.5).sin();
>         let gain_wrap = ((1.0 - fade) * PI * 0.5).sin();
>         main * gain_main as f32 + wrap_sample * gain_wrap as f32
> ```
>
> Equal-power crossfade (using `sin`/`cos` curves) maintains constant perceived loudness through the transition, unlike linear crossfade which dips by ~3dB at the midpoint. A typical crossfade length is 50–500 samples (1–10ms), user-adjustable.

### RS-4 — Granular as a warp mode (origin: `research/factory/unified-sampler-suite.md` Addendum §8 + `process()` dispatch)

Recovers granular as one of the warp/playback modes (`WarpMode::Granular` in the `process()`
dispatch, `warp/granular.rs` in the module tree) and the §8 granular-engine design. Verbatim from the origin:

> ### Grain scheduling architecture
>
> A granular engine maintains a **grain pool** (pre-allocated array of grain structs) and a **scheduler** that triggers new grains at intervals determined by grain density.
>
> ```rust
> const MAX_GRAINS: usize = 128;
> ```
> (Full `Grain` and `GranularEngine` structs in the origin: parameters include `grain_size_ms`
> 10–100ms, `density` 10–1000 grains/sec, `position`, `spray`, `pitch`, `pitch_random`, `pan_spread`.)
>
> ### Inter-onset time and density
>
> Grain density controls how often new grains are triggered. The inter-onset time (IOT) is `sample_rate / density`. For asynchronous granular synthesis, IOT can be randomized: `iot = base_iot * (1.0 + random(-0.3, 0.3))` to avoid mechanical periodicity, which is a core technique documented in Barry Truax's original real-time granular synthesis work from 1986.
>
> ### Grain window shapes
>
> - **Hann** (default): `0.5 * (1 - cos(2π * t/N))` — smooth, no clicks, good overlap behavior
> - **Triangle**: sharper transients, more rhythmic character
> - **Tukey** (flat-top cosine): `cos²` tapers at edges, flat middle — preserves more of the source character
> - **Gaussian**: `exp(-0.5 * ((t - N/2) / (σ * N/2))²)` — softest, most "cloudy"
>
> ### Grain density vs. grain size interactions
>
> When `grain_size > inter_onset_time`, grains overlap. At typical settings of 50ms grains and 100 grains/second (IOT = 10ms), ~5 grains overlap simultaneously. The Hann window has the COLA (Constant Overlap-Add) property at 50% overlap, meaning overlapping Hann-windowed grains sum to constant amplitude — producing smooth, artifact-free textures.

### RS-5 — Workflow benchmark action-counts (origin: `research/factory/unified-sampler-suite.md` Part 1 "Best-in-class workflow benchmarks")

Recovers the concrete best-in-class benchmarks the unified sampler should match or beat.
Verbatim from the origin:

> The three target workflows have clear speed leaders. **Loading a one-shot**: Ableton — drag to pad, done (**2 actions**). **Slicing a loop to pads**: Logic — drag to Quick Sampler Slice → Create DMD Track, auto-generates MIDI (**4 actions**, 1 click to convert). **Time-stretching to BPM**: Ableton — drag to track, auto-warps to project tempo (**2 actions**, zero configuration). A unified sampler should match or beat these action counts for each workflow.

### RS-6 — Round-robin practical design (origin: `research/factory/unified-sampler-suite.md` Part 2d "Round-robin and velocity layering")

Recovers the practical RR tip: an ODD number of RR samples relative to the time signature,
random-robin-with-repeat-avoidance, and the "5+ velocity layers × 10 round robins = 50 samples
per key" sizing. Verbatim from the origin:

> Per-note round-robin counters cycle through sample variants to eliminate the "machine gun effect." Professional libraries use **5+ velocity layers × 10 round robins = 50 samples per key**. A practical tip from MusicRadar: use an **odd number of RR samples** relative to the time signature (5 or 7 in 4/4) so the cycling never aligns with beats. Random-robin with repeat avoidance provides additional variation — pick a random index, skip if it matches the last played.

### RS-7 — Parameter-smoothing concrete guidance (origin: `research/factory/unified-sampler-suite.md` Addendum §7)

Recovers the per-parameter smoothing times, per-block optimization, and denormal prevention.
Verbatim from the origin:

> ### Smoothing time guidelines
>
> - **Volume/pan**: 5–10ms (fast response, avoids audible lag)
> - **Filter cutoff**: 5–20ms (needs to be fast for sweeps, smooth enough to avoid clicks)
> - **Delay time**: 50–100ms (longer to avoid pitch glitches)
> - **General UI knobs**: 10ms is a good universal default
>
> ### Per-block optimization
>
> For parameters that don't need per-sample granularity, compute the smoothed value once per block (e.g. every 64 or 128 samples) and hold it constant within the block. This saves CPU when many parameters are active. A KVR developer's approach: run the smoother at 1/16 sample rate and multiply the coefficient by the downsampling factor to maintain the same time constant.
>
> ### Denormal prevention
>
> The one-pole filter's feedback will decay asymptotically toward zero, potentially producing denormal floating-point values that cause massive CPU spikes on x86. Add a tiny DC offset: `self.current += 1e-18` after each iteration, or use `_mm_setcsr(_mm_getcsr() | 0x8040)` to enable flush-to-zero globally on the audio thread.

### RS-8 — Interpolation tiering (origin: `research/factory/unified-sampler-suite.md` Addendum §1)

Recovers the three-tier interpolation recommendation (linear = preview-only/aliasing,
cubic Hermite = default at 4 mul/4 add per sample, windowed sinc via rubato / Surge
pre-computed tables = HQ mode). Verbatim from the origin:

> ### Cubic Hermite interpolation (recommended default)
>
> Uses four sample points around the read position. The Hermite form avoids matrix inversion:
>
> This gives excellent quality for most sampler use cases at 4 multiplies and 4 adds per sample. It is the interpolation used by most professional samplers in their default mode.
>
> ### Windowed sinc interpolation (highest quality)
>
> The `rubato` crate is the recommended Rust solution. It provides SIMD-accelerated (AVX on x86_64, NEON on aarch64) asynchronous sinc resampling with configurable quality.
>
> For the Surge synthesizer's approach, sinc tables are pre-computed at initialization: a windowed sinc function is evaluated at `512 × oversampling_factor` points and stored. During playback, the table is indexed by the fractional position and the nearest values are interpolated — trading memory (~256KB) for avoiding expensive `sin()` calls on the audio thread.
>
> ### Recommended strategy for the sampler
>
> Use cubic Hermite as the default interpolation for pitched playback (excellent quality-to-cost ratio). Use `rubato` (SincFixedOut variant) for sample rate conversion when a sample's native rate differs from the session rate — run this conversion on the I/O thread during loading, not on the RT thread. For the highest-quality "HQ" rendering mode, use sinc interpolation per-voice via pre-computed tables. Linear interpolation is "acceptable only for quick previews" because it "introduces high-frequency attenuation and aliasing."

### RS-9 — Underrun graceful degradation (origin: `research/factory/unified-sampler-suite.md` Part 2b "Buffer sizing for 128 voices on NVMe")

Recovers the documented underrun-recovery behavior behind R-002/AC-004's 128-voice streaming claim.
Verbatim from the origin:

> Total streaming memory: **~76MB** — trivial for modern systems. On buffer underrun, apply an inverse ramp over 64 samples to fade gracefully to silence, mark the voice as starved, and resume with a fade-in when data arrives.
