# Mother of All Drum Machines Implementation Guide

## Executive summary

This document specifies an end-to-end, real-time-safe drum machine instrument plugin designed to run identically on native targets (x86_64/aarch64) and in the browser (WebAssembly inside an `AudioWorkletProcessor`). On the web side, the **default render quantum is 128 frames**, making the engine a strict block-DSP system with a ~2.9 ms budget at 44.1 kHz (128/44100). citeturn0search8turn0search0turn0search16

The instrument is structured as **pads/tracks** (typically 8–32) each capable of multiple **layers** (analog-modeled synth, FM/PM percussion, physical/modal resonators, noise engines, sample playback, and granular textures) and an advanced sequencing system (step patterns, polyrhythms, Euclidean generation, groove extraction/quantize, humanization, probability/ratcheting, and pattern morphing). Euclidean rhythms are well-studied and can be generated efficiently using Euclid-structured algorithms as described by entity["people","Godfried Toussaint","euclidean rhythms author"]. citeturn7search0turn7search1

Core DSP highlights:

- **Analog drum models** are built from damped resonators, transient/click exciters, pitch envelopes, nonlinear drive, and (for flagship “authentic” modes) optional physically informed circuit models. A key example is a physically informed digital model of the TR-808 bass drum circuit by entity["people","Kurt James Werner","dafx14 808 model author"], entity["people","Jonathan S. Abel","ccrma researcher"], and entity["people","Julius O. Smith III","ccrma professor"]. citeturn10search3turn10search12
- **FM metallic/percussive drums** use phase modulation (PM) and “loopback FM” structures, which are explicitly studied for percussion synthesis and offer a compact parameter space with strong timbral range. citeturn10search1
- **Physical and modal percussion** uses resonator banks and waveguide-inspired structures, backed by physical-modeling foundations and modal methods that scale well for percussion. citeturn10search31turn10search5turn10search8
- **Transient detection** uses onset detection functions (ODFs) such as energy-envelope derivatives, spectral flux, and phase/complex-domain methods; this is surveyed rigorously by entity["people","Juan Pablo Bello","onset detection author"] et al., with extensions and evaluations by entity["people","Simon Dixon","onset detection revisited author"]. citeturn1search3turn1search19
- **Time-stretch / pitch-shift** supports: (a) high-quality resampling for one-shots, (b) WSOLA-class time-domain TSM for transient-heavy loops, (c) phase vocoder for spectral material, and (d) a production-quality integrated library path using entity["company","Signalsmith Audio","audio dsp tools"]’s Signalsmith Stretch for polyphonic pitch/time workflows. citeturn6search0turn6search1turn6search2turn6search5
- **Convolution reverb** uses partitioned convolution to reduce latency; the “no input-output delay” framing and efficient partition strategies are classic, with a widely cited reference by entity["people","William Gardner","efficient convolution author"] and detailed real-time partitioning analysis in later works. citeturn6search3turn6search7turn6search19

GPU acceleration is optional and must never block the audio thread. Compute shaders and visualization shaders are expressed in WGSL (defined by entity["organization","W3C","standards body"]) and run via `wgpu` on native and WebGPU in browsers. citeturn8search1turn8search0

### Assumptions and open-ended parameters

Several details are intentionally unspecified (left open for product decisions) and are treated as tunable constants or configuration:

- Default number of pads/tracks (assume 16 for UI parity; engine supports 8–64).
- Max per-pad polyphony (assume 8 native, 2–4 wasm, configurable).
- Max layers per pad (assume 4; configurable).
- Max pattern length (assume 1–8 bars; configurable).
- Sample streaming cache sizes on native (device-dependent).

All such values appear as constants or config structs and are not hard-coded into algorithmic correctness.

## Crate architecture and real-time execution model

### Crate graph and invariants

Use the same crate boundaries as your synth spec; the drum machine is “just another node” in the DAW graph.

**`daw-core`**

- Newtypes: `Hertz`, `Beats`, `Seconds`, `Decibels`, `SampleRate`, `Samples`, `PadId`, `PatternId`, `StepIndex`, `VoiceId`.
- Data-only. No DSP.

**`daw-dsp`**

- Pure DSP kernels and stateful primitives that are allocation-free once constructed:
    - Oscillator cores (phase accumulator, PM/FM, noise)
    - Envelopes (ADSR + multi-segment)
    - One-pole filters, biquads (RBJ), SVF/ladder models (ZDF/TPT)
    - Delay lines, allpass, combs
    - Window functions (Hann, Tukey, Gaussian) for granular/TSM
    - Resamplers (linear/cubic/sinc building blocks)
    - FFT kernels (CPU path), partitioned convolution kernels (CPU path)
- Must be WASM-safe and `no_std`-compatible (practically: isolate any `alloc` usage to constructors and non-RT code paths).

**`daw-synth`**

- Owns:
    - Drum engine state
    - Pattern/sequencer state
    - Modulation matrix
    - Voice manager and choke groups
    - Per-pad routing and FX graph (compiled to a stable schedule)
- Exposes hot-path:
    - `fn process(midi_events: &[MidiEvent], output: &mut [&mut [f32]], block_size: usize)`

**`daw-engine`**

- Integrates with native audio I/O via `cpal`, which calls a user closure periodically to fill output buffers. citeturn9search7turn9search0
- Uses lock-free ring buffers (e.g., `rtrb`) for UI-to-audio messages; `rtrb` allocates a fixed capacity once, then operations are lock-free and return immediately. citeturn8search3turn8search7

