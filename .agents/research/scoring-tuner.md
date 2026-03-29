# Scoring Tuner Implementation Guide for Sourdaw

## Executive Summary

**Scoring** is a reference-grade chromatic tuner + tuning reference tool for Sourdaw (Tauri v2 + React 19 + Rust DSP) designed to match or exceed:

- Peterson-level strobe precision (±0.1 cent perceptual accuracy)
- PolyTune-style polyphonic string detection
- Logic-style clarity and immediacy
- Mobile tuner UX responsiveness (Guitar Tuna class)

This system is not just a pitch detector — it is a **perceptual instrument calibration system**. Core engineering constraints: **real-time safe audio**, **no allocation, no locks, no syscalls in the hot path**, and a **dual target** build (native via `cpal` callback, and WebAssembly inside `AudioWorklet`). WebAudio's default render quantum is 128 frames, making analysis workloads and UI telemetry strictly budgeted.

My design is a multi-algorithm pitch tracker with a quality governor:

- **Monophonic mode (default)**: robust F0 tracking using a hybrid of **YIN (CMNDF)** and **MPM (NSDF)** backed by FFT acceleration; plus confidence metrics ("aperiodicity" + "clarity").
- **Strobe mode**: increased temporal averaging + a phase/beat-based visualization that displays **tiny deviations as motion** (left = flat, right = sharp) with sqrt perceptual scaling, capable of representing 0.1-cent-scale errors.
- **Polyphonic string mode**: optimized for guitar/bass using a **set of band-pass filters (one per string)** feeding **monophonic pitch detectors**, plus a classifier to decide whether the input is monophonic or polyphonic.
- **Tuning systems**: reference A4 adjustable (400–490 Hz), 12-TET, historic temperaments, per-note offset tables ("sweeteners"), and **Scala `.scl`** and **AnaMark `.tun`** import.

Where competitor features are proprietary (e.g., some Peterson "sweetened" offset tables), I implement an equivalent _mechanism_ (per-note/per-string cent offsets) and ship only offsets that are publicly documented or user-supplied, clearly labeled as _unofficial_ where community-measured.

---

## 1. System Architecture

### 1.1 Real-Time Pipeline

```
Audio Input
  → DC Removal
  → Bandpass (adaptive, 40Hz–5kHz)
  → RMS + Voicing Gate
  → Analysis Ring Buffer
  → Pitch Detection (YIN / MPM hybrid)
  → Candidate Extraction + Harmonic Bias
  → Temporal Stabilization (pYIN-lite)
  → Confidence Modeling
  → Tuning Mapping
  → Lock-free SPSC → UI
  → UI Rendering (Needle / Strobe / Poly)
```

### 1.2 Crate Layout

I mirror the non-negotiable architecture style used across Sourdaw:

```text
daw-core   → newtypes, ids, time, parameter ids
daw-dsp    → no_std-friendly analysis DSP (FFT adapters, filters, detectors, smoothing)
daw-synth  → Scoring engine: stateful tracker, poly classifier, tuning system, tone gen
daw-engine → cpal callback / AudioWorklet wrapper, ring buffers, audio graph node
```

Native audio runs inside a `cpal` callback (no blocking/no allocation in hot path). Web audio runs under WebAudio's 128-frame render quantum; everything is O(1) per block with bounded CPU.

### 1.3 Thread Model

**DSP Thread (Real-Time Safe):**
- No allocations, no locks, no syscalls
- Writes to atomic shared state / lock-free SPSC ring buffer

**UI Thread:**
- Reads smoothed pitch state
- Renders GPU visuals at 60fps
- Uses double-buffered lerp to smooth between DSP update cadence (20–60Hz) and paint cadence (60fps)

### 1.4 Core Data Structures

```rust
pub struct ScoringTuner {
    pub sr: SampleRate,
    pub block_size_hint: usize,

    // Audio pass-through control
    pub mute: SmoothedBool,
    pub out_gain: SmoothedParam,

    // Analysis buffers (fixed, preallocated)
    pub analysis: AnalysisBuffer,       // ring buffer of recent samples
    pub scratch: AnalysisScratch,       // FFT buffers, temps (fixed arrays)
    pub mono: MonoPitchTracker,
    pub poly: PolyStringTracker,
    pub tuning: TuningSystem,

    // UI telemetry (lock-free SPSC, drop on full)
    pub ui_tx: SpscTx<TunerTelemetry, TELEMETRY_CAP>,

    // Tone generator
    pub tone: ToneGenerator,
}

pub struct TunerTelemetry {
    pub t_sec: f64,
    pub mode: DisplayMode,
    pub activity: f32,     // 0..1
    pub confidence: f32,   // 0..1
    pub freq_hz: f32,
    pub note_midi: i32,    // nearest note in selected temperament
    pub cents: f32,        // signed deviation from target
    pub poly: Option<PolyFrame>,
}

// Shared atomic state for UI (complementing SPSC)
pub struct SharedTunerState {
    freq: AtomicF32,
    cents: AtomicF32,
    confidence: AtomicF32,
    note: AtomicU8,
}
```

