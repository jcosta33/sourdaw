# Mother of All Orchestral Engine Implementation Guide

## Executive summary

I am building a flagship orchestral instrument engine that runs as a **single plugin node** inside a Tauri v2 DAW, compiled to both **native** (x86_64/aarch64 via `cpal`) and **WebAssembly** (running inside a browser `AudioWorkletProcessor`). The engine must be **allocation-free, lock-free, and syscall-free in the audio hot path**, and it must support a modern orchestral workflow: cinematic multi-mic sampling, deep articulation scripting (legato, portamento, vibrato, bowing/breathing), hybrid physical modeling/modal synthesis, granular/spectral resynthesis textures, convolution/IR-based spaces, per-section FX, expressive controls (MIDI CC and MPE), and score/phrase tools (MIDI/SMF import with tempo mapping and humanization). citeturn0search6turn0search1turn0search2turn5search2turn11search1

On WebAudio, the render quantum defaults to **128 frames** (and implementations caution that the size may be configurable in the future), so I treat the block size as variable and always read it from the provided output buffer lengths. citeturn0search6turn0search0 On native, `cpal` runs audio callbacks on a dedicated high-priority thread, which reinforces the need for hard real-time discipline. citeturn0search1

The design centers around a **section + voice** engine where each voice can combine:

- **Structured sampling** (multi-velocity, round robin, interval transitions, release triggers, multiple microphone positions),
- **procedural layers** (modal resonators, waveguide physical models, additive/sines+noise components, granular textures),
- **expressive control mapping** (velocity/CC/MPE → dynamics/timbre/vibrato/legato timing),
- **space** (multi-mic IR and partitioned convolution, with optional GPU acceleration for tail partitions).

Partitioned convolution is mandatory for long orchestral IRs because direct convolution is too expensive; the classic “zero input-output delay” hybrid approach and subsequent partitioned implementations are foundational references. citeturn1search3turn4view0

To ensure implementability, I specify concrete math, deterministic data structures, Rust struct sketches, per-block pseudocode, anti-aliasing strategies, SIMD opportunities, and reasonable WASM voice budgets. Where exact counts (voices, mics, buffer sizes) are product decisions, I list them as explicit assumptions instead of inventing “facts.”

## Assumptions and constraints

I treat the following as **open-ended configuration** (compile-time constants for WASM; runtime-configurable for native), and I design every subsystem so it still works if these values are changed:

**Core constraints**

- WebAudio render quantum defaults to **128 frames**; I do not assume it is always fixed and I always check buffer lengths at runtime. citeturn0search6turn0search0
- Native audio is callback-driven and must complete on time on a dedicated high-priority thread. citeturn0search1
- Audio hot path uses only preallocated memory; UI/control changes arrive via SPSC ring buffers that return immediately on full/empty (dropping messages rather than blocking). citeturn0search2

**Open-ended parameters (examples)**

- Max polyphony: `MAX_VOICES_NATIVE` (e.g., 512) and `MAX_VOICES_WASM` (e.g., 32–64).
- Max microphone positions per instrument: `MAX_MICS` (e.g., 2–8).
- Max velocity layers: `MAX_VEL_LAYERS` (e.g., 4–12).
- Round-robin count per articulation: `MAX_RR` (e.g., 2–12).
- Interval transition coverage per legato articulation: `MAX_INTERVALS` (e.g., ±12 semitones recorded; larger via DSP or fallback).
- Streaming chunk sizes (native): prefetch bytes per sample (product-tunable).
- FFT sizes for analysis/resynthesis: 1024–8192 (quality tier dependent).
- IR lengths: up to tens of seconds; partition sizes product-tunable.

**Native vs Web sample memory**

- Native supports “direct from disk” style streaming (load the attack in RAM, stream the remainder from disk). This exact technique is explained as “DFD” in **entity["company","Native Instruments","music software company"]** documentation and manuals. citeturn8search20turn8search3
- WebAudio has no disk streaming inside an AudioWorklet; therefore web builds must preload sample data in memory and enforce hard caps and LOD strategies. The render quantum model makes long blocking I/O unworkable. citeturn0search6turn0search0

## Crate architecture and real-time dataflow

I mirror the previously specified stack and make orchestral-engine-specific additions.

**`daw-core`**

- Newtypes: `SampleRate`, `Samples`, `Seconds`, `Beats`, `Decibels`, `Hertz`, `VoiceId`, `InstrumentId`, `ArticulationId`, `MicId`, `ZoneId`, `ParamId`.
- Host timing abstraction: block timestamp and musical time mapping (tempo map, PPQ).

**`daw-dsp`**

