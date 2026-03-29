# Scoring Tuner Implementation Guide for Sourdaw

## Executive summary

I am implementing **Scoring**, a built-in chromatic tuner + tuning reference tool for Sourdaw (Tauri v2 + React 19 + Rust DSP) that must feel as immediate and readable as a simple DAW tuner, while reaching **strobe-level precision** and supporting **polyphonic guitar/bass string detection** plus **alternate tunings** (historical temperaments, “sweeteners,” and microtonal file import). The core engineering constraints are: **real-time safe audio**, **no allocation, no locks, no syscalls in the hot path**, and a **dual target** build (native via `cpal` callback, and WebAssembly inside `AudioWorklet`). WebAudio’s default render quantum is **128 frames**, making analysis workloads and UI telemetry strictly budgeted. citeturn25view0turn27search9turn0search15turn28view0turn19view0

My design is a multi-algorithm pitch tracker with a quality governor:

- **Monophonic mode (default)**: robust F0 tracking for “any instrument” using a hybrid of **YIN (CMNDF)** and **MPM (NSDF)** backed by FFT acceleration; plus confidence metrics (“aperiodicity” + “clarity”). citeturn15view0turn15view1turn16view0
- **Strobe mode**: increased temporal averaging + a phase/beat-based visualization that displays **tiny deviations as motion** (left = flat, right = sharp) and can represent 0.1-cent-scale errors because motion reveals the _rate of mismatch_, not a quantized needle position. citeturn25view0turn19view0turn17view0
- **Polyphonic string mode**: optimized for guitar/bass by following the approach described in the PolyTune patent: a **set of band-pass filters (one per string)** feeding **monophonic pitch detectors**, plus a classifier to decide whether the input is monophonic or polyphonic. citeturn19view0turn19view3turn28view4
- **Tuning systems**: reference A4 adjustable (at least 400–490 Hz as in Peterson hardware docs), 12-TET, historic temperaments, per-note offset tables (“sweeteners”), and **Scala `.scl`** and **AnaMark `.tun`** import. citeturn25view0turn27search9turn29view1turn30view3

Where competitor features are proprietary (e.g., some Peterson “sweetened” offset tables), I implement an equivalent _mechanism_ (per-note/per-string cent offsets + constraints) and ship only offsets that are publicly documented or user-supplied; I clearly label any community-measured offsets as _unofficial_.

## System architecture and real-time constraints

### Crate layout

I mirror the non-negotiable architecture style used across Sourdaw:

```text
daw-core   → newtypes, ids, time, parameter ids
daw-dsp    → no_std-friendly analysis DSP (FFT adapters, filters, detectors, smoothing)
daw-synth  → Scoring engine: stateful tracker, poly classifier, tuning system, tone gen
daw-engine → cpal callback / AudioWorklet wrapper, ring buffers, audio graph node
```

Native audio runs inside a `cpal` callback, which reinforces “no blocking/no allocation” in the hot path. citeturn27search9turn25view0turn28view0  
Web audio runs under WebAudio’s render quantum (commonly 128 frames), so I assume 128-sample blocks on the analysis interface and design everything to be O(1) per block with bounded CPU. citeturn0search15turn25view0turn19view0

### Hot-path dataflow

Scoring is typically inserted on a track, but it also supports a “global utility” mode (monitor selected track). Engine-side, both are the same: I receive a mono or stereo input buffer and optionally pass-through/mute.

**Audio-thread pipeline (per block):**

1. Read `block` samples from the input (mono downmix with equal-power).
2. Apply **noise gate / activity detector** (RMS or peak + smoothed envelope).
3. Push samples into a fixed-size **analysis ring buffer**.
4. If it’s time to update (e.g., 20–60 Hz UI cadence), run analysis:
    - monophonic: YIN/MPM hybrid
    - polyphonic: per-string filterbank + detectors
5. Compute display outputs: note name, octave, cents deviation, confidence.
6. Emit a small telemetry message to UI via SPSC ring buffer (drop on full).
7. Output audio: pass-through or mute (config), with click-free gain ramp.