---

## 2. Monophonic Pitch Detection

### 2.1 Accuracy Targets

A cent is a logarithmic interval: `c = 1200 * log2(f2 / f1)`. At A4 = 440 Hz, 1 cent ≈ 0.254 Hz delta.

- **Standard/needle**: ±1 cent stable readout (requires smoothing).
- **Strobe**: visible motion down to ~0.1 cent (requires stable estimation + perceptual sqrt motion scaling).

### 2.2 Window Length and Update Cadence

Physics sets a lower bound for low notes. E2 ≈ 82 Hz has a period of ~12 ms; 2–3 periods means 24–36 ms. Policy:

- Maintain up to `N = 4096` or `8192` samples of history (configurable).
- Adaptive window: `window = clamp(sample_rate / min_freq * 3, 1024, 4096)`
- Run analysis at 20–60 Hz (UI refresh cadence), using a hop size between 256 and 1024 samples.
- Strobe mode: increase averaging to reduce jitter.

### 2.3 Preconditioning

Before running any estimator:

1. **DC removal** (first-order IIR highpass at 20 Hz)
2. **Bandpass** (adaptive 40 Hz–5 kHz)
3. **Amplitude normalization**
4. **Hann windowing**: `x'(n) = x(n) · 0.5(1 - cos(2πn/N))`

### 2.4 YIN (CMNDF) — Primary Estimator

Difference function:

```
d(τ) = Σ_{j=0}^{W-τ} (x_j - x_{j+τ})²
```

CMNDF:

```
d'(0) = 1
d'(τ) = d(τ) / ((1/τ) Σ_{j=1}^{τ} d(j))   for τ > 0
```

**FFT acceleration** (reduces O(W·τ) to O(N log N)):

```
d(τ) = S(0) + S(τ) - 2r(τ)
```

where `r(τ)` = autocorrelation via FFT. Use `NFFT` = next power of two ≥ `win_size + max_tau`. Zero-pad, FFT, multiply by conjugate, iFFT.

**Stable candidate selection (critical fix — do NOT use naive first threshold crossing):**

Instead, score all local minima:

```
score = (1 - cmndf[tau]) * harmonic_weight(tau)
harmonic_weight = 1 / (1 + tau * k)
```

Pick the candidate with best score. This harmonic bias suppresses octave errors by preferring shorter periods (higher fundamentals).

**Sub-sample interpolation** around selected minimum:

```
δ = (y_- - y+) / (2*(y_- - 2*y0 + y+))
δ = clamp(δ, -0.5, 0.5)
τ_refined = k + δ
f0 = sample_rate / τ_refined
confidence = 1 - cmndf[k]
```

**Implementation config:**

```rust
pub struct YinConfig {
    pub fmin: f32,
    pub fmax: f32,
    pub threshold: f32,     // theta, typical ~0.1
    pub win_size: usize,    // W
    pub max_tau: usize,     // sr/fmin
    pub min_tau: usize,     // sr/fmax
}

pub struct YinState {
    pub diff: [f32; MAX_TAU],
    pub cmndf: [f32; MAX_TAU],
}
```

### 2.5 McLeod Pitch Method (MPM / NSDF) — Cross-check & Confidence

NSDF:

```
NSDF(τ) = 2r(τ) / m₀(τ)
```

Values in `[-1, 1]` with built-in clarity metric. Use as:

- Fallback engine when YIN confidence is low
- Secondary confidence / clarity validation
- Peak-picking strategy: find key maxima between zero crossings, select first above `0.8 * global_max`

```rust
pub struct MpmConfig {
    pub fmin: f32,
    pub fmax: f32,
    pub k_rel: f32,       // ~0.8..1.0
    pub win_size: usize,
}

pub struct MpmState {
    pub nsdf: [f32; MAX_TAU],
}
```