### Block sizes and “deadline math” for WASM

Web Audio specifies the AudioContext render quantum default as **128 frames**. citeturn0search8  
Therefore:

- At 44.1 kHz: 128 / 44100 ≈ 2.90 ms budget.
- At 48 kHz: 128 / 48000 ≈ 2.67 ms budget.

Design consequence:

- Keep synthesis per voice cheap (drums are short, but transient-heavy).
- Heavy tasks (FFT analysis, convolution tail, waveform peaks, resynthesis) must be:
    1. moved off-thread (not possible inside AudioWorklet),
    2. performed on GPU outside the audio quantum, or
    3. done incrementally across blocks with strict caps.

### Hot-path no-alloc / no-lock methods

Mandatory hot-path invariants:

- No dynamic allocation in `process()`.
- No locks, no syscalls, no blocking I/O.
- Per-block messages are applied via preallocated queues; use `rtrb`-like SPSC channels and drop messages when full rather than block. citeturn8search3

**Message pattern**

- UI thread: enqueue `ParamChange`, `PatternEdit`, `SampleLoadCompleteHandle`.
- Audio thread: drain at block start; apply to local copies.

### Determinism and “two-tiered quality”

Drum machine should support:

- **Draft**: cheapest, for live playing and heavy patterns.
- **Render**: best quality, may enable extra oversampling, better resampling, longer convolution partitions, etc.

Draft vs Render is essential because Web runtime budgets are much tighter than native budgets given the fixed quantum. citeturn0search8turn0search16

### Core top-level API sketch in `daw-synth`

```rust
pub struct MotherDrumMachine {
    pub sr: SampleRate,
    pub block_size: usize,

    pub pads: Vec<Pad>,                 // allocated outside RT; internal arrays fixed
    pub sequencer: Sequencer,
    pub modulation: ModulationMatrix,

    pub voice_mgr: DrumVoiceManager,

    pub fx_global: GlobalFxRack,
    pub mix: MixerState,

    // Preallocated scratch buffers (owned, fixed max sizes)
    scratch: ScratchBuffers,
}

impl MotherDrumMachine {
    pub fn process(&mut self, midi: &[MidiEvent], out: &mut [&mut [f32]]) {
        // 1) drain messages, 2) sequencer tick, 3) triggers, 4) render voices, 5) FX/mix
    }
}
```

## Drum sound engines

The drum machine is built around a single concept: **a “hit” is a short-lived voice** that may combine oscillator/resonator layers, noise layers, and sample layers, mixed through per-voice shaping and then routed into per-pad and global processing.

### Common per-hit voice anatomy

A high-quality drum hit typically decomposes into:

1. **Transient/click** (sub-millisecond to ~10 ms)
2. **Body** resonance / pitched component
3. **Noise** component (snare wires, hats, air)
4. **Tail** and room/ambience (often from FX chain)

This maps naturally to a layer stack:

- Transient layer: impulse + short envelope + saturation
- Body layer: damped sine/resonator bank + pitch envelope
- Noise layer: filtered noise + decay envelope
- Sample layer: optional, multi-zone, round robin

For physical/circuit-faithful modes, the decomposition still applies, but the blocks are derived from actual circuit sub-sections (e.g., bridged-T resonator and time-varying components described in the TR-808 model analysis). citeturn10search3turn10search16

### Analog-modeled drum synthesis

#### Kick drum: resonant sine + pitch drop + click + drive

**Math**
A baseline “synth kick” can be implemented as:

- Body oscillator: `y_body[n] = A[n] * sin(φ[n])`
- Phase update: `φ[n+1] = φ[n] + 2π f[n] / fs`
- Pitch envelope: `f[n] = f0 * exp(-n / (τ_pitch * fs)) + f_floor` (exponential pitch drop)
- Amp envelope: exponential decay: `A[n] = exp(-n / (τ_amp * fs))`

Transient click: a very short noise burst or impulse filtered by a highpass and shaped by 1–5 ms envelope.

Drive: apply saturator `tanh(d * x)` or a polynomial soft clipper; oversample if drive is strong to reduce aliasing.

**Anti-aliasing**

- Sine itself is alias-free.
- Aliasing comes primarily from:
    - click (broadband impulse)
    - nonlinear drive
      Therefore:
- Band-limit click using a short lowpass or bandpass (or windowed impulse shaping).
- Oversample in distortion stage (2× draft, 4× render) for drum voices that apply heavy drive.

**Rust struct sketch**

```rust
pub struct KickSynth {
    pub phase: f32,
    pub base_freq: f32,     // Hz
    pub pitch_decay_s: f32, // seconds
    pub amp_decay_s: f32,   // seconds
    pub click_level: f32,
    pub drive: f32,

    pub env: ExpEnv,
    pub pitch_env: ExpEnv,
    pub click_env: ExpEnv,
}
```

**Per-sample pseudocode**

```rust
fn tick(&mut self, sr: f32) -> f32 {
    let a = self.env.next(sr);
    let p = self.pitch_env.next(sr); // 0..1 exp decay
    let f = self.base_freq * (1.0 + self.pitch_amount * p);
    self.phase = (self.phase + f / sr).fract();

    let body = a * sin_approx(self.phase);
    let click = self.click_env.next(sr) * self.click_level * filtered_noise();

    let x = body + click;
    saturate_oversampled(x, self.drive)
}
```

