# Drum Machine — Flagship Spec

> **Codebase annotation:** Grinder currently exists as an Amp Simulator plugin (`crates/daw-dsp/src/grinder`), not a Drum Machine. The pad-based sampler is `Toaster` (`crates/daw-dsp/src/toaster`), which implements basic pad assignments and sample playback but lacks the advanced synthesis engines, physical modeling, and integrated step sequencer below. The flagship Drum Machine is **Missing / Unimplemented** in its intended form.

---

## Context

Sourdaw's current built-in drum devices (`builtin-drum-kit`, `Toaster`) are rudimentary compared to the reference machines in this space: Logic DMD, Ableton Drum Rack, NI Battery 4, FL Studio FPC, Bitwig Drum Machine, NI Maschine, and hardware classics (MPC, TR-808/909, SP-1200, Digitakt). This spec defines the single flagship drum machine that Sourdaw will ship and use for the Factory suite.

The spec is grounded in consolidated DSP research (`master-drum-machine.md`, `master-drum-machine-secrets*.md`) and the detailed reference-machine breakdowns below. Where multiple research notes contradict, the deeper circuit-level analysis takes precedence (called out inline in each part).

## Goal

After implementation, Sourdaw ships a pad-based drum instrument that (a) matches or exceeds the feature surface of Logic DMD / Ableton Drum Rack / Battery 4, (b) includes an integrated step sequencer with parameter locks and conditional triggers at MPC/Digitakt quality, (c) hosts both sampled and synthesized voices with per-pad effect chains, (d) meets the RT-safety contract (no allocation, no locks, no blocking on the audio thread) on both native and WASM.

## Scope

**In scope:**

- Per-pad hosting of sample playback, drum synthesis engines, and layered sources with independent effects, modulation, mixer channel, and output routing.
- Integrated step sequencer: per-step probability, velocity, micro-timing, parameter locks, conditional triggers.
- Drum synthesis engines (808/909/CR-78 style physical/modal models), transient shapers, modal percussion, and advanced slicing.
- GPU-accelerated visual rendering where applicable.
- RT-safe real-time implementation matching `AGENTS.md` constraints.

**Out of scope:**

- Articulation maps (see `active/articulation-maps.md`).
- Cross-device chained behavior beyond single-instance (see `../features/device-racks.md`).
- AI groove generation UI surface (the DSP for pattern generation is specified in Part 3.5; the UX integration surfaces through `../features/workflow-ui.md`).

## Acceptance criteria (release gate)

- [ ] Every Part below has at least one integration test demonstrating its feature surface under real-time constraints.
- [ ] RT-safety: no allocation, no mutex locks, no blocking on the audio thread — verified by the repo's standard RT-safety test harness.
- [ ] Matches or exceeds the checklist of reference-machine features enumerated in "Reference Machines — Architectural Inspirations".
- [ ] Ships with at least the Factory preset count defined in `../../audits/factory-content-status.md` §2.
- [ ] `pnpm deps:validate` and `cargo test --workspace` pass.

---

> **Audience**: An AI coding agent building this instrument from scratch in Rust + TypeScript.
> **Contract**: Every algorithm has the math, the data structures, and implementation details. No hand-waving.
>
> **Consolidated from**: master-drum-machine.md (spec/architecture), master-drum-machine-secrets.md (deep DSP research on filters, oscillators, compression, reverb), master-drum-machine-secrets-2.md (drum synthesis engines, sequencing, transient detection, time-stretch, modal/physical models, GPU).
>
> **Resolution of overlaps**: The secrets docs provide deeper DSP detail that supersedes the spec's generic descriptions. Where both describe the same algorithm (e.g., 808 kick, filters, reverb), the secrets docs' specific circuit analysis, coefficients, and implementation notes take precedence.

---

# Part 1: Architecture & Execution Model

## What We Are Building

A pad-based drum instrument where every pad is a full instrument channel. Each pad can host any combination of sample playback, drum synthesis engines, and layered sources, with its own independent effect chain, modulation, mixer channel, and output routing. The instrument includes an integrated step sequencer with per-step probability, velocity, micro-timing, parameter locks, and conditional triggers.

This must surpass Logic's Drum Machine Designer, Ableton's Drum Rack, NI Battery 4, FL Studio's FPC, Bitwig's Drum Machine, NI Maschine, and hardware references (MPC, TR-808/909, SP-1200, Digitakt).

## Reference Machines — Architectural Inspirations

**Logic DMD**: Each pad is a full DAW channel strip (any instrument + FX chain). Drum Synth has purpose-built engines per category (not generic osc+filter). Track stack architecture = mixer sees individual channels per drum piece. **Take**: per-pad full instrument hosting, purpose-built engines, the "container for channels" concept.

**Ableton Drum Rack**: Nested device chains per pad. Chain selector with velocity/key zones. 16 macro knobs spanning all pads. Recursive nesting (Drum Rack inside Drum Rack). **Take**: velocity-zone layering, choke groups, kit macros, recursive hosting.

**NI Battery 4**: 128-cell grid (8×16). Up to 128 sample layers per cell with velocity crossfading. Per-cell effects. 4 internal buses. Tag-based browser. Cell matrix operations. **Take**: large grid, deep layering, per-pad sample editing, bus routing, tag browser.

**FL Studio FPC**: Dual-bank (A/B) with waveform preview on pad face. Up to 4 layers per pad with independent ADSR. Channel Rack step sequencer (fastest drum programming UX). **Take**: visual waveform on pads, fast per-layer controls, tight sequencer integration.

**Bitwig Drum Machine**: Full device chain per pad (not simplified). Same audio-rate modulation system as The Grid works per pad. Nested containers. **Take**: full modulation system per pad, audio-rate mod for sound design.

**Roland TR-808**: Dedicated circuit per drum type (bridged-T kick, hex Schmitt hat, multi-burst clap). Global accent boosts amplitude AND modifies tone. **Take**: purpose-built circuits, accent = timbral change not just volume.

**Akai MPC**: 16 Levels mode (one pad → 4×4 parameter grid). Note Repeat (tempo-synced retrigger). Chop/slice workflow. Per-pad velocity curves. **Take**: 16 Levels, Note Repeat, slice workflow, velocity curves.

**E-mu SP-1200**: 12-bit/26.04kHz deliberate lo-fi. No reconstruction filter. Drop-sample pitch shifting (no interpolation). SSM2044 VCF on some channels. **Take**: lo-fi as a feature, vintage character modes.

**Elektron Digitakt**: Parameter locks (per-step automation of any parameter). Conditional trigs (probability, fill, first/not-first, A:B ratio). Sound locks (different sample per step). Retrig per step. **Take**: parameter locks, conditional trigs, sound locks, retrig.

## Technology Constraints

- Rust, `no_std`-compatible DSP, compiles to native + WASM
- Shares DSP with the Fermenter synth (filters, envelopes, effects are identical)
- Lives in the existing `src-tauri/fermenter/` crate ecosystem OR its own `src-tauri/grinder/` crate
- Exposes: `fn process(midi_events: &[MidiEvent], output: &mut [f32], block_size: usize)`
- Web: WASM in AudioWorkletProcessor, 128-sample blocks (~2.9ms at 44.1kHz)
- React 19 frontend with progressive disclosure UI (5 levels)
- Preset format: JSON with versioning

## Crate Structure

Reuse the existing Fermenter crate's DSP modules where possible:

- Filters (SVF, Moog, Diode, Formant, MS-20, SEM) → `fermenter/src/filter.rs`
- Effects (Reverb, Delay, Chorus, Phaser, Distortion, Compressor, EQ) → `fermenter/src/effects.rs`
- Envelopes (ADSR, MSEG) → `fermenter/src/envelope.rs`, `fermenter/src/mseg.rs`
- LFO → `fermenter/src/lfo.rs`
- Noise → `fermenter/src/noise.rs`

New drum-specific code in `src-tauri/grinder/` (or `fermenter/src/drums/`):

- Kick synths (808, 909, analog, generic)
- Snare synths
- Hi-hat / cymbal synths
- Clap synths
- Tom synths
- Percussion synths
- Modal/physical percussion
- Sample player with zones and round-robin
- Step sequencer
- Voice manager with choke groups
- Pad routing and bus mixing

## Block Processing Model

Same as Fermenter — 128-frame blocks, control-rate updates once per block.

**Canonical order per block:**

1. Drain pending parameter changes from UI thread
2. Advance step sequencer → generate trigger events
3. Process incoming MIDI events + sequencer triggers
4. Voice allocation/stealing with choke group logic
5. For each active voice: render layers → filter → per-voice FX → accumulate into pad buffer
6. For each pad: apply per-pad FX chain → route to bus or master
7. For each bus: apply bus FX chain → sum to master
8. Apply master FX chain
9. Update meters and visualization taps

## Real-Time Safety

- No allocation in `process()`
- Pre-allocate all voices, buffers, delay lines at init
- Lock-free SPSC queue for UI→audio messages
- Two quality tiers: **Draft** (cheap, for live) and **Render** (best quality, extra oversampling)

---

# Part 2: Pad Architecture

## Pad Grid

- Configurable: 16 pads (4×4, default), 32 (4×8), 64 (8×8), up to 128 (8×16)
- Multiple banks (A/B/C/D) switchable
- Each pad displays: name, color, waveform thumbnail, MIDI note, choke group badge, mute/solo, activity flash
- Drag-reorderable, MIDI-mappable (default: GM drum map from C1)
- Each pad is an independent instrument channel

## Pad Sound Source Architecture

Each pad hosts **one or more layers**. Each layer is one of:

### Sample Player

- Single sample: start, end, loop start/end, loop mode (off, forward, ping-pong), crossfade
- Root note, coarse/fine tuning
- Playback modes: one-shot, gated, loop, reverse, reverse one-shot
- Cubic Hermite interpolation for pitch-shifting
- Waveform display with draggable start/end/loop markers
- Drag-and-drop auto-setup (detect one-shot, normalize, trim silence)
- ADSR envelope, velocity→volume curve (configurable: linear, square, logarithmic)
- Velocity zones: each layer triggers only within a velocity range (enables velocity-switched layering)

### Multi-Sample Player

