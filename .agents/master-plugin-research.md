# The Master Synthesizer Plugin Implementation Guide

## System architecture and real-time constraints

This synth is a _pure compute node_ (`daw-synth`) embedded in a larger DAW runtime (`daw-engine`). The design goal is: identical DSP core on native and WebAssembly, with the **same patch format**, **same parameter schema**, and **same deterministic rendering** (except for optional GPU-accelerated paths which must be explicitly quality-gated and able to fall back to CPU). On native, the audio callback is invoked on a high-priority thread and must never block or allocate. citeturn13search10 On WebAudio, processing happens in render quanta (commonly 128 frames) so DSP must reliably complete within that fixed deadline. citeturn42search11turn42search3

### Crate boundaries and what they imply

**`daw-core`**

- Newtypes and invariants: sample rate, time, decibels, frequency, normalized [0..1] parameters, etc.
- Must be `Copy`-friendly and allocation-free.

**`daw-dsp`**

- “No I/O, no threads” and `no_std`-compatible implies:
    - No filesystem, no network, no OS calls.
    - No `Box`, no `Vec` in hot-path code, but _algorithms may still require state_. The workable interpretation is: **state is passed in explicitly or stored in stack/struct fields**, and any required buffers are provided by callers (fixed-size arrays or externally owned slices).
- Contains the _mathematical kernels_: oscillators (phase/core), filters (state update), envelopes (state update), resamplers, FFT primitives (optional), oversamplers, delay lines.

**`daw-synth`**

- Owns _patch state_ (layers, routing, modulators, voice pool, preset state).
- Exposes a single hot-path entry:
    - `fn process(midi_events: &[MidiEvent], output: &mut [&mut [f32]])`
- Must be allocation-free inside `process()`.
- Any dynamic allocation (preset load, wavetable import, sample load) must happen _outside_ `process()` and be swapped in via lock-free handoff in `daw-engine` (double/triple buffering strategy).

**`daw-engine`**

- Owns the audio thread integration (native `cpal` callback), ring buffers, compiled processing graph, and any background work.
- The `cpal` callback reads/writes audio buffers periodically and must remain real-time safe; `cpal` is explicitly designed around a periodic callback on a system-managed high-priority thread. citeturn13search10
- Lock-free SPSC queues (e.g., `rtrb`) are appropriate because they pre-allocate fixed capacity and perform wait-free operations, returning immediately on full/empty. citeturn13search7turn13search3

### A parameter system that is RT-safe and still “string-path addressable”

The user spec requires paths like `"layers[0].generators[0].wavetable.position"` for modulation/automation targeting. Strings are not RT-safe.

**Rule:** _Strings exist only in UI/control threads._ The audio thread uses numeric IDs and fixed arrays.

**Implementation sketch**

- At compile time (or build step), generate a canonical parameter registry:
    - `ParamId(u32)`
    - `ParamSpec { id: ParamId, path: &'static str, default: f32, range: (f32,f32), warp: ParamWarp, smoothing_ms: f32, flags: ParamFlags }`
- Build a perfect-hash or stable hash map (FNV-1a, xxHash) from `path -> ParamId` for UI/control use.
- Store per-parameter state in `daw-synth` as arrays indexed by `ParamIndex` (dense):
    - `target_value[param]`
    - `smoothed_value[param]`
    - `dirty_flag[param]`
- `set_parameter(path, value)` in your public API is _not hot-path_. Internally it resolves to `ParamId` and enqueues a small “param change” message down an SPSC ring buffer which is drained at block start in `daw-synth`.

**Smoothing formula**
Use first-order low-pass smoothing per parameter:

- `y[n] = y[n-1] + α (x[n] - y[n-1])`
- `α = 1 - exp(-2π / (τ * fs))`, where `τ` is smoothing time in seconds.
  This is a standard one-pole coefficient derivation used widely in audio DSP. citeturn0search0

### Block processing model

On WebAudio, 128-frame blocks are typical, and `currentFrame` advances by 128 after each render quantum. citeturn42search3turn42search11 Your synth must therefore:

- Process at _block granularity_ (control-rate update once per block, plus optional sub-block update for “audio-rate modulation” features).
- Avoid allocations and locks.
- Keep inner loops branch-minimal and memory-local.

**Canonical order per block**

1. Drain pending parameter changes and automation events.
2. Apply MIDI events (note on/off, CC, pitch, aftertouch, MPE).
3. Voice allocation/stealing decisions.
4. Update modulators (control-rate tick, plus schedule audio-rate sources).
5. For each active voice:
    - Render generators (including per-generator unison).
    - Apply per-voice filters.
    - Optional per-voice FX.
    - Accumulate into lane buffers.
6. Process global FX lanes/router.
7. Mix to stereo output.
8. Update meters and visualization taps via lock-free handoff.

## Synthesis engines and generators

This section defines the DSP, data structures, anti-aliasing, and RT performance strategy for each required engine. For wavetable and VA engines, the guide is anchored in well-known bandlimiting methods (wavetable replication/mip tables and BLEP-style discontinuity correction). citeturn39search1turn41view0turn39search4 For FM/PM, the design is aligned with phase modulation practice used in classic 6-operator architectures (the same general approach used by open DX7/Dexed-style engines). citeturn1search2

### Shared building blocks (used by every engine)

**Phase accumulator (core oscillator primitive)**

- Represent phase as `[0, 1)` to avoid large floats:
    - `phase = (phase + phase_inc) % 1.0`
    - `phase_inc = freq_hz / sample_rate_hz`
- For SIMD, store `phase` in SoA layout when rendering multiple unison oscillators.

**Fast sine**

- Native: `libm::sinf` is acceptable for FM/additive at moderate partial counts, but high polyphony benefits from:
    - polynomial approximation (e.g., 5th/7th minimax) or
    - table-based sine with cubic interpolation.
- WASM: prefer a table-based sine to reduce `libm` overhead.

**Denormal prevention**

- On native x86, denormals can cause severe slowdowns; “flush-to-zero” is ideal, or add tiny noise (`1e-18`) in sensitive feedback loops. Nigel Redmon explicitly discusses denormals as a practical DSP issue. citeturn39search11

---

### Wavetable synthesis

#### Mathematical model

A wavetable oscillator reads a single-cycle waveform table `w[n]` using a phase index:

- `i = phase * N`
- `k = floor(i)`
- `t = frac(i)`
- `y = interp(w[k], w[k+1], ..., t)`