**Performance**

- Extremely cheap: one sine + a few envelopes.
- SIMD: render multiple active kick voices in parallel only if doing stacked/unison kicks; otherwise not important.
- WASM: dozens of kick voices are feasible; bounded mostly by FX and sample layers.

**Secret sauce**

- Make pitch drop nonlinearly dependent on initial amplitude (harder hits have deeper drop), and add slight transient-dependent phase reset to keep punch consistent.
- Apply drive **before** a gentle lowpass to simulate analog headroom.

#### TR-808-authentic kick: physically informed circuit model (flagship mode)

The TR-808 bass drum circuit has been analyzed and digitally modeled in a physically informed manner, enabling accurate emulation and even circuit-bent modifications that structured sampling cannot capture. citeturn10search3turn10search12turn10search16

**Implementation approach**

- Provide two kick engines:
    1. `KickSynth` (fast parametric)
    2. `Kick808CircuitModel` (authentic, heavier)

In `Kick808CircuitModel`, use the paper-derived blocks:

- Excitation pulse shaping
- Bridged-T resonator dynamics
- Time-varying pitch behavior from circuit components

**RT engineering**

- Keep it stable by:
    - fixed step integrators per sample
    - small oversampling (2×) if the model includes strong nonlinearities
    - parameter smoothing on component “knobs”

#### Snare: resonant body + noise wires + transient

**Math**

- Body: 1–3 damped resonators (modes):
    - `y_mode[n] = g * e^{-n/τ} * sin(2π f_mode n/fs)`
- Or implement as biquad bandpass resonators excited by an impulse.
- Wires: filtered noise burst:
    - `noise = white()`
    - `wires = BP(noise, f_center, Q) * env_wires`

**Anti-aliasing**
Noise is broadband by nature; avoid harshness by shaping:

- Use highpass + bandpass cascades so energy sits where snares live (e.g., 2–10 kHz).
  Nonlinear drive again benefits from oversampling if used.

**Secret sauce**

- Use two noise bands: one for “sizzle” (8–12 kHz) and one for “mid grit” (2–5 kHz), each with different decay times.
- Couple wire decay to velocity and to body resonance amount.

#### Hats/cymbals: inharmonic exciters + filters (analog-inspired) or FM metallic

High hats and cymbals are best-in-class when they have:

- inharmonic partial structure
- controlled broadband noise
- “stick” transient
  This is achievable either with:
- analog-inspired square/noise oscillator banks into filters, or
- FM/loopback FM oscillator structures. The percussion synthesis literature shows loopback FM can yield wide-ranging percussion timbres with real-time parameter control. citeturn10search1

**Anti-aliasing**

- Use bandlimited square (PolyBLEP) if you use square oscillators; aliasing is most audible in cymbals. PolyBLEP methods are standard practice for bandlimiting discontinuities. citeturn0search1
- For FM metallic, oversample when modulation indices are extreme.

### FM / PM drums including loopback FM

#### Loopback FM oscillator (percussion-focused)

Loopback FM is a variant where the carrier feeds back as its own modulator, useful for percussion synthesis and parametric control. citeturn10search1

**Core equation (conceptual)**

- `y[n] = sin(φ[n] + I * y[n-1])`
- `φ[n+1] = φ[n] + 2π f / fs`

This is essentially PM with feedback.

**Rust sketch**

```rust
pub struct LoopbackFm {
    pub phase: f32,
    pub freq: f32,
    pub index: f32,
    pub fb: f32,
    pub y_prev: f32,
}
```

**Per-sample**

```rust
fn tick(&mut self, sr: f32) -> f32 {
    let pm = self.index * self.y_prev;
    self.phase = (self.phase + self.freq / sr).fract();
    let y = sin_approx(self.phase + pm);
    self.y_prev = y;
    y
}
```

**Anti-aliasing**
Feedback/PM can generate high harmonics quickly:

- Add oversampling toggles for metallic voices.
- Clamp index at high frequency to keep partials below Nyquist.

**Secret sauce**

- Modulate index with a fast decay envelope on each hit (high index at start for “clank”, lower later for “body”).

### Physical models: modal synthesis and waveguides

Physical modeling for percussion often reduces to either:

- **modal synthesis**: sum of damped resonant modes
- **waveguides**: propagation in a medium with reflections (strings, bars, membranes by approximations)

Physical modeling foundations are covered comprehensively in the freely available _Physical Audio Signal Processing_ textbook chapters, including resonators, waveguides, and related techniques. citeturn10search31turn10search8

#### Modal synthesis engine (recommended core physical drum engine)

Modal synthesis models a vibrating object as a bank of damped resonators (“modes”), each excited by an удар (impulse) or a shaped force. This is fundamental for percussive objects and appears throughout physical modeling literature and modern real-time modal systems. citeturn10search5turn10search7

**Math**
For mode `k`:

- `y_k[n] = a_k[n] * sin(φ_k[n])`
- `a_k[n+1] = a_k[n] * d_k` where `d_k = exp(-1/(τ_k*fs))`
- `φ_k[n+1] = φ_k[n] + 2π f_k / fs`
  Output: `y[n] = Σ_k g_k * y_k[n]`