- Multiple samples mapped across velocity layers and/or note zones
- Round-robin: cycle through N samples on repeated triggers
- Velocity crossfading between adjacent layers (smooth, not hard-switched)
- SFZ import support
- O(1) zone lookup: precompute `zone_lut[note][vel_bucket][rr_index]`

### Drum Synth Engines

Purpose-built synthesis algorithms per drum category — not generic oscillator+filter.

#### Kick Engines

**808 Kick (flagship — physically informed model)**

The TR-808 kick uses a bridged-T network (Zobel topology) in an op-amp feedback path. It has no separate VCA — oscillation is inherently self-damping (Werner, DAFx-14, CCRMA).

Key physics:

- **6ms frequency shift on attack**: envelope briefly raises Q and center frequency to ~130Hz (C3-11¢) for <1 period — "not long enough to be perceived as a pitch shift" but "greatly affects the attack, making it punchier and crisper"
- **300ms pitch sigh**: leakage current creates voltage-dependent nonlinearity (softplus: α=14.315, V₀=-0.556) shifting frequency from ~58Hz → ~49Hz over 300ms
- **Click transient**: the 1ms trigger pulse passes through to output via op-amp — not a separate circuit
- **Tone control**: passive lowpass in output stage
- **Decay**: high-shelf filter in feedback buffer controls recirculation (50–800ms)

Simplified parametric model:

```
body = amp_env * sin(phase)
phase += (base_freq * (1 + pitch_amount * pitch_env)) / sample_rate
click = click_env * click_level * filtered_noise
output = saturate(body + click, drive)
```

Parameters: base_freq (30–80Hz), pitch_decay (50–200ms), amp_decay (50–800ms), click_level (0–1), drive (0–10), tone (lowpass cutoff)

**909 Kick**: Dedicated VCO (saw→waveshaper→~sine) + separate noise/click path. Attack knob controls click/noise amplitude. Higher default tuning (~E3/165Hz) than 808.

**Analog Kick**: Tunable sine/triangle, pitch envelope, optional noise layer, optional distortion. Generic but covers wider range than 808/909.

#### Snare Engines

**808 Snare**: Two bridged-T oscillators at 238Hz and 476Hz (octave apart, mixed via Tone pot) + noise through 2749Hz highpass Sallen-Key filter.

**909 Snare**: Similar but sharper noise character.

**Analog Snare**: 1–3 damped resonator modes + two noise bands (sizzle 8–12kHz, grit 2–5kHz) with independent decay times. Couple wire decay to velocity.

#### Hi-Hat / Cymbal Engines

**808 Hi-Hat**: 6 square-wave oscillators at inharmonic frequencies through hex Schmitt trigger, mixed at equal levels. Two bandpass filters at ~3440Hz and ~7100Hz. Closed: ~50ms decay; Open: 350–1200ms. Triggering closed chokes open.

The 6 frequencies are NOT integer ratios — this creates metallic rather than pitched character. Two are tunable (~800Hz, ~540Hz), four are fixed.

**FM Metallic**: Loopback FM (`y[n] = sin(φ[n] + I * y[n-1])`) with fast decay envelope on modulation index — high index at start for "clank", lower for "body". Excellent for wide-ranging metallic percussion.

#### Clap Engine

**808 Clap**: 3–4 rapid sawtooth-shaped sub-envelopes at ~100Hz rate (~10ms each) with diminishing amplitudes, driving bandpass-filtered noise at 1000Hz. A separate ~100ms decay path creates fake reverb tail.

#### Tom Engine

**808 Tom**: Sine/triangle with pitch envelope. Similar to 808 kick but higher pitched, shorter decay. Low/Mid/High by base pitch.

#### Percussion Engines

- **Cowbell**: Two square oscillators at minor third interval, gated short envelope
- **Clave/Rimshot**: Short resonant bandpass-filtered impulse, very fast decay
- **Shaker/Maracas**: Shaped noise bursts with density-controlled grain-like behavior

#### Modal Synthesis Engine (physical percussion)

Sum of damped resonant modes, each excited by impulse. Each mode implemented as a 2-pole resonator (biquad bandpass) — avoids per-mode sine calls, SIMD-friendly.

```rust
struct ModalMode {
    freq: f32,
    decay: f32,     // per-sample multiplier
    gain: f32,
    state: [f32; 2], // biquad state
}
```

Secret sauce: tension modulation (mode frequencies drift with amplitude) + nonlinear damping (decay increases with instantaneous amplitude).

#### Karplus-Strong Layer

Reuse from Fermenter's `physical.rs`. For percussive plucks, tuned metallic hits, and hybrid kits.

### Synth Engine (from Fermenter)

Any pad can use a full Fermenter voice — wavetable, VA, FM, granular, additive. Reuse the exact same Rust code.

## Per-Pad Processing Chain

1. **Layer mixer**: volume, pan, mute/solo per layer
2. **Filter**: SVF/Moog/Diode/Formant (reuse from Fermenter)
3. **Insert FX chain**: EQ, compressor, distortion, delay, reverb (reuse from Fermenter)
4. **Transient shaper**: fast/slow envelope follower → split transient vs sustain → independent gain
5. **Output**: volume, pan, routing (master, bus 1–4, direct out), send 1+2 levels

## Choke Groups

- Pads in same choke group silence each other on trigger
- Implementation: on note-on, fade out other group members (5–10ms)
- At least 16 groups, visual badge on pads
- Primary use: open hi-hat choked by closed hi-hat

## Voice Management

- Per-pad configurable polyphony: 1 (retrigger) or N (overlap)
- Total pool: 64–128 voices shared across all pads
- Stealing priority: same pad oldest first, then global oldest
- Choke group kills are immediate (fast fade, not stealing)

## Transient Detection Algorithms (ODFs)

Critical for auto-slicing, transient shaping, and transient-preserving time-stretch.

**Energy Envelope Derivative (cheapest)**

```
e[m] = Σ_n w[n] x_m[n]²
odf[m] = max(0, e[m] - e[m-1])
```

Useful but misses soft onsets and false-triggers on loud sustain.

**Spectral Flux (best for percussion)**

```
odf[m] = Σ_k max(0, |X(m,k)| - |X(m-1,k)|)
```

More robust — detects spectral change, not just energy. Requires STFT.

**Complex-Domain / Phase Deviation**
Tracks phase evolution across STFT frames. Better for pitched onsets, fewer false positives. More complex.

**Multi-Band ODF Fusion**
Compute ODF in bands (low/mid/high), combine. Most robust for drums with distinct spectral shapes. ~2–3× STFT cost.

**Peak Picking Post-Processing**

1. Smooth ODF with moving average
2. Adaptive threshold: `T[m] = median_filter(odf) + k * std(odf)`
3. Find local maxima where `odf[m] > T[m]` and separated by minimum inter-onset interval

| Method            | Feature            | Pros                  | Cons               | Best Use           |
| ----------------- | ------------------ | --------------------- | ------------------ | ------------------ |
| Energy derivative | Δ energy           | Very cheap            | Misses soft onsets | Simple slicing     |
| Spectral flux     | Δ magnitude        | Robust for percussion | Needs STFT         | Loops/drums        |
| Phase/complex     | Phase deviation    | Fewer false positives | More complex       | Melodic percussion |
| Multi-band fusion | Band ODFs combined | Most robust           | Most compute       | Full auto-slice    |

## Transient Shaper Algorithm

Split signal into transient and sustain components using dual envelope followers:

```
r[n] = |x[n]|                              // rectify
ef[n] = one_pole(r[n], τ_fast)             // fast envelope (~0.5ms)
es[n] = one_pole(r[n], τ_slow)             // slow envelope (~20ms)
t[n] = clamp(ef[n] - es[n], 0, 1)          // transient measure

x_transient[n] = x[n] * (t[n] / (ef[n] + ε))
x_sustain[n] = x[n] - x_transient[n]

output[n] = x_transient[n] * gain_attack + x_sustain[n] * gain_sustain
```

## Auto-Slice Workflow (sample import → kit)

When user drops a drum loop:

1. Compute ODF → onset times
2. Refine each onset to closest zero-crossing or local minimum (reduces clicks)
3. If tempo known, optionally snap to beat grid but preserve micro-timing as groove template
4. Extract per-slice features: RMS, peak, spectral centroid (brightness), duration
5. Auto-map slices to pads: cluster by centroid + duration ("low+long" → kick, "high+short" → hat)
6. Create step sequencer pattern that replays original timing

## Sample Browser & Kit Management

**Sample browser:**

- Tag-based: category (kick, snare, hat, clap, tom, percussion, cymbal, FX), genre (hip-hop, electronic, acoustic, cinematic, lo-fi), character (punchy, warm, bright, dirty, clean)
- Audio preview on hover/click (plays through browser output, not pad FX)
- Waveform thumbnail per sample
- Favorites, recently used, search with fuzzy match
- Factory library: classic machines (808, 909, LinnDrum, SP-1200, CR-78), acoustic kits, cinematic, foley, textures
- Drag from browser → pad

**Kit management:**

- Kit = complete state (all pads, layers, FX, routing, macros, patterns)
- Save/load as JSON, tag-based browser
- A/B compare between two loaded kits
- Starter templates: 808 Kit, 909 Kit, Acoustic Kit, Lo-Fi Kit, Cinematic Kit, Empty Kit

**Import workflows:**

1. **File → pad**: auto-detect one-shot vs loop (length + pattern analysis). One-shot: trim silence, normalize. Loop: offer play-as-loop, auto-slice, or granular source.
2. **Loop → machine**: transient detect → slice → assign to sequential pads → create replay pattern
3. **Multi-sample folder**: detect velocity layers by filename convention or loudness analysis → assign with auto-configured velocity crossfading

## Resampling & Pitch-Shifting

**For drum one-shots** (default: resampling, not time-stretch):

- Linear: 2 taps, fastest, audible HF loss
- Cubic Hermite: 4 taps, good quality/CPU (recommended default)
- Windowed-sinc: 8–64 taps, best quality, expensive

**For loops** (time-stretch approaches):