For _morphing wavetables_, the waveform is a function of frame position `p`:

- `frame_f = p * (F-1)`
- `f0 = floor(frame_f)`, `f1 = min(f0+1, F-1)`
- `u = frac(frame_f)`
- `y = (1-u) * sample(frame=f0, phase) + u * sample(frame=f1, phase)`

#### Wavetable data format and layout

A practical “Serum/Vital-like” format is:

- `F = 256` frames
- `N = 2048` samples per frame  
  This is consistent with typical wavetable practice and provides enough frequency resolution for high-quality resynthesis. citeturn39search1turn39search15

**Memory layout (cache-friendly, SIMD-friendly)**

- Store time-domain frames contiguously:
    - `data[(frame * stride) + sample]`
- Use `stride = N + GUARD`, where `GUARD = 4` supports cubic interpolation without modulus checks.
- For stereo wavetables (optional), store planar:
    - `data_l[...]`, `data_r[...]` (SoA beats AoS for SIMD).

**Frequency-domain companion representation**
If you implement spectral warps (Vital-style), you need an FFT-domain representation per frame:

- Store complex spectrum bins `X[k]` for `k=0..N/2` (real FFT).
- Represent each bin as `(re, im)` in SoA arrays for SIMD and to avoid complex structs:
    - `re[k]`, `im[k]`
      Vital’s source uses frequency-domain arrays (amplitudes, normalized frequencies/phases) and performs inverse transforms to reconstruct warped frames. citeturn33view0turn32view3

#### Anti-aliasing strategy

There are two high-quality strategies; you should implement both and select per target/quality:

**Strategy A: Octave-bandlimited wavetable “replication” (mipmap tables)**

- Create a set of bandlimited tables `W[level]`, each removing harmonics above `Nyquist / 2^level`.
- At runtime select `level` based on fundamental frequency `f0`.

Nigel Redmon’s “replicating wavetables” method describes building progressively bandwidth-reduced tables from a full-bandwidth cycle. citeturn39search1

**Exact steps (FFT-based)**

1. Start with base cycle `w0[n]`, `n=0..N-1` (one frame).
2. Compute FFT `X0[k]` (`k=0..N-1`).
3. For each mip level `L`:
    - Define max harmonic bin `k_max = floor((N/2) / 2^L)`.
    - Copy `X0[k]` into `XL[k]` for `k <= k_max`, set higher bins to `0`.
4. Inverse FFT to produce `wL[n]`.
5. Normalize RMS or peak (normalize consistently across frames).

**Mip-level selection**

- Fundamental frequency `f0`.
- Nyquist `fN = fs/2`.
- Max allowable harmonic count `H = floor(fN / f0)`.
- Choose smallest level `L` such that `k_max(L) <= H`.
- Smooth transitions by crossfading adjacent levels when `H` lies between thresholds.

**Memory note**
`F=256`, `N=2048`, `levels≈11` is ~256*2048*11 ≈ 5.8M floats (~23MB) _per wavetable_, which is too heavy. Therefore:

- Generate mipmaps per **wavetable**, but:
    - Reduce levels (e.g., 7–9),
    - Use smaller `N` for higher levels (downsample), or
    - Use Strategy B for “pro” quality.

**Strategy B: On-the-fly harmonic truncation in frequency domain**

- Store spectral data per frame.
- At render/update time:
    - zero bins above `H = floor(fN / f0)` (or a more conservative limit),
    - inverse FFT to a time-domain table buffer,
    - then do fast table lookup per sample.
      This is closer to how a spectral-warp wavetable oscillator can remain bandlimited while applying frequency-domain warps. Vital’s spectral morph path explicitly constructs a spectrum, zeros out content, and inverse-transforms. citeturn31view2turn33view0turn32view3

**RT viability**

- The inverse FFT is _not_ per-sample; it runs at **table update rate** (see below). This is the key trick: expensive spectral work happens at a bounded cadence.

#### Interpolation (table lookup quality)

**Within-frame interpolation**

- Linear: `y = a*(1-t) + b*t` (cheap but softens HF content).
- Cubic Hermite / Catmull-Rom (recommended real-time sweet spot):
    - Use 4 samples `y[-1], y[0], y[1], y[2]` around index `k`.
    - Cost: ~20–30 FLOPs/sample, no trig.

**Rust-friendly Catmull-Rom**

```rust
#[inline(always)]
fn catmull_rom(y0: f32, y1: f32, y2: f32, y3: f32, t: f32) -> f32 {
    let c0 = y1;
    let c1 = 0.5 * (y2 - y0);
    let c2 = y0 - 2.5*y1 + 2.0*y2 - 0.5*y3;
    let c3 = 0.5*(y3 - y0) + 1.5*(y1 - y2);
    ((c3*t + c2)*t + c1)*t + c0
}
```

**Between-frame interpolation**

- Linear crossfade between two frames is the default (stable and cheap).
- Spectral interpolation (important for large timbral changes):
    - Interpolate magnitude (often in log domain) and phase.
    - Requires FFT-domain frames and an inverse FFT to produce a blended time-domain frame.

If you implement Strategy B (spectral), you get spectral interpolation “for free” because you’re already constructing a spectrum before iFFT.

#### Table update scheduling (how to make spectral warps RT-safe)

Define per-oscillator update cadence:

- `UPDATE_STRIDE_NATIVE`: e.g., 16 samples (audio-rate-ish).
- `UPDATE_STRIDE_WASM`: e.g., 64–128 samples (block-rate).
  At each stride boundary, compute new “render table” from:
- current base wavetable frame position,
- warp mode + warp amount,
- pitch-dependent harmonic limit.

Between updates, do pure table lookup.

This is how you can expose “audio-rate modulation” of warp controls while bounding the spectral workload.

#### Vital-style spectral warp modes (math + implementable kernels)

The user spec requires specific “spectral” warp families. In a practical implementation, each warp is a **bin remapping** and/or **magnitude/phase transform** applied to the spectrum `X[k]` prior to inverse FFT. Vital’s source contains explicit morph functions that operate on stored frequency-domain data and then inverse-transform into a wrapped output buffer. citeturn31view3turn33view0turn32view3

Below, `k` is harmonic index (bin), `K` is max bin (Nyquist), `a[k]` magnitude, `φ[k]` phase, `X[k] = a[k] e^{jφ[k]}`.