**Efficient resonator form (biquad)**
Each mode can be implemented as a 2-pole resonator (bandpass) excited by input `x[n]`. This avoids per-mode sine calls and is cache/SIMD friendly.

**Rust sketch**

```rust
pub struct ModalMode {
    pub freq: f32,
    pub decay: f32,   // 0..1 per-sample multiplier
    pub gain: f32,
    pub state: Resonator2p, // biquad-like resonator state
}

pub struct ModalPerc {
    pub modes: [ModalMode; MAX_MODES],
    pub mode_count: usize,
    pub exciter: Exciter,   // impulse/noise burst/force profile
}
```

**Per-block**

- Compute exciter samples for the block.
- For each sample:
    - sum resonator outputs across modes (SoA layout for SIMD).

**Secret sauce**

- For membrane-like drums, allow **tension modulation** (mode frequencies drift slightly with amplitude) as discussed in membrane percussion modeling literature. citeturn10search5
- Add nonlinear damping (decay increases with instantaneous amplitude), which is perceptually crucial for “real” drum decay.

#### Waveguide-inspired drum components

Digital waveguide techniques are foundational in physical modeling (delays, scattering junctions, fractional delays), and are covered in physical modeling references. citeturn10search31turn10search14turn10search29

For a drum machine, waveguides are most useful for:

- “tensioned” drum strings and metallic bars
- filtered feedback models for “boing” and “laser” percussion
- plucked/struck string layers in hybrid kits

Implement a basic Karplus-Strong / waveguide string layer for percussive plucks and “tuned percussion”. Waveguide models and Karplus-Strong relationships are standard in the physical modeling canon (and discussed across Smith-related resources). citeturn10search31turn10search29turn10search15

### Noise-based synthesis (fast, essential)

Noise is fundamental for:

- snares
- hats
- shakers
- claps
- transient “air”

Noise engines:

- White noise using fast PRNG.
- Pink noise using a standard recursive filter method (common DSP reference implementations exist; the key is stable coefficients and state). citeturn0search1

Shaping:

- Filter chains (HP/BP) + envelope + saturation.

### Sample playback engine (multi-zone, round robin, velocity layers)

For best-in-class drums you need a modern sampler, even if synthesis is excellent.

**Zones**

- note range, velocity range, round robin index, choke group, tuning, start/end, loop mode.

**O(1) zone selection**
Precompute a lookup:

- `zone_lut[note][vel_bucket][rr_index_mod] -> ZoneId`
  This avoids searching in hot path.

**Pitching**

- 1-shot drum hits: resample (fast, minimal artifacts).
- loops: time-stretch + pitch-shift (Signalsmith/WSOLA/vocoder).

**Native vs Web memory**

- Native can disk stream in a background thread; Web cannot (AudioWorklet has no filesystem), so Web must preload samples into memory and enforce hard memory caps. The AudioWorklet processing model enforces the 128-frame quantum; heavy streaming work cannot occur inside it. citeturn0search8turn0search0

### Granular drum resynthesis and textures

Granular is used for:

- beat-synced stutters
- glitch fills
- re-texturing hits while preserving transients
- granular reverb-like tails per voice

Core grain equation:

- `y[n] += amp * window(age) * src[pos + rate*age]`

Key: transient-aware: do not smear initial transient; schedule grains _after_ onset or carve a transient region that is always played as a 1-shot slice.

## Transients, slicing, resampling, and time/pitch processing

### Transient detection foundations (ODFs)

A robust drum instrument needs transient detection for:

- auto-slicing (drag-drop sample to kit)
- transient shaping (split transient vs sustain)
- transient-preserving time-stretch
- beat-synced granular slicing

Bello et al. survey onset detection approaches across temporal envelope features, spectral magnitude/phase features, and model-based methods, giving a taxonomy of commonly used ODFs. citeturn1search3  
Dixon revisits and extends onset detection functions and tests them against other approaches. citeturn1search19

#### Core ODFs to implement

Let `x[n]` be input, `X(m,k)` STFT frame `m`, bin `k`.

1. **Energy envelope derivative**

- `e[m] = Σ_n w[n] x_m[n]^2`
- `odf[m] = max(0, e[m] - e[m-1])`
  Useful but misses soft onsets and can false-trigger on loud sustain. citeturn1search3

2. **Spectral flux**

- `odf[m] = Σ_k max(0, |X(m,k)| - |X(m-1,k)| )`
  More robust for percussive content. citeturn1search3turn1search19

3. **Complex-domain / phase deviation methods**
   These track phase evolution; improved for pitched onsets and reduces false positives. Bello’s tutorial covers phase-based ODFs as a category. citeturn1search3

4. **Multi-band ODF fusion**
   Compute ODF in bands (low/mid/high), then combine to improve robustness for drums with distinct spectral shapes. ODF fusion is studied in evaluation literature. citeturn1search23

#### Post-processing: peak picking

Given `odf[m]`:

- smooth with moving average
- compute adaptive threshold `T[m]` (median filter or `mean + k*std`)
- find local maxima where `odf[m] > T[m]` and separated by `min_ioi` (minimum inter-onset interval)

Bello’s tutorial covers typical peak-picking and thresholding strategies. citeturn1search3

### Transient shaper (per-voice and global)

A transient shaper typically estimates a fast envelope and a slow envelope, then derives transient content as their difference.

**Detector**