- Stateless math primitives plus stateful DSP objects that are fixed-size and allocation-free once constructed:
    - Resamplers (linear / cubic Hermite / windowed-sinc tables)
    - Filters: RBJ biquad, SVF (TPT/ZDF), ladder variants (optional)
    - Envelope and smoothing primitives (one-pole and piecewise exponential)
    - Delay lines, fractional delay interpolators (linear, Lagrange, Thiran) as described in **entity["book","Physical Audio Signal Processing","smith 2010 online edition"]** (delay/comb/allpass, interpolation, waveguides, FDNs). citeturn4view0
    - STFT windows and overlap-add scaffolding
    - Fast oscillators for additive/resynthesis (recursive sin/cos updates)

**`daw-synth`**

- Owns instrument state and orchestration logic:
    - Section/instrument racks, mic mixers, articulation script engine
    - Voice allocator and voice stealing
    - Modulation and expression mapping (MIDI CC + MPE)
    - Pattern/phrase tools (SMF import buffers, tempo map interpretation)
    - FX routing and convolution engines
- Exposes a pure compute function:
    - `process(midi_events, output_buffers)` with no I/O.

**`daw-engine`**

- Hosts the graph and audio I/O:
    - Native: `cpal` callback integration, real-time scheduling, ring buffers. citeturn0search1turn0search2
    - Web: AudioWorklet wrapper, ring buffer design patterns for wasm processing. citeturn0search9turn0search0

### Control and parameter update strategy

I support user-facing string paths but never resolve strings on the audio thread.

**Parameter registry**

- Build a table mapping `&'static str` → `ParamId` on the UI side (perfect hash or sorted binary search).
- Audio side stores:
    - `target[param_index]`, `smoothed[param_index]`, `dirty_flags[param_index]`
- Changes arrive via SPSC queue messages:
    - `SetParam { id: ParamId, value: f32 }`
    - `LoadPresetHandle { handle_id }` (swap pointers at block boundary)

**Smoothing**
I use the standard one-pole smoother:

- `y[n] = y[n-1] + α (x - y[n-1])`
- `α = 1 - exp(-1/(τ·fs))`  
  and I tune τ by parameter type (fast for modulation, slower for UI knobs). One-pole filtering and time-varying delay/interpolation scaffolding are explicitly covered in Smith’s reference material. citeturn4view0

### Real-time-safe orchestral voice allocation

Orchestral voices are heavier than synth voices because they may read multiple mic streams, crossfade layers, and run per-voice envelopes and filters.

**Voice policy**

- Fixed voice pool:
    - WASM: small (e.g., 32–64)
    - Native: large (e.g., 256–1024)
- Voice stealing priority:
    1. voices in release tail beyond “audibility threshold”
    2. lowest-energy voices (RMS within the last N samples)
    3. oldest voices

**Orchestral-specific nuance**

- If sustain pedal / long releases are active, I allow “tail virtualization”:
    - freeze the tail into an auxiliary reverb send buffer (or into a low-rate resynthesis tail) and free the voice earlier.
      This is a practical necessity under strict quantum budgets. citeturn0search6turn1search3

## Sampling and articulation engine

This section defines the core of realistic orchestral playback: multi-dimensional sample selection (key, velocity, articulation, round-robin, mic), real-time streaming, and an articulation scripting system that produces legato, portamento, and performance realism.

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["orchestral sample library microphone positions close tree room diagram","legato interval samples transition diagram","spectrogram of violin vibrato and bow noise","convolution reverb impulse response hall multi mic"],"num_per_query":1}

### Sample and zone model

I model orchestral samples as **regions** with constraints similar to SFZ (because SFZ expresses many sampler invariants: region/group inheritance, ADSR opcodes, and round-robin sequencing via `seq_length`/`seq_position`). citeturn5search5turn5search15turn5search0

**Key dimension axes**

- `note` (MIDI key)
- `velocity` (MIDI 0–127)
- `articulation_id` (sustain, staccato, spiccato, tremolo, trill, legato transitions, etc.)
- `rr_index` (round robin)
- `mic_id` (close, tree, ambient, outriggers…)
- `variation` (optional: bow direction, breath noise variant, etc.)
- `release_trigger` (release sample vs sustain sample)

**Rust struct sketches**

```rust
pub type SampleId = u32;
pub type ZoneId = u32;
pub type ArticulationId = u16;
pub type MicId = u8;

#[derive(Clone, Copy)]
pub struct KeyRange { pub lo: u8, pub hi: u8 }
#[derive(Clone, Copy)]
pub struct VelRange { pub lo: u8, pub hi: u8 }

pub struct SampleRef {
    pub sample_id: SampleId,
    pub root_key: u8,
    pub tune_cents: i16,
    pub start: u32,   // samples
    pub end: u32,     // samples
    pub loop_mode: LoopMode,
    pub loop_start: u32,
    pub loop_end: u32,
}

pub struct Zone {
    pub id: ZoneId,
    pub key: KeyRange,
    pub vel: VelRange,
    pub art: ArticulationId,
    pub rr_pos: u8,       // seq_position
    pub rr_len: u8,       // seq_length
    pub mic: MicId,
    pub is_release: bool,

    pub sample: SampleRef,

    // Per-zone playback defaults
    pub amp_env: AdsrParams,
    pub filter: FilterDefaults,
}
```