**Common scaffolding**

- Start from two frame spectra `X0[k]`, `X1[k]`.
- Interpolate to `Xbase[k]`.
- Apply warp to `Xwarp[k]`.
- Zero bins above `H`.
- iFFT to `table[n]`.

##### Sync (hard-sync spectral simulation)

Hard sync in time domain means the waveform is forcibly reset when a “master” completes a cycle. Spectrally, this introduces additional harmonics dependent on the sync ratio.

**Efficient implementation (phase distortion approximation)**
Instead of fully resynthesizing a sync’d waveform per sample, use a phase mapping:

- Let sync ratio `r >= 1`.
- Map oscillator phase:
    - `phase' = fract(phase * r)`
- Read base wavetable at `phase'`.
  This reproduces the characteristic “more cycles inside one period” sound.

**Anti-aliasing**

- Because the phase mapping introduces sharper features, you must use either:
    - bandlimited table (Strategy A/B) + adequate harmonic truncation, or
    - oversample the oscillator (2×) when sync depth is high (like Serum’s quality/oversampling option for warp-heavy modes). citeturn12search21

##### Formant (formant-preserving pitch shift)

Goal: change perceived pitch while preserving a spectral envelope (“formants”).

**Spectral-envelope method**

1. Estimate envelope `E[k]` by smoothing magnitudes (e.g., low-pass across bins in log-frequency).
2. Compute “flattened” harmonics:
    - `H[k] = Xbase[k] / (E[k] + ε)`
3. Pitch-shift harmonics by factor `s`:
    - `H'[k] = H[k/s]` (interpolate in bin domain)
4. Reapply original envelope without shifting:
    - `Xwarp[k] = H'[k] * E[k]`

This keeps the envelope anchored, producing “vocal/formant” behavior.

##### Harmonic stretch (harmonic series scale)

Goal: move harmonic content outward/inward.

Define stretch factor `s` (e.g., `s ∈ [0.25, 4]`, consistent with max harmonic scale constants in Vital). citeturn33view1turn32view3

**Bin mapping**

- Output bin `k` samples input bin `k/s`:
    - `Xwarp[k] = Xbase[k/s]`
- Use linear interpolation on `re/im` (better than magnitude-only for phase coherence).

##### Inharmonic stretch

Goal: break harmonicity, producing bell-like spectra.

Define an exponent mapping:

- `k_in = (k/K)^p * K`, with `p != 1`.
    - `p > 1` expands high bins
    - `p < 1` compresses
      Then:
- `Xwarp[k] = Xbase[k_in]`

Vital defines separate maxima for harmonic vs inharmonic scaling. citeturn33view2turn32view3

##### Spectral time skew / phase dispersion

A time shift in frequency domain adds linear phase:

- `X[k] * e^{-j 2π k Δt / N}`

A “skew” can be non-linear in `k`, e.g.:

- `φ'[k] = φ[k] + α * (k/K)^2`
  This smears the waveform in time, increasing “grainy” or “reese” qualities.

Vital includes a phase disperse scale constant. citeturn32view3

##### Random amplitude

Multiply magnitudes by random factors per bin or per bin-group.

Vital’s `randomAmplitudeMorph` shows a staged approach with precomputed random buffers and interpolation between stages. citeturn33view0

A clean Rust design:

- Precompute `R[stage][k]` uniform in `[0,1]` with deterministic seed per wavetable.
- For warp amount `w`:
    - `stage = floor(w * (S-1))`
    - `t = frac(w * (S-1))`
    - `r = lerp(R[stage][k], R[stage+1][k], t)`
    - `Xwarp[k] = Xbase[k] * (1 - depth + depth * r_norm)`
      Normalize `r_norm` so mean gain is ~1 (avoid loudness jumps).

##### Low-fi (spectral resolution reduction)

Two plausible interpretations:

- **Bin grouping:** average magnitudes in groups of size `g`.
- **Quantization:** quantize magnitude/phase to fewer steps.

A robust implementation:

- Choose `g = 1 + floor(depth * Gmax)`
- For each group `Gm = {m*g .. (m+1)g-1}`:
    - `A = mean(|Xbase[k]|)`
    - `Φ = mean_phase(Xbase[k])` (use vector sum of unit phasors)
    - set all bins in group to `A e^{jΦ}`

##### Data compress (spectral dynamic range compression)

Apply a compression curve to magnitudes:

- `a'[k] = a[k]^γ` with `γ ∈ (0,1]`  
  or
- `a'[k] = log(1 + c a[k]) / log(1 + c)`  
  This pushes small partials up and large partials down.

##### Bend (spectral warping curve)

Implement as frequency-dependent bin remap:

- `k_in = warp_curve(k/K, amount) * K`
  Where `warp_curve` is a monotonic spline controlled by amount. For example:
- `warp_curve(x,a) = x^(1+a)` when `a>0`, else `1 - (1-x)^(1-a)`.

#### Serum-style warp modes (practical parity)

Serum’s manual explicitly describes that quality/oversampling is applied especially when warp modes are active (sync, FM, etc.), implying many of these operations are alias-prone without oversampling. citeturn12search21

To match the “EDM punch” quality expectation:

- Provide a _warp oversample_ toggle (2×/4×) for modes that generate new harmonics (sync bends, FM-from-osc).
- Keep low frequencies phase-aligned (mono-safe bass), and widen mainly via higher partial differences (see unison section).

#### Rust data structures

```rust
pub const WT_FRAMES: usize = 256;
pub const WT_SIZE: usize = 2048;
pub const WT_GUARD: usize = 4;

#[derive(Clone, Copy)]
pub struct WavetableId(pub u32);

pub struct Wavetable {
    pub frames: usize, // usually 256
    pub size: usize,   // usually 2048
    // Time-domain frames for direct lookup (optional if using spectral-only pipeline)
    pub time: Vec<f32>, // allocated at load time only

    // Frequency-domain frames for spectral warps (re/im SoA for cache + SIMD)
    pub re: Vec<f32>, // frames * (size/2+1)
    pub im: Vec<f32>,
    // Precomputed random buffers for random-amplitude warp etc.
    pub rand_stage: Vec<f32>, // stages * (size/2+1)
}

pub enum WarpMode {
    None,
    Sync,
    Formant,
    HarmStretch,
    InharmStretch,
    TimeSkew,
    RandomAmp,
    Lofi,
    DataCompress,
    Bend,
}

pub struct WavetableOsc {
    pub wavetable: WavetableId,
    pub phase: f32,
    pub phase_inc: f32,

    // Morph position and warp
    pub frame_pos: f32,     // 0..1
    pub warp_mode: WarpMode,
    pub warp_amt: f32,      // 0..1

    // Cached render table (owned by voice, fixed-size buffer)
    pub render_table: [f32; WT_SIZE + WT_GUARD],
    pub render_dirty: bool,
    pub update_countdown: u32,
}
```