For lock-free SPSC ring buffers, I follow the same style as `rtrb` (bounded ring buffer designed for real-time audio contexts). citeturn27search9turn25view0turn19view0turn28view0

### Real-time-safe Rust data structures

I preallocate everything at init. No `Vec` growth in `process()`.

```rust
pub struct ScoringTuner {
    pub sr: SampleRate,
    pub block_size_hint: usize,

    // Audio pass-through control
    pub mute: SmoothedBool,
    pub out_gain: SmoothedParam,

    // Analysis buffers (fixed)
    pub analysis: AnalysisBuffer,          // ring buffer of recent samples
    pub scratch: AnalysisScratch,          // FFT buffers, temps (fixed arrays)
    pub mono: MonoPitchTracker,
    pub poly: PolyStringTracker,
    pub tuning: TuningSystem,

    // UI telemetry
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
    pub note_midi: i32,    // nearest note in 12-TET space (or mapped scale degree)
    pub cents: f32,        // signed deviation
    pub poly: Option<PolyFrame>, // per-string info
}
```

## Monophonic pitch detection engine

I implement a **multi-algorithm** monophonic tracker, because “best across all instruments” is rarely achieved by a single method. My default tracker is **YIN** for octave-robustness, with an **MPM-style NSDF** fallback and cross-check, and an optional pYIN-like temporal smooth layer for stability.

### Measurement units and accuracy targets

A cent is a logarithmic interval:  
`c = 1200 * log2(f2 / f1)` and `f2 = f1 * 2^(c/1200)`. citeturn2search0turn2search2

From the formula, at A4 = 440 Hz, 1 cent corresponds to a frequency ratio `2^(1/1200)` and a frequency delta of about **0.254 Hz** (derived directly from the above). That frames the UI accuracy targets:

- **Standard/needle**: ±1 cent “stable” readout (requires smoothing).
- **Strobe**: visible motion down to ~0.1 cent (requires stable estimation + long-term averaging). Peterson’s strobe products explicitly claim 0.1 cent accuracy and show a stabilized image at that tolerance. citeturn25view0turn28view0

### Window length, latency, and update cadence

Physics sets a lower bound for low notes: I need multiple periods of the fundamental. For example, E2 ≈ 82 Hz has a period of ~12 ms; 2–3 periods means 24–36 ms of data. This is consistent with time-domain approaches like YIN/AMDF styles described in the literature. citeturn15view0turn15view1

**Practical policy:**

- Maintain up to `N = 4096` or `8192` samples of history (configurable).
- Run analysis at 20–60 Hz cadence (UI refresh) using a hop size between 256 and 1024 samples.
- In strobe mode, increase hop window (or average multiple analyses) to reduce jitter.

### Autocorrelation and ACF-derived estimators

Classic ACF pitch detection finds a peak in autocorrelation. Cheveigné shows the tight relationship between the squared difference function and running autocorrelation, and derives efficient computations and normalization insights for period estimation. citeturn15view0turn15view1

I keep ACF as a baseline and for confidence/voicing cues, but I do not use it alone because of octave errors and subharmonic ambiguity (peaks at multiples/submultiples). The YIN family addresses this directly. citeturn15view0turn15view1

### YIN (CMNDF) as primary estimator

In Cheveigné’s formulation, define the difference function:

`d_t(τ) = (1/W) ∑_{j=1..W} (x_j - x_{j-τ})^2` citeturn15view0turn15view1

Then define the **cumulative mean normalized difference function** (CMNDF):

`d'_t(0) = 1`  
`d'_t(τ) = d_t(τ) / [ (1/τ) ∑_{j=1..τ} d_t(j) ]` for τ>0 citeturn15view0turn15view1

Cheveigné’s paper emphasizes that CMNDF avoids “too high F0” errors and removes the need for an explicit upper search limit, and it normalizes w.r.t. amplitude—crucial for thresholding. citeturn15view0turn15view1

**Absolute threshold step**