- rectify: `r[n] = |x[n]|`
- fast envelope: `ef[n] = one_pole(r[n], τ_fast)`
- slow envelope: `es[n] = one_pole(r[n], τ_slow)` where `τ_slow >> τ_fast`
- transient measure: `t[n] = clamp(ef[n] - es[n], 0, 1)`

**Split**

- transient component: `x_t[n] = x[n] * (t[n] / (ef[n]+ε))`
- sustain component: `x_s[n] = x[n] - x_t[n]`

**Shape**

- `y[n] = x_t[n] * gain_attack + x_s[n] * gain_sustain`

This design is consistent with envelope/follower building blocks discussed in onset detection contexts (envelope features) and is computationally minimal. citeturn1search3turn1search19

### Transient-aware slicing (sample import → slices → kit)

When user drops a drum loop:

1. Compute ODF → onset times. citeturn1search3
2. Refine each onset to closest **zero-crossing** or local minimum to reduce click.
3. If tempo known (host BPM), snap slices to beat grid optionally, but preserve micro-timing as “groove template”.
4. Extract per-slice features:
    - RMS, peak
    - spectral centroid (brightness)
    - duration
5. Auto-map slices to pads:
    - cluster by spectral centroid + duration (kick vs snare vs hat)
    - or rule-based (“low + long” → kick).

### Resampling and per-hit tuning

For drum one-shots, the best default is high-quality resampling (SRC) rather than time-stretch:

- drum hits are short; resampling preserves transients better than naive vocoder time-stretch.

If you use an external SRC library, document it explicitly. For Rust, `rubato` describes chunk-based resamplers and is designed for real-time/offline use. citeturn8search15  
If implementing internally:

- Linear: 2 taps, fastest, audible HF loss.
- Cubic Hermite: 4 taps, good quality/CPU.
- Windowed-sinc: 8–64 taps, best quality, expensive.

### Time-stretch and pitch-shift for loops and long samples

You need multiple strategies with clear tradeoffs.

#### WSOLA (time-domain, transient-friendly)

WSOLA aligns waveform segments using cross-correlation before overlap-add. Driedger’s thesis analyzes WSOLA and phase vocoder and discusses artifacts and transient issues. citeturn6search1

**Core idea**

- Analysis frames of length `L`
- For each synthesis frame at time `t_s`, search in a neighborhood around expected analysis time `t_a` for the offset that maximizes normalized cross-correlation with the previous synthesis tail.
- Overlap-add with a window (Hann).

Enhanced WSOLA with transient management addresses the problem of time-scaling transient sections uniformly (transients smear). citeturn6search5

#### Phase vocoder (frequency-domain)

The phase vocoder is a standard technique for time-scale modification via STFT magnitude/phase manipulation, but it can produce “phasiness” or transient smearing if used naïvely; Dolson’s tutorial covers fundamentals and typical issues. citeturn6search2turn6search10

Improvements include phase-locking around spectral peaks to reduce smearing at large stretch factors. citeturn6search10turn6search38

#### Signalsmith Stretch (production-grade library path)

Signalsmith Stretch provides a polyphonic pitch/time stretching library and notes best-sounding time-stretch ranges for modest changes (e.g., ~0.75×–1.5×). citeturn6search0turn6search4

Use it as:

- Native: direct Rust bindings (either via FFI wrapper you write or Rust ports if suitable).
- Web: CPU-only fallback; in-browser time-stretch is expensive—prefer slicing + retrigger + granular for loops.

### Algorithm comparison tables

#### Transient detection methods (ODFs)

| Method               | Core feature         | Pros                                         | Cons                                                 | Typical CPU          | Best use           |
| -------------------- | -------------------- | -------------------------------------------- | ---------------------------------------------------- | -------------------- | ------------------ |
| Energy derivative    | Δ energy             | Very cheap                                   | Misses soft onsets; false positives on loud sustains | O(N)                 | Simple slicing     |
| Spectral flux        | Δ magnitude spectrum | Robust for percussion                        | Needs STFT                                           | O(N log N) per frame | Loops/drums        |
| Phase/complex-domain | phase deviation      | Better pitched onsets; fewer false positives | More complex; STFT needed                            | O(N log N) per frame | Melodic percussion |
| Multi-band fusion    | combine band ODFs    | More robust across drum types                | More compute; tuning needed                          | ~2–3× STFT           | Full “auto-slice”  |

These method families and their motivations are summarized in onset detection surveys and follow-up evaluations. citeturn1search3turn1search19turn1search23

#### Time-scale / pitch processing choices

| Algorithm           | Domain                         | Transient handling                     | Good for                   | Bad for                                 | Notes                                                                                     |
| ------------------- | ------------------------------ | -------------------------------------- | -------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Resampling          | time                           | preserves transients                   | one-shots, short hits      | loop tempo changes                      | simplest for drums                                                                        |
| WSOLA               | time                           | good if aligned; enhanced WSOLA better | rhythmic loops, drums      | extreme polyphonic textures             | cross-correlation search; transient-aware variants exist citeturn6search1turn6search5 |
| Phase vocoder       | freq                           | baseline smears; phase-lock helps      | pads, ambience             | sharp drums unless transient management | classic tutorial & improvements citeturn6search2turn6search10                         |
| Signalsmith Stretch | hybrid/implementation-specific | designed for quality                   | general-purpose pitch/time | very large stretch may degrade          | MIT-licensed library approach citeturn6search0                                         |