#### Per-sample rendering (fast path)

In `process_sample()`:

1. If `render_dirty` and countdown==0: rebuild `render_table` (spectral pipeline or select mip level).
2. Sample using cubic interpolation and increment phase.

#### Performance characteristics and SIMD opportunities

- **Hot path**: table lookup + cubic interpolation is branch-light and SIMD-friendly (process 4–8 samples per loop iteration).
- **Cold path**: FFT/iFFT and spectral warps are heavier but bounded by update cadence.
- WASM budget:
    - With 16–32 voices, keep table rebuild cadence low (block-rate) and limit FFT size/work.
    - Prefer Strategy A (precomputed smaller mipmaps) on WASM to reduce per-block CPU, and reserve Strategy B (spectral table rebuild) for native “Lab” quality mode.

---

### Virtual analog subtractive oscillators

#### PolyBLEP foundation (discontinuity correction)

Aliasing in naive saw/square/pulse comes from discontinuities. PolyBLEP adds a small correction polynomial around each discontinuity. Martin Finke provides a clear PolyBLEP implementation and the standard two-branch polynomial form used widely (“PolyBLEP by Tale”). citeturn41view0

Let `t` be phase in `[0,1)`, `dt` be phase increment in cycles/sample:

- `dt = freq / fs`

PolyBLEP function:

- if `t < dt`: `x = t/dt`, return `x + x - x*x - 1`
- else if `t > 1 - dt`: `x = (t-1)/dt`, return `x*x + x + x + 1`
- else return `0`

**Saw**

- `y = 2t - 1 - poly_blep(t, dt)`

**Square (pulse width `pw`)**

- `y = (t < pw ? 1 : -1) + poly_blep(t, dt) - poly_blep(fract(t - pw), dt)`

**Triangle**

- Integrate bandlimited square with leaky integrator (Finke uses a stable leaky approach). citeturn41view0

#### MinBLEP (precomputed step response)

MinBLEP uses a precomputed minimum-phase bandlimited step that is added at discontinuities. Nigel Redmon discusses MinBLEP-based oscillators as a high-quality, low-frequency-independent-cost approach. citeturn39search4

**When to prefer MinBLEP**

- Hard sync with frequent resets
- Arbitrary discontinuous waveforms
- PWM with fast modulation

**MinBLEP application pattern**

- Maintain a small ring buffer `blep_accum[M]`.
- When a discontinuity occurs at fractional offset `f` within the sample:
    - Add `blep_table[phase=f]` into the next `M` samples of `blep_accum`.
- Output is `naive + blep_accum[current]`, then shift the ring.

#### Hard sync with anti-aliasing

Hard sync resets slave phase when master wraps. The reset is a discontinuity; treat it like a BLEP event:

- Detect wrap: if `phase + inc >= 1.0`
- Compute fractional crossing time `f = (1.0 - phase) / inc`
- Apply BLEP at `f` and reset `phase = (phase + inc) - 1.0` (or `fract`).

#### PWM via two saws

Pulse can be generated as difference of two bandlimited saws:

- `pulse(t,pw) = saw(t) - saw(fract(t+pw))`
  Each saw uses PolyBLEP/MinBLEP at its wrap point; the second saw wrap is offset, so discontinuity times differ (stable PWM without “moving edge aliasing”).

#### Drift and free-running phase

Analog-style drift:

- Each voice has a slow random LFO modulating pitch by a few cents at ~0.1–0.5 Hz (design choice; tune by ear).
- Implementation: filter white noise with a one-pole lowpass to get smooth drift.

Phase reset modes:

- Free-running: keep phase between notes (analog-like).
- Reset: set phase to 0 on note-on (punchy, consistent transients).

#### Rust data structures

```rust
pub enum VaWaveform { Sine, Saw, Square, Pulse, Triangle }

pub struct VaOsc {
    pub wave: VaWaveform,
    pub phase: f32,
    pub phase_inc: f32,
    pub pulse_width: f32, // 0.01..0.99
    pub last_triangle: f32, // integrator state
    pub drift_state: f32,   // slow noise filter state
}
```

#### Performance and WASM voice budget

- PolyBLEP adds a few branches and multiplications per sample; performance is stable across pitch (unlike additive).
- WASM: 32 voices with 1–2 VA oscillators + simple filters is realistic if you avoid oversampling and keep unison modest.

**Secret sauce (why top VA sounds better)**

- Accurate bandlimiting at discontinuities (BLEP).
- Slight but controlled drift + subtle saturation in the signal path.
- ZDF/TPT filters with correct resonance behavior (next section). citeturn0search0turn38search15

---

### FM / phase modulation synthesis

#### PM math (DX-style stability)

Phase modulation operator:

- `y_i[n] = sin(θ_i[n] + I_i[n])`
- `θ_i[n+1] = θ_i[n] + 2π f_i / fs`

Where `I_i` is the modulation contribution from other operators (and optional feedback). This avoids the integral inherent in “true FM” and is the standard practical approach in classic 6-op systems. Dexed is an open DX7-compatible engine and is a key reference architecture. citeturn1search2

#### Operator routing: arbitrary modulation matrix

Let there be `O` operators. Define:

- `out[i]` operator output
- `mod[i] = Σ_j (out[j] * M[j][i]) + fb[i]`

Then:

- `out[i] = sin(phase[i] + mod[i]) * env[i]`

**Feedback**
DX-style feedback uses a 1-sample delay in the loop (stable and simple):

- `fb_signal = out_prev[i] * fb_amount`
- `out_prev[i] = out[i]`

Clamp feedback to a safe range; if you need “hot” feedback, oversample the operator.

#### DX7 envelope model (rate/level segments)

Classic 4-rate/4-level envelopes define a sequence of targets and rates. Implementation detail: map “rate” (0–99) to a time constant; map “level” (0–99) to linear amplitude (or dB-ish curve).