### 2.6 Multi-frame Stabilization

Use **weighted median** (not mean) over the last 8 frames to avoid spikes:

```
stable_freq = weighted_median(last_8_frames)
```

---

## 3. Probabilistic Smoothing (pYIN-lite)

Full pYIN is too expensive for real-time tuner use. I implement lightweight HMM-like online smoothing.

**Candidate extraction:**

```
candidates = [ (freq_i, cmndf_i) for each local minimum ]
```

**Probability mapping:**

```
prob_i = exp(-alpha * cmndf_i)
normalize(prob_i)
```

**Temporal transition model:**

```
T(f' | f) = exp(-(f' - f)² / (2σ²))
```

**Online update (greedy — no full Viterbi):**

```
best_freq = argmax(prob_i * transition(prev_freq → freq_i))
```

This eliminates octave jumps and pitch tracking instability without full Viterbi latency.

```rust
pub struct PyinConfig {
    pub fmin: f32,
    pub fmax: f32,
    pub nq: usize,         // pitch bins
    pub trange: usize,     // allowed bin step per frame
    pub ptrans: f32,       // transition probability weight
    pub beta_a: f32,
    pub beta_u: f32,
}
```

---

## 4. Vibrato Handling (Dual-Path Stability)

### Problem

Vibrato causes pitch oscillation — the user expects a *stable center* reading, not jitter.

### Dual Path System

**Raw path:** immediate detection, drives strobe (shows real pitch motion).

**Smoothed path:**

```
smoothed += (raw - smoothed) * alpha
```

**Adaptive alpha** (scales with confidence):

```
alpha = map(confidence, 0 → 1, 0.05 → 0.3)
```

**Vibrato detection:**

```
if variance(freq_history) > threshold:
    vibrato_mode = true
```

When vibrato is detected:
- Reduce smoothing alpha slightly
- Widen the "in tune" color zone for needle display
- Strobe still shows real motion

---

## 5. Confidence Metrics and Voicing

Two combined metrics:

1. **YIN aperiodicity**: `1 - cmndf[best_tau]` — 0 for purely periodic, ~0.5 for white noise.
2. **MPM clarity**: NSDF max value at best peak — correlation strength proxy.

Confidence drives:
- Noise gate decisions ("don't display nonsense")
- UI coloring thresholds and state machine (inactive → searching → stable)
- Decision to switch into polyphonic interpretation mode

---

## 6. Polyphonic String Detection

### Architecture

Polyphonic "strum all strings and see each string" detection is constrained: targets are **known string ranges**. Much cheaper than NMF or full transcription.

```rust
pub struct StringPreset {
    pub name: SmallString,
    pub strings: [StringTarget; MAX_STRINGS],
    pub n: u8,
}

pub struct StringTarget {
    pub label: SmallString,   // "E2", "A2", or string number
    pub midi_note: i32,
    pub freq_hz: f32,
    pub band: BandSpec,
}

pub struct BandSpec {
    pub center_hz: f32,
    pub q: f32,
    pub lo_hz: f32,
    pub hi_hz: f32,
}

pub struct PolyStringTracker {
    pub preset: StringPreset,
    pub bands: [SvfBandpass; MAX_STRINGS],
    pub detectors: [MonoPitchTracker; MAX_STRINGS],
    pub activity: [f32; MAX_STRINGS],
}

pub struct PolyString {
    pub cents: f32,
    pub confidence: f32,
    pub active: bool,
}
```

### Filterbank Design

- SVF bandpass per string (stable, easy to retune)
- Center at string's nominal frequency
- Bandwidth: ±2 semitones minimum, wider for lower strings
- If a string is far out of tune, surface a UI hint: "too far — use mono mode"

### Per-String Detection

Each filtered band → approximately monophonic signal → run same YIN/MPM estimator with:
- Tight fmin/fmax bounds for that string
- Smaller windows (higher fmin = smaller required window)
- Harmonic alignment validation: `score = harmonic_alignment(spectrum)`

### Monophonic vs Polyphonic Classification

```
compute FFT magnitude of short window
count peaks above adaptive threshold
if peaks > N and activity high → poly mode
else → mono mode
```

Or simpler fallback: if wideband monophonic tracker returns stable high confidence → treat as mono.

### Performance

- Only enable poly tracking when poly UI mode is active
- Run at 10–20 Hz during strum events, not 60 Hz
- Cost: `Nstrings` filters + `Nstrings` reduced-window detectors ≈ ~1 ms total