| Algorithm           | Domain | Transient Handling         | Good For        | Bad For            |
| ------------------- | ------ | -------------------------- | --------------- | ------------------ |
| Resampling          | time   | preserves transients       | one-shots       | loop tempo changes |
| WSOLA               | time   | good with alignment        | rhythmic loops  | extreme polyphonic |
| Phase vocoder       | freq   | smears unless phase-locked | pads, ambience  | sharp drums        |
| Signalsmith Stretch | hybrid | designed for quality       | general purpose | very large stretch |

**WSOLA core**: analysis frames of length L, for each synthesis frame search neighborhood for offset maximizing cross-correlation with previous tail, overlap-add with Hann window. Enhanced WSOLA preserves transients by detecting and protecting transient regions.

## Rust Struct Sketches (Key Data Structures)

```rust
pub struct KickSynth {
    pub phase: f32,
    pub base_freq: f32,     // Hz (30-80)
    pub pitch_decay_s: f32, // seconds (0.05-0.2)
    pub amp_decay_s: f32,   // seconds (0.05-0.8)
    pub click_level: f32,   // 0-1
    pub drive: f32,         // 0-10
    pub env: ExpEnv,
    pub pitch_env: ExpEnv,
    pub click_env: ExpEnv,
}

pub struct LoopbackFm {
    pub phase: f32,
    pub freq: f32,
    pub index: f32,         // modulation index (envelope-controlled)
    pub fb: f32,            // feedback amount
    pub y_prev: f32,        // previous output for feedback
}

pub struct ModalMode {
    pub freq: f32,
    pub decay: f32,         // per-sample multiplier: exp(-1/(τ*fs))
    pub gain: f32,
    pub state: [f32; 2],    // biquad resonator state
}

pub struct ModalPerc {
    pub modes: [ModalMode; MAX_MODES],  // MAX_MODES ~= 16-32
    pub mode_count: usize,
    pub exciter: Exciter,   // impulse/noise burst/force profile
}
```

## DC Blocking & Denormal Protection

**DC blocker** (Julius O. Smith):

```
y[n] = x[n] - x[n-1] + R * y[n-1]
R ≈ 0.995 at 44.1kHz (~32Hz cutoff)
```

**Denormal protection:**

- x86: set MXCSR register `_mm_setcsr(csr | 0x8040)` (FTZ bit 15, DAZ bit 6)
- ARM/Apple Silicon: flush by default
- Portable fallback: add `1e-15` (alternating sign each buffer) to IIR filter inputs
- Without protection: IIR states decaying toward zero cause **10–100× CPU spikes**

## Dattorro Plate Reverb Constants (at 29761 Hz base)

Scale all to runtime sample rate: `scaled = round(base * fs / 29761)`

- Input diffuser allpass sizes: **142, 107, 379, 277**
- Modulated allpass sizes: **672, 908**
- Tank delays: **4453, 4217, 3720, 3163**
- Decay diffusers: **1800, 2656**
- Output taps: **266, 2974, 1913, 1996, 1990, 187, 1066**

**Drum-specific sauce**: short pre-delay + higher input diffusion → clean transient + dense tail. Per-voice mini-plate (tiny delay lengths) creates "each hit has its own space" (WASM-budget permitting).

## GPU Compute (WGSL Pseudocode)

**Pattern Heatmap Visualization:**

```wgsl
struct Step { vel: f32, prob: f32, trig: u32, pad: u32, step: u32 };

@group(0) @binding(0) var<storage, read> steps: array<Step>;
@group(0) @binding(1) var<uniform> u: Uniforms;

@vertex fn vs(@builtin(instance_index) ii: u32) -> VSOut {
    let s = steps[ii];
    let x = f32(s.step) / f32(u.steps_total);
    let y = f32(s.pad) / f32(u.pad_count);
    // Build quad in clip space, pass intensity to fragment
}

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
    let intensity = in.trig * in.vel * in.prob;
    return vec4f(intensity, intensity, intensity, 1.0);
}
```

**FFT (Stockham-style) for Spectrum:**

```wgsl
@group(0) @binding(0) var<storage, read_write> buf: array<vec2f>; // complex
@group(0) @binding(1) var<uniform> u: FFTUniforms;

@compute @workgroup_size(256)
fn fft_stage(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u.N / 2u) { return; }
    let a = buf[index_a(i, u.stage)];
    let b = buf[index_b(i, u.stage)];
    let w = twiddle(i, u.stage, u.N);
    let t = cmul(b, w);
    buf[out0(i, u.stage)] = a + t;
    buf[out1(i, u.stage)] = a - t;
}
```

## Oversampling Filter Design

**Halfband IIR filters** (allpass decomposition) are the standard for real-time:

- ~1 sample latency vs hundreds for linear-phase FIR
- For 4× oversampling, cascade two halfband stages; for 8×, three
- Professional stopband: **100–144dB**
- **2× sufficient for gentle saturation** (tanh); aggressive waveshaping needs **4–8×**
- Each 2× only provides 6dB alias rejection — MinBLEP's 70–80dB is vastly superior for oscillators

## Velocity & Filter Mapping

**Velocity**: square-law relationship `amplitude = (m * velocity + b)²`. Apply power of **0.8** to normalized velocity before exponential mapping (empirically most musical — Dannenberg CMU 2006).

**Filter cutoff**: must use exponential frequency mapping since pitch perception is logarithmic. `freq = 20 * pow(1000, knob_position)` → 0→20Hz, 0.5→632Hz, 1.0→20kHz.

**Envelope times**: logarithmic mapping (1ms to 10s) so short times are resolvable on the knob.

---

# Part 3: Integrated Step Sequencer

## Pattern Structure

- Grid of steps for all pads simultaneously
- Configurable: 16/32/48/64 steps (default 16), resolution 1/4 to 1/32 (default 1/16)
- **Per-pad step count** (polymetric): kick=16, hat=15 → evolving patterns (Elektron approach)
- Multiple patterns (A–H) with chaining/arrangement

## Per-Step Data

```rust
struct Step {
    active: bool,
    velocity: f32,          // 0–1
    probability: f32,       // 0–1 (1 = always)
    micro_timing: f32,      // -0.5 to +0.5 steps
    retrigger_count: u8,    // 0 = normal, 1–16
    retrigger_rate: f32,    // fraction of step duration
    parameter_locks: SmallVec<ParamLock>,
    sound_lock: Option<SoundId>,
    condition: StepCondition,
}
```

## Parameter Locks (Elektron-style)

Every step can override any pad parameter. Stored as sparse key-value pairs. Applied at trigger time, reverted on next step.

## Conditional Triggers

- Always, Fill, NotFill, Probability(%), FirstPlay, NotFirstPlay, Ratio(A:B)
- Deterministic: seeded from `(pattern_id, bar, step, pad)` for reproducible playback

## Swing/Groove

- Global swing: shifts alternating steps
- Groove templates: MPC swing, SP-1200 timing, TR-808 shuffle (stored as micro-timing arrays)
- Per-pad independent groove
- Humanization: filtered random (low-freq drift) + per-hit micro jitter

## Euclidean Rhythm Generator

`E(k, n, rotation)`: distribute k hits across n steps as evenly as possible. Bjorklund recursive algorithm. Generates many traditional rhythmic patterns.

## Ratcheting

Sub-triggers within a step: `sub_interval = step_duration / ratchet_count`. Each sub-trigger gets tapered velocity.

## Pattern Morphing

Interpolate between patterns A and B: triggers by probability crossfade, velocity linear, microtiming interpolated, ratchets nearest-integer.

---

# Part 3.5: AI Groove & Pattern Generation

Grinder's step sequencer (Part 3) is the **sole write path** for AI-generated rhythmic content. AI does not produce audio and does not run on the audio thread — it produces `Pattern` / `Step` deltas that are committed to the sequencer model exactly as if a user had edited the grid. This part specifies three cooperative features — a **groove-quality classifier**, a **text-to-pattern generator**, and **template-based groove extraction/application** — and how each integrates with the existing step sequencer UI and data structures.

## Runtime placement

- **Native (Tauri shell):** ONNX inference runs in a Rust worker thread via the `ort` crate (ONNX Runtime). The audio thread is never touched. Inference requests arrive on an MPSC channel; results return via a Tauri event. Model files ship as app resources.
- **Web (browser-only builds and AudioWorklet-only contexts):** Inference runs on a dedicated Web Worker via ONNX Runtime Web (WASM backend; WebGPU backend when available and the user opts in). The AudioWorklet is never touched.
- **All inference is off the audio thread.** The audio thread reads only the committed `Pattern` after a UI-side commit (see "Preview and commit" below).

This follows the Tauri-platform placement rules in `.agents/skills/tauri-platform/SKILL.md`: inference is a Rust concern on native and a Web Worker concern on web; the audio thread stays deterministic.

## Data contract

All three features read and write the existing `Pattern` / `Step` types defined in Part 3. No new persisted formats are introduced; AI output is simply a `Pattern` delta that the sequencer's commit path accepts:

```rust
pub struct PatternDelta {
    pub pad_id: PadId,
    pub steps: Vec<StepDelta>, // sparse: only changed steps
}

pub enum StepDelta {
    SetActive { index: u8, active: bool, velocity: f32 },
    SetMicroTiming { index: u8, offset: f32 },    // -0.5..+0.5 steps
    SetProbability { index: u8, probability: f32 },
    SetRatchets { index: u8, count: u8 },
    Clear { index: u8 },
}
```

A `PatternDelta` is the only object AI features emit. UI applies it by calling the same sequencer mutators used by manual edits. Undo/redo, parameter locks, and conditional triggers behave identically regardless of origin.

## Feature 1 — Groove-quality classifier (CNN-on-mel-spectrograms)

**Purpose.** Score a candidate pattern's rhythmic quality and/or genre fit, so (a) text-to-pattern can rank samples it generates and (b) the user can see a "Groove Fit" meter on any pattern (manual or generated).

**Model.** A small convolutional classifier over **mel-spectrograms** of a short (2–4 bar) rendered preview of the candidate pattern played through a neutral kit. Output: a soft probability distribution over a fixed genre/groove label set (e.g. `{ boom-bap, trap, house, techno, drum-and-bass, afrobeat, amen-break, generic }`), plus a scalar "groove quality" score in `[0, 1]`. Exact architecture (e.g. 4-layer CNN → GAP → MLP head) is an implementation choice subject to the latency AC below.

**Input pipeline.**