A robust engine stores envelope as:

- stages: 4 segments + release
- `current_level`, `target_level`, `velocity_scale`, `key_scale`
- `coef = exp(-1 / (τ * fs))` per segment (or per block)

Dexed is the practical reference for these decisions. citeturn1search2

#### Rust data structures

```rust
pub const FM_OPS: usize = 6;

pub struct FmOperator {
    pub phase: f32,
    pub phase_inc: f32,
    pub env: DxEnv,
    pub out_prev: f32,
}

pub struct FmMatrix {
    pub m: [[f32; FM_OPS]; FM_OPS], // modulation indices
    pub feedback: [f32; FM_OPS],
}

pub struct FmVoice {
    pub ops: [FmOperator; FM_OPS],
    pub matrix: FmMatrix,
}
```

#### Performance

- 6 operators: ~6 sin evaluations/sample/voice plus matrix multiplies.
- With a sine table, FM can support high polyphony; on WASM, FM is typically cheaper than wavetable+filters at high warp quality.

**Secret sauce (musical FM)**

- Ratio tuning + key scaling + velocity to modulation depth.
- Envelope curves that match classic behavior and avoid stepping.

---

### Additive synthesis

#### Direct partial summation

Signal:

- `y[n] = Σ_{k=1..P} a_k[n] sin(φ_k[n])`
- `φ_k[n+1] = φ_k[n] + 2π k f0 / fs`

Anti-aliasing is trivial:

- Do not render partials where `k f0 > fs/2`. (Remove or fade out near Nyquist.)

#### Efficient CPU oscillator bank

To avoid `sin()` per partial per sample:

- Use recursive oscillator update per partial:
    - Maintain `(sinφ, cosφ)` and step by `(sinΔ, cosΔ)` each sample: - `sin(φ+Δ) = sinφ cosΔ + cosφ sinΔ` - `cos(φ+Δ) = cosφ cosΔ - sinφ sinΔ`
      This turns trig into multiplies.

#### IFFT-based additive (block-wise)

If you already have FFT infrastructure, you can:

1. Construct a spectrum `X[k]` from partial magnitudes/phases.
2. Inverse FFT to time-domain block.
3. Overlap-add with windowing to ensure continuity (STFT technique).

This is aligned with standard spectral processing practice and is covered broadly in DSP literature; for physical/spectral modeling references, Julius Smith’s work is a primary source foundation. citeturn2search2

#### GPU path

When `P=512` and voice count > 4, CPU can be too heavy. The spec requires GPU compute on WebGPU.

You can offload either:

- partial summation (parallel over samples and/or partials), or
- frequency-domain assembly + inverse FFT.

WGSL details are covered in the GPU section; the language/spec semantics are defined by WGSL and WebGPU. citeturn13search4turn13search1turn13search12

#### Rust data structures

```rust
pub const MAX_PARTIALS: usize = 512;

pub struct PartialBank {
    pub amp: [f32; MAX_PARTIALS],
    pub phase: [f32; MAX_PARTIALS],
}

pub struct AdditiveOsc {
    pub base_freq: f32,
    pub partials: PartialBank,
}
```

---

### Granular synthesis

Granular is “many tiny windowed sample players”.

#### Grain model

For grain `g`:

- Position in source: `pos`
- Playback rate: `r`
- Duration samples: `L`
- Window `w[i]` (Hann/Gaussian/Tukey)
- Output:
    - `y[n] += amp * w[age] * src[pos + r*age]`

#### Scheduling

Given density `D` grains/sec:

- mean inter-onset = `fs / D` samples.
- Use a phase accumulator:
    - `grain_phase += D / fs`
    - when `grain_phase >= 1`, spawn grain and subtract 1.

Spray adds random offset to `pos`. Freeze stops advancing base position but continues spawning around a fixed region.

#### RT-safe implementation

Use a fixed-capacity grain pool:

- `const MAX_GRAINS: usize = 128` (tune).
- Maintain free list + active list.

#### WASM performance

Granular is manageable if:

- grain count is bounded (e.g., ≤ 64 active),
- interpolation is cubic or linear,
- windows are precomputed.

---

### Sampler / sample playback

Sampler is a multi-zone resampler with modulation and optional time-stretch.

#### Zone selection (O(1))

Precompute:

- `lookup[note][velocity_bucket] -> zone_index`  
  Then note-on selection is constant time.

#### SFZ parsing

SFZ is text-based; implement a minimal subset:

- `<group>`, `<region>`
- `sample=`, `lokey=`, `hikey=`, `lovel=`, `hivel=`
- `pitch_keycenter=`
- `seq_length=`, `seq_position=` for round robin
- `group=`, `off_by=` for choke groups
- `trigger=release` for release samples

Parser approach:

- Tokenize lines, ignore comments, parse key/value pairs.
- Build groups with inherited defaults, then regions overriding.

#### Resampling interpolation

- Linear: cheapest, artifacts at high transposition.
- Cubic Hermite: recommended for RT.
- Sinc: offline/high quality only.

#### Looping

Modes:

- one-shot
- forward loop
- ping-pong loop

Crossfade loop:

- fade length `Nxf = 64..256`
- When approaching loop end, blend from end segment to loop start segment.

#### Time-stretching

The spec calls out Signalsmith Stretch for polyphonic stretching. Signalsmith Stretch is a dedicated pitch/time library, with C++ reference and Rust wrappers available. citeturn42search2turn42search18turn42search6

Policy for applying:

- If “stretch” enabled and sample is harmonic/polyphonic: Signalsmith Stretch.
- If monophonic: TD-PSOLA (requires pitch detection, more complex).

---

### Noise generator

White noise:

- uniform `[-1,1]` from a fast PRNG.

Pink noise:

- Provide both:
    1. Voss-McCartney (octave sources)
    2. Paul Kellet “pिंकing filter” (fast IIR cascade)

The “pk3” coefficients and “economy” coefficients are explicitly listed in Robin Whittle’s curated DSP pink noise page (originally from music-dsp mailing list contributions). citeturn44view0turn43view0

**Instrumentation-grade (pk3)**