## Sequencing, modulation, and performance control

A best-in-class drum machine is as much a **sequencer** as a synth. The sequencer must:

- render deterministically in the audio thread,
- support deep per-step modulation,
- allow tempo-synced behaviors,
- and expose groove/humanization in a musically meaningful way.

### Pattern representation

Represent patterns as a fixed grid with optional parameter lanes:

- `bars`, `steps_per_bar`, `ppq` (internal substep resolution, e.g. 96 or 192)
- each pad has a `TrackPattern`
- each step stores triggers and per-step parameters

**Rust sketch**

```rust
pub struct Step {
    pub trig: bool,
    pub vel: u8,            // 0..127
    pub gate: u8,           // 0..127 (maps to seconds)
    pub prob: u8,           // 0..100
    pub micro: i16,         // microtiming in samples or ticks
    pub ratchets: u8,       // 1..N (sub-triggers)
    pub flam: u8,           // small time offset pattern
    pub cond: StepCond,     // conditional triggers
}

pub struct TrackPattern {
    pub steps: Vec<Step>,   // fixed after pattern compile
    pub lane_params: ParamLanes,
}

pub struct Pattern {
    pub bpm: f32, // host-provided
    pub bars: u8,
    pub steps_per_bar: u8,
    pub tracks: Vec<TrackPattern>,
}
```

### Step probabilities, conditions, and determinism

Per-step probability must be deterministic for “same seed → same playback”:

- Seed RNG from `(pattern_id, bar_index, step_index, pad_id)` so playback is stable across runs unless user changes seed.

### Ratcheting and sub-step scheduling

Ratcheting triggers multiple hits within one step:

- Sub-interval = `step_duration / ratchets`
- Each sub-trigger gets scaled velocity (e.g., taper or accent shape)

Implementation:

- Expand step events into a per-block “event queue” sorted by sample offset (0..block_size-1).
- Preallocate event queue capacity = `max_events_per_block`.

### Polyrhythms and polymeters

Support separate track lengths via:

- Each track has `steps_per_bar_track` and `bars_track`.
- Global time cursor advances; each track wraps on its own length.

### Euclidean rhythm generator

Euclidean rhythms distribute `k` hits as evenly as possible across `n` steps; Toussaint demonstrates that Euclid-structured construction yields many traditional rhythmic patterns efficiently. citeturn7search0turn7search24

Implement generator `E(k,n,rotation)`:

- output boolean array length `n`.
- Provide Bjorklund-style recursive grouping (common implementation family discussed in Euclidean rhythm literature). citeturn7search4turn7search0

### Groove quantize and humanization

A groove template maps ideal grid times to shifted times and velocities.

Ableton’s manual describes groove parameters including random timing fluctuation (“humanization”) applied per voice, causing originally simultaneous notes to become slightly offset. citeturn7search3

**Groove template representation**

- `timing_map[step] -> micro_offset_ticks`
- `velocity_map[step] -> velocity_scale`
- `random_amount` (0..1), `random_seed`

**Applying groove**

- Step time = grid_time + groove_offset(step) + random(step,voice)\*random_amount

**Humanization models**

- White random jitter is musically harsh; prefer filtered random (low-frequency) for “human drift”, and per-hit micro jitter for “human imperfection”.
- For hi-hats, use systematic late hats / early snare templates plus a small random component (common production practice; formalizable as groove templates). citeturn7search3

### Pattern morphing

Morphing between patterns A and B:

- Triggers: treat as probabilities; interpolate probability and then sample deterministically with seed.
- Velocity: linear in MIDI domain or better in dB domain (velocity→gain mapping).
- Microtiming: interpolate offsets.
- Ratchets: discrete; crossfade by probability or choose nearest integer based on morph position.

### Modulation system (per-voice and per-pattern)

In drums, modulation is often:

- per-hit envelopes (amp, pitch, filter)
- per-step parameter lanes
- global LFOs for groove and FX
- audio followers for sidechain-style effects

Use a modulation matrix similar in spirit to synth mod matrices, but specialized:

- sources: per-voice envelopes, per-track LFOs, velocity, pad pressure/MPE, step lane values
- destinations: engine params (pitch, decay, noise color), FX params, send amounts

### MIDI, pad mappings, and MPE

Support classic drum MIDI mapping:

- pads mapped to MIDI notes
- velocity to amplitude and to parameter macros
- aftertouch to FX (e.g., filter/open hats)
- choke groups (open hat choked by closed hat)

For MPE: MPE assigns per-note expressive dimensions via separate channels/zone configuration; the MIDI Association describes MPE as enabling per-note pitch/timbre changes while playing polyphonically. citeturn7search2turn7search21  
Practical drum use:

- per-pad pressure controls decay/open-ness
- per-pad slide controls pitch or sample start
- per-pad pitch bend per note controls tuning

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["drum machine step sequencer grid heatmap visualization","euclidean rhythm pattern visualization 8 3","MPE drum pad controller performance","drum sampler waveform slicing transient markers"],"num_per_query":1}

## Effects, routing, and GPU acceleration

### Routing model: per-voice, per-pad, global

Define three processing tiers:

1. **Per-voice**: transient shaper, drive, tiny room, per-hit pitch/filter
2. **Per-pad**: EQ/filter, compressor, saturator, short delay, send to global FX
3. **Global**: bus EQ, bus compressor, limiter, global reverb/delay, master clipper