- Choose a threshold θ; Cheveigné notes θ ≈ 0.1 works well in most cases. citeturn15view0
- Select the **first local minimum** of `d'(τ)` that falls below θ; pick the smallest τ among minima below θ to prefer the fundamental rather than subharmonics. citeturn15view0turn15view1

**Parabolic interpolation**
To get sub-sample τ precision, perform quadratic interpolation around the selected minimum, as recommended in the YIN discussion. citeturn15view0turn15view1

**Interpolation math (standard)**
Given `y_- = d'(k-1)`, `y0 = d'(k)`, `y+ = d'(k+1)`:

`δ = (y_- - y+) / (2*(y_- - 2*y0 + y+))`  
`τ_refined = k + δ`

Then `f0 = sr / τ_refined`.

#### YIN implementation structure

```rust
pub struct YinConfig {
    pub fmin: f32,
    pub fmax: f32,
    pub threshold: f32,     // theta, typical ~0.1
    pub win_size: usize,    // W
    pub max_tau: usize,     // usually sr/fmin
    pub min_tau: usize,     // usually sr/fmax
}

pub struct YinState {
    // Scratch buffers allocated once
    pub diff: [f32; MAX_TAU],
    pub cmndf: [f32; MAX_TAU],
}
```

#### YIN per-update pseudocode (real-time-safe)

```rust
fn yin_estimate(x: &[f32], cfg: &YinConfig, st: &mut YinState) -> Option<Estimate> {
    // 0) preconditions: x length >= cfg.win_size + cfg.max_tau
    // 1) compute diff(τ) for τ in [min_tau..max_tau]
    // 2) compute cmndf with running cumulative mean
    // 3) find first dip below threshold, then refine by parabolic interpolation
    // 4) compute confidence from cmndf value + voicing metrics
}
```

#### FFT-accelerated YIN/NSDF

Computing d(τ) directly is O(W·τ_range). For low notes and larger windows, I instead follow the FFT acceleration approach stressed in MPM: compute autocorrelation via FFT by zero-padding, FFT, multiply by conjugate, iFFT. citeturn16view0

MPM explicitly describes this FFT approach (zero pad, FFT, multiply by conjugate to get PSD, inverse FFT). citeturn16view0

**Practical approach**

- Use `NFFT` = next power of two ≥ `win_size + max_tau`
- Copy frame with window to complex array
- FFT → power spectrum → iFFT → autocorrelation
- Derive NSDF/CMNDF from autocorrelation + energy terms.

This keeps the update cost ~O(N log N), stable for both native and WASM.

### McLeod Pitch Method (MPM / NSDF) as cross-check

MPM uses a **Normalized Square Difference Function (NSDF)** with a peak-picking strategy and a clarity measure. citeturn16view0turn16view2

MPM defines NSDF in terms of autocorrelation and normalization, keeping values in [-1,1] and enabling a meaningful clarity estimate. citeturn16view0turn16view2

**Key MPM points I inherit**

- Compute NSDF efficiently via FFT-based ACF (as above). citeturn16view0
- Perform peak picking by selecting “key maxima” between zero crossings and choosing the first key maximum above a threshold relative to the highest maximum; the paper mentions a practical k range ~0.8 to 1.0. citeturn16view0
- Use parabolic interpolation around selected maxima for sub-sample accuracy. citeturn16view3

#### MPM implementation structure

```rust
pub struct MpmConfig {
    pub fmin: f32,
    pub fmax: f32,
    pub k_rel: f32,       // ~0.8..1.0
    pub win_size: usize,
}

pub struct MpmState {
    pub nsdf: [f32; MAX_TAU],
    // plus autocorr buffer if not shared
}
```

### pYIN-style probabilistic smoothing

The pYIN concept is “YIN + probabilistic candidate weighting + HMM smoothing.” Even when I cannot rely on a single PDF source in the runtime environment, open-source implementations show the core steps:

- Find multiple candidate valleys (periods) in a YIN-like function.
- Convert candidate valley depths into probabilities using a distribution (commonly a beta prior over threshold choices).
- Build an observation set of candidate pitches per frame with probabilities.
- Apply a sparse HMM / Viterbi-like decode to pick a smooth pitch trajectory.