- Maintain `b0..b6` states:
    - `b0 = 0.99886*b0 + white*0.0555179`
    - `b1 = 0.99332*b1 + white*0.0750759`
    - `b2 = 0.96900*b2 + white*0.1538520`
    - `b3 = 0.86650*b3 + white*0.3104856`
    - `b4 = 0.55000*b4 + white*0.5329522`
    - `b5 = -0.7616*b5 - white*0.0168980`
    - `pink = b0+b1+b2+b3+b4+b5+b6 + white*0.5362`
    - `b6 = white*0.115926` citeturn44view0

Brown noise:

- Integrate white noise with leak:
    - `y = 0.99*y + 0.01*white`

---

### Physical modeling (stretch goal)

A Karplus–Strong plucked string is a delay line with feedback filtering:

1. Fill delay buffer of length `L ≈ fs / f0` with noise burst.
2. Each sample:
    - `y = delay.read()`
    - `avg = 0.5*(y + y_prev)`
    - `delay.write(avg * damping)`
      Fractional delays use allpass interpolation; Julius Smith’s physical modeling material is the canonical reference for waveguides, delay-line models, and fractional delay techniques. citeturn2search2

## Filters and saturation models

Filter sound quality is dominated by:

- **topology** (ladder vs SVF vs Sallen-Key),
- **feedback handling** (the “zero-delay feedback” problem),
- **nonlinearities** and where they are placed,
- coefficient/pole stability at high resonance.

entity["people","Vadim Zavalishin","dsp author va filters"]’s _The Art of VA Filter Design_ is the core reference for TPT/ZDF design. citeturn38search6turn38search4turn0search0

### Topology-Preserving Transform (TPT) integrator

TPT replaces naive discrete integrators with trapezoidal equivalents. For a one-pole integrator:

- `g = tan(π f_c / fs)`
- TPT one-pole (normalized):
    - `v = (x - z) * g / (1 + g)`
    - `y = v + z`
    - `z = y + v`  
      This pattern appears throughout Zavalishin’s derivations. citeturn38search6turn0search0

### Moog ladder (4-pole transistor ladder, ZDF)

A practical non-linear ladder model also appears in the literature; Huovilainen’s DAFx paper is a widely cited nonlinear digital implementation approach. citeturn38search15

A “best-in-class” approach:

- 4 cascaded one-pole stages in a feedback loop.
- Nonlinearity (soft clip / tanh) inside the stages or in the feedback path.
- Solve feedback with an implicit or iterative method (ZDF), or use TPT approximations.

**Core structure**

- `u = x - k * y4` (global feedback)
- Stage i:
    - `y_i = one_pole_tpt(tanh(u_i))`
    - feed into next stage
- Output `y4` is 24 dB lowpass.
- For self-oscillation: allow `k` beyond 1.0 but control internal saturation to keep stable and produce a clean sine at cutoff.

### Diode ladder (TB-303-style)

Zavalishin derives the diode ladder equations and presents a diode ladder structure plus global feedback around it. citeturn38search0

A workable discrete model:

- Use the diode ladder linearized form as a base, then insert nonlinearities (`tanh`) at stage inputs/outputs.
- Implement as TPT integrator chain with specific coupling coefficients (note that diode ladder stages differ from transistor ladder in coupling; Zavalishin shows distinct equations and transfer behavior). citeturn38search0

### Korg MS-20 / Korg35 (Sallen-Key + diode clipping)

entity["people","Tim Stinchcombe","ms20 filter study author"]’s detailed MS-20 filter study explains the Korg35-based topology and how transistors in the chip behave as variable resistors in a Sallen-Key configuration. citeturn38search22

Implementation strategy (practical VA):

- Model as two cascaded 2-pole sections (HP then LP) with resonance loops.
- Insert diode-like asymmetrical saturation in the feedback path to get the “scream”.
- Use TPT/implicit solve if you include nonlinear feedback; otherwise clamp resonance to stable range and approximate.

### Oberheim SEM (state-variable, morphable)

SEM-style SVF outputs:

- lowpass `lp`
- bandpass `bp`
- highpass `hp`
- notch `notch = lp + hp`

TPT SVF (ZDF SVF) is standard VA technique. citeturn38search6turn0search0

Morph parameter `m` blends outputs:

- `y = w_lp*lp + w_bp*bp + w_hp*hp + w_notch*notch`
  Weights are continuous functions of `m` (piecewise linear or spline) to ensure smooth morphing.

Add gentle soft clip on `bp` to emulate internal saturation (“creamy” resonance).

### Curtis/Sequential (CEM3320 family)

A practical approach in a modern hybrid synth:

- Provide a 4-pole lowpass (cascade) with resonance and optional saturation, tuned so resonance “bites” but doesn’t overly thin low end.
- Optionally include a “pushed” mode (as used in some OB-Xd-derived filter models in open-source synth ecosystems) to increase nonlinearity at high resonance; this is common in modern emulations. citeturn38search7

### Clean digital filters (RBJ biquads)

entity["people","Robert Bristow-Johnson","audio eq cookbook author"]’s Audio EQ Cookbook provides canonical coefficient formulas for LP/HP/BP/Notch/Peak/Shelves using BLT and standard parameterizations. citeturn39search3turn39search0

Implement:

- `Biquad { b0,b1,b2,a1,a2, z1,z2 }`
- Direct Form I Transposed (numerically good):
    - `y = b0*x + z1`
    - `z1 = b1*x - a1*y + z2`
    - `z2 = b2*x - a2*y`

Cascading biquads yields steeper slopes (12/24/36/48 dB).

### Formant filter (vowel bank)

Implement vowels using parallel bandpass filters with fixed formant frequencies (F1,F2,F3). Wikipedia provides a standard table of average vowel formants (noting variability by speaker). citeturn39search35

For a simplified synth formant filter:

- Choose 5 vowel presets (A,E,I,O,U) with `(F1,F2,F3)` centered for a “male-average” table.
- Each band: RBJ bandpass with moderate Q (e.g., 5–20).
- Output is sum of bands with per-band gains.

Morph:

- Interpolate frequencies and gains between vowel targets.

### Drive/saturation models and placement

Standard waveshapers:

- Soft clip: `tanh(drive*x)`
- Hard clip: clamp with optional knee
- Tube: asymmetric shaping (different drive/bias for positive vs negative halves)
- Tape: full hysteresis modeling is heavy; for filters, use an approximation (pre-emphasis + soft clip + post LP) unless you explicitly implement hysteresis elsewhere. citeturn40search9turn40search4

Placement:

- Pre-filter drive: changes how resonance reacts (more “bite”).
- In-loop drive: changes self-oscillation character (more “analog”).
- Post-filter drive: loudness/harmonics without altering resonance stability.