1. Offline-render the candidate `Pattern` through the currently selected kit using the engine's offline render path (no realtime audio device required).
2. Compute a log-mel spectrogram: 22.05 kHz mono downsample, 2048-FFT, 512-hop, 128 mel bins, log-magnitude, zero-mean / unit-variance per clip.
3. Crop/pad to a fixed `(128, T_max)` tensor (`T_max` set so total bar length ≤ 4 bars at 200 BPM).
4. Run ONNX model.

**Surface.**

- Small "Groove Fit" chip on every pattern slot (A–H) in the sequencer header (Level 3+), showing top-1 label and quality score.
- The chip is **advisory only**. It never modifies the pattern.

**Acceptance criteria.**

- [ ] For a curated ground-truth set of ≥ 50 hand-labelled patterns covering all label classes, the top-1 genre classification accuracy is ≥ 70 % and the quality score has Spearman correlation ≥ 0.5 with human-rated quality.
- [ ] End-to-end latency from "classify this pattern" to result, measured on a reference laptop (Apple M1 / 16 GB), is ≤ 250 ms for a 2-bar pattern — broken down roughly as ≤ 150 ms offline render + ≤ 50 ms mel + ≤ 50 ms inference. On a reference web target (Chrome / M1), ≤ 500 ms.
- [ ] Classification runs entirely off the audio thread. A verification test triggers classification during playback and asserts that audio callback run-time distribution (p99) is unchanged versus a playback-only control within ±10 %.
- [ ] The classifier loads its model lazily on first use and caches it for the session; first-use cost is reported to the UI as a "warming up" state and does not block the sequencer.

## Feature 2 — Text-to-pattern (prompt → structured JSON)

**Purpose.** User types a short prompt (e.g. "slow boom-bap with ghost snares on 3e") and receives a candidate `Pattern` proposal they can preview and commit.

**Model and inference location.**

- Native: a small local LLM (e.g. Phi-3-mini or a comparable ≤ 4 B parameter model) via `ort` with quantized weights, OR a call-out to a configured cloud endpoint if the user has enabled one. Both paths emit the same JSON shape.
- Web: same choice surface, but the local path uses ONNX Runtime Web with WebGPU when available.
- Choice of specific model is an open question (see below). The spec fixes the **interface**, not the model.

**Prompt contract.** The LLM is constrained to emit JSON matching this schema:

```json
{
  "bars": 1,
  "resolution": 16,
  "swing": 0.12,
  "steps": [
    { "pad": "kick",  "index": 0,  "velocity": 1.00, "probability": 1.0, "micro": 0.00 },
    { "pad": "snare", "index": 4,  "velocity": 0.85, "probability": 1.0, "micro": -0.02 },
    { "pad": "hat",   "index": 2,  "velocity": 0.60, "probability": 0.9, "micro": 0.00 }
  ],
  "kit_deltas": []
}
```

Parsing is strict: invalid JSON, out-of-range velocities, or unknown pads cause the proposal to be rejected (user sees a "model returned invalid pattern — try again" toast). Valid proposals are converted to a `PatternDelta` against the currently selected pattern slot.

**Preview and commit model.** Proposed deltas are **never auto-committed**. Flow:

1. User enters prompt in the sequencer's prompt field (visible at Level 3+).
2. Worker returns a JSON proposal; UI converts it to a `PatternDelta` and renders it in a **preview overlay** on the step grid (distinct color from manual steps).
3. Playback plays the previewed pattern without overwriting the underlying slot.
4. User clicks **Accept** (commits the delta) or **Reject** (discards it). Accept goes through the same mutator path as a manual edit — undoable.

Only steps that the prompt explicitly mentions may appear in the delta; steps the model "decides" to add spuriously are rejected at parse time if they fall outside the prompt's stated intent (bar/resolution/pad list).

**Acceptance criteria.**

- [ ] Over a fixed suite of 10 canonical prompts (recorded in the test fixtures) evaluated across 20 trials each (200 total outputs), "slow boom-bap" prompts produce patterns with **kick density ≥ 70 % on beats 1 and 3** and **snare hits on beats 2 and 4 in ≥ 90 % of trials**.
- [ ] "Four-on-the-floor house" prompts produce kick on every downbeat in ≥ 95 % of trials and a hat pattern whose inter-onset interval distribution peaks at the 8th-note grid.
- [ ] Schema-invalid outputs are rejected without crashing and surface a user-visible, non-technical error. The test suite includes adversarial prompts designed to elicit malformed JSON; failure-mode rate must be 100 % rejection, 0 % silent pattern corruption.
- [ ] Proposals always appear in a preview overlay; a test verifies that `pattern_slot.steps` is unchanged until the user presses Accept.
- [ ] Prompt-to-preview latency ≤ 3 s on the reference native target for local inference; ≤ 6 s on the reference web target. If exceeded, UI shows cancellable progress.

## Feature 3 — Template groove extraction and application

**Purpose.** Extract the groove (swing, micro-timing, velocity curve, ghost-hit pattern) from a source pattern and re-apply it to a different kit or different note content, producing the MPC / SP-1200 / TR-808-shuffle "feel transfer" workflow.

**Extraction.** Given a source `Pattern` (e.g. a hand-authored or imported 808/909 pattern), compute a `GrooveTemplate`:

```rust
pub struct GrooveTemplate {
    pub resolution: u8,                      // 16, 32, etc.
    pub swing: f32,                          // global swing ratio
    pub micro_timing: [f32; MAX_STEPS],      // per-step offset in ticks (960 PPQN reference)
    pub velocity_curve: [f32; MAX_STEPS],    // per-step velocity gain 0..1 relative to nominal
    pub ghost_mask: [bool; MAX_STEPS],       // which steps are ghost hits (velocity < 0.4)
}
```

The template is purely timing + dynamics. It contains **no pad identities, no sample references, and no synth parameters** — it is the re-applicable shape of the groove.

**Application.** Given a target `Pattern` on any kit and a `GrooveTemplate`, the groove-apply operation:

1. Leaves the target's **step activation pattern** unchanged (kicks stay where they are).
2. Overwrites each active step's `micro_timing` with the template's value (or proportionally mapped if resolutions differ).
3. Multiplies each active step's `velocity` by the template's velocity curve.
4. Sets the pattern's global `swing` from the template.
5. Emits a single `PatternDelta`; the UI routes it through the same preview-and-commit flow as Feature 2.

**Curated library.** Ship with at minimum: "TR-808 shuffle", "TR-909 swing 58 %", "MPC swing 54 %", "MPC swing 62 %", "SP-1200 straight", "J-Dilla late-snare". Each is a hand-authored `GrooveTemplate` stored as JSON in the app resources.

**Generation from reference audio (stretch, optional for v1).** Extracting a `GrooveTemplate` from a reference audio loop (rather than a MIDI pattern) requires transient detection and is covered by the auto-slice path (Part 2, lines 298-307). When that path surfaces a sliced rhythmic pattern, the groove-extract function runs on the detected onsets and their relative amplitudes. This mode is gated behind Level 5 UI.

**Acceptance criteria.**

- [ ] Extract a `GrooveTemplate` from a known 808 reference pattern, apply it to a different kit pattern, and measure: per-step timing deviation between re-applied and source is within **±5 ticks at 960 PPQN** (≈ ±5 ms at 120 BPM) for every active step.
- [ ] Velocity curve re-application preserves the source's relative dynamics: per-step velocity ratio (re-applied / source) has standard deviation ≤ 0.05 over a suite of 10 reference patterns.
- [ ] Applying a `GrooveTemplate` to an empty pattern is a no-op (nothing to time-shift).
- [ ] A round-trip (extract template from pattern A → apply to pattern A again) is idempotent: the resulting `Pattern` is bit-identical to the input.
- [ ] The groove-apply operation emits one `PatternDelta` and goes through the preview-and-commit flow; a test verifies no direct mutation of `pattern_slot` occurs before Accept.
- [ ] Ships with the curated library listed above, each passing the round-trip test on synthetic patterns.

## Integration point with the existing sequencer UI

- **Level 1–2:** No AI UI surface. Groove Fit chips are hidden.
- **Level 3 — Build:** Prompt field in the step sequencer header (Feature 2). Groove-template picker in the swing/groove control area (Feature 3). Groove Fit chip on each pattern slot (Feature 1). All preview-and-commit.
- **Level 5 — Lab:** Exposes inference settings (model choice, local vs cloud, batch size). Exposes groove extraction from audio loops.

All AI UI is additive; existing step-sequencer interaction is unchanged. A user who never interacts with an AI control gets identical behavior to today.

## Out of scope

- AI-generated **audio** (sample synthesis, neural drum synthesis). This spec only covers MIDI-level / pattern-level generation. Neural audio would be a separate spec.
- Real-time AI reaction to incoming MIDI (e.g. "complete this phrase live"). Inference latency targets here assume on-demand generation, not continuous adaptation.
- Training or fine-tuning pipelines. Models are consumed as shipped ONNX files; training is a separate concern.
- Persisted preference learning across sessions for the quality classifier. The classifier is stateless per session.

## Open questions

- [CRITICAL] **Model choice for Feature 2 (text-to-pattern).** Candidates: Phi-3-mini (MIT license, ~3.8 B params, ~2 GB quantized), Llama-3.2-1B (community license with commercial terms), Qwen2.5-0.5B (Apache 2.0). Unresolved: which meets the ≤ 3 s native latency AC while satisfying the prompt-adherence ACs, and whose license is compatible with distributing a commercial DAW app. Implementation is blocked until this is resolved.
- **Model distribution.** Ship models bundled (large installer) vs download on first use (smaller installer, first-run network requirement). Likely bundled for native, lazy-download for web, but needs product confirmation.
- **Cloud fallback policy.** If a user has disabled cloud inference but has no compatible local model, Feature 2 UI must be disabled. Exact wording / discoverability of this state is a UX question, not a spec question, but the toggle needs to exist from day one.
- **Classifier label set.** The initial genre/groove label set above is a straw-man; the actual set should be validated against Sourdaw's target users. Not a blocker for implementation — the first set can ship as an enumerated constant and evolve.
- **Groove extraction from audio — transient-to-microtiming mapping precision.** The auto-slice path produces onset timestamps; the mapping from onsets to `GrooveTemplate` indices needs a quantization step whose tolerance to timing ambiguity is not yet specified. Not a blocker for v1 (MIDI-source extraction ships first).