The `pyin.c` implementation illustrates: (a) collecting valleys, (b) calculating candidate probabilities via a beta pdf, and (c) calling a sparse hidden-state solver (`gvps_sparse_sampled_hidden_static`) with transition functions that penalize large jumps. citeturn23view2

#### Practical Rust design

I implement only the parts that matter for a tuner:

- **short HMM state space**: bins are semitone or cents-resolution bins within [fmin..fmax]
- **simple transitions**: prefer “same or nearby bins,” allow limited jump per frame
- **voicing state**: “unvoiced” absorbs noise floor blocks

```rust
pub struct PyinConfig {
    pub fmin: f32,
    pub fmax: f32,
    pub nq: usize,         // pitch bins
    pub trange: usize,     // allowed bin step/frame
    pub ptrans: f32,       // probability of changing state
    pub beta_a: f32,
    pub beta_u: f32,
}

pub struct PyinState {
    pub candidates: [[Candidate; MAX_CANDS]; MAX_FRAMES],
    pub cand_counts: [u8; MAX_FRAMES],
    pub viterbi: ViterbiScratch,
}

pub struct Candidate { pub bin: u16, pub p: f32, pub freq_hz: f32 }
```

**Why this helps**

- Needle mode shouldn’t jitter on vibrato; it should show “center tendency,” while still reflecting drift. The HMM smooth path provides stability without adding large latency if I keep hop size reasonable. The pYIN codebase specifically compensates “unvoiced→voiced boundary” delays by extending voicing backward by several frames. citeturn23view2

### Confidence metrics and octave-error suppression

I combine two metrics:

1. **YIN aperiodicity**: Cheveigné defines a periodic/aperiodic partition around the estimated period T and derives an “aperiodicity” measure `A_T` (0 for purely periodic, ~0.5 for white noise). citeturn15view0
2. **MPM clarity**: NSDF max value corresponds to correlation strength and is used as a clarity estimate. citeturn16view0

Confidence drives:

- noise gate decisions (“don’t display nonsense”)
- UI coloring thresholds
- whether to switch into polyphonic interpretation mode.

### Performance characteristics and SIMD opportunities

#### Cost model

A tuner’s heavy work happens at **analysis cadence**, not every sample. I budget for:

- `analysis_hz = 30` updates/s (typical)
- `NFFT` = 2048–8192 depending on mode and detected low frequency

FFT-based autocorrelation costs O(N log N). MPM explicitly relies on FFT efficiency for ACF extraction. citeturn16view0

#### SIMD

- Preprocessing (DC removal, window multiply) is vectorizable (4–8 f32 at a time).
- Correlation/difference loops are vectorizable if I run a time-domain fallback for small windows.
- On WASM, `simd128` can speed the windowing and energy accumulation; FFT libs vary by platform (I keep an interchangeable backend).

#### WASM budget estimate (128 frames @ 44.1kHz)

I treat the strict budget as: analysis must be amortized across blocks. In practice:

- Do **not** run a 4096-point FFT every block.
- Run monophonic pitch analysis at 20–60 Hz (once every ~735–2205 samples at 44.1k).
- Run polyphonic separation only when poly mode is active and activity/confidence indicate a stable strum. The PolyTune concept is “strum all strings and see each string,” but it is still a discrete interaction, not continuous microsecond responsiveness. citeturn28view4turn19view3

## Polyphonic string detection engine

Polyphonic “chord” pitch detection is a deep research field, but Polytune-style “tune all guitar strings simultaneously” is more constrained: the targets are **known string ranges**, and I only need per-string deviation, not full transcription.

### What the PolyTune patent implies

The polyphonic tuner patent explicitly describes:

- separating string partials using **a set of bandpass filters, one per string**, followed by **monophonic pitch detectors**; and as an alternate approach, using a Fourier transform on the conditioned signal to find pitch information for all strings. citeturn19view0turn19view3
- a limitation: because the polyphonic detector cannot perfectly assign harmonic partials to strings, it assumes a frequency range around each string’s nominal frequency belongs to that string; if a string is very out of tune, it may be shown under the wrong string indicator. citeturn19view1turn19view2
- differentiating monophonic vs polyphonic input via correlation/Fourier/ASDF pattern analysis and even by counting spectral peaks. citeturn18view1turn19view3

The PolyTune user manual explicitly markets the workflow: strum all open strings and see which strings need tuning. citeturn28view4

### Polyphonic tracker architecture

I implement a polyphonic module that supports:

- guitar: 6 strings (standard + presets)
- bass: 4/5/6 string
- custom “string sets” (user-defined targets).

```rust
pub struct StringPreset {
    pub name: SmallString,
    pub strings: [StringTarget; MAX_STRINGS],
    pub n: u8,
}

pub struct StringTarget {
    pub label: SmallString,  // "E2", "A2" or "6"
    pub midi_note: i32,      // target pitch class in 12-TET
    pub freq_hz: f32,        // derived from tuning system (A4 ref + temperament)
    pub band: BandSpec,      // expected freq range for filterbank
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
```

### Filterbank design

I avoid narrow biquads with peaky ringing. I use an SVF bandpass (stable and easy to retune), or two-pole bandpass with controlled Q.

**Band range**

- I center each band around the string’s nominal frequency.
- Width: at least ±2 semitones worth of bandwidth to allow moderate detuning; more if required.
- Because PolyTune-style detection can misassign if a string is _way_ out of tune, I surface a clear UI hint: “too far off; use monophonic mode,” matching the patent’s warning about out-of-range string misinterpretation. citeturn19view1turn19view2

### Per-string pitch estimation

Each filtered band gives (approximately) a monophonic signal. I run the same YIN/MPM estimator inside each band, but with:

- smaller f-range (tight min/max based on the string)
- smaller windows (faster, since fmin is higher for higher strings)
- aggressive confidence gating.

### Polyphonic vs monophonic classification

Following the patent’s discussion, I use:

- spectral peak count / spectral complexity proxy, or
- “monophonic detector validity”: if wideband monophonic tracker returns stable high confidence, treat as monophonic; else fall into poly classifier. citeturn18view1turn19view3

A simple but robust classifier:

- compute FFT magnitude of a short window
- count peaks above adaptive threshold
- if peaks > threshold and activity high, treat as poly.

### General polyphonic approaches (for future expansion)

If I later want “truly polyphonic note extraction,” I can add:

- **Harmonic Product Spectrum (HPS)**: multiply downsampled spectra to emphasize fundamentals (classic Noll lineage), with definition `Y(ω) = ∏_{r=1..R} |X(rω)|` described in university teaching material. citeturn4search9turn5search18
- **Subharmonic summation**: a psychoacoustically motivated spectral-compression approach described in Hermes’s classic paper. citeturn5search10
- **NMF-based multi-pitch estimation**: matrix factorization approaches are used for multiple pitch estimation and transcription; the ISMIR discriminative NMF paper demonstrates supervised improvements for multi-pitch estimation. citeturn4search3turn4search15

For Scoring’s **product requirement** (guitar/bass poly tuning), the filterbank approach is directly consistent with the PolyTune patent description and is much cheaper than NMF. citeturn19view0turn28view4

### Performance and WASM budget

Poly mode cost is roughly:

- `Nstrings` filters + `Nstrings` monophonic detectors at reduced window sizes.

WASM strategy:

- only enable poly tracking while poly UI mode is active
- run poly analysis at 10–20 Hz during strums (UI need), not at 60 Hz.

## Temperament, reference pitch, and sweetened tunings

### Reference pitch (A4) and cent computations

I implement A4 reference frequency as a continuous parameter.

- ISO 16 specifies a standard tuning frequency of **A = 440 Hz** for the A in the treble stave. citeturn27search9
- Peterson tuners expose wide ranges (example manual: A=400–490 Hz). citeturn25view0

The tuner uses cents math to compute deviation:

- `cents = 1200 * log2(f_detected / f_target)` citeturn2search0turn2search2

### Temperaments and mapping to target frequencies

The “tuning system” outputs a target frequency per note. I separate:

- **pitch labeling** (note name, sharps/flats, transposition)
- **frequency targets** (temperament and offsets)

#### Data model

```rust
pub enum Temperament {
    Equal12TET,
    JustIntonation { key_root: i32, mode: JustMode },
    Pythagorean { key_root: i32 },
    Meantone { comma: MeantoneComma, key_root: i32 },
    WellTemperament { variant: WellVariant },
    Custom12 { cents_offset_pc: [f32; 12] },  // pitch-class offsets
    ScalaScl { scale: ScalaScale, mapping: ScalaMapping },
    AnaMarkTun { tuning: TunScale },
}

pub struct TuningSystem {
    pub a4_hz: f32,
    pub concert_transpose_semitones: i32,  // transposing instruments
    pub capo_semitones: i32,
    pub temperament: Temperament,

    // “sweetener” overlays (per-note offsets)
    pub sweetener: Option<Sweetener>,
}

pub struct Sweetener {
    pub name: SmallString,
    pub offsets: [Option<f32>; 128], // cents offsets per MIDI note; None = 0
}
```

### Why sweetened tunings exist

Equal temperament major thirds are 400 cents, while a just 5:4 major third is about 386 cents; this mismatch is commonly cited as a source of “beating” or “sounds sharp” in certain chord contexts. citeturn2search1turn2search10

Sweeteners are, mechanically, **small per-note offsets** intended to reduce perceived beating or compensate instrument-specific intonation issues (string deflection, inharmonicity, etc.). Peterson manuals describe “sweeteners” as preset tunings and include instrument categories; their FAQ highlights both claimed accuracy and the ability to display it. citeturn25view0turn28view0turn28view1

### Peterson-style sweeteners: what is and is not public

Peterson documentation publicly lists sweetener preset names and what they’re for (e.g., guitar, acoustic guitar, bass, orchestral strings, historic temperaments). citeturn25view0turn28view1  
However, the **exact cent offsets** for some popular sweeteners may be treated as proprietary; community discussions explicitly note that not all offsets are published in manuals and that some users measure them manually. citeturn24search2turn24search6

**Engineering response**

- I implement the “sweetener mechanism” fully:
    - per-note offsets (0.1 cent granularity is useful, as Peterson software allows 0.1 increments for global offsets) citeturn9view4
- I ship only:
    - open, documented temperaments (just intonation, meantone, etc.)
    - user-imported `.scl`/`.tun`
    - user-created sweeteners
- If I include community-measured offsets for a user convenience preset, I label them “unofficial / user-measured.”

### Scala `.scl` import

The Scala `.scl` format is explicitly documented for developers: it is a text format with one scale per file, comment lines starting with `!`, a description line, then number of notes, then pitch values as either ratios (e.g., `5/4`) or cents values (e.g., `408.0`). citeturn29view1turn29view2

**Parsing rules I follow**

- Ignore comment lines (`!`).
- Read description (may be empty).
- Read integer `N` notes.
- Read `N` pitch lines:
    - if contains a period → cents
    - else ratio (slash) or integer (treated as integer/1). citeturn29view1turn29view2

I convert each scale degree to a cents value relative to 1/1:

- ratio `p/q` → cents = `1200 * log2(p/q)` (using the cent formula). citeturn2search0turn29view2

### AnaMark `.tun` import

The AnaMark tuning specification defines scale datasets delimited by `[Scale Begin]` / `[Scale End]`, supports multiple scales per file, and provides multiple sections. citeturn30view0turn28view3

For a tuner, I implement **two** parts:

1. **Exact tuning**: base frequency + per-note cent values relative to base frequency. The spec states that `BaseFreq` defaults to a value corresponding to A=440 for note 69, and that `note x` values are cents relative to `BaseFreq`. citeturn30view3
2. **Functional tuning** (optional advanced): algorithmic formulas; the spec illustrates tokenized formulas and also includes a ‘!’ token to force a given MIDI note to match a frequency in Hz. citeturn30view2