## Modulation system and UX model

A modulation system needs (1) a predictable DSP evaluation order and (2) a UI that makes modulation visible and direct. Vital is explicitly built around spectral warping plus an animated, drag-and-drop modulation workflow. citeturn14view0turn12search16

### Modulation matrix core

Use a flat slot array:

```rust
pub type ModSourceId = u16;
pub type ModDestId = u16;

pub enum Polarity { Unipolar, Bipolar }

pub struct ModulationSlot {
    pub source: ModSourceId,
    pub dest: ModDestId,
    pub amount: f32,       // signed depth
    pub polarity: Polarity,
    pub per_voice: bool,
    pub smoothing_ms: f32,
    pub enabled: bool,
    pub preview: bool,     // UI audition routing
}
```

Evaluation:

- For each destination parameter `P`:
    - `P_final = clamp(P_base + Σ(slot.amount * source_value(slot.source)), range)`
- Apply smoothing on `P_final` (or on each slot contribution if you need “soft” modulation depth changes).

### Control-rate vs audio-rate

- Control-rate: update mod sources once per block (128–256 samples).
- Audio-rate: update per sample (needed for:
    - FM-like pitch modulation,
    - filter cutoff audio-rate “pinging”,
    - oscillator warp audio-rate sweeps).

A practical compromise:

- All modulators have a `rate_mode`.
- Audio-rate modulators compute `next()` per sample.
- Control-rate modulators compute one value plus an optional linear ramp across the block (cheap, avoids stepping).

### Modulation dependency ordering (meta-modulation)

Because mod sources can modulate other mod depths:

- Build a directed graph:
    - node = modulator output or parameter feeding a modulator
    - edge = “depends on”
- Topologically sort at patch compile time (preset load).
- If cycles exist, break them by:
    - inserting a 1-block delay, or
    - disallowing cycles in UI (recommended).

### Modulation sources

**ADSR**

- Stages: Attack, Decay, Sustain, Release (+ optional Hold).
- Curves: implement via exponential approach or power curves.
- Guard rails: minimum attack ~1 ms to prevent clicks.

**MSEG**

- Store points: `[(time, value, curve)]`
- Evaluate by segment index; for efficiency:
    - keep current segment pointer and advance as time increases,
    - use binary search only when jumping (loop start or user scrubbing).

**LFO**

- Waveforms: sine/tri/saw/square/S&H plus custom shape table.
- Sync modes: convert note division to Hz via tempo.
- Stereo split: phase offset between L/R accumulators.
- Keytracked LFO: scale frequency by note pitch (same mapping as oscillator; can become audio-rate).

**Step sequencer**

- Steps: value + gate + probability + curve
- Sync: steps per beat from tempo
- Probability: deterministic RNG seeded per note (repeatable) or truly random.

**Random modulators**

- Smooth random: 1D Perlin-like noise via interpolation between random anchors.
- Stepped random: S&H updated per division.
- Lorenz attractor is possible but heavier; for “chaos” feel, smooth random + nonlinear shaping often suffices.

**Audio follower**

- Rectify (abs) then envelope follower with attack/release one-pole:
    - `coef_a = exp(-1/(attack*fs))`
    - `coef_r = exp(-1/(release*fs))`
    - `env = max(x, env*coef_r + (1-coef_r)*x)` (peak-ish) or RMS with squared smoothing.

**Performance and MPE**

- Normalize MIDI: velocity, aftertouch, CC1, pitch bend.
- MPE: per-note pitch/pressure/slide. Store per-voice in `Voice` and feed as modulators.

**XY transform pad**
Bilinear interpolation across 4 snapshots:

- `v = (1-x)(1-y)A + x(1-y)B + (1-x)yC + xyD`

### Modulation UX hooks (preview routing)

UI “hover preview” must not mutate audio-thread structures directly:

- UI sends “preview routing add/remove” messages.
- Audio thread applies them at block boundary.
- Preview slots are tagged `preview=true` and are removed on cancel.

### Colored rings rendering (GPU)

Rendering arcs and multiple modulation segments is a perfect GPU instancing use-case; WGSL supports storage buffers and per-instance parameters. citeturn13search4turn13search1

## Voice management and routing

### Voice pool and iteration

Use fixed arrays:

- Native: 128 voices
- WASM: 32 voices (configurable)

Maintain:

- `free_list: [u16; N]`
- `active: [u16; N] + active_len`

Voice struct includes per-voice states (osc phases, env stages, filter z-states, per-voice FX buffers if enabled).

### Voice stealing

When no free voice:

1. Prefer voices in release (oldest release first).
2. Else oldest held note.
3. Apply a short fade-out (~10 ms) while new voice fades in (dual render) to avoid clicks.

### Unison “width without phasey mess”

Implement per-generator unison:

- `U = 1..16`
- Detune distribution:
    - Use symmetric curve (e.g., exponential around center).
- Stereo spread:
    - Pan unison voices across `[-width, +width]`.
- Phase randomization:
    - Random initial phase per unison voice to avoid combing.
- Bass mono-protection:
    - Below cutoff (e.g., 120 Hz), reduce stereo spread to keep bass tight.

This approach addresses the common “wide but not hollow” behavior reported in modern synths.

### Glide/portamento

Exponential glide:

- `p += (target - p) * g`
- `g = 1 - exp(-1/(glide_time*fs))`
  Legato: only glide if note overlap.

## Effects engine and DSP modules

Two anchor references define the core FX math here:

- entity["people","Jon Dattorro","plate reverb author"]’s plate reverb topology (JAES 1997) with explicit delay lengths at 29761 Hz. citeturn7view0turn11view0turn11view1
- entity["people","Theodoros Giannoulis","compressor paper author"] et al. (JAES 2012) for digital compressor design. citeturn2search1

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["Dattorro plate reverb topology diagram","Moog ladder filter topology diagram","Feedback Delay Network reverb diagram","Biquad filter frequency response diagram"],"num_per_query":1}

### Dattorro plate reverb (complete topology)

Use the paper’s delay network and lengths. The PDF mirror contains the reverberator figure and lengths; the canonical sample-rate base is 29761 Hz (you must scale lengths for other rates). citeturn7view0turn11view0turn11view1

**Scaling delay lengths**

- `delay_samples = round(delay_samples_29761 * fs / 29761)`