SFZ makes the round-robin sequencing concept concrete: regions can be gated by an internal sequence counter using `seq_length` and `seq_position`. citeturn5search15turn5search0

### O(1) zone lookup

An orchestral engine must not search zones linearly at note-on.

I build a **precomputed LUT** keyed by:

- `note` (0–127)
- `vel_bucket` (e.g., 0–15)
- `articulation_id` (dense index)
- `mic_id` (dense index)
  and return a compact list of candidate zones (for round robin and “closest match fallback”).

**Data layout**

- `zone_lut[art][mic][note][vel_bucket] -> ZoneListRef`
- `ZoneListRef` points into a preallocated “zone list arena”:
    - `zone_list_arena: [ZoneId; MAX_ARENA]`
    - `zone_list_offsets: [u32; LUT_SIZE+1]`

On note-on:

1. compute `vel_bucket`
2. get slice of zone IDs
3. pick round robin deterministically
4. schedule voices.

This approach mirrors the motivation behind allocation-free SMF parsing libraries like `midly`, which explicitly avoid allocations by referencing original bytes and separating I/O from parsing. citeturn11search2

### Round robin, humanization, and repetition handling

Round robin prevents “machine gun” repetition.

**Deterministic selection**

- Maintain per-(instrument,articulation,note) counter:
    - `rr_counter = (rr_counter % rr_len) + 1`
- Choose the zone where `rr_pos == rr_counter`, consistent with SFZ semantics. citeturn5search15

**Humanization**

- Micro-variations:
    - random tuning ±2–5 cents
    - random start offset within safe range (attack-safe)
    - random velocity remap (small)
- Use seeded RNG so renders are deterministic unless user changes seed.

### Multi-mic positions and phase/time alignment

Modern orchestral libraries record multiple microphone positions (close, tree, room). Mixing them can create comb filtering if time offsets are not managed.

**I treat mic signals as physically delayed**

- Room mics are supposed to arrive later; aligning them fully to close mics can destroy depth (practical recording guidance often warns about over-aligning room mics). citeturn10search13turn10search9
- However, close mic arrays captured at slightly different distances can benefit from small time alignment to avoid severe combing.

**Delay estimation tool (offline / UI thread)**
I implement a “mic align” analysis using GCC-PHAT (generalized cross-correlation with phase transform) as a standard time-delay estimation method referenced in the time delay estimation literature (Knapp & Carter) and widely documented in engineering systems. citeturn10search8turn10search16

**Algorithm (offline)**

1. Take a short analysis segment of both mics (e.g., first 50–200 ms of sample).
2. Compute FFTs, cross-power spectrum, apply PHAT weighting, iFFT to correlation.
3. Peak location gives sample delay estimate.
4. Store per-zone mic delay corrections:
    - `mic_delay_samples[mic_id]`

**Hot-path use**

- Apply simple integer delay lines (or fractional delay if needed) per mic.
- Delay changes must be static per loaded sample/zone to avoid artifacts unless explicitly modulated.

### Native streaming vs Web in-memory

I support two build-time backends:

**Native streaming backend**

- DFD-style sample playback streams from disk, loading only the initial portion into RAM for fast attack, then reading subsequent blocks from disk while playing. This is explicitly described in official Native Instruments support material on DFD. citeturn8search20turn8search3

**Web backend**

- No disk streaming. I load samples into WASM memory (or SharedArrayBuffer where allowed outside AudioWorklet) and enforce:
    - mic LOD (disable ambient mics first)
    - velocity layer LOD (reduce to 2–4)
    - RR LOD (reduce RR count)
    - articulation LOD (disable interval transitions on large sections)
      The 128-frame render quantum makes long blocking operations inside the audio callback unacceptable. citeturn0search6turn0search0

### Resampling, pitch, and anti-aliasing in sample playback

Pitch shifting a sample is resampling. For high-quality orchestral tones, interpolation quality matters.

I implement three resampling tiers using Smith’s interpolation taxonomy (linear, Lagrange/Farrow, windowed-sinc) as laid out in PAPS’s interpolation section. citeturn4view0

**Comparison table: resampling approaches**

| Resampler     | Math                           | Quality | CPU cost | Best use              | Anti-aliasing notes                 |
| ------------- | ------------------------------ | ------- | -------- | --------------------- | ----------------------------------- |
| Linear        | `y = (1-t)x0 + t x1`           | lowest  | lowest   | draft, noisy textures | droops HF; minimal ringing          |
| Cubic Hermite | 4-point polynomial             | high    | low–mid  | default realtime      | good HF, stable                     |
| Windowed-sinc | `y = Σ x[n]·sinc(π(n-t))·w[n]` | best    | highest  | offline render, solo  | can be bandlimited if designed well |