## Dependencies

- Native: `ort` crate (ONNX Runtime bindings), `rustfft` or similar (mel-spectrogram compute), `serde_json`.
- Web: `onnxruntime-web` (npm), WebAudio `OfflineAudioContext` for offline render, a mel-spectrogram WASM module or JS implementation.
- Model files: placed in `resources/ai-models/` with per-file license/provenance metadata. Any model added to this directory must have a `<model>.LICENSE` sibling file.

---

# Part 4: Performance Features

## Pad Performance Modes

- **Velocity-sensitive**: configurable curve per pad (linear, square root, logarithmic, S-curve)
- **16 Levels (MPC-style)**: entire grid becomes 16 velocity/parameter levels of selected pad
- **Note Repeat**: tempo-synced retrigger (1/4 to 1/32, triplet), velocity ramp options
- **Mute/Solo**: instant per-pad with visual feedback
- **Fill mode**: activates Fill-conditioned steps when held

## Sampling into Pads

- Record from mic/input → assign to pad
- Resample: bounce drum machine output into a pad
- Auto-chop: transient detection → slice loop → assign to pads → create pattern

## Kit Macros

8 knobs with kit-wide scope. Default mappings:

- Tune, Decay, Color (filter), Punch (transient), Space (reverb send), Drive, Swing, Dynamics

---

# Part 5: Routing & Mixing

```
Pad → [Layers → Filter → Insert FX → Transient Shaper] → Output Selector
                                                              ↓
                                                   Master Bus → Master FX → Output
                                                   Bus 1–4   → Bus FX    → Output
                                                   Direct Out → DAW channel
```

- 2 global sends (reverb + delay), per-pad send levels
- Per-pad mixer: volume, pan, mute/solo, output routing, send levels, meter
- Mixer view: all pad channels side by side

---

# Part 6: Lo-Fi / Vintage Character

Inspired by SP-1200 (12-bit @ 26.04kHz, no reconstruction filter, SSM2044 VCF):

- **Bit reduction**: `output = round(input * 2^(bits-1)) / 2^(bits-1)` with TPDF dither
- **Sample rate reduction**: sample-and-hold at reduced rate (creates aliasing)
- **Analog filter**: 1–2 pole lowpass at reduced Nyquist
- **Tape saturation**: harmonic distortion + HF rolloff + compression
- **Vinyl noise**: hiss, crackle, hum (optional)

Classic machine templates: TR-808, TR-909, LinnDrum, CR-78, SP-1200 character

---

# Part 7: DSP Secrets (from research)

## The 808 Kick Secret

The pitch envelope is NOT exponential — it's a coupled RC network with voltage-dependent nonlinearity. The 6ms attack blip is less than one period at the higher frequency but critically affects punch. The 300ms "sigh" uses a softplus-like function (α=14.315). The click is just the trigger pulse passing through the op-amp.

## Filter Secrets

**Saturation INSIDE the feedback path = warm. OUTSIDE = harsh.** This is the single most important DSP insight:

- Moog: each stage saturates inputs independently (`g * (tanh(Vin/2Vt) - tanh(Vfb/2Vt))`)
- CEM3320 (Prophet): saturates the difference (`gm * tanh((Vin - Vfb) / 2Vt)`)
- TB-303: inter-stage coupling, first capacitor half-value → "broken 24dB" slope

## Compression Secrets

- **1176 "all buttons"**: ratio ~12–20:1, lag on initial transient lets it through, ratio increases after
- **LA-2A**: CdS photoresistor has physical "light memory" — longer illumination = slower recovery
- **SSL bus**: dual auto-release (τ=619ms fast ∥ τ=353ms slow), VCA produces 2nd harmonic distortion

## Reverb Secrets

- Modulating delay times (0.3–2Hz, 4–16 samples depth) breaks periodicity and eliminates metallic coloration
- Echo density must reach 2000–4000/sec for diffuse sound
- Frequency-dependent decay: filters INSIDE feedback, not after

## Velocity Mapping

Square-law relationship: `amplitude = (m * velocity + b)²`. Apply power of 0.8 to normalized velocity before exponential mapping (empirically most musical).

---

# Part 8: Modulation (Per-Pad)

Sources: Velocity, Note number, Envelope 1 (amp), Envelope 2 (aux), LFO (tempo-syncable), Random (per-trigger), Macros 1–8

Key routings:

- Velocity → Volume (always), → Filter cutoff, → Pitch envelope depth (kicks), → Noise amount (snares)
- Envelope 2 → Pitch (kick sweep), → Filter cutoff
- LFO → Pan (auto-pan), → Filter for movement

Same drag-drop UX as Fermenter with colored rings on knobs.

---

# Part 9: UI — Progressive Disclosure (5 Levels)

## Layout Zones (same structure as Fermenter)

1. **Top bar**: Kit name/browser, save/load, level switcher, CPU/voice meter
2. **Macro strip**: 8 kit-wide knobs
3. **Left panel**: Pad grid (primary interaction — clicking a pad drives the inspector)
4. **Center panel**: Context inspector (selected pad controls, or step sequencer, or mixer)
5. **Bottom dock**: Step sequencer (Build+) or modulation dock
6. **Right panel**: FX chains (per-pad, bus, send)

## Level 1 — Play

- Pad grid with colors and names (hit to play)
- Kit browser, macro strip, pattern select, play/stop
- **Nothing else.** Clean, inviting, immediate.

## Level 2 — Shape

- Selected pad's sound source (simplified: engine selector + primary knobs)
- Basic filter + envelope
- One-knob transient shaper
- Basic sample editor (start/end waveform)

## Level 3 — Build

- Full layer stack per pad (add layers, velocity zones)
- Step sequencer (toggle steps, set velocity, basic probability)
- Choke groups, output routing
- Per-pad effects chain

## Level 4 — Route

- Full routing view (pad → bus → master)
- Bus FX chains, send levels
- Multi-output config
- Per-pad mixer view (all channels)

## Level 5 — Lab

- Full drum synth engine parameters
- Parameter locks in sequencer
- Conditional trigs, polymetric step counts
- Micro-timing editor, Euclidean generator
- Auto-chop/slice tools, resample
- Lo-fi processing, advanced sample editing

---

# Part 10: Implementation Priority Tiers

## Tier 1 — Core (Must Have)

- 16-pad grid with MIDI mapping
- Kick synth (808 model + generic analog)
- Snare synth (noise + resonator)
- Hi-hat synth (metallic multi-osc)
- Clap synth (multi-burst noise)
- Sample player (one-shot, basic)
- Per-pad ADSR + filter (SVF)
- Basic step sequencer (16 steps, velocity)
- Choke groups
- Master reverb + delay sends
- Preset save/load (JSON)

## Tier 2 — Competitive (Should Have)

- 909 kick/snare/hat engines
- Multi-sample with velocity layers + round-robin
- Per-pad insert FX chain
- Parameter locks in sequencer
- Conditional triggers + probability
- Swing/groove templates
- Transient shaper per pad
- 4 bus routing
- Lo-fi vintage mode (bit/rate reduction)
- Kit macros (8 knobs)
- Euclidean rhythm generator

## Tier 3 — Differentiating (Nice to Have)

- 808 circuit-faithful kick model (Werner/CCRMA)
- Modal synthesis percussion engine
- FM/loopback FM percussion
- Granular drum textures
- Auto-chop/slice workflow
- Polymetric step counts
- Ratcheting/flam per step
- 16 Levels mode + Note Repeat
- Pattern morphing
- Sound locks (different source per step)

## Tier 4 — Stretch Goals

- Record into pad (sampling)
- Resample workflow
- Time-stretch for loops (WSOLA)
- GPU FFT spectrum visualization
- AI pattern generation (LLM + templates)
- SFZ import
- Multi-output (per-pad DAW channels)
- Convolution reverb (partitioned)

---

# Part 11: Integration with Sourdaw

The drum machine (codename: **Grinder**) is a device type in the DAW, just like Fermenter:

- Receives MIDI from track input
- Audio output → DAW mixer (master or multi-out)
- Automation of any parameter from DAW automation lanes
- Drag-drop samples from DAW browser to pads
- Step sequencer patterns exportable as MIDI clips
- Shares all DSP with Fermenter — zero code duplication

# Mathematical models for classic analog drum synthesis

**Every iconic drum machine sound from the TR-808, TR-909, LinnDrum, CR-78, and SP-1200 can be recreated digitally using well-documented circuit equations, and MIT-licensed Rust reference code already exists.** The academic foundation is remarkably solid: Kurt Werner's 2016 Stanford dissertation provides complete ODE systems for the 808's bridged-T networks, while the Stanford CCRMA paper on the SP-1200 details the exact drop-sample algorithm that creates its signature crunch. This appendix provides the transfer functions, component-derived coefficients, envelope models, and implementation strategies needed to build all major voices in Sourdaw's drum engine.

---

## 1. TR-808 bass drum: the bridged-T oscillator in full

The 808 kick is the most thoroughly analyzed analog drum circuit in academic literature. Werner, Abel, and Smith (DAFx-14, 2014) decomposed it into six cascaded blocks: trigger logic → pulse shaper → bridged-T network → feedback buffer → envelope generator → output stage. Each block has a closed-form transfer function.

### Bridged-T network component values and center frequency

From the Roland service manual (June 1981), the core oscillator components are:

| Component | Value  | Role                              |
| --------- | ------ | --------------------------------- |
| R165      | 47 kΩ  | Series resistance (switchable)    |
| R166      | 6.8 kΩ | Series resistance (always active) |
| R167      | 1 MΩ   | Shunt feedback resistance         |
| C41       | 15 nF  | Capacitor leg 1                   |
| C42       | 15 nF  | Capacitor leg 2                   |

**Center frequency formula:**

```
fc = 1 / (2π × √(R_eff × R167 × C41 × C42))
```

At steady state, `R_eff = R165 + R166 = 53.8 kΩ`, yielding **fc ≈ 49.4 Hz** (G1 + 14 cents). The service manual lists 56 Hz typical; real units measure 48–60 Hz due to **±20% capacitor tolerance**.