**Core blocks**

- Input diffusion: 4 allpass filters (fixed delays, feedback gains).
- Tank: two parallel paths with modulated allpass + delay + damping.
- Output taps: multiple taps for stereo spread (paper provides tap positions). citeturn7view0turn11view0turn11view1

**Allpass**

- `y = -g*x + x_delay + g*y_delay`
  Use modulated delay lengths via fractional delay interpolation (linear or allpass interpolation).

**Damping**

- One-pole lowpass in feedback:
    - `d = d + (1-α)*(x - d)`.

### Algorithmic FDN reverb

An FDN uses multiple delay lines with a mixing matrix in the feedback junction.

- Choose 8 or 16 delays, mutually prime lengths.
- Feedback matrix:
    - Hadamard (fast, orthogonal)
    - Householder (simple dense orthogonal)

This class of reverbs is standard; for broader reverb context, classic surveys like “Fifty Years of Artificial Reverberation” provide background. citeturn2search10

### Delay (stereo / ping-pong / tape)

Stereo delay:

- Two delay lines with times `tL`, `tR`.
- Feedback:
    - `fbL = yL * feedback + yR * cross_feedback`
    - `fbR = yR * feedback + yL * cross_feedback`

Time changes:

- Use dual read heads and crossfade over `Nxf` samples to avoid pitch jumps.

Tape feel:

- Wow/flutter: LFO modulating delay time.
- Saturation in feedback loop (tanh).
- High-frequency rolloff per repeat (LP in feedback).

### Distortion with oversampling

Nonlinearities produce harmonics above Nyquist; oversample to reduce aliasing. Serum explicitly exposes quality/oversampling tied to warp/processing contexts, reinforcing that oversampling is perceptually important in nonlinear sections. citeturn12search21

Implement 2× oversampling with halfband FIR:

- Upsample: insert zeros + FIR
- Process nonlinear
- Downsample: FIR + decimate

### Chorus / flanger / phaser

Chorus:

- Multi-tap modulated delay lines (20–50 ms), mixed with dry.
  Flanger:
- Short delay (0.5–10 ms) with feedback → comb notches.
  Phaser:
- Cascade allpass filters with LFO-modulated coefficient + feedback.

### Compressor (Giannoulis/Massberg/Reiss)

Key blocks:

- Detector (peak or RMS)
- Static curve (threshold, ratio, knee)
- Attack/release smoothing
- Makeup gain
  The JAES paper provides a systematic method to design and implement digital compressors. citeturn2search1

### EQ (RBJ cookbook)

Use RBJ formulas for each band type; W3C hosts the cookbook as a working-group note. citeturn39search3turn39search0

### Limiter with true peak

True peak:

- Oversample sidechain (4×) and detect inter-sample peaks.
  Lookahead:
- Delay audio path by `N` samples; compute gain envelope from future peaks.

### Stereo width

Mid/Side:

- `mid=(L+R)/2`, `side=(L-R)/2`
- `side*=width`
  Then reconstruct.

## GPU compute workloads and visualization

GPU compute must be optional and never block the audio thread. `wgpu` is the cross-platform Rust layer aligned with WebGPU. citeturn13search12 WGSL semantics (workgroup/shared memory, storage buffers) are defined in the WGSL spec. citeturn13search4turn13search1

### Dataflow rule: audio thread never waits on GPU

- Audio thread writes “analysis taps” (recent audio blocks, envelopes, FFT windows) into an SPSC ring buffer.
- Render thread (or UI worklet thread) consumes and submits GPU workloads.
- Visualization is best-effort; if GPU misses a frame, drop it.

### GPU FFT for spectrum analysis

- Upload windowed time-domain data to a storage buffer.
- Compute radix-2 FFT in multiple passes (stockham autosort is easiest for GPU).
- Output magnitude to a buffer used by a render pipeline.

Use GPU only when you need continuous 60 fps and larger FFT sizes; otherwise CPU FFT (e.g., rustfft) may beat transfer overhead.

### GPU additive synthesis

Parallelize across samples:

- Workgroup computes several output samples each.
- For each sample, sum partials; for speed, limit partial count or use shared precomputed sin tables per workgroup.

### GPU convolution tail partitions

Partitioned convolution:

- Head partition on CPU for low latency.
- Tail partitions as FFT blocks on GPU:
    - complex multiply and accumulate across partitions.
- Readback is latency-sensitive; design as asynchronous with fixed additional latency if enabled.

### Visualization shaders

- Oscilloscope: polyline with AA in fragment.
- Spectrum: instanced quads per bin.
- Wavetable 3D: mesh surface of frames.
- Filter response: compute magnitude response on CPU or GPU, render curve.
- Mod rings: instanced quads + fragment arc drawing based on per-instance modulation segments.

## Presets, AI generation, and UI progressive disclosure

### Preset file format

JSON with:

- synth state (layers/generators/filters/fx/mod)
- version number
- stable parameter paths

Migration:

- On load: `if version < current`, run upgrade transforms (rename paths, add defaults).

### Preset browser

- Tags, search, favorites.
- Audio preview: render 2s snippet at save time.
- Similarity: compute parameter-distance metric and/or feature-distance (spectral centroid/flux).

### AI preset pipeline

**Template generation**

- Category templates define bounds for parameters and module choices.

**Quality classifier**

- Render audio → mel-spectrogram → small CNN.
- Native inference: `ort` Rust bindings for ONNX Runtime. citeturn42search0turn42search9
- Web inference: `onnxruntime-web` supports in-browser inference. citeturn42search1turn42search17

**Auto-tagging**
Compute:

- spectral centroid, flux, RMS
- onset density
  Then map to tags via thresholds.

**Text-to-preset**

- LLM outputs JSON matching schema.
- Validate and clamp values.

**Preset morphing**

- Linear for most params.
- Log for frequencies/Q.
- Crossfade for discrete types (filter model, oscillator type).
- For wavetables: morph in spectral domain.

### UI progressive disclosure mapping

The UI design is selection-driven, not page-driven:

- Level 1 exposes macros/XY and preset browser.
- Level 2 shows one layer and one generator.
- Level 3 shows full layer stack + modulators.
- Level 4 exposes routing graph and per-voice FX placement.
- Level 5 unlocks wavetable/additive editors and analysis.

This is a visibility-layer decision, not an engine decision: the backend patch format stays identical across UI levels.