Supports: guitar (6 strings), bass (4/5/6 string), custom user-defined string sets.

---

## 7. Strobe Mode

### Core Principle

Strobe = **phase drift visualization**. Motion direction reveals flat/sharp; motion speed reveals magnitude. Human vision detects motion far better than tiny static offsets — this is why strobe reaches 0.1 cent perceptual resolution.

- Scroll **left** → flat
- Scroll **right** → sharp
- Stabilized/locked → in tune at ≤0.1 cent

### Drift Equation

```
Δc = 1200 * log2(f_detected / f_target)
```

### Motion Model (Perceptual Sqrt Scaling)

```
velocity = sign(cents) * sqrt(abs(cents)) * k
phase += velocity * dt
```

The sqrt mapping exaggerates tiny errors — a 0.01-cent deviation produces visible motion even though it is physically imperceptible as a static offset. This is the key perceptual mechanism that makes strobe superior to needle for precision work.

### Lock Zone

```
if abs(cents) < 0.1:
    velocity = 0   // fully stabilized
```

### GPU Shader (WGSL)

```wgsl
struct Params {
  time_sec: f32,
  speed: f32,     // signed stripes/sec (from velocity model)
  phase: f32,
  contrast: f32,
  cage_width: f32,
};

@group(0) @binding(0) var<uniform> p: Params;

fn stripe(u: f32) -> f32 {
  let t = fract(u);
  return 1.0 - abs(2.0*t - 1.0);  // triangular wave
}

@fragment
fn fs(in: FsIn) -> @location(0) vec4f {
  let shifted = in.uv.x + p.speed * p.time_sec + p.phase;
  let s = stripe(shifted * 24.0);
  let intensity = pow(s, p.contrast);
  return vec4f(intensity, intensity, intensity, 1.0);
}
```

Renders at 60fps without touching the audio thread. "In tune" is visually emphasized by rendering a "cage" overlay when `|cents| < 0.1`.

---

## 8. Needle Mode

```
angle = clamp(cents / 50, -1, +1) * max_angle
```

Color zones:
- ±2 cents → green
- ±10 cents → yellow
- > ±10 cents → red

Limitation: a needle shows a static value; at very small errors it becomes visually quantized and hard to read. Strobe is the preferred precision display mode.

---

## 9. DSP ↔ UI Timing and Jitter Control

DSP cadence (~3–50ms per analysis update) ≠ UI paint cadence (16ms). Solution:

- DSP writes to lock-free SPSC ring buffer + atomic shared state
- UI interpolates between updates: `display = lerp(prev, current, 0.5)`
- Drop telemetry messages on overflow — never block the audio thread

---

## 10. Tuning System Engine

### Data Model

```rust
pub enum Temperament {
    Equal12TET,
    JustIntonation { key_root: i32, mode: JustMode },
    Pythagorean { key_root: i32 },
    Meantone { comma: MeantoneComma, key_root: i32 },
    WellTemperament { variant: WellVariant },
    Custom12 { cents_offset_pc: [f32; 12] },
    ScalaScl { scale: ScalaScale, mapping: ScalaMapping },
    AnaMarkTun { tuning: TunScale },
}

pub struct TuningSystem {
    pub a4_hz: f32,                        // ISO 16: 440Hz standard; user: 400–490Hz
    pub concert_transpose_semitones: i32,
    pub capo_semitones: i32,
    pub temperament: Temperament,
    pub sweetener: Option<Sweetener>,
}

pub struct Sweetener {
    pub name: SmallString,
    pub offsets: [Option<f32>; 128],       // cents offsets per MIDI note; None = 0
}
```

### Frequency Computation

```
target_freq = a4 * 2^(offset / 1200)
cents_deviation = 1200 * log2(f_detected / target_freq)
```

### Why Sweeteners Exist

Equal temperament major thirds are 400 cents; a just 5:4 major third is ~386 cents. This mismatch causes audible beating in certain chord contexts. Sweeteners are small per-note offsets (0.1 cent granularity) to compensate for instrument-specific intonation issues (string inharmonicity, neck geometry, etc.).

I implement the mechanism fully but ship only: open temperaments (just, meantone, etc.), user-imported `.scl`/`.tun`, and user-created sweeteners. Community-measured offsets for Peterson presets are labeled "unofficial / user-measured."

### Scala `.scl` Import