### The attack frequency jump

The envelope generator (Q41–Q43) produces a **~5 ms pulse** that grounds R165 through Q43's collector, reducing R_eff from 53.8 kΩ to just **6.8 kΩ** (R166 alone). This raises the instantaneous center frequency to approximately **130 Hz** — over an octave above resting pitch. The resulting downward chirp is too fast to perceive as pitch but creates the attack's characteristic "punch."

### Bridged-T transfer function (bandpass, forward path)

```
H(s) = (β₂s² + β₁s + β₀) / (α₂s² + α₁s + α₀)

β₂ = R_eff × R167 × C41 × C42
β₁ = R_eff × C41 + R167 × C41 + R_eff × C42
β₀ = 1
α₂ = R_eff × R167 × C41 × C42
α₁ = R_eff × (C41 + C42)
α₀ = 1
```

The feedback path transfer function (from feedback buffer to bridged-T output) is:

```
H_fb(s) = (Rk × R167 × C41 × s) / (Rk × R167 × C41 × C42 × s² + Rk × R170 × (C41 + C42) × s + Rk + R170)
```

where `Rk = R161 ‖ (R165 + R166)`.

### Feedback buffer (decay control)

```
H_fb(s) = (R169 × VR6k × C43 × s + R169) / (R164 × (R169 + VR6k) × C43 × s + R164)
```

where `VR6k = VR6 × k` and `k ∈ [0, 1]` is the decay knob position. **Decay range: 50–800 ms** (300 ms at center). This is a first-order high-shelf filter whose gain increases with k, sustaining oscillation longer.

### Pulse shaper nonlinear ODE

The trigger pulse passes through a shelf filter with diode D53 (1N4148):

```
R162 × R163 × C40 × (dV_trig/dt − dV⁺/dt) − R162 × V_trig
  + (R162 + R163) × V⁺ − R162 × R163 × Is × (e^(V⁺/(n×VT)) − 1) = 0
```

where **Is ≈ 10⁻¹² A**, **VT ≈ 26 mV**, n ≈ 1. The diode clips the negative swing at **~0.71 V**, leaving positive voltages unaffected. In Rust pseudocode, the memoryless nonlinearity after the linear shelf filter is:

```rust
fn pulse_shape(v: f32) -> f32 {
    if v >= 0.0 { v } else { -0.71 * (v.exp() - 1.0) }
}
```

### Pitch sigh: transistor Q43 leakage model

The gradual downward pitch drift through the decay ("pitch sigh") is caused by residual collector current in Q43. Werner fits this as:

```
i_C = −ln(1 + e^(α × (V_comm − V₀)))^m / α
```

with fitted constants **α = 14.3150**, **V₀ = −0.5560**, **m = 1.4765 × 10⁻⁵**. As the control voltage decays, R_eff smoothly transitions from 6.8 kΩ back toward 53.8 kΩ, sweeping pitch downward.

### Discrete-time implementation

Werner recommends **bilinear transform** (c = 2/T) for all continuous-to-discrete conversions, implemented in **Transposed Direct Form II** (TDF-II) for numerical stability under time-varying coefficients. The delay-free feedback loop is resolved by inserting a **single unit delay** after the feedback buffer — negligible at kick drum frequencies relative to 48 kHz sample rate. All six blocks cascade in series, with nonlinearities applied as memoryless functions between filter stages.

```rust
// Per-sample kick drum processing (simplified)
fn process_kick(&mut self, trigger: bool, accent: f32) -> f32 {
    // 1. Trigger: accent controls voltage (5V normal, up to 15V accented)
    let v_trig = if trigger { 5.0 + accent * 10.0 } else { 0.0 };

    // 2. Pulse shaper: first-order shelf filter + diode clip
    let shaped = self.pulse_shelf.process(v_trig);
    let shaped = pulse_shape(shaped);

    // 3. Envelope: 5ms pulse controls R_eff
    self.env_timer = if trigger { 0.005 * SAMPLE_RATE } else { (self.env_timer - 1.0).max(0.0) };
    let r_eff = if self.env_timer > 0.0 { 6800.0 } else { 53800.0 };
    // Smooth r_eff for pitch sigh using Q43 leakage model

    // 4. Update bridged-T coefficients from r_eff
    self.bridged_t.update_coefficients(r_eff, R167, C41, C42);

    // 5. Process bridged-T with feedback
    let bt_out = self.bridged_t.process(shaped + self.feedback);
    self.feedback = self.feedback_buffer.process(bt_out) * self.decay_gain;

    // 6. Output: LPF (tone) → level → HPF (6.7 Hz DC block)
    let out = self.tone_lpf.process(bt_out);
    self.dc_block.process(out * self.level)
}
```

### Accent circuit behavior

Accent is **not just volume**. The CPU trigger voltage ranges from **5 V (unaccented) to 15 V (full accent)**. Higher trigger voltage increases the pulse amplitude into the bridged-T, which increases both loudness AND:

- **Longer ring time** (more energy in the resonator)
- **More pronounced pitch chirp** (higher initial excitation of the frequency-shifted mode)
- **Greater harmonic content** from the diode nonlinearity seeing larger signals
- In swing-type VCAs used on other voices, higher control voltage drives the transistor harder, adding **saturation harmonics**

---

## 2. TR-808 snare, hi-hat, and percussion voices

### Snare drum: dual bridged-T plus noise

The snare uses two bridged-T oscillators tuned roughly an octave apart, mixed with bandpass-filtered white noise.

**Lower oscillator (from service manual):** R196 = 680 Ω, R197 = 820 kΩ, C58 = 56 nF, C59 = 27 nF → **fc ≈ 173 Hz** (revised; original ~238 Hz). **Upper oscillator:** R195 = 2.2 kΩ, R198 = 1 MΩ, C60 = 6.8 nF, C61 = 15 nF → **fc ≈ 335 Hz** (revised; original ~476 Hz). The **Tone** knob (VR8) crossfades between oscillators. The **Snappy** knob (VR9) controls the noise VCA envelope amplitude.

The noise source is a reverse-biased **2SC828 NPN transistor** generating avalanche (white) noise, bandpass-filtered through a Sallen-Key 2-pole HPF at **~2749 Hz**. An attenuated noise envelope is summed into the oscillator excitation, coupling the "snappy" character into the tonal attack.

### Hi-hat and cymbal: six square-wave oscillators

A **Hitachi HD14584** hex Schmitt trigger inverter IC generates six square waves via RC astable multivibrators. Werner (ICMC 2014) measured these frequencies from SPICE simulation:

| Oscillator | Frequency    | Note     | Tunable                |
| ---------- | ------------ | -------- | ---------------------- |
| 1          | **800 Hz**   | G5 +35¢  | Yes (TM1), 359–1150 Hz |
| 2          | **540 Hz**   | C♯5 −45¢ | Yes (TM2), 254–627 Hz  |
| 3          | **522.7 Hz** | C5 −2¢   | Fixed                  |
| 4          | **369.6 Hz** | F♯4 −2¢  | Fixed                  |
| 5          | **304.4 Hz** | D♯4 −38¢ | Fixed                  |
| 6          | **205.3 Hz** | G♯3 −20¢ | Fixed                  |

The Schmitt trigger oscillator frequency is:

```
f = 1 / (2 × R_osc × C_osc × ln((VDD − VT⁻)/(VDD − VT⁺)))
```

All six outputs are summed, then split into **two bandpass filters**: BPF1 at **~3440 Hz** and BPF2 at **~7100 Hz**. Each feeds a separate VCA with independent envelopes. Closed hat has a fixed **50 ms** decay; open hat is adjustable **90–600 ms**. The cowbell taps oscillators 1 and 2 through a BPF centered at **~850 Hz** (Q ≈ 4.25) with a **50 ms** decay.

The **choke mechanism**: when closed hat triggers while open hat is sounding, transistor Q23 immediately kills the open hat VCA envelope.

```rust
// Hi-hat oscillator bank (simplified)
const HH_FREQS: [f32; 6] = [800.0, 540.0, 522.7, 369.6, 304.4, 205.3];

fn generate_metallic_noise(&mut self, sample_rate: f32) -> f32 {
    let mut sum = 0.0;
    for i in 0..6 {
        self.phase[i] += HH_FREQS[i] / sample_rate;
        if self.phase[i] >= 1.0 { self.phase[i] -= 1.0; }
        // Square wave: +1 or -1
        sum += if self.phase[i] < 0.5 { 1.0 } else { -1.0 };
    }
    sum / 6.0 // Normalize
}
```

### Handclap: multi-burst envelope

Bandpass-filtered white noise (center **~1000 Hz**) passes through two parallel VCA paths. Path 1 uses a **sawtooth-shaped envelope with 3 rapid bursts** (~10 ms each) followed by a 20 ms final discharge — total **~50 ms**. Path 2 provides a simple **100 ms decay** tail (fake reverb). This multi-burst pattern simulates multiple hands clapping at slightly different times.

### Remaining voices quick reference

| Voice        | Method              | Frequency/Frequencies | Decay                 |
| ------------ | ------------------- | --------------------- | --------------------- |
| **Clave**    | Single bridged-T    | 2500 Hz               | Natural ring (~20 ms) |
| **Rimshot**  | Two bridged-T       | 1667 Hz + 455 Hz      | ~10 ms, HPF for snap  |
| **Low Tom**  | Bridged-T + noise   | 80–100 Hz (tunable)   | 200 ms                |
| **Mid Tom**  | Bridged-T + noise   | 120–160 Hz (tunable)  | 130 ms                |
| **High Tom** | Bridged-T + noise   | 165–220 Hz (tunable)  | 100 ms                |
| **Maracas**  | White noise → VCA   | Broadband             | 25–35 ms              |
| **Cowbell**  | Osc 1 + Osc 2 → BPF | 800 Hz + 540 Hz       | ~50 ms                |

Toms include diodes (D80–D85) in the feedback path that create a subtle **downward pitch sweep** as amplitude decays — the diode's forward resistance increases at lower signal levels, reducing effective resonance. Congas use the same circuits with one bridged-T half bypassed and no noise component.

---

## 3. TR-909: VCO architecture and hybrid analog-digital design