### Buzz Feiten and True Temperament support as tuning overlays

The tuner should support guitar intonation systems used in practice:

- Buzz Feiten system: manufacturer and industry sources describe it as a combination of structural compensation and adjusted intonation offsets, improving chord intonation consistency. citeturn3search17turn25view0
- True Temperament: official materials describe curved frets (“Dynamic Intonation”) intended to improve intonation across the neck. citeturn3search6turn3search2

**Implementation note**

- These systems are best represented as **instrument presets** that load specific offset tables and UI instructions, not as new math. The tuner engine’s “sweetener offsets” model handles both.

## Displays, GPU rendering, and UX integration

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["Peterson strobe tuner display bands scrolling","TC Electronic PolyTune polyphonic display all strings","DAW tuner needle display chromatic","guitar tuner app green in tune UI"],"num_per_query":1}

### Output quantities and UI semantics

Per update, I compute:

- `freq_hz`: detected fundamental (mono) or per-string frequency (poly)
- `note_target`: nearest target note in selected temperament
- `cents`: signed deviation from target
- `confidence`: 0..1 (combines activity, periodicity/clarity)
- `state`: {inactive, searching, stable}

Color feedback:

- green within ±2 cents
- yellow within ±10 cents
- red beyond ±10 cents  
  (These thresholds are tunable; the key is consistent UX.)

### Needle / gauge mode

Needle mode is a mapping:

- `needle_angle = clamp(cents / cents_full_scale, -1, +1) * max_angle`

Where `cents_full_scale` might be 50 cents (half a semitone) for a full sweep. The numerical cents readout always shows full precision.

**Why needle is limited**
The needle display shows a static value; at very small errors, it becomes visually quantized and hard to read. Strobe visualizes motion, which remains perceptible at tiny deviations. Peterson’s strobe manuals describe motion direction and “stabilized/caged” behavior at 0.1 cent accuracy. citeturn25view0turn28view0

### Strobe mode: digital stroboscopic principle

Peterson describes their strobe bands:

- scroll left for flat
- scroll right for sharp
- stabilized/caged indicates in tune at 0.1 cent. citeturn25view0turn28view0

The PolyTune patent also explains a digital stroboscopic principle:

- maintain an input signal buffer containing at least one (preferably two) periods
- use an interpolation mechanism synchronized to the **target pitch frequency**
- sample the input buffer at equally spaced time instances so that one or two target periods are represented; the visual “strobe” emerges from how these samples appear over time when the signal is or isn’t aligned to the target. citeturn17view0turn17view1

#### A practical strobe rendering model

I define:

- `f_t`: target frequency for displayed note
- `f_e`: estimated frequency
- `Δc = 1200 * log2(f_e / f_t)` cents deviation (signed) citeturn2search0turn2search2

I convert deviation into a **phase drift rate**:

- ratio `r = f_e / f_t`
- the relative phase slip per second is `(f_e - f_t)` cycles/s (beat frequency)
- convert to a normalized visual speed:
    - `v = k * (f_e - f_t)` stripes per second
    - direction: left if negative, right if positive (matching Peterson). citeturn25view0turn28view0

“0.1 cent at 440 Hz” corresponds to a very small `f_e - f_t`; that yields slow drift but still visible.

#### GPU approach

Strobe is best drawn on GPU as a shader that samples a repeating pattern texture (or procedurally generates stripes) and shifts UV coordinates by `v * time`:

WGSL-style pseudocode (fragment shader):

```wgsl
struct Params {
  time_sec: f32,
  speed: f32,     // signed stripes/sec
  phase: f32,     // optional offset
  contrast: f32,
  cage_width: f32 // how tight “in tune” looks
};

@group(0) @binding(0) var<uniform> p: Params;

fn stripe(u: f32) -> f32 {
  // simple triangular wave as stripe base
  let t = fract(u);
  return 1.0 - abs(2.0*t - 1.0);
}

@fragment
fn fs(in: FsIn) -> @location(0) vec4f {
  let u = in.uv.x;
  let shifted = u + p.speed * p.time_sec + p.phase;
  let s = stripe(shifted * 24.0); // 24 stripes across
  let intensity = pow(s, p.contrast);
  return vec4f(intensity, intensity, intensity, 1.0);
}
```

