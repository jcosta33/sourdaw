# The Master Drum Machine — Ultimate Implementation Guide

> **Codebase Annotation:** Grinder currently exists in the codebase as an Amp Simulator plugin (`crates/daw-dsp/src/grinder`), not a Drum Machine. The pad-based sampler is `Toaster` (`crates/daw-dsp/src/toaster`), which implements basic pad assignments and sample playback, but completely lacks the advanced synthesis engines, physical modeling, and integrated step sequencer detailed below. The Master Drum Machine spec is **Missing / Unimplemented** in its intended flagship form.

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