Per-voice FX is essential for “per-hit space” and modern sound design, but must be capped on WASM.

### Core filter models (for drums)

Drum sound design relies on:

- SVF (LP/BP/HP) for tonal shaping
- ladder variants for character
- clean biquads for surgical EQ

#### RBJ biquads (clean EQ)

RBJ’s Audio EQ Cookbook provides canonical coefficient formulas and is a standard reference for biquad design. citeturn0search3

Implement biquads in transposed direct form II for stability.

#### ZDF/TPT filters for “analog” behavior

Virtual-analog filter design using topology-preserving transform and delay-free feedback is covered in depth in _The Art of VA Filter Design_ by entity["people","Vadim Zavalishin","va filter design author"]. citeturn0search1turn0search5

For drums:

- Use TPT SVF for resonant sweeps without instability.
- Use nonlinear ladder only where needed (e.g., kick drive, snare crunch).

#### Nonlinear Moog ladder (character option)

Huovilainen presents a nonlinear digital implementation of the Moog ladder filter and discusses modeling nonlinearities and tuning concerns. citeturn1search1turn1search5  
Provide it as a “character” filter for drums (not as the default EQ filter).

### Saturation/drive modules

Provide multiple waveshapers:

- soft clip `tanh`
- hard clip
- asymmetric “tube”
- wavefolder for metallic distortion

Aliasing in nonlinearities is a known practical issue; for best quality, apply oversampling around nonlinear blocks (especially when shaping hats/cymbals and aggressive distortion). This is a design requirement for “best-in-class” drum FX, consistent with general DSP practice and the need to manage Nyquist foldback.

### Reverb and delay

#### Dattorro plate reverb (algorithmic)

Dattorro’s _Effect Design_ paper is an AES publication (Part 1). citeturn4search9turn0search26  
The exact delay lengths and topology are widely reimplemented in open references; a faithful Dattorro-style tank reverb implementation includes the canonical tap and delay lengths at 29,761 Hz and shows how they scale with sample rate. citeturn5view2turn5view1

Key constants (at 29,761 Hz base, from a Dattorro-style implementation derived from the paper):

- Input diffusers allpass sizes: 142, 107, 379, 277 samples citeturn5view1
- Modulated allpass sizes: 672 and 908 samples citeturn5view2
- Tank delays: 4453, 4217, 3720, 3163 samples citeturn5view2
- Decay diffusers: 1800 and 2656 samples citeturn5view2
- Output taps (examples shown in code): 266, 2974, 1913, 1996, 1990, 187, 1066, etc. citeturn5view2

**Scaling**
`scaled = round(base * fs / 29761)` citeturn5view1

**Secret sauce for drums**

- A short pre-delay plus slightly higher input diffusion gives clean transient-preservation while providing tail density.
- Per-voice mini-plate (tiny delay lengths) can create “each hit has its own space” but should be WASM-limited.

#### Convolution reverb with partitioned tails

Partitioned convolution reduces latency by splitting an IR and convolving partitions separately. Gardner’s “Efficient Convolution without Input-Output Delay” is a classic reference point. citeturn6search3  
Modern real-time partitioned convolution is analyzed in depth in later technical documents, including uniform partitioning with overlap-save. citeturn6search7turn6search19

**Hybrid approach**

- Head partition (small) on CPU for low latency.
- Tail partitions either:
    - on CPU (native) using uniform partitioning, or
    - on GPU (native/web) via WebGPU compute if available.

### Compressor and limiter

Giannoulis, Massberg, and Reiss provide a tutorial and analysis of digital compressor design, recommending stable, predictable feed-forward approaches and discussing detector placement and knee behavior. citeturn1search10turn1search14

Limiter:

- lookahead + true peak (oversampled detection).
- For web budget, true peak can be optional; limiter can run at 1× in draft and 2× in render.

### GPU acceleration and visualization

WGSL is the shader language for WebGPU (specification maintained by entity["organization","W3C","standards body"]). citeturn8search1  
On native, use `wgpu` as a Rust-native implementation aligned to WebGPU. citeturn8search0

#### Hard rule: audio thread never waits on GPU

- Audio thread writes visualization taps (audio blocks, envelopes, peak arrays) into lock-free ring buffer.
- UI/render thread consumes and performs GPU submissions.

This matches the WebAudio render model constraints and avoids missed deadlines. citeturn0search8turn0search0

#### GPU workloads required

1. **FFT for spectrum / spectrogram**

- CPU writes time-domain window to GPU buffer.
- Compute shader performs radix-2 FFT (stockham autosort recommended for GPU).
- Output magnitude for a bar graph or spectrogram.

When GPU helps:

- continuous 60 fps updates with FFT sizes ≥ 2048, where CPU+transfer tradeoff favors GPU for visualization (not for DSP-in-audio-thread). citeturn8search0turn8search1

2. **Convolution tail partitions**

- Upload frequency-domain partitions of IR.
- Multiply-accumulate with input block FFT.
- Read back overlap-add buffers (asynchronous; add latency if needed). citeturn6search3turn6search7

3. **Waveform peak computation**

- Compute min/max per pixel column for waveform overview.

4. **Pattern heatmap rendering**

- Steps are a 2D matrix of intensity (velocity/probability).
- Render instanced quads.

#### WGSL pseudocode: pattern heatmap