Smith’s discussion of delay-line interpolation and windowed-sinc provides practical implementation details and highlights why naive interpolation affects frequency response. citeturn4view0

### Articulation scripting engine

I implement an articulation engine as a deterministic state machine running on the audio thread, driven by:

- MIDI events (note on/off)
- CC (mod wheel, expression, vibrato CC, bow pressure CC)
- timers (time since last note, overlap duration)
- velocity
- optionally MPE per-note controls. citeturn5search2turn5search10

#### Articulation model

```rust
pub enum Articulation {
    Sustain,
    Staccato,
    Spiccato,
    Pizzicato,
    Tremolo,
    Trill { interval: i8 },
    Legato,
    Portamento,
    Marcato,
    Harmonics,
    // plus FX articulations (flutter tongue, sul pont, sul tasto, etc.)
}

pub struct ArticulationState {
    pub current: ArticulationId,
    pub keyswitch_map: [ArticulationId; 128],
    pub cc_map: [Option<ArticulationId>; 128],
    pub rr_counters: RrCounters,
}
```

#### Legato and interval transitions

Best-in-class legato is typically achieved by recorded **interval transition samples** and crossfading into sustains; this is discussed in synthesis and sampling research and also appears in systematic “virtual orchestra” methodologies. citeturn13search0turn13search13turn13search1

**Legato detection**

- If a new note-on occurs while a previous note is held (overlap), and the time between ons is below a configurable threshold:
    - choose legato behavior (transition sample + sustain)
- Else:
    - normal attack sample.

**Transition selection**

- Determine interval `Δ = new_key - old_key`.
- If transition samples exist for `Δ` at current dynamic layer:
    - trigger interval sample (often recorded at the start of the transition)
    - crossfade into target sustain sample after a fixed or sample-defined “handoff point”
- Else:
    - fallback: crossfade between sustains with a brief “attack suppress” envelope

**Crossfade math**

- `y = (1-a) * y_transition + a * y_sustain`
- `a(t)` uses equal-power curve to preserve perceived loudness:
    - `g0 = cos(π/2 * a)`, `g1 = sin(π/2 * a)`

#### Portamento and portamento curves

For strings and winds, portamento is a controlled pitch glide (either recorded as transition samples in some systems or synthesized as continuous pitch). If I synthesize it:

- I apply pitch ratio `r = 2^{Δ/12}`
- For time `t ∈ [0, T]`, pitch factor is:
    - linear in cents (constant rate): `p(t) = 2^{(Δ*(t/T))/12}`
    - or exponential approach (constant time feel): `p(t) = 2^{(Δ * (1 - exp(-t/τ)))/12}`

Many time-varying delay and Doppler/pitch-change concepts in PAPS inform stable interpolation and delay-based pitch modulation primitives that keep artifacts low. citeturn4view0

#### Vibrato and bowing/breathing realism

I separate vibrato into:

- pitch modulation (FM of playback rate / oscillator)
- **spectral envelope modulation** (SEM) where partial amplitudes change with vibrato due to body resonances. Research on expressive resynthesis notes SEM as perceptually important for bowed strings. citeturn12search19turn9view1

Practical implementation:

- Add a small LFO pitch mod (5–9 Hz typical for string vibrato; treat as a tunable range).
- Add a corresponding timbre mod:
    - subtle EQ tilt or formant shift
    - or (hybrid mode) apply spectral envelope interpolation in resynthesis domain.

### Score import and phrase tools

I import MIDI/SMF as a “score reference” for phrase assistance, articulation prediction, and tempo mapping.

- SMF encodes timing in “ticks per quarter note” or SMPTE time formats; this definition is in standard MIDI file specifications. citeturn11search0turn11search1
- For Rust implementation, `midly` provides allocation-minimizing SMF parsing patterns (lifetimes referencing source bytes). citeturn11search2

I treat this as **non-real-time**: parsing happens outside the audio thread, then the engine receives a precompiled event stream.

## Physical modeling and hybrid resynthesis engines

Sampling remains the primary realism driver, but flagship orchestral engines gain dramatic expressive range from hybrid synthesis: waveguide physical models, modal resonators, granular textures, and spectral modeling synthesis (SMS) for morphing and phrase-level edits.

### Physical modeling foundations and scope

I base my physical modeling blocks on the standard “nonlinear exciter + linear resonator” framework widely used in digital waveguide modeling, and discussed historically in the instrument oscillation literature. citeturn12search0turn12search15

I implement physical models as **optional layers** (and as “thin” augmentations for sampling), because full FDTD brass models are expensive—though research environments do exist for articulated brass using FDTD methods. citeturn12search12

### Bowed strings: commuted/waveguide-inspired layer

**Reference**

- entity["people","Julius O. Smith III","audio dsp researcher"]’s “Synthesis of Bowed Strings” provides canonical waveguide-style bowed-string synthesis ideas. citeturn12search2