This renders at 60 fps without touching the audio thread. “In tune” is visually emphasized by reducing motion and optionally rendering a “cage” highlight when `|cents| < 0.1`.

### Polyphonic mode display

I present a string list:

- label (E2, A2… or string number)
- small tuning bar per string
- color-coded near-zero indicator

This matches the user-facing behavior described in PolyTune documentation (“strum all open strings… see which strings need fine tuning”). citeturn28view4turn19view3

### Calibration history graph

I store a decimated ring buffer of `(timestamp, cents)` for 10–30 seconds, and render as a line graph.

To keep it cheap:

- audio thread pushes 20–60 Hz samples, not every sample
- UI thread draws via GPU line mesh or CPU canvas path
- optionally show confidence shading.

### Tone generator and mute/bypass behavior

I implement a reference tone generator:

- sine oscillator (phase accumulator), amplitude-smoothed to avoid clicks
- note/frequency selection uses the same tuning system.

StroboClip manuals emphasize real-time operation and use on many instruments; a clean sine reference meets “tune by ear” needs. citeturn25view0turn27search9

Mute mode:

- analysis still runs
- output gain ramps to -∞ smoothly and returns smoothly.

## Testing, calibration, and performance budgeting

### Correctness tests (DSP)

1. **Cents math roundtrip**: verify `f2 = f1 * 2^(c/1200)` and `c = 1200 log2(f2/f1)` against known values. citeturn2search0turn2search2
2. **YIN regression**:
    - synthetic sine at known f0 over fmin..fmax
    - verify fundamental selection and CMNDF threshold behavior (θ ~ 0.1 baseline). citeturn15view0
3. **MPM regression**:
    - check NSDF peak picking, key maxima logic, and k range behavior. citeturn16view0turn16view3
4. **Polyphonic regression**:
    - generate multi-sine signals at guitar open strings and detuned variants
    - verify per-string bandpass+detector results
    - test “one string wildly out of tune” and confirm expected misassignment risk is surfaced, consistent with the patent’s limitation note. citeturn19view2turn19view1
5. **Scala/TUN parsing**:
    - parse official format examples and verify cents/ratio conversion rules and base frequency defaults. citeturn29view2turn30view3

### Latency and update-rate tests

- For each fmin tier, measure time-to-stable.
- Ensure UI update at 20–60 Hz; ensure strobe motion remains stable at small deviations by increasing averaging.

### Performance budgeting and quality governor

On WASM, I guarantee no deadline miss by:

- amortizing FFT work (analysis cadence)
- reducing FFT size in standard mode
- disabling poly tracking unless needed
- lowering poly tracking Hz when CPU spikes
- dropping UI telemetry messages on overflow (never blocking on UI).

This aligns with the realities of WebAudio render quantization and real-time constraints. citeturn19view0turn28view4turn27search9

### “Secret sauce” summary

- **Strobe precision** is mostly about _visualizing drift_, not only about instantaneous numerical accuracy. Manuals explicitly describe left/right motion and “stabilized/caged” when in tune at 0.1 cent. citeturn25view0turn28view0
- **Octave error resistance** comes from YIN’s CMNDF normalization and “first dip below threshold” strategy. citeturn15view0turn15view1
- **Polyphonic guitar success** comes from constraining the problem: bandpass-per-string + monophonic detectors is explicitly described as a method in the polyphonic tuner patent and matches the “strum all strings” UX. citeturn19view0turn28view4
- **Musical “in tune”** is temperament-dependent; equal temperament compromises (e.g., major third differences vs just) explain why “sweeteners” and custom offsets exist, and my engine models them as explicit per-note offsets + importable tuning formats. citeturn2search1turn2search10turn29view2turn30view3