The 909 represents a fundamentally different design philosophy from the 808. Its kick uses a conventional VCO with separate envelope generators, and its cymbals/hi-hats are **6-bit digital samples** — a hybrid architecture that was unprecedented in 1983.

### 909 kick drum: sawtooth → waveshaper

The 909 kick has two parallel signal paths mixed at the output:

**Upper path (tone):** A VCO generates a triangle/sawtooth waveform. This passes through a **diode clipper** (back-to-back 1N4148 diodes) that soft-clips the peaks to approximate a sine wave. The waveshaper transfer function is:

```
f(x) ≈ V_clip × tanh(x / V_clip)    where V_clip ≈ 0.6–0.7 V
```

More precisely, the Shockley diode equation applies: **I = Is × (e^(V/(n×VT)) − 1)** with Is ≈ 2.52 nA for 1N4148, n ≈ 1.0, VT ≈ 25.85 mV. The result is a rounded waveform with residual odd harmonics — warmer and slightly grittier than a pure sine.

**EG3** provides an instant-attack, slow-decay contour applied to VCO frequency: pitch jumps high at trigger, then sweeps down to resting frequency (~55 Hz, set by **R59 = 47 kΩ**). The VCO resets phase on every trigger via Q11 for a consistent click.

**Lower path (attack/click):** The trigger is shaped through LPF and BPF circuits into a short transient, mixed with filtered LFSR noise, and passed through a separate VCA with its own envelope (ENV-2).

Key component: **C9 = 0.22–0.33 µF** (varies by PCB revision) sets the tune range. Default resting pitch: **~55 Hz**.

### 909 vs 808 kick: the critical difference

The 808 kick is a **self-decaying resonant circuit** — the bridged-T network IS the oscillator, and its natural decay IS the envelope. No separate VCO or amplitude envelope is needed. The 909 kick separates oscillation from amplitude shaping, using a **free-running VCO** plus explicit **envelope generators** for pitch and amplitude. This gives the 909 more "punch" and midrange presence, while the 808 produces deeper, cleaner sub-bass.

### 909 noise generator: 31-bit LFSR

Shared by snare, clap, and toms. Two **CD4006** 18-stage shift registers plus one **CD4070** quad-XOR gate form a **31-stage maximal-length LFSR** with feedback taps at **stages 31 and 13**:

```rust
fn lfsr_step(&mut self) -> f32 {
    let new_bit = ((self.state >> 30) ^ (self.state >> 12)) & 1;
    self.state = (self.state << 1) | new_bit;
    self.state &= 0x7FFFFFFF; // 31-bit mask
    // Output: bipolar [-1, 1]
    if (self.state >> 30) & 1 == 1 { 1.0 } else { -1.0 }
}
// Sequence length: 2^31 - 1 = 2,147,483,647
// Clock: ~300 kHz in hardware; run at sample rate in DSP
```

### 909 hi-hat: 6-bit samples from EPROM

Three **32 KB HN61256P EPROMs** store cymbal samples at **6-bit resolution**. The hi-hat ROM is shared between open and closed hats via address-line logic. Playback rate is **~32 kHz** at stock tuning (adjustable via counter clock). Samples were compressed before storage; an analog VCA with exponential decay envelope restores dynamics after the 6-bit DAC (simple resistor ladder). A post-DAC lowpass filter removes clock artifacts. The 909's cymbal samples were recorded from **Paiste and Zildjian hi-hat cymbals** by engineer Atsushi Hoshiai.

### 909 clap: four-burst envelope

Bandpass-filtered LFSR noise (center **~1140 Hz**, Q ≈ 1.95) through two parallel VCA paths. The primary path uses a **four-part sequential attack-decay envelope** — four op-amp stages chained together, each burst **~11 ms apart**, creating the "ta-ta-ta-TAA" signature. The reverb tail path uses a simple AR envelope with longer decay (C61 = 0.01 µF controls timing).

---

## 4. SP-1200 signal chain: where the "crunch" comes from

The E-mu SP-1200's character comes from the specific interaction of five signal processing stages, each contributing distinct artifacts. The Stanford CCRMA paper (Yeh, Nolting, Smith, 2007) provides the definitive model.

### Complete signal chain model

**Stage 1 — Anti-aliasing input filter:** Opamp-based, modeled as an **order-11 IIR filter** at 96 kHz (coefficients derived via SPICE AC analysis → MATLAB `invfreqz.m` system identification). Attenuates 42 dB at Nyquist.

**Stage 2 — ADC:** 12-bit linear quantization using an **AD7541** multiplying DAC in successive-approximation mode. Fixed sample rate of **26.04 kHz** (measured; not 27.5 kHz as originally specified). This yields **4096 quantization levels** and a **72 dB** theoretical dynamic range.

```rust
fn quantize_12bit(x: f32) -> f32 {
    (x * 2047.0).round() / 2047.0  // ±1.0 normalized range
}
```

**Stage 3 — Drop-sample pitch shifting (the "magic"):** Zero-order-hold, nearest-neighbor lookup with **no interpolation whatsoever**. For tuning ratio r:

```rust
fn drop_sample_pitch(buffer: &[f32], n: usize, ratio: f64) -> f32 {
    buffer[(n as f64 * ratio).floor() as usize % buffer.len()]
}
// ratio = 2.0_f64.powf(semitones / 12.0)
// Irrational ratios create complex, non-harmonic aliasing
```

This is the **single most important element** of the SP-1200 sound. When r is irrational (non-equal-temperament intervals), irregular sample skips create unpredictable aliasing patterns — the "stardust" artifacts.

**Stage 4 — ZOH DAC (no reconstruction filter):** The AD7541 output is a staircase waveform. Critically, **no reconstruction filter** exists on the output, so spectral images appear at f + k × 26040 Hz. The ZOH frequency response is: `H(f) = sinc(f/fs) × e^(−jπf/fs)`. Digitally, this is modeled by repeating each sample N times (N = 4 is sufficient).

**Stage 5 — Output filters (channel-dependent):**

| Channels               | Filter                        | Details                                              |
| ---------------------- | ----------------------------- | ---------------------------------------------------- |
| 1–2 (Toms)             | **SSM2044** 4-pole VCF        | AR envelope from Z80; 5 ms attack, exponential decay |
| 3–4 (Snare, Bass)      | **5-pole 1 dB Chebyshev LPF** | Fixed cutoff, static                                 |
| 5–6 (Claps, Cowbell)   | **5-pole 1 dB Chebyshev LPF** | Higher cutoff than Ch 3–4                            |
| 7–8 (Hi-hats, Cymbals) | **Unfiltered**                | Direct output                                        |

### SSM2044 filter specifications