**Model (simplified for realtime orchestral augmentation)**

- String resonator: bidirectional delay line (length ≈ fs / f0) with frequency-dependent loss filter.
- Bow exciter: nonlinear friction curve that depends on relative velocity between bow and string.
- Output: bridge pickup and body resonances.

**Equations (conceptual)**

- Traveling waves: `u+(n)` and `u-(n)` in delay lines.
- Junction scattering at bridge/nut: reflection coefficients.
- Bow friction: `F = f(v_rel)` where `f` is nonlinear and provides stick-slip.

**Rust structure**

```rust
pub struct BowedStringModel {
    pub delay_pos: DelayLine,
    pub delay_neg: DelayLine,
    pub loss_filter: BiquadOrOnePole,
    pub body: ResonatorBank,   // modal body coloration
    pub bow: BowFriction,
    pub f0: f32,
}
```

**Anti-aliasing**

- Nonlinear friction can generate high-frequency content.
- In draft: clamp bow nonlinearity and lowpass at Nyquist margin.
- In render: 2× oversample inside the exciter loop (short block only).

**Where it helps in a sample engine**

- Blend a low-level physical model under sustains to provide continuous energy changes under CC/MPE (bow pressure, bow speed), defeating the “static sustain loop” problem.

### Woodwinds and brass: reed/lip excitation + tube waveguide layer

**Core concept**

- Nonlinear excitation (reed or lip) drives a linear resonator (bore).
  This framework matches historical modeling discussions and digital waveguide architectures. citeturn12search0turn12search15

**Reed modeling reference**

- Digital waveguide modeling of reed instruments and nonlinear excitations is discussed in Scavone’s work. citeturn12search5

**Simplified tube model**

- Bore: delay line + reflection filter at bell/open end.
- Reed: nonlinear function of mouth pressure and bore pressure.

**Rust structure**

```rust
pub struct ReedTubeModel {
    pub bore: DelayLine,
    pub bell_reflection: BiquadOrOnePole,
    pub reed: ReedNonlinearity,
    pub noise_breath: NoiseLayer,
    pub f0: f32,
}
```

**Breath and turbulence**

- Add colored noise source modulated by breath pressure that couples into the bore as an excitation term.

**Why I treat it as hybrid**

- It adds continuous responsiveness (especially under MPE pressure) while samples provide the authentic recorded timbre.

### Modal synthesis for percussion and body resonance

Modal synthesis models an instrument body as a sum of damped modes and is broadly consistent with physical modeling formulations in PAPS and related modal synthesis literature. citeturn4view0turn12search3

For orchestral use, modal synthesis is especially useful for:

- adding controllable resonance to short articulations
- modeling instrument body response under dynamics
- subtle “room-body coupling” enhancement

### Spectral modeling synthesis and sines+noise+transients

For resynthesis, phrase morphing, vibrato SEM, and “texture layers,” I implement a spectral decomposition based on the SMS family: deterministic sinusoids + stochastic noise + explicit transient handling, as laid out in **entity["book","Spectral Audio Signal Processing","smith 2011 online edition"]**. citeturn9view1

Key points that directly matter for an orchestral engine:

- Sinusoidal models are highly effective for tonal instruments (strings, winds, brass). citeturn9view1
- Noise-like components should be modeled as filtered stochastic terms rather than many sinusoids. citeturn9view1
- Explicit transient models help preserve attacks during time stretch. citeturn9view1turn7search1

**Analysis pipeline (offline or background native thread)**

1. STFT with Hann window, size N (2048–8192), hop N/4
2. Peak picking per frame → partial tracks
3. Estimate noise residual
4. Detect transients (onset detection methods below)
5. Store:
    - partial tracks: `f_i(t)`, `A_i(t)`
    - stochastic spectral envelope
    - transient events (time, band-limited snapshots)

**Synthesis pipeline (realtime)**

- For each partial track: oscillator bank (recursive sin/cos update is preferred over calling `sin()` per sample).
- Add filtered noise shaped by stochastic envelope.
- Inject transient waveforms at scheduled times (do not stretch transients).

### Transient detection (for attack replacement and transient-preserving edits)

I use onset detection function (ODF) families summarized by Bello’s tutorial and Dixon’s evaluation work, which cover energy envelope, spectral flux, and complex-domain methods. citeturn7search0turn7search8

**Transient detectors I implement**

- Energy derivative (fast, coarse)
- Spectral flux (robust for musical changes)
- Complex-domain likely-phase deviation ODF (better for tonal onsets)
- Multi-band fusion (reduction of false positives)

Choosing and post-processing ODFs for reliable onset picks follows best practices from these references. citeturn7search0turn7search8

### Time-stretch and pitch-shift for phrase morphing

For phrase-level edits (tempo mapping, aligning to score, morphing articulations), I implement multiple algorithms and select per content type.

**Time-domain WSOLA class**