```wgsl
struct Step {
  vel: f32,
  prob: f32,
  trig: u32,
  pad: u32,
  step: u32,
};

@group(0) @binding(0) var<storage, read> steps: array<Step>;
@group(0) @binding(1) var<uniform> u: Uniforms; // includes pads, steps_per_bar, etc.

@vertex
fn vs(@builtin(vertex_index) vi: u32,
      @builtin(instance_index) ii: u32) -> VSOut {
  // Instance ii corresponds to one step cell
  let s = steps[ii];
  let x = f32(s.step) / f32(u.steps_total);
  let y = f32(s.pad) / f32(u.pad_count);

  // Build a quad in clip space; send intensity to fragment
  ...
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  // intensity combines trig/vel/prob
  let intensity = in.trig * in.vel * in.prob;
  return vec4f(intensity, intensity, intensity, 1.0);
}
```

WGSL resource and storage buffer semantics are defined in the WGSL specification. citeturn8search1turn8search8

#### WGSL pseudocode: FFT skeleton (Stockham-style)

```wgsl
// This is pseudocode-level WGSL: shows data flow and indexing, not a full verified implementation.

@group(0) @binding(0) var<storage, read_write> buf: array<vec2f>; // complex
@group(0) @binding(1) var<uniform> u: FFTUniforms; // N, stage, etc

@compute @workgroup_size(256)
fn fft_stage(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.N/2u) { return; }

  // Stockham: read two inputs, apply twiddle, write outputs
  let a = buf[index_a(i, u.stage)];
  let b = buf[index_b(i, u.stage)];
  let w = twiddle(i, u.stage, u.N); // e^{-j2πk/N}
  let t = cmul(b, w);

  buf[out0(i, u.stage)] = a + t;
  buf[out1(i, u.stage)] = a - t;
}
```

The design relies on compute shader workgroups and storage buffers, whose semantics are defined by WGSL. citeturn8search1turn8search8

## Preset/pattern format and AI generation pipeline

### JSON schema with versioning and migration

Use a single JSON document containing:

- pads and their engines
- per-pad layers
- per-pad FX and sends
- global FX chain
- patterns: banks of patterns with metadata
- macros (8–16 performance knobs)
- mappings (MIDI learn)
- version number

**Example shape**

```json
{
  "format_version": 3,
  "meta": { "name": "Ice Hat Trap Kit", "author": "...", "tags": ["trap","bright"] },
  "pads": [
    {
      "name": "Kick",
      "choke_group": null,
      "layers": [
        { "engine": "kick_synth", "params": { "freq": 52.0, "decay": 0.42, "drive": 0.8 } },
        { "engine": "sample", "params": { "sample_id": "k1", "tune": -2.0 } }
      ],
      "fx": { "insert": [...], "sends": { "rev": 0.2, "del": 0.0 } }
    }
  ],
  "patterns": [
    { "id": "A1", "bars": 2, "steps_per_bar": 16, "tracks": [...] }
  ]
}
```

**Migration**

- Maintain `fn migrate(v_old, json) -> json_new`.
- Never break old patches; migrate at load time, then save at newest version.

### AI pattern generation stages

The pipeline is designed to operate offline (native) and optionally in-browser with smaller models.

#### Template-based generation

Generate candidate patterns via constraints:

- style templates: trap, techno, house, DnB, breakbeat, hip-hop, ambient percussion
- include:
    - density ranges per instrument
    - probability distributions
    - swing templates
    - Euclidean seeds for percussion lines (Touissant-based). citeturn7search0

#### Audio rendering for training data

Render:

- isolated hits per pad (1-shot)
- pattern loop (1–2 bars)
  Compute mel-spectrograms and onset density features (ODF-based). citeturn1search3

#### CNN classifier (quality scoring)

Train a small CNN on mel-spectrogram images to score “groove quality” or “genre fit”.

**ONNX runtime**

- Native: `ort` crate provides Rust bindings for ONNX Runtime. citeturn11search0turn11search4
- Web: ONNX Runtime Web runs models in browser via JavaScript APIs. citeturn11search1turn11search5turn11search9

Model versioning:

- ONNX IR and opset versions are explicitly versioned; IR versions are monotonic. citeturn11search3turn11search6

#### Text-to-pattern (LLM-powered) with schema validation

- Prompt includes schema + examples.
- Output is JSON pattern + kit deltas.
- Validate strictly:
    - step arrays length constraints
    - value ranges
    - choke groups legal
- If invalid, request repair or fall back to template generator.

### “Secret sauce” system-level qualities

A drum machine feels “best-in-class” when:

- **Transients remain crisp** under tempo changes and FX: achieved by transient-aware slicing and transient management in time-scale modification (enhanced WSOLA concepts). citeturn6search5turn1search3
- **Groove is controllable and explainable**: achieved by groove templates + per-voice randomization parameters similar to established groove systems. citeturn7search3
- **Hybrid synthesis is coherent**: sample layers and synth layers are phase- and envelope-aligned at hit start (align transient to zero crossing and apply consistent micro-fade-in).
- **Circuit-faithful modes exist where it matters**: at least for iconic kick behavior, where physically informed models demonstrably capture salient and modifiable behaviors beyond sampling. citeturn10search3turn10search16
- **GPU is used for what it’s good at** (visualization and non-RT compute), while the audio quantum stays bounded. WGSL and `wgpu` provide a cross-platform path. citeturn8search1turn8search0