The SSM2044 (Dave Rossum's design, now reissued as SSI2144) is a **4-pole (24 dB/oct) improved ladder filter** — distinct from the Moog ladder topology:

- **Sweep range:** 10,000:1 minimum
- **Frequency control:** −19 mV/octave (range: −18 to −20 mV/oct)
- **Q control:** 0–1000 µA; self-oscillation at ~400 µA
- **Key characteristic:** Passband gain **decreases** as Q increases — the distinctive "SSM2044 sound"
- **Dynamic range:** 92 dB (A-weighted)
- **External capacitors:** 6.8 nF on C1–C3, 560 pF on C4

In the SP-1200, resonance (Q) is fixed at zero/minimal — no user control. Cutoff is modulated only by the Z80's AR envelope via internal trimpots.

### Mathematical sources of SP-1200 character

The five artifacts compound multiplicatively:

1. **12-bit quantization distortion:** Signal-correlated noise at −72 dB. Creates harmonic distortion on sinusoidal inputs.
2. **Undersampling aliasing:** Frequencies above 13.02 kHz fold back as `f_alias = |f − k × 26040|`
3. **Drop-sample aliasing:** Effective sample rate becomes `26040/r`. Non-integer r creates non-harmonic content.
4. **ZOH spectral imaging:** Mirror images at `f + k × 26040 Hz`, shaped by sinc envelope — perceived as brightness.
5. **No reconstruction filter:** Images are NOT removed, creating "phantom" harmonics above Nyquist.

Simply applying a 12-bit bitcrusher and sample-rate reducer does **not** capture the SP-1200 sound — the pitch-shifting artifacts and analog filter chain are essential.

---

## 5. LinnDrum and CR-78 characteristics

### LinnDrum: µ-Law companding is the secret

The LinnDrum (LM-2, 1982) plays back 8-bit samples at **35 kHz** through **AM6070 µ-Law companding DACs** — one per voice. The µ-255 law encoding is critical:

```rust
fn mu_law_expand(compressed: u8) -> f32 {
    let mu: f32 = 255.0;
    let sign = if compressed & 0x80 != 0 { -1.0 } else { 1.0 };
    let magnitude = (compressed & 0x7F) as f32 / 127.0;
    sign * (1.0 / mu) * ((1.0 + mu).powf(magnitude) - 1.0)
}
// Effective dynamic range: ~72-78 dB (equivalent to 12-13 linear bits)
```

This non-linear quantization sounds dramatically warmer than linear 8-bit. The LinnDrum also has **no anti-aliasing filter on playback** — Roger Linn deliberately chose to let high-frequency aliasing through because "the results sounded like the sizzle of drums." Kick, toms, and congas pass through **CEM3320** voltage-controlled filters (24 dB/oct multimode). Each voice has its own DAC and clock, so pitch shifting equals variable sample-rate playback with attendant aliasing.

### CR-78: the 808's predecessor

The Roland CR-78 (1978) is 100% analog using discrete transistor circuits. It shares the **bridged-T oscillator** topology with the 808 for drum tones, but with simpler envelopes (single-transistor "swing-type VCA" throughout). The hi-hat mixes square waves with white noise through a bridged-T bandpass filter. The signature **"metallic beat"** sound uses three filtered square waves through an **inductor-based filter** — a component that cannot be replicated with simple RC networks and must be modeled as an RLC resonator. The CR-78 sounds more delicate and organic than the 808, owing to simpler VCA envelopes and less defined transients.

---

## 6. Core DSP theory: saturation, antialiasing, and numerical methods

### Nonlinear saturation models

Three saturation curves match different circuit behaviors:

**Soft diode clipping (808 pulse shaper, 909 kick waveshaper):** The Shockley diode equation I = Is × (e^(V/(n×VT)) − 1) governs 1N4148 behavior. For back-to-back diodes (909 waveshaper), the practical approximation is tanh soft clip:

```rust
fn tanh_saturate(x: f32, drive: f32) -> f32 {
    (x * drive).tanh() / drive.tanh()
}
// First antiderivative (for ADAA): F₁(x) = ln(cosh(x))
```

**Transistor saturation (808 swing-type VCA):** The Ebers-Moll model uses two back-to-back diodes with current gain. Key parameters for typical BJT: **βF = 200, βR = 0.1, Is = 6.734 × 10⁻¹⁵ A, VT = 26 mV**.

**Hard clipping (comparator/Schmitt trigger):** Digital output swings between VOL and VOH when input crosses thresholds VT+ and VT−.

### Antiderivative antialiasing (ADAA)

For any memoryless nonlinearity y = f(x), first-order ADAA computes:

```rust
fn adaa_first_order(f1: impl Fn(f32) -> f32, x_n: f32, x_prev: f32, f_orig: impl Fn(f32) -> f32) -> f32 {
    let dx = x_n - x_prev;
    if dx.abs() > 1e-7 {
        (f1(x_n) - f1(x_prev)) / dx
    } else {
        f_orig(x_n) // Limiting case
    }
}
// For tanh: F₁(x) = ln(cosh(x))
// For hard clip at ±1: F₁(x) = x²/2 if |x|<1, |x|-0.5 if |x|≥1
// Introduces 0.5 sample delay
```

Second-order ADAA uses F₂ (second antiderivative) for ~20 dB better SNR at the cost of 1.0 sample delay. Bilbao, Esqueda, Parker, and Välimäki (IEEE SPL, 2017) provide the foundational theory.

### Numerical integration: trapezoidal rule for WDFs

The **trapezoidal rule** (bilinear transform) is the standard discretization for virtual analog:

```
s → (2/T) × (z − 1)/(z + 1)
```

This is inherently **energy-preserving** and A-stable, making it ideal for wave digital filter (WDF) implementations. For stiff circuits with multiple nonlinearities, Werner's WDF approach uses **R-type scattering matrices** derived from Modified Nodal Analysis (MNA). The K-method/DK-method (Yeh, 2010) provides an alternative state-space formulation:

```
State update: x[n] = α·H·x[n-1] + H·(B·u[n] + C·i[n])
K matrix: K = D·H·C + F
Nonlinear solve: 0 = f(p[n] + K·i[n]) − i[n]  (Newton-Raphson)
```

where H = (αI − A)⁻¹ and α = 2/T for trapezoidal rule.

### PolyBLEP for square wave oscillators

The 808 hi-hat's six square oscillators need antialiasing. Second-order PolyBLEP corrects ~2 samples around each transition:

```rust
fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let t = t / dt;
        t + t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + t + t + 1.0
    } else {
        0.0
    }
}

fn square_wave(phase: f32, dt: f32) -> f32 {
    let mut value = if phase < 0.5 { 1.0 } else { -1.0 };
    value += poly_blep(phase, dt);
    value -= poly_blep((phase + 0.5) % 1.0, dt);
    value
}
```

### Envelope shapes

808/909 envelopes are primarily **RC-derived exponential decays**, not linear ramps:

```rust
fn rc_decay(state: &mut f32, target: f32, coefficient: f32) -> f32 {
    // coefficient = e^(-1/(decay_time_seconds * sample_rate))
    // Typical: 0.9999 for ~200ms at 48kHz
    *state = target + (*state - target) * coefficient;
    *state
}
```

The clap's multi-burst envelope is more complex — a chain of RC circuits triggered sequentially by comparator thresholds, requiring a state machine:

```rust
enum ClapEnvState { Burst(u8), Tail }

fn clap_envelope(&mut self) -> f32 {
    match self.state {
        ClapEnvState::Burst(n) if n < 3 => {
            self.env *= 0.985; // ~10ms RC decay at 48kHz
            if self.env < 0.1 {
                self.env = 1.0; // Retrigger
                self.state = ClapEnvState::Burst(n + 1);
            }
            self.env
        }
        _ => {
            self.env *= 0.9997; // ~100ms tail decay
            self.env
        }
    }
}
```

---

## 7. Open-source reference implementations and licensing

The following projects provide legally reusable code for Sourdaw's drum engine:

### Tier 1: directly usable MIT-licensed code

**mi-plaits-dsp-rs** (MIT, Rust) — A complete native Rust port of Mutable Instruments Plaits, including all drum engines: analog bass drum (bridged-T + FM triangle VCO variants), analog snare (dual bridged-T + noise), and hi-hat (6 square oscillators + HPF noise). Runs at 48 kHz, `no_std` compatible, published as a crate. This is the **single best starting point** for Sourdaw. Source: `github.com/sourcebox/mi-plaits-dsp-rs`.

**Mutable Instruments Plaits** (MIT, C++) — The original C++ reference. Drum engines in `plaits/dsp/drums/` implement behavioral simulation of classic circuits: `analog_bass_drum.h` (bridged-T excitation model), `analog_snare_drum.h` (dual resonators + noise), `hihat.h` (six square oscillators or three ring-modulated pairs). Émilie Gillet's code comment: "No fancy acronyms or patented technology here... Just behavioral simulation of circuits from classic drum machines!" Source: `github.com/pichenettes/eurorack`.

**DaisySP** (MIT, C++) — Clean API port of Plaits drum engines for embedded. Files: `AnalogBassDrum.cpp`, `AnalogSnareDrum.cpp`, `HiHat.cpp`. Source: `github.com/electro-smith/DaisySP`.

**ChowKick** (BSD 3-clause, C++) — Kick drum plugin directly based on Werner's 808 analysis. Uses chowdsp_wdf library for wave digital filter modeling of the pulse shaper and bridged-T resonator. Source: `github.com/Chowdhury-DSP/ChowKick`.

**FunDSP** (MIT/Apache 2.0, Rust) — Composable audio DSP graph notation. No dedicated drum models but provides all building blocks (oscillators, filters, envelopes, noise generators). Source: `crates.io/crates/fundsp`.

### Tier 2: copyleft-licensed references

**WDR-8** (GPLv3, C++) — The most physically accurate 808 model found. Uses wave digital filters to model individual subcircuits from the service manual schematic, including simplified envelope generator, shell resonators with waveshapers, and diode clipper VCA. Built on chowdsp_wdf. Source: `github.com/Simon-L/WDR-8-rack`.

**Faust synths.lib** (LGPL) — Standard library drum functions: `kick()`, `clap()`, `hat()`, `additiveDrum()`, `popFilterDrum()`. Faust compiles to Rust, C++, and WASM. Source: `faustlibraries.grame.fr`.

**Geonkick** (GPLv3, C++) — Full-featured percussive synthesizer, LV2 plugin. Source: `github.com/Geonkick-Synthesizer/geonkick`.

### Tier 3: academic reference code

**chowdsp_wdf** (BSD-style, C++) — Standalone WDF library implementing Werner's theory with Lambert-W diode solvers. Source: `github.com/Chowdhury-DSP/chowdsp_wdf`.

**ACME.jl** (Julia) — Holters-Zölzer generalized state-space method for automated circuit simulation. Source: `acmejl.readthedocs.io`.

---

## 8. Academic papers: the essential reading list

The foundational literature for this implementation breaks into four categories:

**TR-808 circuit analysis (Werner et al.):** Werner's 2016 Stanford dissertation "Virtual Analog Modeling of Audio Circuitry Using Wave Digital Filters" is the definitive source, using the 808 bass drum as its primary case study across all four chapters. The DAFx-14 paper provides the ODE systems and transfer functions summarized in Section 1. The ICMC 2014 paper covers the cymbal/hi-hat oscillator bank. The AES 2015 paper covers the cowbell. All are freely available from CCRMA.

**Antialiasing theory (Bilbao, Esqueda, Parker, Välimäki):** The IEEE SPL 2017 ADAA paper provides the core antialiasing framework for memoryless nonlinearities. Esqueda's 2019 Aalto dissertation "Aliasing Reduction in Nonlinear Audio Signal Processing" extends this with BLAMP methods and wavefolder models. Parker et al. (DAFx-16) established the continuous-time convolution foundation. Holters (DAFx-19) extended ADAA to stateful systems. Albertini et al. (DAFx-20) integrated ADAA into WDFs.

**Numerical circuit simulation (Yeh, Holters):** Yeh's 2009 Stanford dissertation introduces the K-method/DK-method for automated state-space modeling from netlists. Part I (IEEE TASLP 2010) provides theory; Part II (2012) validates on BJT circuits. Holters-Zölzer (EUSIPCO 2015) offers a more flexible generalized method implemented in Julia.

**Oscillator antialiasing (Välimäki et al.):** The DPW method (IEEE TASLP 2010) and PolyBLEP method (JASA 2012) are essential for the square-wave oscillators in hi-hat synthesis. The IEEE SPM 2007 survey provides the broader context.

---

## Conclusion: a practical implementation roadmap for Sourdaw

Three strategic insights emerge from this research. First, **start with mi-plaits-dsp-rs** — it is MIT-licensed, written in Rust, and implements behavioral models of all three core 808 voices (kick, snare, hi-hat) that are already proven in thousands of Eurorack modules. This provides a working baseline within days rather than weeks.

Second, for **higher fidelity**, layer in circuit-level modeling from Werner's transfer functions. The bridged-T equations in Section 1 can be implemented as time-varying biquad filters with bilinear-transformed coefficients, using TDF-II topology for stability. The 808 kick alone has six cascaded stages, but each is individually simple — at most a second-order filter or a memoryless nonlinearity.

Third, the SP-1200 effect is **algorithmically simple but perceptually critical** — the entire character reduces to `buffer[floor(n × ratio)]` with no interpolation, 12-bit quantization, and a 4-pole lowpass on select channels. This can be implemented in under 100 lines of Rust and applied as a channel insert effect.

The component tolerances (±20% capacitors, ±5% resistors) that made every hardware unit sound slightly different are a feature, not a bug. Exposing these as randomized parameters in Sourdaw would give each drum instance authentic organic variation — the same mathematical property that made these machines legendary.