- WSOLA and transient-preserving improvements are surveyed and analyzed in Driedger’s thesis and in enhanced WSOLA work that explicitly targets transient sections. citeturn7search1turn7search3

**Frequency-domain phase vocoder**

- Phase vocoder fundamentals and common artifacts (“phasiness,” transient smear) are described in Dolson’s tutorial. citeturn7search2
- Additional techniques such as phase locking and improvements are discussed in the phase vocoder improvement literature, and are summarized in modern reviews. citeturn7search9

**Signalsmith Stretch**

- For an implementation path with production-grade behavior, I integrate Signalsmith Stretch, which documents best time-stretch ranges and is MIT licensed. citeturn8search2turn8search6

**Algorithm comparison table**

| Method                        | Domain         | Strengths                       | Weaknesses                                               | Orchestral best use                                                                               |
| ----------------------------- | -------------- | ------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Resampling                    | time           | preserves transients            | changes duration with pitch                              | per-note tuning                                                                                   |
| WSOLA / enhanced WSOLA        | time           | preserves transients if managed | can wobble on sustained harmonic content if search fails | rhythmic phrases, legato segments with clear waveform continuity citeturn7search1turn7search3 |
| Phase vocoder + phase locking | freq           | strong for harmonic sustain     | transient smear without special handling                 | pads, long sustains, ambience citeturn7search2turn7search9                                    |
| Signalsmith Stretch           | hybrid library | strong general-purpose quality  | time-stretch best for modest factors                     | practical realtime pitch/time control citeturn8search2                                         |

## Spatialization, convolution, and effects for orchestral realism

Orchestral realism depends on coherent space:

- mic mix coherence,
- early reflections shaping,
- long-tail reverberation (often convolution),
- per-section placement and depth.

### Multi-mic mixing model

Each mic position is its own audio stream (per sample or per instrument). I represent mic streams as independent sources with:

- gain, pan, width
- optional time-delay compensation (especially when layering close mics)
- optional phase inversion per mic

I apply the earlier caution: room mics are inherently delayed and contribute depth; I do not blindly align them to close mics unless the user asks for a “tight” mix, consistent with practical multi-mic guidance. citeturn10search13turn10search9

### Convolution reverb: partitioned convolution engine

Long orchestral IRs require partitioned convolution (otherwise the cost scales with IR length per sample).

**Foundations**

- Gardner’s “Efficient Convolution without Input-Output Delay” is a classic hybrid approach combining direct-form and block FFT processing to achieve zero-delay behavior. citeturn1search3turn1search7
- Smith’s PAPS covers reverberation structures (FDNs, delay networks) and provides a conceptual foundation for mixing matrices and stability. citeturn4view0

**Uniform partitioned convolution (practical)**

- Split IR `h[n]` into partitions of length `L`:
    - `h = h0 + h1 + ...`
- For each input block:
    1. FFT input block (with overlap-save)
    2. Multiply spectrum with each partition spectrum
    3. iFFT and overlap-add

**Latency**

- Latency is near `L` samples for a pure uniform FFT convolver; I reduce perceived latency by making partition 0 small (head partition) and running it in time domain or with a tiny FFT, consistent with the hybrid “head + tail” philosophy. citeturn1search3

**Per-voice convolution tails**

- Best-in-class cinematic engines sometimes apply voice-level space (each note has its own tail).
  This is expensive; I implement:
    - per-voice early reflections (cheap)
    - per-section convolution tail (shared across voices)
    - optional “per-voice tail virtualization” for high-end native only (cap voice count)

### Algorithmic reverbs (fallback and creative)

I include an algorithmic reverb option (FDN) because:

- it is cheaper and tunable compared to convolution,
- it can provide “glue” even when IRs are disabled.

PAPS explicitly includes FDN reverberation discussion, including stability and feedback matrices (Hadamard/Householder) and delay length choice heuristics. citeturn4view0

### Filters and EQ

For clean EQ and tone shaping I implement RBJ biquads using the W3C-hosted Audio EQ Cookbook. citeturn8search0turn8search4

For “character” shaping (optional), I include a TPT SVF and ladder-derived models informed by **entity["people","Vadim Zavalishin","virtual analog filter author"]**’s **entity["book","The Art of VA Filter Design","zavalishin rev 2.1.0"]**. citeturn1search1

### Orchestral bus dynamics

Orchestral engines typically use gentle bus compression and limiting:

- light ratio, long attack to preserve transients
- lookahead limiting for safety

I implement these as standard feed-forward dynamics modules, with careful smoothing and no overshoot; (compression math is textbook and not repeated here line-by-line to keep the main guide focused on orchestral-specific DSP paths).

## GPU compute and visualization workloads

GPU is **optional** for audio generation on web (because GPU readback latency and scheduling are not deterministic enough for the AudioWorklet hot path), but GPU is extremely valuable for:

- visualization (spectrograms, waveform overviews, phase meters),
- offline/preview tasks (IR FFT preparation, peak computations),
- heavy resynthesis previews.

### API and shader language

- WGSL is standardized by the **entity["organization","World Wide Web Consortium","standards body"]** and defines compute shaders, storage buffers, and workgroup semantics. citeturn6search0turn6search8
- On native, I use `wgpu`, which is a Rust implementation aligned with WebGPU and supports both native backends and wasm. citeturn6search1

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["spectrogram visualization orchestra strings","audio phase correlation meter visualization","wgsl compute shader diagram workgroups","partitioned convolution frequency domain diagram"],"num_per_query":1}

### Hard rule: audio thread never blocks on GPU

Audio thread writes analysis taps into an SPSC buffer (or a lock-free shared memory region). UI/render thread consumes those taps and schedules GPU work.

This is consistent with WebAudio’s render-quantum model and avoids missing deadlines. citeturn0search6turn0search0

### GPU workload specifications

**FFT for spectrogram visualization**

- Input: `N` samples (windowed), uploaded to storage buffer.
- Compute: radix-2 Stockham FFT in multiple passes.
- Output: magnitude spectrum for display.

WGSL supports workgroups and shared memory semantics for compute shaders. citeturn6search8turn6search4

**WGSL pseudocode for Stockham stage**

```wgsl
struct Uniforms { N: u32, stage: u32 };

@group(0) @binding(0) var<storage, read_write> buf: array<vec2f>;
@group(0) @binding(1) var<uniform> u: Uniforms;

fn cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
}

@compute @workgroup_size(256)
fn fft_stage(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.N/2u) { return; }

  // Pseudocode: read indices depend on stage in Stockham autosort
  let a = buf[index_a(i, u.stage)];
  let b = buf[index_b(i, u.stage)];
  let w = twiddle(i, u.stage, u.N); // e^{-j2πk/N}
  let t = cmul(b, w);

  buf[out0(i, u.stage)] = a + t;
  buf[out1(i, u.stage)] = a - t;
}
```

**Convolution tail partitions**

- Precompute FFT of each IR partition (offline).
- Per visualization tick or offline render:
    - FFT of input block
    - multiply-accumulate across partitions
    - iFFT and overlap-add.
      The partitioned convolution rationale and hybrid head/tail structure are grounded in Gardner’s work. citeturn1search3

**Spectral resynthesis previews**

- If I provide a “Lab” resynthesis editor, I can offload:
    - partial-bank rendering (additive synthesis) to GPU
    - noise spectral shaping to GPU
      but I keep realtime audio output on CPU because GPU readback/jitter risks glitching.

### Visualization widgets I implement (outside React reconcilers)

- Waveform view: min/max downsample for each pixel column (GPU compute is ideal).
- Spectrogram: GPU FFT + magnitude texture.
- Mic phase meter: compute cross-correlation or phase coherence between mic streams (CPU or GPU).
- Articulation timeline: display legato transitions and articulation states over time.

WGSL buffer layout and storage interface constraints are specified in the WGSL spec. citeturn6search0turn6search8

## Presets, AI pipelines, and progressive-disclosure UX

This section ties together: a stable preset schema, migrations, AI-assisted preset/phrase generation, and the orchestral UX disclosure model.

### Preset and bank format

I store full engine state as JSON with:

- `format_version`
- instrument racks (sections, articulations)
- mic mixer state
- routing and FX
- macro controls
- mapping tables (keyswitches, CC, MPE mapping)
- metadata (name, tags, authorship)

**Migration**

- `migrate(version_old → version_new)` runs on load.
- Audio thread receives a handle to a prevalidated state blob and swaps pointers at block boundary.

### Expression and MPE mapping

The MPE specification is defined by the **entity["organization","MIDI Association","music standards body"]** and formalizes per-note pitch/timbre/pressure control. citeturn5search2turn5search10

**Mapping model**

- Global controllers (CC1 mod wheel, CC11 expression, CC7 volume)
- Per-note MPE controls:
    - per-note pitch bend → intonation slides, string portamento
    - per-note pressure → bow pressure / breath pressure / vibrato amount
    - per-note “timbre” (often CC74 in practice) → brightness/noise/bow position

I maintain a per-voice `ExpressionState` updated by MIDI events, so modulation occurs without global interference.

### AI-assisted preset and phrase generation

**Pipeline overview**

1. Template-based generation (style-aware orchestral templates)
2. Quality scoring classifier (CNN on spectrograms)
3. Auto-tagging (spectral features + dynamics features)
4. Text-to-preset/phrase (LLM outputs JSON schema)
5. Morphing & variation (interpolate articulations, dynamics curves, mic mixes)

**ONNX for classifiers**

- ONNX IR and opsets are versioned with monotonically increasing numbers, and the ONNX documentation describes the versioning scheme. citeturn6search2turn6search10
- Native inference uses the `ort` crate (Rust bindings for ONNX Runtime). citeturn6search3turn6search7