Text format: comments (`!`), description line, note count `N`, then `N` pitch values as either cents (`408.0`) or ratios (`5/4`).

Conversion: ratio `p/q` → `cents = 1200 * log2(p/q)`.

### AnaMark `.tun` Import

`[Scale Begin]` / `[Scale End]` delimiters; `BaseFreq` (default: A=440 on note 69); per-note cent values relative to base frequency.

### Other Supported Systems

- **Buzz Feiten system**: structural compensation + adjusted offsets → implement as instrument preset loading specific offset tables
- **True Temperament**: curved fret offsets → implement same way

---

## 11. Tone Generator

```
phase += freq / sample_rate
output = sin(2π * phase)
```

Amplitude-smoothed on note change to avoid clicks. Uses the same tuning system for frequency selection. Mute mode: analysis still runs, output gain ramps smoothly to -∞.

---

## 12. Calibration History Graph

Ring buffer of the last 5–30 seconds of (timestamp, cents) pairs decimated at 20–60 Hz cadence. UI renders as GPU line strip, ±50 cents vertical range, with optional confidence shading.

---

## 13. UI/UX Structure

### Progressive Disclosure

**Level 1 — Play:** Large note name, color feedback, simple gauge. Zero cognitive load, readable from distance.

**Level 2 — Shape:** Instrument select, display mode (needle/strobe), A4 reference pitch.

**Level 3 — Build:** Tuning tables, history graph, transposition, capo, custom string sets.

**Mini Mode:** Note + thin bar only. Embeds in timeline or plugin chain.

### Polyphonic Display

String list showing label (E2, A2, etc.), small tuning bar per string, color-coded near-zero indicator. "Strum all open strings → see which need tuning."

### Color semantics

- **Green**: ±2 cents (in tune)
- **Yellow**: ±10 cents (close)
- **Red**: > ±10 cents (needs work)

Thresholds are tunable.

---

## 14. Performance Budget

| Task              | Cost       |
|-------------------|------------|
| YIN FFT (4096pt)  | ~0.2ms     |
| Poly (6 strings)  | ~1ms       |
| Strobe GPU        | negligible |
| Tone generator    | negligible |

### WASM Constraints

- 128 samples per block (~3ms at 44.1kHz)
- Analysis runs at 20–30 Hz (amortized, not every block)
- UI interpolates between updates
- Poly tracking only while active, at 10–20 Hz
- Drop telemetry on overflow, never block

Performance governor: reduce FFT size in standard mode, disable poly unless needed, lower poly Hz on CPU spike.

---

## 15. Testing Strategy

### DSP Correctness

1. **Cents math roundtrip**: `f2 = f1 * 2^(c/1200)` and `c = 1200 log2(f2/f1)` against known values.
2. **YIN regression**: synthetic sine at known f0 over fmin..fmax; verify fundamental selection, CMNDF threshold, and harmonic bias suppresses octave errors.
3. **MPM regression**: NSDF peak picking, key maxima selection at `k_rel` 0.8–1.0.
4. **pYIN-lite**: verify octave jump elimination across frame boundaries with synthetic pitch modulation.
5. **Vibrato detection**: feed sinusoidal pitch modulation at typical vibrato depth; confirm smoothed output tracks center, not extremes.
6. **Polyphonic regression**: multi-sine signals at guitar open strings + detuned variants; verify per-string bandpass+detector; test out-of-range string misassignment risk is surfaced.
7. **Scala/TUN parsing**: parse format examples; verify cents/ratio conversion and base frequency defaults.

### Latency and Update-Rate Tests

- For each fmin tier, measure time-to-stable.
- Ensure UI update at 20–60 Hz.
- Strobe motion remains stable at small deviations with averaging active.

---

## 16. Core Design Principles

- **Strobe precision** comes from visualizing *drift rate* (sqrt scaled), not static position — motion is perceptible at 0.1 cent even though no static display can show it.
- **Octave error resistance** comes from harmonic-weighted candidate scoring (not naive first-threshold-crossing) plus pYIN-lite temporal smoothing.
- **Polyphonic guitar success** comes from constraining the problem: bandpass-per-string + monophonic detectors beats NMF on CPU while matching the PolyTune UX.
- **Musical "in tune"** is temperament-dependent; equal temperament compromises explain why sweeteners and custom offsets exist, and the engine models them as explicit per-note offsets + importable formats.
- **Vibrato stability** requires a dual path — raw for strobe truth, smoothed for needle center — with adaptive alpha tied to confidence.