**Classifier architecture (practical)**

- Input: 2-second audio render (per patch or per phrase) → mel-spectrogram image
- CNN: small 2D conv stack → dense → scalar score
- Output: “quality score” and “artifact risk” (e.g., transient smear, phasey mic issues)

### Phrase tools: MIDI import, tempo mapping, humanization

I import SMF using a non-allocating parser pattern and compile it into internal events:

- SMF timing and “ticks per quarter note” semantics are described in standard MIDI file documentation. citeturn11search0turn11search1
- `midly` is a Rust crate designed to parse SMF efficiently with minimal allocations and lifetime-based borrows. citeturn11search2

Tempo mapping:

- Read tempo meta-events and build a piecewise tempo map.
- Convert tick times to seconds for scheduling.

Humanization:

- Microtiming: ±5–20 ms, scaled by tempo
- Velocity shaping: subtle random drift + phrase-based cresc/decresc models
- Articulation variation: inject occasional alternate RR or alternate bow direction variants, if provided.

### Progressive-disclosure UX for orchestral workflows

I structure the UI as five visibility layers (not separate engine modes), matching orchestral users’ needs:

- **Play**: instrument selection, 8 macros (Dynamics, Expression, Vibrato, Tightness, Space, Tone, Attack, Release), articulation selector, mic mix quick faders.
- **Shape**: per-instrument articulation editor, CC/MPE mapping, dynamics curves, legato thresholds.
- **Ensemble**: section builder, divisi, voice count, mic positions and seating, humanization panel.
- **Arrange**: phrase tools (MIDI import preview, articulation timeline, tempo map), phrase morphing, legato glue.
- **Mix**: per-section routing, bus FX, convolution spaces, phase meters.
- **Lab**: spectral resynthesis editor, granular textures, hybrid physical modeling parameters, AI generation and classifier debugging views.

### WASM voice budget estimates (explicitly approximate)

Because actual budgets depend on CPU, browser, and engine configuration, I treat these as **estimates** and design a runtime “quality governor” that dynamically disables heavy components (extra mic positions, high-order resamplers, per-voice convolution) when nearing deadline.

The web quantum constraint is anchored in the default 128-frame render quantum described by WebAudio sources. citeturn0search6turn0search0

**Estimated voice budgets table (draft mode, 44.1 kHz, 128 frames)**

| Patch archetype           | Core operations                                  | Mic count | Expected WASM voices | Notes                                          |
| ------------------------- | ------------------------------------------------ | --------: | -------------------: | ---------------------------------------------- |
| Solo violin sustain       | sample playback + cubic resample + 1–2 envelopes |       1–2 |                16–32 | disable convolution per voice                  |
| Solo violin legato        | above + transition sample + crossfade logic      |       1–2 |                 8–16 | interval transitions are extra decodes/streams |
| String section (8 voices) | 8 voices, each 1–2 mics, light bus reverb        |         2 |           8–12 total | treat “section” as true polyphony              |
| Woodwind quartet          | mixed sustains/shorts, mic LOD                   |       1–2 |           8–16 total | depends on articulation density                |
| Full orchestra sketch     | mic LOD to 1, no per-voice conv                  |         1 |          24–40 total | requires strict LOD + shared FX                |
| Cinematic full mix        | multi-mic + convolution                          |       3–6 |           8–16 total | likely needs native or GPU-offline             |

These estimates are consistent with the need to keep render-quantum work bounded and avoid heavy per-voice operations. citeturn0search6turn1search3

### “Secret sauce” checklist for best-in-class orchestral realism

I treat these as non-negotiable quality drivers, each tied to a specific technical mechanism:

- **Legato that breathes**: interval transitions where available; otherwise transient-aware crossfades; dynamic-dependent legato timing. citeturn13search1turn7search0turn7search1
- **Dynamics that are continuous**: blend velocity layers and continuous CC-based crossfades and spectral/timbre shaping; avoid “layer stepping” by smoothing and equal-power blending. citeturn5search1turn9view1
- **Human repetition control**: deterministic RR + subtle pitch/start jitter; avoid noticeable periodicity via seeded randomness. citeturn5search15
- **Mic mixes that don’t comb-filter**: optional close-mic alignment via time delay estimation; preserve room delays for depth. citeturn10search8turn10search13turn10search9
- **Space that scales**: partitioned convolution with head/tail strategy; per-section shared tails; optional per-voice early reflections. citeturn1search3turn4view0
- **Hybrid layers that add life without sounding synthetic**: low-level waveguide/modal augmentation under samples; SMS-based SEM for vibrato timbre realism. citeturn12search2turn9view1turn12search19
- **Predictable performance across targets**: strict LOD governor keyed to quantum deadlines; ensure web never attempts disk streaming; use SPSC ring buffers for control messages. citeturn0search2turn0search6turn8search20
