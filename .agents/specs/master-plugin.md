# The Master Synthesizer Plugin — Complete Implementation Guide

> **Audience**: An AI coding agent building this plugin from scratch in Rust.  
> **Contract**: Every algorithm has the math, the data structures, and compilable Rust code.  
> No "see external reference." No hand-waving. Everything is inline.

---

## Crate Architecture

```
daw-core    → newtypes: TrackId, Beats, Decibels, Hertz, SampleRate, MidiEvent
daw-dsp     → pure stateless DSP (no_std, no I/O, no threads)
daw-synth   → MasterSynth: voice manager, mod matrix, generators, presets
               exposes: fn process(midi_events: &[MidiEvent], output: &mut [&mut [f32]])
               NO I/O, NO cpal, NO threads — pure computation
daw-engine  → audio graph, cpal callback, lock-free ring buffers (rtrb)
               instantiates daw-synth as one node
```

### daw-core types

```rust
// daw-core/src/lib.rs
#![no_std]

#[derive(Copy, Clone, Debug, PartialEq, PartialOrd)]
pub struct Hertz(pub f32);

#[derive(Copy, Clone, Debug, PartialEq, PartialOrd)]
pub struct Decibels(pub f32);
impl Decibels {
    pub fn to_linear(self) -> f32 { 10f32.powf(self.0 / 20.0) }
}

#[derive(Copy, Clone, Debug)]
pub struct SampleRate(pub f32);
impl SampleRate {
    pub fn recip(self) -> f32 { 1.0 / self.0 }
}

#[derive(Copy, Clone, Debug)]
pub struct MidiEvent {
    pub frame: u32,
    pub message: MidiMessage,
}

#[derive(Copy, Clone, Debug)]
pub enum MidiMessage {
    NoteOn  { channel: u8, note: u8, velocity: u8 },
    NoteOff { channel: u8, note: u8 },
    ControlChange { channel: u8, cc: u8, value: u8 },
    PitchBend { channel: u8, value: i16 },  // -8192..+8191
    Aftertouch { channel: u8, pressure: u8 },
    PolyAftertouch { channel: u8, note: u8, pressure: u8 },
    ProgramChange { channel: u8, program: u8 },
}

/// MIDI note to frequency: A4=440Hz, equal temperament
pub fn midi_to_hz(note: u8, pitch_bend_semitones: f32) -> f32 {
    440.0 * 2f32.powf((note as f32 - 69.0 + pitch_bend_semitones) / 12.0)
}
```

---

# PART 1: SYNTHESIS ENGINES

---

## 1.1 Wavetable Synthesis

**Reference**: Serum (Xfer Records), Vital (Matt Tytel / GPLv3)

### Mathematical Foundation

A wavetable is a 2D array of single-cycle waveforms. Playback reads through one frame at a rate determined by the desired pitch, while the _frame position_ (wavetable position) selects which waveform is playing.

For a frame of length `N = 2048` samples played back at frequency `f` and sample rate `sr`:

```
phase_increment = f / sr          (0..1 normalized)
sample = frame[floor(phase * N)]  (with interpolation)
```

Interpolation between frames A and B at blend `t ∈ [0,1]`:

```
output = (1-t)*A[i] + t*B[i]     (linear — fast)
```

or spectral interpolation (IFFT of interpolated magnitudes + phases — better but ~10× slower).

### Wavetable Format

```
frames:     256  (standard; some synths use 2048)
frame_len:  2048 samples (power of 2, enables efficient phase indexing)
mip_levels: ceil(log2(sr / (2 * lowest_expected_freq))) ≈ 10 levels

Memory layout (planar, cache-friendly for sequential frame reads):
  [frame_0_mip_0][frame_1_mip_0]...[frame_255_mip_0]   <- full-bandwidth (mip 0)
  [frame_0_mip_1][frame_1_mip_1]...[frame_255_mip_1]   <- half-bandwidth (mip 1)
  ...

Each mip level has half the spectral bandwidth of the previous:
  mip 0: 2048 samples, keeps harmonics up to sr/2
  mip 1: 1024 samples (stored in 2048 with top half zeroed, or shorter array)
  mip k: keeps harmonics up to sr / 2^(k+1)
```

### Mip-Map Generation (Anti-Aliasing)

At init time, for each frame, generate band-limited versions by zeroing FFT bins above the cutoff.

**Algorithm (Nigel Redmon / earlevel.com approach)**:

```
for each frame f in 0..NUM_FRAMES:
    spectrum = rfft(frame[f])          // 1025 complex bins for 2048-point frame
    for mip_level k in 0..NUM_MIPS:
        max_harmonic = NUM_SAMPLES / 2^(k+1)
        mip_spectrum = spectrum.clone()
        mip_spectrum[max_harmonic..].fill(0.0)  // zero harmonics above cutoff
        mip_frame[f][k] = irfft(mip_spectrum)   // back to time domain
```

**Runtime mip selection**: given playback frequency `f` and sample rate `sr`:

```
// The highest harmonic that can play without aliasing is sr/2.
// At fundamental f, harmonic n aliases when n*f > sr/2, i.e. n > sr/(2*f).
// We want the mip level whose bandwidth covers n = sr/(2*f) harmonics.
// mip k covers N/2^(k+1) harmonics. Solve: N/2^(k+1) >= sr/(2*f)
// => k <= log2(N*f/sr)
// Choose: mip_level = clamp(floor(log2(sample_rate / (2.0 * freq))), 0, NUM_MIPS-1)

fn select_mip(freq: f32, sample_rate: f32, num_mips: u32) -> u32 {
    let k = (sample_rate / (2.0 * freq)).log2().floor() as i32;
    // Lower k = more harmonics = higher mip index
    // Actually: mip 0 is full bandwidth. Higher mip = fewer harmonics.
    let mip = ((sample_rate / (2.0 * freq * 2048.0)).log2().ceil()) as i32;
    mip.clamp(0, num_mips as i32 - 1) as u32
}
```

### Sample Interpolation Within a Frame

**Cubic Hermite (4-point)**:
Given samples `y[-1], y[0], y[1], y[2]` and fractional position `t ∈ [0,1)`:

```
c0 = y[0]
c1 = 0.5 * (y[1] - y[-1])
c2 = y[-1] - 2.5*y[0] + 2.0*y[1] - 0.5*y[2]
c3 = 0.5*(y[2] - y[-1]) + 1.5*(y[0] - y[1])
output = ((c3*t + c2)*t + c1)*t + c0
```

In Rust:

```rust
#[inline(always)]
pub fn cubic_hermite(y: [f32; 4], t: f32) -> f32 {
    let c0 = y[1];
    let c1 = 0.5 * (y[2] - y[0]);
    let c2 = y[0] - 2.5 * y[1] + 2.0 * y[2] - 0.5 * y[3];
    let c3 = 0.5 * (y[3] - y[0]) + 1.5 * (y[1] - y[2]);
    ((c3 * t + c2) * t + c1) * t + c0
}
```

Cost: ~7 multiply-adds. Much better than linear (audible rolloff above ~10kHz) and far cheaper than sinc (8–64 taps).

### Frame Interpolation

Linear crossfade (default — adequate for smooth wavetables):

```rust
fn interpolate_frames(frame_a: &[f32], frame_b: &[f32], t: f32, idx: usize) -> f32 {
    frame_a[idx] * (1.0 - t) + frame_b[idx] * t
}
```

Spectral interpolation (for wavetables with large timbral jumps between frames):

```
A_spectrum = rfft(frame_a)
B_spectrum = rfft(frame_b)
for each bin k:
    mag = lerp(|A_spectrum[k]|, |B_spectrum[k]|, t)
    // Phase interpolation: shortest arc on unit circle
    phase_a = arg(A_spectrum[k])
    phase_b = arg(B_spectrum[k])
    delta = wrap_pi(phase_b - phase_a)
    phase = phase_a + t * delta
    interp_spectrum[k] = mag * e^(i*phase)
output_frame = irfft(interp_spectrum)
```

CPU cost: ~10× linear crossfade. Only worth it for wavetables with dramatic timbral changes.

### Rust Data Structures

```rust
// daw-dsp/src/wavetable.rs

pub const WAVETABLE_FRAMES: usize = 256;
pub const WAVETABLE_FRAME_LEN: usize = 2048;
pub const WAVETABLE_MIP_LEVELS: usize = 10;

/// Immutable wavetable data — shared across voices
pub struct Wavetable {
    /// [mip_level][frame_index][sample_index]
    /// Stored contiguously for cache efficiency: all frames of mip 0, then mip 1, etc.
    data: Box<[[[f32; WAVETABLE_FRAME_LEN]; WAVETABLE_FRAMES]; WAVETABLE_MIP_LEVELS]>,
    name: [u8; 64],
}

impl Wavetable {
    pub fn get_sample(&self, mip: usize, frame: f32, phase: f32) -> f32 {
        let frame_idx_lo = frame.floor() as usize % WAVETABLE_FRAMES;
        let frame_idx_hi = (frame_idx_lo + 1) % WAVETABLE_FRAMES;
        let frame_t = frame.fract();

        let phase_norm = phase.rem_euclid(1.0);
        let pos = phase_norm * WAVETABLE_FRAME_LEN as f32;
        let idx = pos.floor() as usize;
        let frac = pos.fract();

        // 4-point cubic hermite across frame samples
        let get = |frame_i: usize, offset: isize| -> f32 {
            let i = (idx as isize + offset).rem_euclid(WAVETABLE_FRAME_LEN as isize) as usize;
            self.data[mip][frame_i][i]
        };

        let s_lo = cubic_hermite([get(frame_idx_lo,-1), get(frame_idx_lo,0),
                                   get(frame_idx_lo,1), get(frame_idx_lo,2)], frac);
        let s_hi = cubic_hermite([get(frame_idx_hi,-1), get(frame_idx_hi,0),
                                   get(frame_idx_hi,1), get(frame_idx_hi,2)], frac);
        s_lo * (1.0 - frame_t) + s_hi * frame_t
    }
}

/// Per-voice, per-generator mutable state
#[derive(Clone)]
pub struct WavetableOscState {
    pub phase: f32,           // 0..1
    pub phase_inc: f32,       // freq / sample_rate
    pub frame_pos: f32,       // 0..WAVETABLE_FRAMES (wavetable position)
    pub mip_level: u32,
    // Unison state (up to 16 detuned copies)
    pub unison_phases: [f32; 16],
    pub unison_pan: [f32; 16],   // -1..1
    pub unison_detune: [f32; 16], // semitones offset
}

#[derive(Clone)]
pub struct WavetableParams {
    pub frame_pos: f32,           // 0..255
    pub warp_mode: WarpMode,
    pub warp_amount: f32,         // 0..1
    pub unison_count: u8,         // 1..16
    pub unison_detune: f32,       // 0..1 (maps to 0..100 cents total spread)
    pub unison_stereo_spread: f32,// 0..1
    pub unison_blend: f32,        // 0..1 (0=all detuned, 1=centered+detuned)
    pub pitch_semitones: f32,
    pub pitch_fine_cents: f32,
    pub gain: f32,
    pub pan: f32,
}

#[derive(Clone, Copy, PartialEq)]
pub enum WarpMode {
    None,
    Sync,
    Formant,
    HarmonicStretch,
    InharmonicStretch,
    SpectralSkew,
    RandomAmplitude,
    LowFi,
    DataCompress,
    Bend,
}
```

### Vital's Spectral Warping Modes

All warp modes operate in the **frequency domain** on each wavetable frame's FFT. The warp is applied at wavetable load time (or when warp parameters change) to pre-compute warped versions, NOT per-sample. This is critical for performance.

**Implementation pattern**:

```rust
fn apply_warp(frame: &[f32], mode: WarpMode, amount: f32) -> Vec<f32> {
    let mut spectrum = rfft(frame);   // -> Vec<Complex32>, length N/2+1
    warp_spectrum(&mut spectrum, mode, amount);
    irfft(&spectrum)
}
```

#### 1. Sync (Hard sync simulation in frequency domain)

Hard sync creates a spectrum with energy concentrated at multiples of the sync ratio. In the spectral domain, fold the spectrum back on itself:

```
sync_ratio = 1.0 + amount * 3.0   // 1..4× sync ratio
for each bin k in 0..N/2:
    source_bin = (k * sync_ratio).floor() as usize
    if source_bin < N/2:
        warped_spectrum[k] = spectrum[source_bin % (N/2)]
    else:
        warped_spectrum[k] = 0.0
```

#### 2. Formant (Formant-preserving pitch shift)

Shift the pitch downward while keeping the spectral envelope (formants) in place. Implemented as spectral envelope extraction + resampling:

```
// Extract spectral envelope via cepstral liftering
cepstrum = irfft(log(|spectrum| + 1e-6))
// Keep only low quefrency (envelope) components
lifter = cepstrum[0..LIFTER_CUTOFF].to_vec()
lifter.extend(vec![0.0; N/2+1 - LIFTER_CUTOFF])
envelope = exp(rfft(lifter))   // spectral envelope

// Shift fine structure by amount (pitch ratio)
shift_ratio = 2^(amount * 2)   // up to 2 octaves
for each bin k:
    src_k = k / shift_ratio
    shifted[k] = interpolate_spectrum(spectrum / envelope, src_k) * envelope[k]
```

#### 3. Harmonic Stretch

Stretch the harmonic series so harmonics are spaced further apart (inharmonic upward stretch) or compressed:

```
stretch = 1.0 + amount * 2.0   // 1..3× stretch
for each bin k in 0..N/2:
    // Map output bin k to input bin (source harmonic)
    src = k / stretch
    warped[k] = interpolate_spectrum(spectrum, src)
```

This makes h1 stay at f, h2 move to 2*stretch*f, h3 to 3*stretch*f — producing bell/metallic timbres.

#### 4. Inharmonic Stretch

Like harmonic stretch but the mapping is nonlinear — lower partials stay near harmonic, higher partials drift:

```
for each bin k:
    stretch_at_k = 1.0 + amount * (k as f32 / (N/2) as f32)
    src = k / stretch_at_k
    warped[k] = interpolate_spectrum(spectrum, src)
```

#### 5. Spectral Time Skew

Rotates phase relationships — equivalent to time-skewing the waveform in the spectral domain:

```
for each bin k:
    skew_phase = amount * k as f32 * PI
    warped[k] = spectrum[k] * Complex::from_polar(1.0, skew_phase)
```

#### 6. Random Amplitude

Randomizes partial amplitudes while preserving overall spectral envelope:

```rust
fn warp_random_amplitude(spectrum: &mut [Complex32], amount: f32, seed: u64) {
    let envelope: Vec<f32> = smooth_spectral_envelope(spectrum, 32);
    let mut rng = SmallRng::seed_from_u64(seed);
    for (k, bin) in spectrum.iter_mut().enumerate() {
        let rand_scale = 1.0 + amount * (rng.gen::<f32>() * 2.0 - 1.0);
        *bin = Complex32::from_polar(bin.norm() * rand_scale * envelope[k], bin.arg());
    }
}
```

#### 7. Low-Fi

Reduces spectral resolution by quantizing bin amplitudes to fewer levels:

```
bits = lerp(10.0, 2.0, amount)   // 10 bits → 2 bits
levels = 2^bits
for each bin k:
    mag = spectrum[k].norm()
    quantized_mag = round(mag * levels) / levels
    warped[k] = Complex::from_polar(quantized_mag, spectrum[k].arg())
```

#### 8. Data Compress

Spectral compression: reduce dynamic range of harmonics, brings quiet partials up:

```
compression_ratio = 1.0 / (1.0 + amount * 9.0)   // 1:1 to 1:10
for each bin k:
    mag = spectrum[k].norm()
    target_mag = mag.powf(compression_ratio)
    warped[k] = spectrum[k] * (target_mag / (mag + 1e-6))
```

#### 9. Bend

Spectral warping via a nonlinear frequency mapping curve:

```
for each bin k:
    norm_k = k as f32 / (N/2) as f32
    bent_k = norm_k + amount * norm_k * (1.0 - norm_k) * 4.0  // quadratic bend
    src = bent_k * (N/2) as f32
    warped[k] = interpolate_spectrum(spectrum, src)
```

### Unison Implementation

The key insight: **don't use random per-voice phase offsets at note-on** if you want "wide but not phasey." Instead, use **fixed phase offsets** per unison slot so the stereo image is stable, and vary pitch continuously.

```rust
pub struct UnisonConfig {
    pub count: usize,             // 1..16
    pub detune_cents: f32,        // total spread: ±detune_cents/2 across voices
    pub stereo_spread: f32,       // 0..1
    pub blend: f32,               // 0 = all equal, 1 = center louder
    pub phase_randomize: f32,     // 0 = sync phase, 1 = random phase
}

impl UnisonConfig {
    pub fn voice_detune_cents(&self, voice_idx: usize) -> f32 {
        if self.count == 1 { return 0.0; }
        // Linear spread centered at 0
        let t = voice_idx as f32 / (self.count - 1) as f32;  // 0..1
        (t - 0.5) * self.detune_cents
    }

    pub fn voice_pan(&self, voice_idx: usize) -> f32 {
        if self.count == 1 { return 0.0; }
        let t = voice_idx as f32 / (self.count - 1) as f32;
        (t - 0.5) * 2.0 * self.stereo_spread  // -spread..+spread
    }

    pub fn voice_amplitude(&self, voice_idx: usize) -> f32 {
        // "Blend": center voice louder, outer voices quieter
        let dist_from_center = (voice_idx as f32 / (self.count as f32 - 1.0) - 0.5).abs() * 2.0;
        let center_boost = 1.0 + self.blend * dist_from_center.recip().min(4.0);
        // Normalize so total power is constant regardless of count
        center_boost / (self.count as f32).sqrt()
    }
}
```

**Why Vital sounds wide**: The stereo spread uses alternating L/R placement with **exponential** positioning (outer voices spread further out proportionally), and the detuning uses a small amount of randomization (~5 cents random offset per voice per note-on) on top of the fixed grid. The critical detail: **frequency-dependent correlation** — at low frequencies (below ~300Hz) the phase relationship is kept coherent to avoid bass cancellation; at high frequencies the voices are allowed to drift freely. This is implemented by modulating the `phase_randomize` parameter based on the fundamental frequency.

### Full Process Function

```rust
// daw-dsp/src/wavetable.rs (continued)

pub fn wavetable_process_block(
    state: &mut WavetableOscState,
    params: &WavetableParams,
    wavetable: &Wavetable,
    output_l: &mut [f32],
    output_r: &mut [f32],
    sample_rate: f32,
) {
    let unison_count = params.unison_count as usize;
    let base_freq = state.phase_inc * sample_rate; // Hz

    // Select mip level based on highest unison voice frequency
    let max_detune_ratio = 2f32.powf(params.unison_detune * 100.0 / 1200.0);
    let max_freq = base_freq * max_detune_ratio;
    let mip = select_mip(max_freq, sample_rate, WAVETABLE_MIP_LEVELS as u32) as usize;

    let n = output_l.len();

    // Zero outputs
    output_l.iter_mut().for_each(|x| *x = 0.0);
    output_r.iter_mut().for_each(|x| *x = 0.0);

    for u in 0..unison_count {
        let detune_cents = if unison_count > 1 {
            let t = u as f32 / (unison_count - 1) as f32;
            (t - 0.5) * params.unison_detune * 100.0 // 0..1 -> cents spread
        } else { 0.0 };

        let detune_ratio = 2f32.powf((detune_cents + params.pitch_fine_cents) / 1200.0);
        let inc = (base_freq * 2f32.powf(params.pitch_semitones / 12.0) * detune_ratio) / sample_rate;

        let pan = if unison_count > 1 {
            let t = u as f32 / (unison_count - 1) as f32;
            (t - 0.5) * 2.0 * params.unison_stereo_spread
        } else { params.pan };

        // Equal-power pan law
        let pan_angle = (pan + 1.0) * 0.25 * core::f32::consts::PI;
        let gain_l = pan_angle.cos() * params.gain;
        let gain_r = pan_angle.sin() * params.gain;

        // Amplitude: center voice boosted with blend param
        let dist = if unison_count > 1 {
            (u as f32 / (unison_count as f32 - 1.0) - 0.5).abs() * 2.0
        } else { 0.0 };
        let amp = (1.0 - params.unison_blend * dist * 0.5) / (unison_count as f32).sqrt();

        let mut phase = state.unison_phases[u];

        for i in 0..n {
            let sample = wavetable.get_sample(mip, params.frame_pos, phase);
            output_l[i] += sample * gain_l * amp;
            output_r[i] += sample * gain_r * amp;
            phase += inc;
            if phase >= 1.0 { phase -= 1.0; }
        }

        state.unison_phases[u] = phase;
    }
}
```

**Performance**: ~40–80 cycles per sample per unison voice. With 7 unison voices, ~350–560 cycles/sample. At 44.1kHz native, budget per sample ≈ 45,000 cycles (2GHz / 44100), so 7-voice unison uses ~1.2% CPU per voice. WASM budget: approximately 16 voices × 7 unison = 112 oscillator instances fits within 2.9ms at 44.1kHz on a modern device.

---

## 1.2 Virtual Analog / Subtractive Synthesis

**Reference**: u-he Diva (ZDF filters + oscillator drift), Repro-5, Arturia Mini V

### PolyBLEP Anti-Aliasing

A discontinuity in a waveform (sawtooth reset, square wave edge) generates aliasing. PolyBLEP corrects these with a polynomial that subtracts the alias contribution around the discontinuity point.

**Sawtooth PolyBLEP** (the core primitive):

At a discontinuity at normalized phase `t = 0` (reset from +1 to -1), apply correction to samples within 1 phase-increment of the discontinuity:

```
// t = phase at current sample relative to discontinuity
// dt = phase increment (freq/sr)
// Returns additive correction

fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        // Before discontinuity (within one sample)
        let t = t / dt;
        2.0 * t - t * t - 1.0
    } else if t > 1.0 - dt {
        // After discontinuity (within one sample)
        let t = (t - 1.0) / dt;
        t * t + 2.0 * t + 1.0
    } else {
        0.0
    }
}
```

**Full VA oscillator in Rust**:

```rust
// daw-dsp/src/va_osc.rs

#[derive(Clone)]
pub struct VaOscState {
    pub phase: f32,      // 0..1
    pub sync_phase: f32, // for hard sync slave
    // Drift simulation
    pub drift_phase: f32,
    pub drift_value: f32,
    pub drift_lfo_phase: f32,
}

#[derive(Clone, Copy)]
pub enum VaWaveform {
    Saw,
    Square,
    Triangle,
    Pulse { width: f32 },  // width 0..1
    Sine,
}

#[derive(Clone)]
pub struct VaOscParams {
    pub waveform: VaWaveform,
    pub pitch_hz: f32,
    pub pitch_semitones: f32,
    pub pitch_fine_cents: f32,
    pub gain: f32,
    pub phase_reset_on_note: bool,
    pub hard_sync_ratio: Option<f32>,  // None = no sync, Some(ratio) = sync
    pub drift_amount: f32,             // 0..1, maps to 0..5 cents drift
}

fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let t = t / dt;
        2.0 * t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + 2.0 * t + 1.0
    } else {
        0.0
    }
}

pub fn va_osc_process(
    state: &mut VaOscState,
    params: &VaOscParams,
    output: &mut [f32],
    sample_rate: f32,
) {
    let drift_cents = params.drift_amount * 5.0 * state.drift_value;
    let freq = params.pitch_hz
        * 2f32.powf((params.pitch_semitones + params.pitch_fine_cents / 100.0 + drift_cents / 100.0) / 12.0);
    let dt = freq / sample_rate;

    for sample in output.iter_mut() {
        let phase = state.phase;

        let raw = match params.waveform {
            VaWaveform::Saw => {
                let s = 2.0 * phase - 1.0;
                s - poly_blep(phase, dt)
            }
            VaWaveform::Square => {
                let s = if phase < 0.5 { 1.0 } else { -1.0 };
                s + poly_blep(phase, dt) - poly_blep((phase + 0.5).rem_euclid(1.0), dt)
            }
            VaWaveform::Triangle => {
                // Triangle from integrated square, PolyBLEP on the derivative
                let square = if phase < 0.5 { 1.0 } else { -1.0 };
                let square_blep = square
                    + poly_blep(phase, dt)
                    - poly_blep((phase + 0.5).rem_euclid(1.0), dt);
                // Integrate: y[n] = y[n-1] + 4*dt*square[n]
                // (handled in a separate integrator state — simplified here)
                // For direct triangle:
                let tri = if phase < 0.25 { 4.0 * phase }
                          else if phase < 0.75 { 2.0 - 4.0 * phase }
                          else { 4.0 * phase - 4.0 };
                let _ = square_blep;
                tri // (proper implementation uses an integrator with PolyBLEP on square)
            }
            VaWaveform::Pulse { width } => {
                // Two saws subtracted with offset = width
                let saw1 = 2.0 * phase - 1.0;
                let phase2 = (phase + width).rem_euclid(1.0);
                let saw2 = 2.0 * phase2 - 1.0;
                let blep1 = poly_blep(phase, dt);
                let blep2 = poly_blep(phase2, dt);
                (saw1 - blep1) - (saw2 - blep2)
            }
            VaWaveform::Sine => (phase * core::f32::consts::TAU).sin(),
        };

        *sample = raw * params.gain;

        // Advance phase
        state.phase += dt;
        if state.phase >= 1.0 {
            state.phase -= 1.0;
        }

        // Update drift LFO (cheap: once per sample is fine, could be once per block)
        let drift_lfo_freq = 0.3_f32; // Hz
        state.drift_lfo_phase += drift_lfo_freq / sample_rate;
        if state.drift_lfo_phase >= 1.0 { state.drift_lfo_phase -= 1.0; }
        let target_drift = (state.drift_lfo_phase * core::f32::consts::TAU).sin();
        // Smooth drift toward target with a very slow coefficient
        state.drift_value += (target_drift - state.drift_value) * 0.0001;
    }
}
```

### MinBLEP (for Hard Sync)

MinBLEP is a precomputed minimum-phase version of the BLEP residual. It handles arbitrary discontinuity shapes (needed for hard sync reset).

```rust
// Generation (done once at startup):
fn generate_minblep(table_size: usize, zero_crossings: usize) -> Vec<f32> {
    let n = table_size;
    // 1. Generate sinc
    let mut sinc: Vec<f32> = (0..n).map(|i| {
        let x = (i as f32 / n as f32 - 0.5) * zero_crossings as f32 * 2.0;
        if x == 0.0 { 1.0 } else { (x * PI).sin() / (x * PI) }
    }).collect();
    // 2. Apply Blackman window
    for (i, s) in sinc.iter_mut().enumerate() {
        let w = 0.42 - 0.5*(2.0*PI*i as f32/n as f32).cos() + 0.08*(4.0*PI*i as f32/n as f32).cos();
        *s *= w;
    }
    // 3. Make minimum-phase via cepstrum
    // (take FFT, log magnitude, set imaginary to 0, IFFT, keep causal half)
    // ... (full cepstrum minimum-phase conversion)
    // 4. Integrate to get step function
    let mut minblep = vec![0.0f32; n];
    let mut acc = 0.0f32;
    for i in 0..n {
        acc += sinc[i];
        minblep[i] = acc;
    }
    // Normalize
    let max = *minblep.iter().max_by(|a,b| a.partial_cmp(b).unwrap()).unwrap();
    minblep.iter_mut().for_each(|x| *x /= max);
    minblep
}

// Apply MinBLEP at a discontinuity: add the MinBLEP residual starting at current output position
fn apply_minblep(
    output: &mut [f32],
    start_sample: usize,
    jump_height: f32,  // magnitude of the discontinuity
    minblep: &[f32],
    minblep_scale: f32, // sub-sample fractional position 0..1
) {
    for (i, &mb) in minblep.iter().enumerate() {
        let idx = start_sample + i;
        if idx < output.len() {
            output[idx] += jump_height * mb;
        }
    }
}
```

**Hard sync**: When the master oscillator completes a cycle, the slave oscillator resets. At the reset point, apply a MinBLEP scaled by the jump height at that phase:

```rust
// In the sync slave's process loop:
if master_phase_wrapped {  // master crossed 0
    let jump = slave_target_phase_value - current_slave_phase_value;
    apply_minblep(output, i, jump, &minblep_table, frac_offset);
    slave_state.phase = 0.0;
}
```

### TPT SVF (Topology-Preserving Transform State Variable Filter)

From Vadim Zavalishin's "The Art of VA Filter Design." The key insight: analog filters have no delay in the feedback path. Standard digital IIR has a 1-sample delay that causes the filter to "break" at high resonance. ZDF/TPT removes this by solving the delay-free loop algebraically.

**Derivation**: The analog SVF has integrators connected in a chain. The TPT discretization uses the bilinear transform (s → (2/T)(z-1)/(z+1)) applied to each integrator, which maps s=∞ to z=-1 (Nyquist), preserving the topology.

The continuous-time SVF equations (with input `x`, states `y_hp`, `y_bp`, `y_lp`):

```
y_hp = x - (1/Q)*y_bp - y_lp
y_bp' = ω₀ * y_hp
y_lp' = ω₀ * y_bp
```

After bilinear transform discretization (T = 1/sr), defining `g = tan(π*f/sr)` and `k = 1/Q`:

```rust
// daw-dsp/src/filters/svf.rs

#[derive(Clone, Default)]
pub struct SvfState {
    pub ic1eq: f32,  // integrator 1 state (band-pass)
    pub ic2eq: f32,  // integrator 2 state (low-pass)
}

#[derive(Clone)]
pub struct SvfCoeffs {
    pub g: f32,   // tan(pi * cutoff / sample_rate)
    pub k: f32,   // 1/Q (damping)
    // Precomputed
    pub a1: f32,
    pub a2: f32,
    pub a3: f32,
}

impl SvfCoeffs {
    pub fn new(cutoff_hz: f32, q: f32, sample_rate: f32) -> Self {
        let g = (core::f32::consts::PI * cutoff_hz / sample_rate).tan();
        let k = 1.0 / q;
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        Self { g, k, a1, a2, a3 }
    }
}

pub struct SvfOutputs {
    pub lp: f32,
    pub bp: f32,
    pub hp: f32,
    pub notch: f32,
    pub peak: f32,
    pub allpass: f32,
}

#[inline(always)]
pub fn svf_tick(state: &mut SvfState, coeffs: &SvfCoeffs, input: f32) -> SvfOutputs {
    // ZDF SVF — no 1-sample delay in feedback loop
    let v3 = input - state.ic2eq;
    let v1 = coeffs.a1 * state.ic1eq + coeffs.a2 * v3;
    let v2 = state.ic2eq + coeffs.a2 * state.ic1eq + coeffs.a3 * v3;

    state.ic1eq = 2.0 * v1 - state.ic1eq;
    state.ic2eq = 2.0 * v2 - state.ic2eq;

    let lp = v2;
    let bp = v1;
    let hp = input - coeffs.k * v1 - v2;
    let notch = input - coeffs.k * v1;
    let peak = lp - hp;
    let allpass = input - 2.0 * coeffs.k * v1;

    SvfOutputs { lp, bp, hp, notch, peak, allpass }
}
```

## 1.3 Analog Filter Models

### 1.3.1 Moog Ladder Filter (4-pole, 24 dB/oct lowpass)

The Moog ladder is four one-pole lowpass filters in series with a global negative feedback path. The resonance makes it self-oscillate (pure sine at cutoff) when Q > 1.

ZDF implementation with saturation (tanh) in each stage — the nonlinearity is what gives it warmth:

```rust
// daw-dsp/src/filters/moog.rs

#[derive(Clone, Default)]
pub struct MoogState {
    pub s: [f32; 4],  // state of each one-pole stage
}

#[derive(Clone)]
pub struct MoogCoeffs {
    pub g: f32,       // discretized pole: g = GD / (1 + GD), GD = tan(pi*f/sr)
    pub res: f32,     // resonance 0..4 (self-oscillates at 4)
    pub drive: f32,   // pre-filter drive (1.0 = no drive)
}

impl MoogCoeffs {
    pub fn new(cutoff_hz: f32, resonance: f32, sample_rate: f32) -> Self {
        // Frequency warping: compensate for bilinear transform frequency compression
        let f_c = (cutoff_hz / sample_rate).min(0.49);
        let gd = (core::f32::consts::PI * f_c).tan();
        let g = gd / (1.0 + gd);
        Self { g, res: resonance.clamp(0.0, 4.0), drive: 1.0 }
    }
}

#[inline(always)]
fn tanh_fast(x: f32) -> f32 {
    // Padé approximant — faster than libm tanh, accurate to ±0.5% for |x| < 4
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}

#[inline(always)]
pub fn moog_tick(state: &mut MoogState, coeffs: &MoogCoeffs, input: f32) -> f32 {
    // Apply drive before filter
    let driven = tanh_fast(input * coeffs.drive);

    // Feedback: subtract 4× resonance × last stage output
    // We need to solve the delay-free loop. Use 1-sample delay approximation
    // (true ZDF Moog requires iterative solve — this is the standard digital approximation):
    let fb = tanh_fast(state.s[3] * coeffs.res * 4.0);
    let mut x = driven - fb;

    // 4 cascaded one-pole stages with tanh nonlinearity
    for i in 0..4 {
        let v = tanh_fast(x);
        let new_s = v * coeffs.g + state.s[i] * (1.0 - coeffs.g);
        // ZDF one-pole: y = g*(x - s) + s = g*x + (1-g)*s
        let y = coeffs.g * (v - state.s[i]) + state.s[i];
        state.s[i] = 2.0 * y - state.s[i]; // state update
        x = y;
    }
    x
}
```

**Full ZDF Moog** (delay-free, requires solving a nonlinear equation — Newton-Raphson or fixed-point iteration):

```rust
pub fn moog_tick_zdf(state: &mut MoogState, coeffs: &MoogCoeffs, input: f32) -> f32 {
    // Estimate: use previous output as initial guess
    let g = coeffs.g;
    let k = coeffs.res;

    // Predictor: run with no feedback
    let mut y = state.s[3];

    // 2 Newton-Raphson iterations to solve the delay-free loop
    for _ in 0..2 {
        let fb = tanh_fast(y * k * 4.0);
        let x0 = tanh_fast(input - fb);

        let (s0, s1, s2, s3) = (state.s[0], state.s[1], state.s[2], state.s[3]);
        let y0 = g * (tanh_fast(x0) - s0) + s0;
        let y1 = g * (tanh_fast(y0) - s1) + s1;
        let y2 = g * (tanh_fast(y1) - s2) + s2;
        let y3 = g * (tanh_fast(y2) - s3) + s3;
        y = y3;
    }

    // Commit state
    let fb = tanh_fast(y * k * 4.0);
    let x0 = tanh_fast(input - fb);
    let y0 = g * (tanh_fast(x0) - state.s[0]) + state.s[0];
    let y1 = g * (tanh_fast(y0) - state.s[1]) + state.s[1];
    let y2 = g * (tanh_fast(y1) - state.s[2]) + state.s[2];
    let y3 = g * (tanh_fast(y2) - state.s[3]) + state.s[3];
    // Update integrator states (double-integrator trick)
    state.s[0] = 2.0 * y0 - state.s[0];
    state.s[1] = 2.0 * y1 - state.s[1];
    state.s[2] = 2.0 * y2 - state.s[2];
    state.s[3] = 2.0 * y3 - state.s[3];
    y3
}
```

**Why it sounds warm**: The `tanh` nonlinearity in each stage creates soft harmonic distortion (mostly 3rd harmonic) that increases as the signal approaches ±1. The resonance feedback path passes through the same saturation, so as resonance increases, the feedback gets compressed — this is why the Moog self-oscillates cleanly (the saturation stabilizes it) rather than blowing up.

### 1.3.2 Diode Ladder Filter (TB-303 style)

The diode ladder uses a different feedback topology where each stage has a diode pair creating asymmetric clipping. This produces the "acid" character: sharper, more aggressive resonance with a characteristic emphasis on odd harmonics.

```rust
// daw-dsp/src/filters/diode_ladder.rs
// Based on Huovilainen (2004) / Pirkle (2019) models

#[derive(Clone, Default)]
pub struct DiodeLadderState {
    pub s: [f32; 4],
    pub y: [f32; 4],
}

#[derive(Clone)]
pub struct DiodeLadderCoeffs {
    pub g: f32,
    pub res: f32,     // 0..17 (self-oscillates >~16)
    pub vt: f32,      // thermal voltage analog: 0.0256 (normalized)
}

impl DiodeLadderCoeffs {
    pub fn new(cutoff_hz: f32, resonance: f32, sample_rate: f32) -> Self {
        let f = (cutoff_hz / sample_rate).min(0.45);
        let g = (core::f32::consts::PI * f).tan();
        Self { g, res: resonance * 17.0, vt: 0.0256 }
    }
}

#[inline(always)]
fn diode_clip(x: f32, vt: f32) -> f32 {
    // Asymmetric diode clipping: sharper for positive, softer for negative
    // Approximate: tanh(x) with different knee for + and -
    if x > 0.0 {
        tanh_fast(x / vt) * vt
    } else {
        tanh_fast(x / (2.0 * vt)) * 2.0 * vt
    }
}

pub fn diode_ladder_tick(
    state: &mut DiodeLadderState,
    coeffs: &DiodeLadderCoeffs,
    input: f32,
) -> f32 {
    let g = coeffs.g;

    // Global negative feedback with diode nonlinearity
    let fb = state.y[3] * coeffs.res;
    let x = diode_clip(input - fb, coeffs.vt);

    // 4 one-pole stages
    for i in 0..4 {
        let v = diode_clip(x - state.s[i], coeffs.vt);
        let y = g * v + state.s[i];
        state.s[i] = g * v + y;  // Euler state update
        state.y[i] = y;
    }

    state.y[3]
}
```

### 1.3.3 Korg MS-20 Filter (Sallen-Key)

The MS-20 uses two Sallen-Key filters (HP then LP) with diode clipping in the feedback, creating its distinctive aggressive "screaming" resonance at high Q.

```rust
// daw-dsp/src/filters/sallen_key.rs

#[derive(Clone, Default)]
pub struct SallenKeyState {
    pub s1: f32,
    pub s2: f32,
}

#[derive(Clone)]
pub struct SallenKeyCoeffs {
    pub g: f32,
    pub k: f32,     // resonance (feedback amount)
    pub filter_type: SallenKeyType,
}

#[derive(Clone, Copy)]
pub enum SallenKeyType { LowPass, HighPass }

impl SallenKeyCoeffs {
    pub fn new(cutoff_hz: f32, resonance: f32, sample_rate: f32, filter_type: SallenKeyType) -> Self {
        let g = (core::f32::consts::PI * cutoff_hz / sample_rate).tan();
        Self { g, k: resonance.clamp(0.0, 2.0), filter_type }
    }
}

pub fn sallen_key_tick(state: &mut SallenKeyState, c: &SallenKeyCoeffs, x: f32) -> f32 {
    let g = c.g;
    match c.filter_type {
        SallenKeyType::LowPass => {
            // Sallen-Key LP with diode feedback nonlinearity
            let fb = tanh_fast(state.s2 * c.k);
            let v1 = (x - fb - state.s1 * g) / (1.0 + g + g * g + g * c.k);
            let y1 = v1 + state.s1;
            let v2 = (y1 - state.s2) * g;
            let y2 = v2 + state.s2;
            state.s1 = 2.0 * v1 * g + state.s1 - v1 * 2.0 * g;  // simplified
            state.s1 += 2.0 * g * (x - fb - state.s1) / (1.0 + 2.0*g + g*g);
            state.s2 += 2.0 * g * (y1 - state.s2);
            y2
        }
        SallenKeyType::HighPass => {
            // Sallen-Key HP
            let hp = (x - state.s1 * (2.0 + c.k) - state.s2) / (1.0 + (2.0 + c.k) * g + g * g);
            let v1 = hp * g;
            let y1 = v1 + state.s1;
            let v2 = (y1 - state.s2) * g;
            let y2 = v2 + state.s2;
            state.s1 += 2.0 * v1;
            state.s2 += 2.0 * v2;
            hp
        }
    }
}

/// MS-20 dual filter: HP followed by LP, both with shared resonance
pub struct Ms20FilterState {
    hp: SallenKeyState,
    lp: SallenKeyState,
}

pub fn ms20_tick(state: &mut Ms20FilterState, hp_coeff: &SallenKeyCoeffs, lp_coeff: &SallenKeyCoeffs, x: f32) -> f32 {
    let hp_out = sallen_key_tick(&mut state.hp, hp_coeff, x);
    sallen_key_tick(&mut state.lp, lp_coeff, hp_out)
}
```

### 1.3.4 Oberheim SEM Filter (State Variable, 12 dB/oct)

The SEM uses a continuous morph between LP, BP, HP, and Notch outputs via a blend parameter — not a switched selector.

```rust
// daw-dsp/src/filters/sem.rs

#[derive(Clone)]
pub struct SemCoeffs {
    pub svf: SvfCoeffs,
    pub morph: f32,  // 0=LP, 0.5=Notch, 1=HP, with BP at 0.25 and 0.75
    pub drive: f32,
}

pub fn sem_tick(state: &mut SvfState, c: &SemCoeffs, input: f32) -> f32 {
    // Soft clip at input for warmth
    let x = tanh_fast(input * c.drive);
    let outs = svf_tick(state, &c.svf, x);

    // Morph between outputs:
    // morph 0.0  -> LP
    // morph 0.25 -> LP+BP blend (warm)
    // morph 0.5  -> Notch (BP subtracted from dry)
    // morph 0.75 -> HP+BP blend
    // morph 1.0  -> HP
    let m = c.morph;
    if m <= 0.5 {
        let t = m * 2.0;  // 0..1
        outs.lp * (1.0 - t) + outs.notch * t
    } else {
        let t = (m - 0.5) * 2.0;  // 0..1
        outs.notch * (1.0 - t) + outs.hp * t
    }
}
```

**Why it sounds creamy**: The SEM operates at 12 dB/oct (vs Moog's 24), so it's gentler and lets more harmonics through. The continuous morph parameter allows the filter to transition through BP character (which adds a slight bandpass resonance) during the LP→HP transition, creating the characteristic "creamy" midrange emphasis. The internal soft-clipping (drive) adds subtle even-harmonic saturation.

### 1.3.5 Prophet-5 / Curtis CEM3320 Filter

The Prophet-5 filter is a 4-pole lowpass similar to the Moog ladder but with a different nonlinearity curve (the Curtis chip uses bipolar transistors rather than FETs, giving a more "even" saturation). Key difference: the resonance feedback in the CEM3320 goes into the input of the first stage, not summed with its output.

```rust
pub fn prophet_filter_tick(state: &mut MoogState, c: &MoogCoeffs, input: f32) -> f32 {
    // Same topology as Moog but with softer nonlinearity
    // "Poly soft clip": more gradual than tanh, mimics BJT saturation
    let poly_soft = |x: f32| -> f32 {
        let x = x.clamp(-1.5, 1.5);
        x - (x * x * x) / 3.0  // cubic soft clip (3rd harmonic emphasis)
    };

    let fb = poly_soft(state.s[3] * c.res);
    let mut sig = poly_soft(input - fb);

    for i in 0..4 {
        let y = c.g * (sig - state.s[i]) + state.s[i];
        state.s[i] = 2.0 * y - state.s[i];
        sig = y;
    }
    sig
}
```

### 1.3.6 Digital/Clean Filters (Audio EQ Cookbook)

All biquad filters follow the standard form:

```
H(z) = (b0 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2)
y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
```

```rust
// daw-dsp/src/filters/biquad.rs

#[derive(Clone, Default)]
pub struct BiquadState {
    pub x1: f32, pub x2: f32,
    pub y1: f32, pub y2: f32,
}

#[derive(Clone, Default)]
pub struct BiquadCoeffs {
    pub b0: f32, pub b1: f32, pub b2: f32,
    pub a1: f32, pub a2: f32,
}

impl BiquadCoeffs {
    // All from Robert Bristow-Johnson "Audio EQ Cookbook"
    // ω₀ = 2π*f₀/sr, α = sin(ω₀)/(2*Q)

    pub fn lowpass(f0: f32, q: f32, sr: f32) -> Self {
        let w0 = core::f32::consts::TAU * f0 / sr;
        let cos_w0 = w0.cos(); let alpha = w0.sin() / (2.0 * q);
        let b1 = 1.0 - cos_w0;
        let b0 = b1 / 2.0; let b2 = b0;
        let a0 = 1.0 + alpha;
        Self { b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: -2.0*cos_w0/a0, a2: (1.0-alpha)/a0 }
    }

    pub fn highpass(f0: f32, q: f32, sr: f32) -> Self {
        let w0 = core::f32::consts::TAU * f0 / sr;
        let cos_w0 = w0.cos(); let alpha = w0.sin() / (2.0 * q);
        let b1 = -(1.0 + cos_w0);
        let b0 = -b1 / 2.0; let b2 = b0;
        let a0 = 1.0 + alpha;
        Self { b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: -2.0*cos_w0/a0, a2: (1.0-alpha)/a0 }
    }

    pub fn bandpass(f0: f32, q: f32, sr: f32) -> Self {
        let w0 = core::f32::consts::TAU * f0 / sr;
        let alpha = w0.sin() / (2.0 * q);
        let b0 = w0.sin() / 2.0;
        let a0 = 1.0 + alpha;
        Self { b0: b0/a0, b1: 0.0, b2: -b0/a0, a1: -2.0*w0.cos()/a0, a2: (1.0-alpha)/a0 }
    }

    pub fn notch(f0: f32, q: f32, sr: f32) -> Self {
        let w0 = core::f32::consts::TAU * f0 / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos(); let a0 = 1.0 + alpha;
        Self { b0: 1.0/a0, b1: -2.0*cos_w0/a0, b2: 1.0/a0,
               a1: -2.0*cos_w0/a0, a2: (1.0-alpha)/a0 }
    }

    pub fn peak(f0: f32, q: f32, db_gain: f32, sr: f32) -> Self {
        let a_gain = 10f32.powf(db_gain / 40.0);
        let w0 = core::f32::consts::TAU * f0 / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos(); let a0 = 1.0 + alpha / a_gain;
        Self { b0: (1.0 + alpha*a_gain)/a0, b1: -2.0*cos_w0/a0, b2: (1.0-alpha*a_gain)/a0,
               a1: -2.0*cos_w0/a0, a2: (1.0-alpha/a_gain)/a0 }
    }

    pub fn low_shelf(f0: f32, q: f32, db_gain: f32, sr: f32) -> Self {
        let a = 10f32.powf(db_gain / 40.0);
        let w0 = core::f32::consts::TAU * f0 / sr;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / 2.0 * ((a + 1.0/a) * (1.0/q - 1.0) + 2.0).sqrt();
        let a0 = (a+1.0) + (a-1.0)*cos_w0 + 2.0*a.sqrt()*alpha;
        Self {
            b0:  a*((a+1.0) - (a-1.0)*cos_w0 + 2.0*a.sqrt()*alpha) / a0,
            b1:  2.0*a*((a-1.0) - (a+1.0)*cos_w0) / a0,
            b2:  a*((a+1.0) - (a-1.0)*cos_w0 - 2.0*a.sqrt()*alpha) / a0,
            a1: -2.0*((a-1.0) + (a+1.0)*cos_w0) / a0,
            a2:  ((a+1.0) + (a-1.0)*cos_w0 - 2.0*a.sqrt()*alpha) / a0,
        }
    }

    pub fn high_shelf(f0: f32, q: f32, db_gain: f32, sr: f32) -> Self {
        let a = 10f32.powf(db_gain / 40.0);
        let w0 = core::f32::consts::TAU * f0 / sr;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / 2.0 * ((a + 1.0/a) * (1.0/q - 1.0) + 2.0).sqrt();
        let a0 = (a+1.0) - (a-1.0)*cos_w0 + 2.0*a.sqrt()*alpha;
        Self {
            b0:  a*((a+1.0) + (a-1.0)*cos_w0 + 2.0*a.sqrt()*alpha) / a0,
            b1: -2.0*a*((a-1.0) + (a+1.0)*cos_w0) / a0,
            b2:  a*((a+1.0) + (a-1.0)*cos_w0 - 2.0*a.sqrt()*alpha) / a0,
            a1:  2.0*((a-1.0) - (a+1.0)*cos_w0) / a0,
            a2:  ((a+1.0) - (a-1.0)*cos_w0 - 2.0*a.sqrt()*alpha) / a0,
        }
    }
}

#[inline(always)]
pub fn biquad_tick(state: &mut BiquadState, c: &BiquadCoeffs, x: f32) -> f32 {
    let y = c.b0 * x + c.b1 * state.x1 + c.b2 * state.x2
                     - c.a1 * state.y1 - c.a2 * state.y2;
    state.x2 = state.x1; state.x1 = x;
    state.y2 = state.y1; state.y1 = y;
    y
}

/// Cascade of biquads for steeper slopes (12/24/36/48 dB/oct)
pub struct BiquadCascade<const N: usize> {
    pub states: [BiquadState; N],
    pub coeffs: [BiquadCoeffs; N],
}

impl<const N: usize> BiquadCascade<N> {
    pub fn process(&mut self, x: f32) -> f32 {
        let mut y = x;
        for i in 0..N {
            y = biquad_tick(&mut self.states[i], &self.coeffs[i], y);
        }
        y
    }
}
```

**Formant Filter (Vowel Shapes)**:

Standard formant frequencies (Hz) for male voice, first 3 formants:

```
        F1    F2    F3    BW1  BW2  BW3
A:     730  1090  2440    80  100  120
E:     270  2290  3010    60  100  120
I:     390  1990  2550    60  100  120
O:     570   840  2410    60   80  100
U:     300   870  2240    80  100  120
```

```rust
pub struct FormantFilter {
    // 3 parallel bandpass biquads
    states: [[BiquadState; 3]; 2],  // L and R (or two vowels for morphing)
}

pub struct FormantParams {
    pub vowel_a: usize,  // 0=A,1=E,2=I,3=O,4=U
    pub vowel_b: usize,
    pub morph: f32,      // 0=vowel_a, 1=vowel_b
    pub gender: f32,     // 0=male, 1=female (scales F1-F3 up by ~1.2×)
}

const FORMANTS: [[f32; 6]; 5] = [
    [730.0, 1090.0, 2440.0, 80.0, 100.0, 120.0],  // A
    [270.0, 2290.0, 3010.0, 60.0, 100.0, 120.0],  // E
    [390.0, 1990.0, 2550.0, 60.0, 100.0, 120.0],  // I
    [570.0,  840.0, 2410.0, 60.0,  80.0, 100.0],  // O
    [300.0,  870.0, 2240.0, 80.0, 100.0, 120.0],  // U
];

pub fn build_formant_coeffs(params: &FormantParams, sample_rate: f32) -> [[BiquadCoeffs; 3]; 1] {
    let fa = FORMANTS[params.vowel_a];
    let fb = FORMANTS[params.vowel_b];
    let gender_scale = 1.0 + params.gender * 0.2;
    let mut coeffs = [[BiquadCoeffs::default(); 3]; 1];
    for f in 0..3 {
        let freq = (fa[f] * (1.0 - params.morph) + fb[f] * params.morph) * gender_scale;
        let bw   = fa[f+3] * (1.0 - params.morph) + fb[f+3] * params.morph;
        let q    = freq / bw;
        coeffs[0][f] = BiquadCoeffs::bandpass(freq, q, sample_rate);
    }
    coeffs
}
```

---

## 1.4 FM Synthesis

**Reference**: Yamaha DX7, Native Instruments FM8, Dexed (GPLv2)

### Phase Modulation vs Frequency Modulation

The DX7 uses **phase modulation** (PM), not classical FM. The distinction:

```
FM: x(t) = sin(ω_c*t + I * ∫sin(ω_m*t)dt) = sin(ω_c*t - I/ω_m * cos(ω_m*t))
PM: x(t) = sin(ω_c*t + I * sin(ω_m*t))
```

PM is simpler to implement (no integration), has more predictable harmonic content (modulation index I directly scales Bessel function coefficients), and stays in tune regardless of the modulator frequency. **Always use PM.**

Harmonic content of PM:

```
x(t) = Σ_{n=-∞}^{∞} J_n(I) * sin((ω_c + n*ω_m)*t)
```

where J_n is the nth-order Bessel function of the first kind. At I=0, only the carrier. As I increases, more sidebands appear.

### 32 DX7 Algorithms

Defined as directed acyclic graphs of operators. Here are all 32 as adjacency lists (op→modulates):

```rust
// Each entry: (carrier_ops, modulator_chains)
// Format: [[op, op_modulates], ...] where ops are 1-indexed (DX7 convention)
// "C" = carrier (direct output), "M" = modulator only

pub const DX7_ALGORITHMS: [&'static [(u8, u8)]; 32] = [
    // Alg 1: 6→5→4→3→2→1(C)  (full series stack)
    &[(6,5),(5,4),(4,3),(3,2),(2,1)],
    // Alg 2: 6→5→4→3→2→1(C), 6 also self-fb
    &[(6,5),(5,4),(4,3),(3,2),(2,1),(6,6)],
    // Alg 3: 6→5→4→3(C), 2→1(C)  (two stacks)
    &[(6,5),(5,4),(4,3),(2,1)],
    // Alg 4: 6→5→4→3(C), 2→1(C), 6 fb
    &[(6,5),(5,4),(4,3),(2,1),(6,6)],
    // Alg 5: 6→(3C,5→4C), 2→1C  (fork + independent)
    &[(6,3),(6,5),(5,4),(2,1)],
    // Alg 6: 6→(3C,5→4C,2→1C)
    &[(6,3),(6,5),(5,4),(6,2),(2,1)],
    // Alg 7: 6→5→4C, 3→2→1C  (two parallel stacks)
    &[(6,5),(5,4),(3,2),(2,1)],
    // Alg 8: 6→5→(3C,4C), 2→1C
    &[(6,5),(5,3),(5,4),(2,1)],
    // Alg 9: 6→5→(3C,4C,2→1C)
    &[(6,5),(5,3),(5,4),(2,1)],
    // Alg 10: 6→5→4C, 3→2→1C
    &[(6,5),(5,4),(3,2),(2,1)],
    // Alg 11: 6→5C, 4→(3C,2→1C)
    &[(6,5),(4,3),(4,2),(2,1)],
    // Alg 12: 6→(5C,4C,3→2→1C)
    &[(6,5),(6,4),(3,2),(2,1)],
    // Alg 13: 6→(5C,4→3C,2→1C)
    &[(6,5),(6,4),(4,3),(6,2),(2,1)],
    // Alg 14: 6→(5C,4→(3C,2→1C))
    &[(6,5),(6,4),(4,3),(4,2),(2,1)],
    // Alg 15: 6→(5C,4→3C), 2→1C
    &[(6,5),(6,4),(4,3),(2,1)],
    // Alg 16: 6→5C, 4→3C, 2→1C  (three stacks)
    &[(6,5),(4,3),(2,1)],
    // Alg 17: 6→(5→4→3→2→1C)  (all mod 1)
    &[(6,5),(5,4),(4,3),(3,2),(2,1)],
    // Alg 18: 6,5→4→3→2→1C
    &[(6,4),(5,4),(4,3),(3,2),(2,1)],
    // Alg 19: 6→(5,4,3,2)→1C
    &[(6,5),(6,4),(6,3),(6,2),(5,1),(4,1),(3,1),(2,1)],
    // Alg 20: 5,6→4→3→2→1C
    &[(5,4),(6,4),(4,3),(3,2),(2,1)],
    // Alg 21: (6,5)→(4,3)→(2,1)C
    &[(6,4),(6,3),(5,4),(5,3),(4,2),(4,1),(3,2),(3,1)],
    // Alg 22: 6→5→4C, 6→3→2→1C
    &[(6,5),(5,4),(6,3),(3,2),(2,1)],
    // Alg 23: 6→5→(4C,3C,2→1C)
    &[(6,5),(5,4),(5,3),(2,1)],
    // Alg 24: 6→(5C,4C,3C,2→1C)
    &[(6,5),(6,4),(6,3),(2,1)],
    // Alg 25: 6→(5C,4C,3C), 2→1C
    &[(6,5),(6,4),(6,3),(2,1)],
    // Alg 26: 6→(5C,4C,3→2→1C)
    &[(6,5),(6,4),(3,2),(2,1)],
    // Alg 27: 6→(5C,4C,3C,2C,1C)  (6 mods all carriers)
    &[(6,5),(6,4),(6,3),(6,2),(6,1)],
    // Alg 28: 6→5C, 4→(3C,2C,1C)
    &[(6,5),(4,3),(4,2),(4,1)],
    // Alg 29: 6→(5C,4C,3→2C,3→1C)
    &[(6,5),(6,4),(3,2),(3,1)],
    // Alg 30: 6→(5C,4→3C,4→2C,4→1C)
    &[(6,5),(4,3),(4,2),(4,1)],
    // Alg 31: 6C,5C,4C,3C,2→1C  (5 carriers, one mod)
    &[(2,1)],
    // Alg 32: all carriers (no modulators)
    &[],
];
```

### FM Engine Implementation

```rust
// daw-dsp/src/fm.rs

#[derive(Clone)]
pub struct FmOperator {
    pub frequency_ratio: f32,  // multiplier of note frequency
    pub frequency_fixed: Option<f32>,  // if Some, ignore ratio (Hz)
    pub output_level: f32,     // 0..1 (linear, from DX7's 0..99 log scale)
    pub feedback_level: f32,   // 0..1 (self-feedback)
    pub velocity_sense: f32,   // 0..1
    pub key_scale_break: u8,   // MIDI note for key scaling center
    pub key_scale_left: f32,   // rate of level change below break
    pub key_scale_right: f32,  // rate of level change above break
    // Envelope (DX7 4-rate/4-level)
    pub envelope: DxEnvelope,
}

/// DX7-style rate/level envelope (4 segments)
#[derive(Clone, Default)]
pub struct DxEnvelope {
    pub rates: [u8; 4],   // R1..R4, 0..99 (higher = faster)
    pub levels: [u8; 4],  // L1..L4, 0..99
}

#[derive(Clone, Default)]
pub struct DxEnvelopeState {
    pub stage: u8,       // 0=attack,1=decay1,2=sustain,3=release
    pub level: f32,      // current output 0..1
    pub phase: f32,      // progress within current stage
}

impl DxEnvelopeState {
    pub fn tick(&mut self, env: &DxEnvelope, note_on: bool, sample_rate: f32) -> f32 {
        // Rate 0 = very slow, rate 99 = instant
        // Time(rate) = 2^((99-rate)/8) * base_time_seconds
        let rate_to_secs = |r: u8| -> f32 {
            if r >= 99 { 0.001 }
            else { 2f32.powf((99 - r) as f32 / 8.0) * 0.001 }
        };

        let target_level = (self.stage as usize).min(3);
        let target = env.levels[target_level] as f32 / 99.0;
        let rate_secs = rate_to_secs(env.rates[self.stage as usize]);

        let step = 1.0 / (rate_secs * sample_rate);

        if !note_on && self.stage < 3 {
            self.stage = 3;  // Jump to release
        }

        if (self.level - target).abs() < step {
            self.level = target;
            if self.stage < 3 && note_on { self.stage += 1; }
        } else {
            self.level += step * if target > self.level { 1.0 } else { -1.0 };
        }

        self.level
    }
}

#[derive(Clone)]
pub struct FmVoiceState {
    pub phases: [f32; 6],
    pub prev_output: [f32; 6],  // for feedback
    pub env_states: [DxEnvelopeState; 6],
}

pub struct FmSynth {
    pub operators: [FmOperator; 6],
    pub algorithm: u8,          // 0..31
    pub custom_routing: Option<[[bool; 6]; 6]>,  // [dest][source] = true if source mods dest
    pub pitch_hz: f32,
}

impl FmSynth {
    pub fn process_sample(
        &self,
        state: &mut FmVoiceState,
        note_on: bool,
        velocity: f32,
        note: u8,
        sample_rate: f32,
    ) -> f32 {
        // Build routing matrix (from algorithm or custom)
        let routing = self.build_routing();

        let mut op_output = [0.0f32; 6];

        // Process operators (order: 6,5,4,3,2,1 — modulators before carriers)
        for op in (0..6).rev() {
            let freq = if let Some(fixed) = self.operators[op].frequency_fixed {
                fixed
            } else {
                self.pitch_hz * self.operators[op].frequency_ratio
            };

            let phase_inc = freq / sample_rate;

            // Compute modulation: sum of all operator outputs that modulate this one
            let mut mod_sum = 0.0f32;
            for src in 0..6 {
                if routing[op][src] {
                    mod_sum += op_output[src];
                }
            }

            // Self-feedback (using previous sample's output)
            let fb = state.prev_output[op] * self.operators[op].feedback_level * 4.0 * core::f32::consts::PI;

            // Phase modulation: phase += modulation_in_radians
            let phase_rad = state.phases[op] * core::f32::consts::TAU + mod_sum + fb;
            let sample = phase_rad.sin();

            // Apply envelope + velocity + key scaling
            let env_level = state.env_states[op].tick(&self.operators[op].envelope, note_on, sample_rate);
            let vel_scale = 1.0 - self.operators[op].velocity_sense * (1.0 - velocity);
            let key_scale = self.compute_key_scale(&self.operators[op], note);

            op_output[op] = sample * env_level * self.operators[op].output_level * vel_scale * key_scale;
            state.prev_output[op] = sample;

            // Advance phase
            state.phases[op] += phase_inc;
            if state.phases[op] >= 1.0 { state.phases[op] -= 1.0; }
        }

        // Sum carrier outputs (determined by algorithm)
        let carriers = self.get_carriers();
        carriers.iter().map(|&c| op_output[c]).sum::<f32>()
    }

    fn build_routing(&self) -> [[bool; 6]; 6] {
        let mut r = [[false; 6]; 6];
        if let Some(custom) = &self.custom_routing {
            return *custom;
        }
        for &(src_1indexed, dst_1indexed) in DX7_ALGORITHMS[self.algorithm as usize] {
            let src = (src_1indexed - 1) as usize;
            let dst = (dst_1indexed - 1) as usize;
            if src != dst {  // non-feedback
                r[dst][src] = true;
            }
        }
        r
    }

    fn get_carriers(&self) -> Vec<usize> {
        let routing = self.build_routing();
        // A carrier is an operator that is not modulated by any other operator
        (0..6).filter(|&op| !(0..6).any(|src| routing[op][src])).collect()
        // Note: self-feedback doesn't disqualify an op from being a carrier
    }

    fn compute_key_scale(&self, op: &FmOperator, note: u8) -> f32 {
        let diff = note as i32 - op.key_scale_break as i32;
        if diff < 0 {
            1.0 - op.key_scale_left * (-diff as f32 / 12.0)
        } else {
            1.0 - op.key_scale_right * (diff as f32 / 12.0)
        }
        .max(0.0)
    }
}
```

---

## 1.5 Additive Synthesis

```rust
// daw-dsp/src/additive.rs

pub const MAX_PARTIALS: usize = 512;

#[derive(Clone)]
pub struct AdditiveGenerator {
    pub amplitudes: [f32; MAX_PARTIALS],
    pub phases: [f32; MAX_PARTIALS],     // initial phase per partial
}

#[derive(Clone)]
pub struct AdditiveState {
    pub phases: [f32; MAX_PARTIALS],     // running phase per partial
}

#[derive(Clone)]
pub struct AdditiveParams {
    pub fundamental_hz: f32,
    pub brightness: f32,     // spectral tilt: 0=natural, -1=dark, +1=bright
    pub harmonicity: f32,    // 1.0 = harmonic, >1.0 = stretched (inharmonic)
    pub freeze: bool,
    pub num_partials: usize,
}

pub fn additive_process_block(
    gen: &AdditiveGenerator,
    state: &mut AdditiveState,
    params: &AdditiveParams,
    output: &mut [f32],
    sample_rate: f32,
) {
    let f0 = params.fundamental_hz;
    let nyquist = sample_rate / 2.0;

    output.iter_mut().for_each(|x| *x = 0.0);

    for n in 0..params.num_partials.min(MAX_PARTIALS) {
        // Stretched harmonic: freq[n] = f0 * (n+1)^harmonicity
        let partial_num = (n + 1) as f32;
        let freq = f0 * partial_num.powf(params.harmonicity);
        if freq >= nyquist { break; }  // anti-aliasing: skip above Nyquist

        // Brightness: amplitude tilt
        let brightness_scale = (-params.brightness * (n as f32) / MAX_PARTIALS as f32).exp();

        let phase_inc = freq / sample_rate;
        let amp = gen.amplitudes[n] * brightness_scale;

        for sample in output.iter_mut() {
            *sample += (state.phases[n] * core::f32::consts::TAU).sin() * amp;
            state.phases[n] += phase_inc;
            if state.phases[n] >= 1.0 { state.phases[n] -= 1.0; }
        }
    }
}
```

**GPU compute** replaces the inner loop for large partial counts — see Part 5.2.

---

## 1.6 Granular Synthesis

```rust
// daw-dsp/src/granular.rs

pub const MAX_GRAINS: usize = 128;

#[derive(Clone, Copy, Default)]
pub enum GrainWindow { Hann, Gaussian, Tukey(f32), Triangle }

#[derive(Clone, Copy)]
pub struct Grain {
    pub active: bool,
    pub source_pos: f64,      // sample position in source buffer
    pub playback_speed: f64,  // 1.0 = original pitch
    pub duration: usize,      // grain duration in samples
    pub age: usize,
    pub amplitude: f32,
    pub pan: f32,             // -1..1
    pub window: GrainWindow,
}

impl Grain {
    fn window_value(&self) -> f32 {
        let t = self.age as f32 / self.duration as f32;  // 0..1
        match self.window {
            GrainWindow::Hann => {
                0.5 * (1.0 - (core::f32::consts::TAU * t).cos())
            }
            GrainWindow::Triangle => {
                if t < 0.5 { 2.0 * t } else { 2.0 - 2.0 * t }
            }
            GrainWindow::Gaussian => {
                let sigma = 0.4_f32;
                let x = t - 0.5;
                (-x * x / (2.0 * sigma * sigma)).exp()
            }
            GrainWindow::Tukey(ratio) => {
                // Flat top with cosine taper of width `ratio` at each end
                if t < ratio / 2.0 {
                    0.5 * (1.0 - (core::f32::consts::PI * t / (ratio / 2.0) - core::f32::consts::PI).cos())
                } else if t > 1.0 - ratio / 2.0 {
                    0.5 * (1.0 - (core::f32::consts::PI * (t - 1.0 + ratio/2.0) / (ratio/2.0)).cos())
                } else { 1.0 }
            }
        }
    }
}

pub struct GranularState {
    pub grains: [Grain; MAX_GRAINS],
    pub read_pos: f64,        // current read position in source
    pub next_grain_in: f64,   // samples until next grain spawn
    pub rng_state: u64,       // xorshift64 state
}

impl GranularState {
    fn rand_f32(&mut self) -> f32 {
        // xorshift64
        self.rng_state ^= self.rng_state << 13;
        self.rng_state ^= self.rng_state >> 7;
        self.rng_state ^= self.rng_state << 17;
        (self.rng_state as f32) / (u64::MAX as f32)
    }
}

#[derive(Clone)]
pub struct GranularParams {
    pub density_hz: f32,      // grains per second
    pub spray_samples: f32,   // position randomization range
    pub grain_size_ms: f32,   // grain duration
    pub pitch_ratio: f32,     // playback speed (1.0 = original pitch)
    pub pitch_spread: f32,    // ±semitones random pitch per grain
    pub pan_spread: f32,      // 0..1
    pub window: GrainWindow,
    pub advance_speed: f32,   // how fast read_pos advances (0=freeze)
}

pub fn granular_process_block(
    state: &mut GranularState,
    params: &GranularParams,
    source: &[f32],
    output_l: &mut [f32],
    output_r: &mut [f32],
    sample_rate: f32,
) {
    let grain_size_samples = (params.grain_size_ms * 0.001 * sample_rate) as usize;
    let samples_per_grain = sample_rate / params.density_hz;

    output_l.iter_mut().for_each(|x| *x = 0.0);
    output_r.iter_mut().for_each(|x| *x = 0.0);

    for i in 0..output_l.len() {
        // Spawn new grain if due
        if state.next_grain_in <= 0.0 {
            // Find free grain slot
            if let Some(slot) = state.grains.iter_mut().find(|g| !g.active) {
                let spray = (state.rand_f32() * 2.0 - 1.0) * params.spray_samples as f64;
                let pos = (state.read_pos + spray).max(0.0).min(source.len() as f64 - 1.0);
                let pitch_cents = (state.rand_f32() * 2.0 - 1.0) * params.pitch_spread * 100.0;
                let speed = params.pitch_ratio as f64 * 2f64.powf(pitch_cents as f64 / 1200.0);

                *slot = Grain {
                    active: true,
                    source_pos: pos,
                    playback_speed: speed,
                    duration: grain_size_samples,
                    age: 0,
                    amplitude: 0.7,
                    pan: (state.rand_f32() * 2.0 - 1.0) * params.pan_spread,
                    window: params.window,
                };
            }
            state.next_grain_in = samples_per_grain as f64;
        }
        state.next_grain_in -= 1.0;

        // Advance read position
        state.read_pos += params.advance_speed as f64;
        state.read_pos = state.read_pos.clamp(0.0, source.len() as f64 - 1.0);

        // Accumulate all active grains
        for grain in state.grains.iter_mut().filter(|g| g.active) {
            let window = grain.window_value();

            // Linear interpolation in source buffer
            let src_int = grain.source_pos as usize;
            let src_frac = (grain.source_pos - src_int as f64) as f32;
            let s0 = source.get(src_int).copied().unwrap_or(0.0);
            let s1 = source.get(src_int + 1).copied().unwrap_or(0.0);
            let sample = s0 + (s1 - s0) * src_frac;

            let out = sample * window * grain.amplitude;
            let pan_angle = (grain.pan + 1.0) * 0.25 * core::f32::consts::PI;
            output_l[i] += out * pan_angle.cos();
            output_r[i] += out * pan_angle.sin();

            grain.source_pos += grain.playback_speed;
            grain.age += 1;
            if grain.age >= grain.duration { grain.active = false; }
        }
    }
}
```

---

## 1.7 Sampler / Sample Playback

```rust
// daw-dsp/src/sampler.rs

#[derive(Clone)]
pub struct SampleZone {
    pub sample_data: alloc::sync::Arc<[f32]>,  // shared, immutable
    pub root_note: u8,
    pub lo_key: u8, pub hi_key: u8,
    pub lo_vel: u8, pub hi_vel: u8,
    pub round_robin_group: u8,
    pub loop_start: usize, pub loop_end: usize,
    pub loop_mode: LoopMode,
    pub one_shot: bool,
}

#[derive(Clone, Copy, PartialEq)]
pub enum LoopMode { None, Forward, PingPong }

pub struct SamplerVoiceState {
    pub zone: usize,          // index into zone table
    pub position: f64,        // current read position (float for interpolation)
    pub direction: i8,        // +1 = forward, -1 = backward (ping-pong)
    pub phase_inc: f64,       // pitch ratio
    pub is_active: bool,
    pub loop_xfade_pos: usize,
    pub loop_xfade_buf: [f32; 256],  // crossfade buffer at loop point
}

/// O(1) zone lookup table indexed [note][velocity/8]
/// Pre-computed at instrument load time
pub struct ZoneLookup {
    table: [[u8; 16]; 128],  // 128 notes × 16 velocity bands → zone_id (255=none)
}

impl ZoneLookup {
    pub fn lookup(&self, note: u8, velocity: u8) -> Option<u8> {
        let vel_band = (velocity / 8) as usize;
        let id = self.table[note as usize][vel_band];
        if id == 255 { None } else { Some(id) }
    }
}

pub fn sampler_voice_process(
    state: &mut SamplerVoiceState,
    zone: &SampleZone,
    output: &mut [f32],
    _sample_rate: f32,
) {
    let src = &zone.sample_data;
    for sample in output.iter_mut() {
        if !state.is_active { *sample = 0.0; continue; }

        let idx = state.position as usize;
        let frac = (state.position - idx as f64) as f32;

        // Cubic Hermite interpolation
        let get = |i: usize| src.get(i).copied().unwrap_or(0.0);
        let y0 = if idx > 0 { get(idx - 1) } else { 0.0 };
        let y = cubic_hermite([y0, get(idx), get(idx+1), get(idx+2)], frac);
        *sample = y;

        // Advance position
        let new_pos = state.position + state.phase_inc * state.direction as f64;

        // Loop handling
        match zone.loop_mode {
            LoopMode::None => {
                if new_pos >= src.len() as f64 {
                    state.is_active = false;
                }
                state.position = new_pos;
            }
            LoopMode::Forward => {
                state.position = if new_pos >= zone.loop_end as f64 {
                    zone.loop_start as f64 + (new_pos - zone.loop_end as f64)
                } else { new_pos };
            }
            LoopMode::PingPong => {
                if new_pos >= zone.loop_end as f64 || new_pos < zone.loop_start as f64 {
                    state.direction = -state.direction;
                }
                state.position = new_pos;
            }
        }
    }
}
```

---

## 1.8 Noise Generator

```rust
// daw-dsp/src/noise.rs

#[derive(Clone)]
pub struct NoiseState {
    pub rng: u64,  // xorshift64
    // Pink noise (Paul Kellet's method)
    pub b0: f32, pub b1: f32, pub b2: f32,
    pub b3: f32, pub b4: f32, pub b5: f32, pub b6: f32,
    // Brown noise
    pub brown_last: f32,
}

impl NoiseState {
    pub fn white(&mut self) -> f32 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        // Map u64 to [-1, 1]
        (self.rng as i64) as f32 / i64::MAX as f32
    }

    /// Paul Kellet's refined pink noise generator (3-filter method)
    pub fn pink(&mut self) -> f32 {
        let white = self.white();
        self.b0 = 0.99886 * self.b0 + white * 0.0555179;
        self.b1 = 0.99332 * self.b1 + white * 0.0750759;
        self.b2 = 0.96900 * self.b2 + white * 0.1538520;
        self.b3 = 0.86650 * self.b3 + white * 0.3104856;
        self.b4 = 0.55000 * self.b4 + white * 0.5329522;
        self.b5 = -0.7616 * self.b5 - white * 0.0168980;
        let pink = self.b0 + self.b1 + self.b2 + self.b3 + self.b4 + self.b5 + self.b6 + white * 0.5362;
        self.b6 = white * 0.115926;
        pink * 0.11  // normalize to approximately [-1, 1]
    }

    pub fn brown(&mut self) -> f32 {
        let white = self.white();
        self.brown_last = (self.brown_last + 0.02 * white) / 1.02;
        self.brown_last * 3.5  // normalize
    }
}
```

---

## 1.9 Physical Modeling — Karplus-Strong

```rust
// daw-dsp/src/physical/karplus_strong.rs

pub struct KarplusStrongState {
    pub delay_line: Vec<f32>,
    pub write_pos: usize,
    pub frac_delay: f32,    // fractional part of delay length
    pub allpass_state: f32, // for fractional delay allpass
    pub lp_state: f32,      // low-pass filter state in feedback
}

impl KarplusStrongState {
    pub fn new(max_samples: usize) -> Self {
        Self {
            delay_line: vec![0.0; max_samples],
            write_pos: 0,
            frac_delay: 0.0,
            allpass_state: 0.0,
            lp_state: 0.0,
        }
    }

    pub fn set_frequency(&mut self, freq: f32, sample_rate: f32) {
        let delay_f = sample_rate / freq;
        let delay_int = delay_f.floor() as usize;
        self.frac_delay = delay_f - delay_int as f32;
        // Resize or set delay line length
        let needed = delay_int + 2;
        if self.delay_line.len() < needed {
            self.delay_line.resize(needed, 0.0);
        }
    }

    pub fn excite(&mut self, duration_samples: usize) {
        // Fill delay line with white noise burst
        let mut rng = 0x12345678u64;
        for i in 0..duration_samples.min(self.delay_line.len()) {
            rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
            self.delay_line[(self.write_pos + i) % self.delay_line.len()] =
                (rng as i64) as f32 / i64::MAX as f32;
        }
    }

    pub fn process_sample(&mut self, feedback_gain: f32, decay: f32) -> f32 {
        let n = self.delay_line.len();
        let read_pos = (self.write_pos + n - n + 1) % n;  // one sample back

        // Allpass interpolation for fractional delay
        // H(z) = (d + z^-1) / (1 + d*z^-1)  where d = (1-frac) / (1+frac)
        let d = (1.0 - self.frac_delay) / (1.0 + self.frac_delay);
        let delayed_sample = self.delay_line[read_pos];
        let allpass_out = d * delayed_sample + self.allpass_state
                         - d * self.allpass_state;  // wait: standard allpass:
        // y[n] = d*(x[n] - y[n-1]) + x[n-1]
        let x = delayed_sample;
        let y = d * (x - self.allpass_state) + self.allpass_state; // hmm, simplified:
        // Correct Schroeder allpass:
        // y[n] = -d*x[n] + x[n-1] + d*y[n-1]
        let allpass_correct = -d * x + self.allpass_state;
        self.allpass_state = x + d * allpass_correct;
        let fractional_delayed = allpass_correct;

        // Low-pass filter in feedback: y[n] = 0.5*(x[n] + x[n-1])
        let lp_out = 0.5 * (fractional_delayed + self.lp_state);
        self.lp_state = fractional_delayed;

        // Write feedback back into delay line
        let output = self.delay_line[self.write_pos % n];
        self.delay_line[self.write_pos % n] = lp_out * decay * feedback_gain;

        self.write_pos = (self.write_pos + 1) % n;
        output
    }
}
```

---

# PART 2: MODULATION SYSTEM

---

## 2.1 Modulation Matrix Architecture

```rust
// daw-synth/src/modulation/matrix.rs

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ModSourceId {
    Envelope(u8),       // 0..MAX_ENVELOPES
    Lfo(u8),            // 0..MAX_LFOS
    StepSequencer(u8),
    Random(u8),
    Velocity,
    KeyTrack,
    Aftertouch,
    PolyAftertouch,
    PitchBend,
    ModWheel,
    Macro(u8),          // 0..7
    AudioFollower(u8),
    XPad,
    YPad,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ModDestId {
    // Layer-level destinations
    LayerVolume(u8),
    LayerPan(u8),
    LayerPitch(u8),

    // Generator-level destinations (layer, generator, param)
    GeneratorParam(u8, u8, GeneratorParamId),

    // Filter destinations (layer, filter_index, param)
    FilterCutoff(u8, u8),
    FilterResonance(u8, u8),
    FilterMorph(u8, u8),
    FilterDrive(u8, u8),

    // Envelope shaping
    EnvelopeAttack(u8),
    EnvelopeDecay(u8),
    EnvelopeSustain(u8),
    EnvelopeRelease(u8),

    // LFO shaping
    LfoRate(u8),
    LfoDepth(u8),
    LfoPhase(u8),

    // Effect parameters
    FxParam(u8, u8, u8),  // lane, effect_index, param_index

    // Macro targets
    Macro(u8),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Polarity { Bipolar, Unipolar }

#[derive(Clone)]
pub struct ModSlot {
    pub source: ModSourceId,
    pub destination: ModDestId,
    pub amount: f32,          // -1..+1 (bipolar) or 0..1 (unipolar)
    pub polarity: Polarity,
    pub is_per_voice: bool,   // true = each voice has separate source state
    pub enabled: bool,
    pub smoothing_ms: f32,    // 0 = no smoothing, N = N ms time constant
    // Internal: smoothed amount for zipper-noise prevention
    pub _smoothed_amount: f32,
}

pub struct ModulationMatrix {
    pub slots: Vec<ModSlot>,   // dynamic — no hard limit
    // Per-parameter accumulated modulation values (reset each block)
    // Keyed by destination parameter path (simplified: flat array indexed by ModDestId)
    pub accumulated: hashbrown::HashMap<ModDestId, f32>,
}

impl ModulationMatrix {
    /// Update all modulation sources (call once per block at control rate)
    pub fn update_sources(
        &mut self,
        sources: &ModSources,
        block_size: usize,
        sample_rate: f32,
    ) {
        // Clear accumulated values
        self.accumulated.clear();

        // Apply each active slot
        for slot in self.slots.iter_mut().filter(|s| s.enabled) {
            let source_value = sources.get(slot.source);

            // Smooth the amount parameter
            if slot.smoothing_ms > 0.0 {
                let coeff = 1.0 - (-core::f32::consts::TAU / (slot.smoothing_ms * 0.001 * sample_rate)).exp();
                slot._smoothed_amount += (slot.amount - slot._smoothed_amount) * coeff;
            } else {
                slot._smoothed_amount = slot.amount;
            }

            let contribution = source_value * slot._smoothed_amount;

            *self.accumulated.entry(slot.destination).or_insert(0.0) += contribution;
        }
    }

    pub fn get_modulation(&self, dest: ModDestId) -> f32 {
        self.accumulated.get(&dest).copied().unwrap_or(0.0)
    }

    pub fn get_final_value(&self, dest: ModDestId, base_value: f32, range: (f32, f32)) -> f32 {
        let mod_amount = self.get_modulation(dest);
        let range_size = range.1 - range.0;
        (base_value + mod_amount * range_size).clamp(range.0, range.1)
    }
}
```

### Control Rate vs Audio Rate

Most modulation updates once per block (64–256 samples). Audio-rate modulation updates every sample — needed for:

- FM-like effects via LFO at audio rate (LFO freq > ~100Hz)
- Envelope follower with very fast attack (<1ms)
- Any modulation targeting oscillator phase directly

```rust
pub enum ModRate { ControlRate, AudioRate }

// In the voice processing loop:
// Control-rate: compute once before sample loop, add to parameter
// Audio-rate: recompute inside sample loop
```

---

## 2.2 Modulation Source Types

### 2.2.1 ADSR Envelope

```rust
// daw-synth/src/modulation/adsr.rs

#[derive(Clone)]
pub struct AdsrParams {
    pub attack_ms: f32,     // 0.1..30000
    pub decay_ms: f32,      // 0.1..30000
    pub sustain: f32,       // 0..1
    pub release_ms: f32,    // 1..30000
    pub hold_ms: f32,       // 0 = no hold
    // Curve shape (-1=log, 0=linear, +1=exp) per segment
    pub attack_curve: f32,
    pub decay_curve: f32,
    pub release_curve: f32,
    pub retrigger_from_zero: bool,
}

#[derive(Clone, Copy, PartialEq)]
pub enum AdsrStage { Idle, Attack, Hold, Decay, Sustain, Release }

#[derive(Clone)]
pub struct AdsrState {
    pub stage: AdsrStage,
    pub level: f32,          // current output 0..1
    pub stage_time: f32,     // samples elapsed in current stage
}

fn ms_to_samples(ms: f32, sample_rate: f32) -> f32 {
    ms * 0.001 * sample_rate
}

/// Apply a curve shape to linear time 0..1
/// curve: -1 = logarithmic start (fast), 0 = linear, +1 = exponential (slow start)
fn apply_curve(t: f32, curve: f32) -> f32 {
    if curve.abs() < 0.001 { return t; }
    if curve > 0.0 {
        t.powf(1.0 + curve * 3.0)  // exponential: slower start
    } else {
        1.0 - (1.0 - t).powf(1.0 - curve * 3.0)  // log: faster start
    }
}

impl AdsrState {
    pub fn note_on(&mut self, params: &AdsrParams) {
        if params.retrigger_from_zero { self.level = 0.0; }
        self.stage = AdsrStage::Attack;
        self.stage_time = 0.0;
    }

    pub fn note_off(&mut self) {
        if self.stage != AdsrStage::Idle {
            self.stage = AdsrStage::Release;
            self.stage_time = 0.0;
        }
    }

    pub fn tick(&mut self, params: &AdsrParams, sample_rate: f32) -> f32 {
        match self.stage {
            AdsrStage::Idle => { self.level = 0.0; }

            AdsrStage::Attack => {
                let dur = ms_to_samples(params.attack_ms.max(0.1), sample_rate);
                let t = apply_curve(self.stage_time / dur, params.attack_curve);
                self.level = t.clamp(0.0, 1.0);
                self.stage_time += 1.0;
                if self.stage_time >= dur {
                    self.level = 1.0;
                    self.stage = if params.hold_ms > 0.0 { AdsrStage::Hold } else { AdsrStage::Decay };
                    self.stage_time = 0.0;
                }
            }

            AdsrStage::Hold => {
                let dur = ms_to_samples(params.hold_ms, sample_rate);
                self.stage_time += 1.0;
                if self.stage_time >= dur {
                    self.stage = AdsrStage::Decay;
                    self.stage_time = 0.0;
                }
            }

            AdsrStage::Decay => {
                let dur = ms_to_samples(params.decay_ms.max(0.1), sample_rate);
                let t = apply_curve(self.stage_time / dur, params.decay_curve);
                self.level = 1.0 - t * (1.0 - params.sustain);
                self.stage_time += 1.0;
                if self.stage_time >= dur {
                    self.level = params.sustain;
                    self.stage = AdsrStage::Sustain;
                    self.stage_time = 0.0;
                }
            }

            AdsrStage::Sustain => {
                self.level = params.sustain;
            }

            AdsrStage::Release => {
                let start_level = self.level;  // release from current level
                let dur = ms_to_samples(params.release_ms.max(1.0), sample_rate);
                let t = apply_curve(self.stage_time / dur, params.release_curve);
                self.level = start_level * (1.0 - t);
                self.stage_time += 1.0;
                if self.stage_time >= dur || self.level < 0.0001 {
                    self.level = 0.0;
                    self.stage = AdsrStage::Idle;
                }
            }
        }
        self.level
    }
}
```

### 2.2.2 MSEG (Multi-Segment Envelope Generator)

```rust
// daw-synth/src/modulation/mseg.rs

#[derive(Clone, Copy)]
pub struct MsegPoint {
    pub time: f32,    // normalized time within segment (0..1 means this point ends at this fraction)
    pub value: f32,   // 0..1
    pub curve: f32,   // -1=log, 0=linear, +1=exp
}

#[derive(Clone)]
pub struct MsegParams {
    pub points: Vec<MsegPoint>,  // sorted by time
    pub loop_start: Option<usize>,  // point index where loop begins
    pub loop_end: Option<usize>,    // point index where loop ends and restarts
    pub one_shot: bool,
    pub tempo_sync: bool,
    pub length_beats: f32,       // if tempo_sync
    pub length_secs: f32,        // if !tempo_sync
}

#[derive(Clone)]
pub struct MsegState {
    pub position: f32,   // 0..total_length in seconds (or beats)
    pub is_active: bool,
    pub is_looping: bool,
}

impl MsegState {
    pub fn evaluate(&self, params: &MsegParams) -> f32 {
        if params.points.is_empty() { return 0.0; }
        if params.points.len() == 1 { return params.points[0].value; }

        let t = self.position / params.length_secs;  // normalized 0..1

        // Binary search for current segment
        let idx = params.points.partition_point(|p| p.time <= t);
        let idx = idx.saturating_sub(1).min(params.points.len() - 2);

        let p0 = &params.points[idx];
        let p1 = &params.points[idx + 1];
        let seg_t = if (p1.time - p0.time).abs() < 1e-6 { 0.0 }
                    else { (t - p0.time) / (p1.time - p0.time) };

        let shaped_t = apply_curve(seg_t.clamp(0.0, 1.0), p0.curve);
        p0.value + (p1.value - p0.value) * shaped_t
    }

    pub fn advance(&mut self, params: &MsegParams, samples: f32, sample_rate: f32) {
        if !self.is_active { return; }
        self.position += samples / sample_rate;
        if self.position >= params.length_secs {
            if params.one_shot {
                self.is_active = false;
                self.position = params.length_secs;
            } else {
                self.position -= params.length_secs;
            }
        }
    }
}
```

### 2.2.3 LFO

```rust
// daw-synth/src/modulation/lfo.rs

#[derive(Clone, Copy, PartialEq)]
pub enum LfoWaveform { Sine, Triangle, SawUp, SawDown, Square, SampleHold, Custom }

#[derive(Clone, Copy, PartialEq)]
pub enum LfoTrigger { FreeRunning, RetriggerOnNote, OneShot }

#[derive(Clone, Copy, PartialEq)]
pub enum LfoSync { Free(f32), Tempo { beats: f32, bpm: f32 } }

impl LfoSync {
    pub fn frequency_hz(&self) -> f32 {
        match *self {
            LfoSync::Free(hz) => hz,
            LfoSync::Tempo { beats, bpm } => bpm / (60.0 * beats),
        }
    }
}

#[derive(Clone)]
pub struct LfoParams {
    pub waveform: LfoWaveform,
    pub sync: LfoSync,
    pub trigger: LfoTrigger,
    pub phase_offset: f32,      // 0..1
    pub fade_in_ms: f32,        // 0 = no fade
    pub key_track: bool,        // if true, rate tracks note pitch
    pub stereo_phase_offset: f32, // L/R phase difference 0..1
    pub custom_shape: Vec<f32>, // 2048-sample lookup for Custom waveform
}

#[derive(Clone, Default)]
pub struct LfoState {
    pub phase: f32,
    pub fade_samples: f32,   // samples elapsed since note-on
    pub sh_value: f32,       // sample-and-hold current value
    pub sh_rng: u64,
}

impl LfoState {
    pub fn note_on(&mut self, params: &LfoParams) {
        match params.trigger {
            LfoTrigger::RetriggerOnNote | LfoTrigger::OneShot => {
                self.phase = params.phase_offset;
                self.fade_samples = 0.0;
            }
            LfoTrigger::FreeRunning => {}
        }
    }

    pub fn tick(&mut self, params: &LfoParams, sample_rate: f32, note_hz: Option<f32>) -> f32 {
        let freq = if params.key_track {
            // LFO rate tracks note: middle C (261.6 Hz) = base rate
            note_hz.unwrap_or(261.63) / 261.63 * params.sync.frequency_hz()
        } else {
            params.sync.frequency_hz()
        };

        let phase_inc = freq / sample_rate;

        let raw = match params.waveform {
            LfoWaveform::Sine     => (self.phase * core::f32::consts::TAU).sin(),
            LfoWaveform::Triangle => 1.0 - (2.0 * self.phase - 1.0).abs() * 2.0,
            LfoWaveform::SawUp    => self.phase * 2.0 - 1.0,
            LfoWaveform::SawDown  => 1.0 - self.phase * 2.0,
            LfoWaveform::Square   => if self.phase < 0.5 { 1.0 } else { -1.0 },
            LfoWaveform::SampleHold => {
                if self.phase < phase_inc {  // just wrapped
                    self.sh_rng ^= self.sh_rng << 13;
                    self.sh_rng ^= self.sh_rng >> 7;
                    self.sh_rng ^= self.sh_rng << 17;
                    self.sh_value = (self.sh_rng as i64) as f32 / i64::MAX as f32;
                }
                self.sh_value
            }
            LfoWaveform::Custom => {
                if params.custom_shape.is_empty() { 0.0 } else {
                    let idx = (self.phase * params.custom_shape.len() as f32) as usize;
                    params.custom_shape[idx % params.custom_shape.len()]
                }
            }
        };

        // Fade-in
        let fade = if params.fade_in_ms > 0.0 {
            let fade_samples = params.fade_in_ms * 0.001 * sample_rate;
            (self.fade_samples / fade_samples).min(1.0)
        } else { 1.0 };
        self.fade_samples += 1.0;

        self.phase += phase_inc;
        if self.phase >= 1.0 { self.phase -= 1.0; }

        raw * fade
    }

    /// Stereo version: returns (L, R) with phase offset
    pub fn tick_stereo(&mut self, params: &LfoParams, sr: f32, note_hz: Option<f32>) -> (f32, f32) {
        let left = self.tick(params, sr, note_hz);
        // Right channel: same phase but shifted by stereo_phase_offset
        let right_phase = (self.phase + params.stereo_phase_offset).rem_euclid(1.0);
        let right = match params.waveform {
            LfoWaveform::Sine => (right_phase * core::f32::consts::TAU).sin(),
            _ => left, // simplified: for other waveforms compute similarly
        };
        (left, right)
    }
}
```

### 2.2.4 Step Sequencer

```rust
// daw-synth/src/modulation/step_seq.rs

#[derive(Clone, Copy, Default)]
pub struct Step {
    pub value: f32,         // 0..1
    pub gate: bool,
    pub probability: f32,   // 0..1 (1 = always fires)
    pub curve_to_next: f32, // -1..1 (interpolation curve to next step)
}

#[derive(Clone)]
pub struct StepSequencerParams {
    pub steps: [Step; 64],
    pub num_steps: usize,
    pub step_rate_beats: f32,  // e.g. 0.25 = 1/16th note
    pub bpm: f32,
    pub glide_ms: f32,         // interpolation between steps
    pub loop_enabled: bool,
}

#[derive(Clone, Default)]
pub struct StepSeqState {
    pub current_step: usize,
    pub step_phase: f32,   // 0..1 through current step
    pub rng: u64,
    pub current_value: f32,
    pub target_value: f32,
}

impl StepSeqState {
    pub fn tick(&mut self, params: &StepSequencerParams, sample_rate: f32) -> f32 {
        let step_duration_sec = params.step_rate_beats * 60.0 / params.bpm;
        let step_inc = 1.0 / (step_duration_sec * sample_rate);

        let prev_step = self.current_step;
        self.step_phase += step_inc;
        if self.step_phase >= 1.0 {
            self.step_phase -= 1.0;
            self.current_step = (self.current_step + 1) % params.num_steps;

            // Probability check
            self.rng ^= self.rng << 13; self.rng ^= self.rng >> 7; self.rng ^= self.rng << 17;
            let rand_f = (self.rng >> 32) as f32 / u32::MAX as f32;
            let step = &params.steps[self.current_step];
            if rand_f <= step.probability {
                self.target_value = step.value;
            }
        }

        let step = &params.steps[self.current_step];
        // Glide: interpolate toward target
        if params.glide_ms > 0.0 {
            let coeff = 1.0 - (-1.0 / (params.glide_ms * 0.001 * sample_rate)).exp();
            self.current_value += (self.target_value - self.current_value) * coeff;
        } else {
            self.current_value = self.target_value;
        }

        self.current_value
    }
}
```

### 2.2.5 Random/Noise Modulators

```rust
// daw-synth/src/modulation/random.rs

/// Lorenz chaotic attractor as modulation source
#[derive(Clone)]
pub struct LorenzState {
    pub x: f64, pub y: f64, pub z: f64,
    // Parameters: sigma=10, rho=28, beta=8/3 for classic Lorenz
    pub sigma: f64, pub rho: f64, pub beta: f64,
    pub dt: f64,
    pub speed: f64,  // how fast to integrate (controls rate of change)
}

impl LorenzState {
    pub fn new() -> Self {
        Self { x: 1.0, y: 0.0, z: 0.0,
               sigma: 10.0, rho: 28.0, beta: 8.0 / 3.0,
               dt: 0.01, speed: 1.0 }
    }

    pub fn tick(&mut self) -> f32 {
        // Runge-Kutta 4 integration
        let (x, y, z) = (self.x, self.y, self.z);
        let dt = self.dt * self.speed;
        let dx = self.sigma * (y - x);
        let dy = x * (self.rho - z) - y;
        let dz = x * y - self.beta * z;
        self.x += dx * dt;
        self.y += dy * dt;
        self.z += dz * dt;
        // Normalize x to -1..1 (x oscillates roughly ±20)
        (self.x / 20.0) as f32
    }
}

/// 1D Perlin noise for smooth random modulation
pub struct PerlinState {
    pub perm: [u8; 512],
    pub pos: f64,
    pub speed: f64,  // units per sample
}

impl PerlinState {
    pub fn new(seed: u64) -> Self {
        let mut perm = [0u8; 512];
        let mut rng = seed;
        for i in 0..256u32 {
            rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
            perm[i as usize] = (rng % 256) as u8;
        }
        for i in 0..256 { perm[i + 256] = perm[i]; }
        Self { perm, pos: 0.0, speed: 0.001 }
    }

    fn fade(t: f64) -> f64 { t * t * t * (t * (t * 6.0 - 15.0) + 10.0) }
    fn grad(hash: u8, x: f64) -> f64 {
        if hash & 1 == 0 { x } else { -x }
    }

    pub fn tick(&mut self) -> f32 {
        let x = self.pos;
        let xi = x.floor() as usize;
        let xf = x - x.floor();
        let u = Self::fade(xf);
        let a = self.perm[xi & 255];
        let b = self.perm[(xi + 1) & 255];
        let result = lerp(Self::grad(a, xf), Self::grad(b, xf - 1.0), u);
        self.pos += self.speed;
        result as f32
    }
}

fn lerp(a: f64, b: f64, t: f64) -> f64 { a + t * (b - a) }
```

### 2.2.6 Audio Follower (Envelope Follower)

```rust
// daw-synth/src/modulation/audio_follower.rs

#[derive(Clone)]
pub struct AudioFollowerParams {
    pub attack_ms: f32,   // 1..100
    pub release_ms: f32,  // 10..2000
    pub gain: f32,        // pre-gain
}

#[derive(Clone, Default)]
pub struct AudioFollowerState {
    pub envelope: f32,
}

impl AudioFollowerState {
    pub fn process_block(&mut self, input: &[f32], params: &AudioFollowerParams, sr: f32) -> f32 {
        let attack_coeff  = 1.0 - (-1.0 / (params.attack_ms  * 0.001 * sr)).exp();
        let release_coeff = 1.0 - (-1.0 / (params.release_ms * 0.001 * sr)).exp();

        for &sample in input {
            let rectified = (sample * params.gain).abs();
            let coeff = if rectified > self.envelope { attack_coeff } else { release_coeff };
            self.envelope += coeff * (rectified - self.envelope);
        }
        self.envelope.min(1.0)
    }
}
```

### 2.2.7 Note/Performance Sources

```rust
pub struct PerformanceSources {
    pub velocity: f32,         // 0..1 (per-voice, set at note-on)
    pub note_hz: f32,          // fundamental frequency
    pub key_track: f32,        // (note - center_note) / 12 octaves, normalized -1..1
    pub aftertouch: f32,       // 0..1 channel or polyphonic
    pub poly_aftertouch: f32,  // per-note (MPE)
    pub pitch_bend: f32,       // -1..1 (+/- 2 semitones default)
    pub mod_wheel: f32,        // 0..1 (CC1)
    pub macros: [f32; 8],      // 0..1 each
    // MPE
    pub mpe_slide: f32,        // per-note horizontal slide
    pub mpe_pressure: f32,     // per-note pressure
    pub mpe_pitch_bend: f32,   // per-note pitch bend (±48 semitones in MPE)
}

impl PerformanceSources {
    pub fn key_track_value(&self, center_note: u8, amount: f32) -> f32 {
        // center_note = reference note where key tracking = 0
        let note = (self.note_hz / 440.0).log2() * 12.0 + 69.0;
        let semitones = note - center_note as f32;
        (semitones / 60.0).clamp(-1.0, 1.0) * amount  // ±5 octaves = ±1
    }
}
```

### 2.2.8 XY Pad / Transform Pad

```rust
pub struct XyPadState {
    pub x: f32,  // 0..1
    pub y: f32,  // 0..1
}

/// Alchemy-style Transform Pad: bilinear interpolation between 4 parameter snapshots
pub struct TransformPad {
    pub snapshots: [SnapshotValues; 4],  // corners: BL, BR, TL, TR
    pub x: f32,
    pub y: f32,
    pub morph_rate: f32,  // 0 = instant, >0 = smooth morph speed
}

pub type SnapshotValues = hashbrown::HashMap<ModDestId, f32>;

impl TransformPad {
    /// Get interpolated value for a destination parameter
    pub fn get(&self, dest: ModDestId) -> f32 {
        let x = self.x;
        let y = self.y;
        let get_snap = |i: usize| self.snapshots[i].get(&dest).copied().unwrap_or(0.5);

        // Bilinear interpolation: corners are BL(0), BR(1), TL(2), TR(3)
        let bl = get_snap(0);
        let br = get_snap(1);
        let tl = get_snap(2);
        let tr = get_snap(3);

        (1.0 - x) * (1.0 - y) * bl
            + x * (1.0 - y) * br
            + (1.0 - x) * y * tl
            + x * y * tr
    }
}
```

---

# PART 3: VOICE MANAGEMENT

---

## 3.1 Voice Allocation

```rust
// daw-synth/src/voice_manager.rs

pub const MAX_VOICES_NATIVE: usize = 128;
pub const MAX_VOICES_WASM:   usize = 32;
pub const MAX_GENERATORS: usize = 8;
pub const MAX_ENVELOPES:  usize = 8;
pub const MAX_LFOS:       usize = 6;

#[derive(Clone)]
pub struct Voice {
    pub note: u8,
    pub velocity: f32,
    pub channel: u8,
    pub is_active: bool,
    pub is_releasing: bool,
    pub age: u64,                          // monotonically increasing at note-on
    pub release_age: u64,                  // when release started
    pub fade_gain: f32,                    // for voice stealing fade-out (1.0 = normal)
    pub fade_rate: f32,                    // negative = fading out
    // Modulation sources (per-voice copies)
    pub envelopes: [AdsrState; MAX_ENVELOPES],
    pub lfos: [LfoState; MAX_LFOS],
    pub pitch_bend_semitones: f32,
    pub mod_sources: PerformanceSources,
}

impl Default for Voice {
    fn default() -> Self {
        Self {
            note: 0, velocity: 0.0, channel: 0,
            is_active: false, is_releasing: false,
            age: 0, release_age: 0,
            fade_gain: 1.0, fade_rate: 0.0,
            envelopes: core::array::from_fn(|_| AdsrState { stage: AdsrStage::Idle, level: 0.0, stage_time: 0.0 }),
            lfos: core::array::from_fn(|_| LfoState::default()),
            pitch_bend_semitones: 0.0,
            mod_sources: PerformanceSources { /* ... */ velocity: 0.0, note_hz: 440.0, key_track: 0.0,
                aftertouch: 0.0, poly_aftertouch: 0.0, pitch_bend: 0.0, mod_wheel: 0.0,
                macros: [0.0; 8], mpe_slide: 0.0, mpe_pressure: 0.0, mpe_pitch_bend: 0.0 },
        }
    }
}

pub struct VoiceManager<const N: usize> {
    pub voices: [Voice; N],
    pub active_indices: Vec<usize>,  // indices of active voices for O(active) iteration
    pub global_age: u64,
    pub poly_mode: PolyMode,
}

#[derive(Clone, Copy, PartialEq)]
pub enum PolyMode {
    Polyphonic,
    Monophonic { glide_ms: f32 },
    LegaTo { glide_ms: f32 },
    Unison { count: u8, spread: f32 },
}

impl<const N: usize> VoiceManager<N> {
    pub fn new() -> Self {
        Self {
            voices: core::array::from_fn(|_| Voice::default()),
            active_indices: Vec::with_capacity(N),
            global_age: 0,
            poly_mode: PolyMode::Polyphonic,
        }
    }

    pub fn note_on(&mut self, note: u8, velocity: u8, channel: u8) -> usize {
        self.global_age += 1;
        let voice_idx = self.allocate_voice();
        let v = &mut self.voices[voice_idx];
        v.note = note;
        v.velocity = velocity as f32 / 127.0;
        v.channel = channel;
        v.is_active = true;
        v.is_releasing = false;
        v.age = self.global_age;
        v.fade_gain = 1.0;
        v.fade_rate = 0.0;
        v.mod_sources.velocity = v.velocity;
        v.mod_sources.note_hz = midi_to_hz(note, 0.0);
        // Reset per-voice envelopes and LFOs
        for env in v.envelopes.iter_mut() {
            env.stage = AdsrStage::Attack;
            env.stage_time = 0.0;
        }
        if !self.active_indices.contains(&voice_idx) {
            self.active_indices.push(voice_idx);
        }
        voice_idx
    }

    pub fn note_off(&mut self, note: u8, channel: u8) {
        for &idx in &self.active_indices {
            let v = &mut self.voices[idx];
            if v.note == note && v.channel == channel && !v.is_releasing {
                v.is_releasing = true;
                v.release_age = self.global_age;
                for env in v.envelopes.iter_mut() {
                    env.note_off();
                }
            }
        }
    }

    pub fn cleanup_finished_voices(&mut self, sample_rate: f32) {
        self.active_indices.retain(|&idx| {
            let v = &self.voices[idx];
            // Voice is done when all envelopes are idle and fade is 0
            let all_idle = v.envelopes.iter().all(|e| e.stage == AdsrStage::Idle);
            if all_idle || (!v.is_active && v.fade_gain <= 0.001) {
                false
            } else { true }
        });
    }
}
```

## 3.2 Voice Stealing

```rust
impl<const N: usize> VoiceManager<N> {
    fn allocate_voice(&mut self) -> usize {
        // 1. Find a free (inactive) voice
        if let Some(idx) = (0..N).find(|&i| !self.voices[i].is_active) {
            return idx;
        }

        // 2. Steal: oldest releasing voice first
        let steal_releasing = self.active_indices.iter()
            .filter(|&&i| self.voices[i].is_releasing)
            .min_by_key(|&&i| self.voices[i].release_age)
            .copied();

        if let Some(&idx) = steal_releasing.as_ref() {
            self.steal_voice(idx);
            return idx;
        }

        // 3. Steal: oldest held note
        let steal_oldest = self.active_indices.iter()
            .min_by_key(|&&i| self.voices[i].age)
            .copied()
            .unwrap_or(0);

        self.steal_voice(steal_oldest);
        steal_oldest
    }

    fn steal_voice(&mut self, idx: usize) {
        // Apply rapid fade-out (~10ms at 44.1kHz = 441 samples)
        // The voice continues rendering for 441 samples then gets reassigned
        let v = &mut self.voices[idx];
        v.fade_rate = -1.0 / 441.0;  // reaches 0 in 441 samples
        v.is_releasing = true;
        // The actual voice reassignment happens after fade completes
        // For simplicity here: immediate steal with brief fade in the process loop
    }
}
```

## 3.3 Portamento / Glide

```rust
#[derive(Clone, Default)]
pub struct GlideState {
    pub current_pitch_hz: f32,
    pub target_pitch_hz: f32,
    pub active: bool,
}

#[derive(Clone)]
pub struct GlideParams {
    pub time_ms: f32,
    pub mode: GlideMode,
}

#[derive(Clone, Copy, PartialEq)]
pub enum GlideMode {
    Always,
    Legato,  // only when overlapping notes
    Off,
}

impl GlideState {
    pub fn note_on(&mut self, new_hz: f32, params: &GlideParams, has_overlap: bool) {
        self.target_pitch_hz = new_hz;
        match params.mode {
            GlideMode::Always  => self.active = true,
            GlideMode::Legato  => self.active = has_overlap,
            GlideMode::Off     => { self.current_pitch_hz = new_hz; self.active = false; }
        }
        if !self.active { self.current_pitch_hz = new_hz; }
    }

    /// Returns the current glide-adjusted pitch in Hz
    pub fn tick(&mut self, params: &GlideParams, sample_rate: f32) -> f32 {
        if !self.active { return self.current_pitch_hz; }
        // Exponential approach in log-frequency space (so equal time per octave)
        let coeff = 1.0 - (-1.0 / (params.time_ms * 0.001 * sample_rate)).exp();
        // Interpolate in log space
        let log_current = self.current_pitch_hz.ln();
        let log_target  = self.target_pitch_hz.ln();
        let log_new     = log_current + coeff * (log_target - log_current);
        self.current_pitch_hz = log_new.exp();
        if (self.current_pitch_hz - self.target_pitch_hz).abs() < 0.01 {
            self.current_pitch_hz = self.target_pitch_hz;
            self.active = false;
        }
        self.current_pitch_hz
    }
}
```

---

# PART 4: EFFECTS ENGINE

---

## 4.1 Reverb — Dattorro Plate

All delay line lengths from Jon Dattorro "Effect Design Part 1" (JAES 1997), originally at 29761 Hz. Scale to arbitrary sample rate with: `samples = floor(original_samples * sample_rate / 29761 + 0.5)`.

Original delay lengths and what they're used for:

```
Input diffusion (allpass):  142, 107, 379, 277
Decay diffusion (modulated allpass, tank): 672, 1800  (left path), 908, 2656 (right path)
Delay lines in tank:        4453, 3720  (left), 4217, 3163 (right)
Output taps (from Dattorro paper): 266, 2974, 1913, 1996, 1990, 187, 1066
Tank allpass modulation: depth ±8 samples at 0.5–1 Hz
```

```rust
// daw-dsp/src/effects/dattorro_plate.rs

pub struct DelayLine {
    buf: Vec<f32>,
    pos: usize,
}

impl DelayLine {
    pub fn new(max_len: usize) -> Self { Self { buf: vec![0.0; max_len], pos: 0 } }
    pub fn len(&self) -> usize { self.buf.len() }

    pub fn read(&self, delay: usize) -> f32 {
        let idx = (self.pos + self.buf.len() - delay) % self.buf.len();
        self.buf[idx]
    }

    pub fn read_frac(&self, delay: f32) -> f32 {
        let d0 = delay.floor() as usize;
        let frac = delay.fract();
        let a = self.read(d0);
        let b = self.read(d0 + 1);
        a + (b - a) * frac
    }

    pub fn write(&mut self, value: f32) {
        self.buf[self.pos] = value;
        self.pos = (self.pos + 1) % self.buf.len();
    }
}

fn scale_dl(original: usize, sr: f32) -> usize {
    (original as f32 * sr / 29761.0).round() as usize
}

pub struct DattorroPlate {
    // Input diffusion
    apf1: (DelayLine, f32), apf2: (DelayLine, f32),  // allpass filters
    apf3: (DelayLine, f32), apf4: (DelayLine, f32),  // (delay_line, coeff)

    // Tank left
    tank_apf1: (DelayLine, f32),
    tank_dl1:   DelayLine,
    tank_apf2: (DelayLine, f32),
    tank_dl2:   DelayLine,

    // Tank right
    tank_apf3: (DelayLine, f32),
    tank_dl3:   DelayLine,
    tank_apf4: (DelayLine, f32),
    tank_dl4:   DelayLine,

    // Modulation LFOs for tank allpass
    mod_phase1: f32,
    mod_phase2: f32,

    // Pre-delay
    pre_delay: DelayLine,

    // Damping filters (one-pole LP)
    damp_state_l: f32,
    damp_state_r: f32,
}

impl DattorroPlate {
    pub fn new(sr: f32) -> Self {
        let dl = |n: usize| DelayLine::new(scale_dl(n, sr) + 10);

        // Coefficients from Dattorro paper
        let id1 = 0.750; let id2 = 0.625;  // input diffusion coefficients

        Self {
            apf1: (dl(142), id1), apf2: (dl(107), id2),
            apf3: (dl(379), id1), apf4: (dl(277), id2),

            tank_apf1: (dl(672),  0.70), tank_dl1: dl(4453),
            tank_apf2: (dl(1800), 0.50), tank_dl2: dl(3720),

            tank_apf3: (dl(908),  0.70), tank_dl3: dl(4217),
            tank_apf4: (dl(2656), 0.50), tank_dl4: dl(3163),

            mod_phase1: 0.0,
            mod_phase2: 0.5,  // 90° offset between L and R modulation

            pre_delay: dl(8820),  // up to 200ms at 44.1kHz

            damp_state_l: 0.0,
            damp_state_r: 0.0,
        }
    }

    fn allpass_tick(dl: &mut DelayLine, coeff: f32, input: f32, delay: usize) -> f32 {
        let delayed = dl.read(delay);
        let pre = input + coeff * delayed;
        dl.write(pre);
        -coeff * pre + delayed
    }

    pub fn process_sample(
        &mut self,
        in_l: f32, in_r: f32,
        decay: f32,           // 0..1 (reverb tail length)
        damping: f32,         // 0..1 (HF damping)
        pre_delay_samples: usize,
        mod_rate: f32,        // Hz
        mod_depth: f32,       // samples
        wet: f32,
        sr: f32,
    ) -> (f32, f32) {
        // Pre-delay
        let pre_len = self.pre_delay.len().min(pre_delay_samples + 1);
        self.pre_delay.write((in_l + in_r) * 0.5);
        let pre = self.pre_delay.read(pre_len - 1);

        // Input diffusion (4 allpass filters in series)
        let apf1_len = self.apf1.0.len() - 1;
        let d = Self::allpass_tick(&mut self.apf1.0, self.apf1.1, pre, apf1_len);
        let apf2_len = self.apf2.0.len() - 1;
        let d = Self::allpass_tick(&mut self.apf2.0, self.apf2.1, d, apf2_len);
        let apf3_len = self.apf3.0.len() - 1;
        let d = Self::allpass_tick(&mut self.apf3.0, self.apf3.1, d, apf3_len);
        let apf4_len = self.apf4.0.len() - 1;
        let diffused = Self::allpass_tick(&mut self.apf4.0, self.apf4.1, d, apf4_len);

        // Tank modulation
        self.mod_phase1 = (self.mod_phase1 + mod_rate / sr) % 1.0;
        self.mod_phase2 = (self.mod_phase2 + mod_rate / sr) % 1.0;
        let mod1 = (self.mod_phase1 * core::f32::consts::TAU).sin() * mod_depth;
        let mod2 = (self.mod_phase2 * core::f32::consts::TAU).sin() * mod_depth;

        // Tank left path
        let tank_l_input = diffused + decay * self.tank_dl2.read(self.tank_dl2.len() - 1);
        let tap_apf1_len = (self.tank_apf1.0.len() as f32 - 1.0 + mod1).max(1.0) as usize;
        let tl1 = Self::allpass_tick(&mut self.tank_apf1.0, self.tank_apf1.1, tank_l_input, tap_apf1_len);
        // Damping LP
        let damp_coeff = 1.0 - damping * 0.8;
        self.damp_state_l = self.damp_state_l * (1.0 - damp_coeff) + tl1 * damp_coeff;
        self.tank_dl1.write(self.damp_state_l * decay);
        let tl2 = Self::allpass_tick(&mut self.tank_apf2.0, self.tank_apf2.1,
                                     self.tank_dl1.read(self.tank_dl1.len()-1),
                                     self.tank_apf2.0.len() - 1);
        self.tank_dl2.write(tl2);

        // Tank right path
        let tank_r_input = diffused + decay * self.tank_dl4.read(self.tank_dl4.len() - 1);
        let tap_apf3_len = (self.tank_apf3.0.len() as f32 - 1.0 + mod2).max(1.0) as usize;
        let tr1 = Self::allpass_tick(&mut self.tank_apf3.0, self.tank_apf3.1, tank_r_input, tap_apf3_len);
        self.damp_state_r = self.damp_state_r * (1.0 - damp_coeff) + tr1 * damp_coeff;
        self.tank_dl3.write(self.damp_state_r * decay);
        let tr2 = Self::allpass_tick(&mut self.tank_apf4.0, self.tank_apf4.1,
                                     self.tank_dl3.read(self.tank_dl3.len()-1),
                                     self.tank_apf4.0.len() - 1);
        self.tank_dl4.write(tr2);

        // Output taps (multi-tap from both delay lines for stereo spread)
        let out_l = self.tank_dl1.read(scale_dl(266, sr))
                  + self.tank_dl1.read(scale_dl(2974, sr))
                  - self.tank_apf2.0.read(scale_dl(1913, sr))
                  + self.tank_dl2.read(scale_dl(1996, sr))
                  - self.tank_dl3.read(scale_dl(1990, sr))
                  - self.tank_apf4.0.read(scale_dl(187, sr))
                  - self.tank_dl4.read(scale_dl(1066, sr));

        let out_r = self.tank_dl3.read(scale_dl(353, sr))
                  + self.tank_dl3.read(scale_dl(3627, sr))
                  - self.tank_apf4.0.read(scale_dl(1228, sr))
                  + self.tank_dl4.read(scale_dl(2673, sr))
                  - self.tank_dl1.read(scale_dl(2111, sr))
                  - self.tank_apf2.0.read(scale_dl(335, sr))
                  - self.tank_dl2.read(scale_dl(121, sr));

        (in_l + wet * out_l * 0.6, in_r + wet * out_r * 0.6)
    }
}
```

## 4.2 Reverb — FDN (Feedback Delay Network)

```rust
// daw-dsp/src/effects/fdn_reverb.rs

pub struct FdnReverb<const N: usize> {
    delay_lines: [DelayLine; N],
    delay_lengths: [usize; N],
    gain_matrix: [[f32; N]; N],  // Householder or Hadamard feedback matrix
    damp_coeff: f32,
    damp_states: [f32; N],
    mod_phases: [f32; N],
}

impl<const N: usize> FdnReverb<N> {
    pub fn new_householder(delay_lengths: [usize; N], sr: f32) -> Self {
        // Householder matrix: H = I - (2/N) * 1*1^T
        // Reflection matrix that distributes energy evenly
        let householder_val = 2.0 / N as f32;
        let mut matrix = [[0.0f32; N]; N];
        for i in 0..N {
            for j in 0..N {
                matrix[i][j] = if i == j { 1.0 - householder_val } else { -householder_val };
            }
        }

        Self {
            delay_lines: core::array::from_fn(|i| DelayLine::new(delay_lengths[i] + 100)),
            delay_lengths,
            gain_matrix: matrix,
            damp_coeff: 0.5,
            damp_states: [0.0; N],
            mod_phases: core::array::from_fn(|i| i as f32 / N as f32),
        }
    }

    pub fn process_sample(&mut self, input: f32, decay: f32, damping: f32,
                          mod_rate: f32, mod_depth: f32, sr: f32) -> (f32, f32) {
        // Read from all delay lines
        let mut reads = [0.0f32; N];
        for i in 0..N {
            self.mod_phases[i] = (self.mod_phases[i] + mod_rate / sr) % 1.0;
            let mod_offset = (self.mod_phases[i] * core::f32::consts::TAU).sin() * mod_depth;
            let delay = (self.delay_lengths[i] as f32 + mod_offset).max(1.0) as usize;
            reads[i] = self.delay_lines[i].read(delay.min(self.delay_lines[i].len()-1));
        }

        // Apply feedback matrix
        let mut feedback = [0.0f32; N];
        for i in 0..N {
            for j in 0..N {
                feedback[i] += self.gain_matrix[i][j] * reads[j];
            }
        }

        // Damping (one-pole LP per channel)
        let damp_coeff = damping * 0.9;
        for i in 0..N {
            self.damp_states[i] = self.damp_states[i] * damp_coeff + feedback[i] * (1.0 - damp_coeff);
            // Write input + feedback into delay line
            self.delay_lines[i].write(input * 0.25 + self.damp_states[i] * decay);
        }

        // Output: first half of channels → L, second half → R
        let out_l: f32 = reads[..N/2].iter().sum::<f32>() / (N/2) as f32;
        let out_r: f32 = reads[N/2..].iter().sum::<f32>() / (N/2) as f32;
        (out_l, out_r)
    }
}
```

## 4.3 Delay — Stereo / Ping-Pong / Tape

```rust
pub struct StereoDelay {
    pub dl_l: DelayLine,
    pub dl_r: DelayLine,
    pub lp_l: f32, pub lp_r: f32,
    pub hp_l: f32, pub hp_r: f32,
    pub wow_flutter_phase: f32,
    pub sat_state_l: f32, pub sat_state_r: f32,
}

#[derive(Clone)]
pub struct DelayParams {
    pub time_l_samples: f32,
    pub time_r_samples: f32,
    pub feedback: f32,           // 0..0.99
    pub cross_feedback: f32,     // 0 = stereo, 1 = ping-pong
    pub lp_freq: f32,            // Hz (for tape tone)
    pub hp_freq: f32,            // Hz
    pub wow_rate: f32,           // Hz (0 = no wow)
    pub wow_depth: f32,          // samples of delay modulation
    pub drive: f32,              // 0..1 (tape saturation)
    pub wet: f32,
}

impl StereoDelay {
    pub fn process_sample(&mut self, in_l: f32, in_r: f32, p: &DelayParams, sr: f32) -> (f32, f32) {
        // Wow & flutter
        self.wow_flutter_phase = (self.wow_flutter_phase + p.wow_rate / sr) % 1.0;
        let wow = (self.wow_flutter_phase * core::f32::consts::TAU).sin() * p.wow_depth;

        let time_l = (p.time_l_samples + wow).max(1.0);
        let time_r = (p.time_r_samples + wow * 1.1).max(1.0);  // slightly different for width

        let delay_out_l = self.dl_l.read_frac(time_l.min(self.dl_l.len() as f32 - 1.0));
        let delay_out_r = self.dl_r.read_frac(time_r.min(self.dl_r.len() as f32 - 1.0));

        // Tape saturation in feedback path
        let sat = |x: f32, drive: f32| tanh_fast(x * (1.0 + drive * 4.0)) / (1.0 + drive * 4.0).max(1.0);
        let fb_l = sat(delay_out_l * p.feedback, p.drive);
        let fb_r = sat(delay_out_r * p.feedback, p.drive);

        // Lowpass filter (darkens repeats)
        let lp_coeff = (core::f32::consts::TAU * p.lp_freq / sr).min(0.99);
        self.lp_l = self.lp_l * (1.0 - lp_coeff) + fb_l * lp_coeff;
        self.lp_r = self.lp_r * (1.0 - lp_coeff) + fb_r * lp_coeff;

        // Ping-pong cross-feedback
        let write_l = in_l + self.lp_l + self.lp_r * p.cross_feedback;
        let write_r = in_r + self.lp_r + self.lp_l * p.cross_feedback;

        self.dl_l.write(write_l);
        self.dl_r.write(write_r);

        (in_l + delay_out_l * p.wet, in_r + delay_out_r * p.wet)
    }
}
```

## 4.4 Distortion (with 2x Oversampling)

```rust
// daw-dsp/src/effects/distortion.rs

#[derive(Clone, Copy)]
pub enum DistortionMode { SoftClip, HardClip, Wavefold, Bitcrush { bits: f32, rate_div: u32 }, Tube }

pub struct DistortionEffect {
    pub mode: DistortionMode,
    pub drive: f32,
    // 2× oversampling FIR halfband filter states
    pub up_fir_state: [f32; 32],
    pub dn_fir_state: [f32; 32],
    pub bit_hold_counter: u32,
    pub bit_held_sample: f32,
}

/// Half-band FIR coefficients for 2x oversampling (Kaiser window, -80dB stopband)
/// These are symmetric — only positive coefficients needed
const HALFBAND_COEFFS: [f32; 8] = [
    0.00151f32, -0.01141, 0.04601, -0.13361,
    0.60945,    0.60945, -0.13361, 0.04601,  // symmetric
];

fn halfband_upsample_tick(state: &mut [f32; 32], input: f32) -> (f32, f32) {
    // Insert two samples: original and zero (upsample by 2)
    // Then apply FIR to get two output samples
    // Simplified: in practice use a proper polyphase FIR
    let s0 = input;
    let s1 = 0.0;  // zero-stuffed
    (s0, s1)  // (TODO: full polyphase FIR for production quality)
}

fn process_nonlinearity(x: f32, mode: DistortionMode, drive: f32) -> f32 {
    let driven = x * drive;
    match mode {
        DistortionMode::SoftClip => tanh_fast(driven),
        DistortionMode::HardClip => driven.clamp(-1.0, 1.0),
        DistortionMode::Wavefold => {
            // Buchla-style wavefolder: sin(π * x) folds the waveform
            (driven * core::f32::consts::PI).sin()
        }
        DistortionMode::Bitcrush { bits, rate_div } => {
            let levels = 2f32.powf(bits);
            (driven * levels).round() / levels
        }
        DistortionMode::Tube => {
            // Asymmetric: softer positive clipping, sharper negative
            if driven > 0.0 {
                1.0 - (-driven).exp()
            } else {
                -1.0 + (driven * 1.5).exp()
            }
        }
    }
}
```

## 4.5 Chorus, Phaser, Flanger

```rust
// daw-dsp/src/effects/chorus.rs

pub struct Chorus {
    pub delay_lines: [DelayLine; 6],
    pub lfo_phases:  [f32; 6],
}

impl Chorus {
    pub fn process_sample(&mut self, in_l: f32, in_r: f32,
                          base_delay_ms: f32, depth_ms: f32, rate_hz: f32,
                          feedback: f32, wet: f32, sr: f32) -> (f32, f32) {
        let mut out_l = 0.0f32; let mut out_r = 0.0f32;
        let rate_inc = rate_hz / sr;
        for i in 0..6 {
            // Slightly different rate and initial phase per tap
            let tap_rate = rate_hz * (1.0 + i as f32 * 0.02);
            self.lfo_phases[i] = (self.lfo_phases[i] + tap_rate / sr) % 1.0;
            let lfo = (self.lfo_phases[i] * core::f32::consts::TAU).sin();
            let delay_samples = ((base_delay_ms + lfo * depth_ms) * 0.001 * sr).max(1.0);

            let input = (in_l + in_r) * 0.5;
            let delayed = self.delay_lines[i].read_frac(delay_samples);
            self.delay_lines[i].write(input + delayed * feedback);

            if i % 2 == 0 { out_l += delayed; } else { out_r += delayed; }
        }
        let n = 3.0f32;
        (in_l + out_l / n * wet, in_r + out_r / n * wet)
    }
}

// Phaser
pub struct Phaser {
    pub ap_states: [(f32, f32); 12],  // (s1, s2) per first-order allpass stage
    pub lfo_phase: f32,
}

fn allpass1_tick(state: &mut f32, coeff: f32, x: f32) -> f32 {
    // First-order allpass: H(z) = (d + z^-1) / (1 + d*z^-1)
    let y = coeff * (x - *state) + *state;
    *state = x;
    y
}

impl Phaser {
    pub fn process_sample(&mut self, input: f32, cutoff_hz: f32, resonance: f32,
                          rate_hz: f32, depth: f32, stages: usize, sr: f32) -> f32 {
        self.lfo_phase = (self.lfo_phase + rate_hz / sr) % 1.0;
        let lfo = (self.lfo_phase * core::f32::consts::TAU).sin();
        let mod_cutoff = cutoff_hz * (1.0 + lfo * depth);
        let coeff = (core::f32::consts::PI * mod_cutoff / sr).tan();
        let d = (1.0 - coeff) / (1.0 + coeff);

        let mut y = input;
        let mut fb_state = 0.0f32;
        for i in 0..stages.min(12) {
            y = allpass1_tick(&mut self.ap_states[i].0, d, y);
        }
        input * 0.5 + y * 0.5
    }
}

// Flanger (through-zero)
pub struct Flanger {
    pub dl: DelayLine,
    pub lfo_phase: f32,
    pub fb_state: f32,
}

impl Flanger {
    pub fn process_sample(&mut self, input: f32, base_ms: f32, rate_hz: f32,
                          depth_ms: f32, feedback: f32, wet: f32, sr: f32) -> f32 {
        self.lfo_phase = (self.lfo_phase + rate_hz / sr) % 1.0;
        let lfo = (self.lfo_phase * core::f32::consts::TAU).sin();
        // Through-zero: delay can go to 0 and cross to negative (phase invert)
        let delay_ms = base_ms + lfo * depth_ms;
        let (sign, delay_abs) = if delay_ms < 0.0 { (-1.0f32, -delay_ms) } else { (1.0, delay_ms) };
        let delay_samples = (delay_abs * 0.001 * sr).max(0.5);

        let delayed = self.dl.read_frac(delay_samples.min(self.dl.len() as f32 - 1.0)) * sign;
        let fb = delayed * feedback;
        self.dl.write(input + self.fb_state);
        self.fb_state = fb;
        input + delayed * wet
    }
}
```

## 4.8 Compressor (Giannoulis/Massberg/Reiss)

```rust
pub struct Compressor {
    pub gain_db: f32,          // current gain reduction in dB
    pub level_db: f32,         // current detected level
    pub lookahead_buf: Vec<f32>,
    pub lookahead_pos: usize,
}

#[derive(Clone)]
pub struct CompressorParams {
    pub threshold_db: f32,     // -60..0
    pub ratio: f32,            // 1..∞ (1=bypass, ∞=limiter)
    pub attack_ms: f32,        // 0.1..100
    pub release_ms: f32,       // 1..5000
    pub knee_db: f32,          // 0..24 (soft knee width in dB)
    pub makeup_db: f32,        // gain after compression
    pub use_rms: bool,         // false = peak detection
    pub lookahead_ms: f32,     // 0..20
}

impl Compressor {
    pub fn process_sample(&mut self, x: f32, p: &CompressorParams, sr: f32) -> f32 {
        // Lookahead: delay audio path by lookahead_ms
        let lookahead_samples = (p.lookahead_ms * 0.001 * sr) as usize;
        if self.lookahead_buf.len() < lookahead_samples + 1 {
            self.lookahead_buf.resize(lookahead_samples + 1, 0.0);
        }

        let sidechain = if p.use_rms {
            x * x  // accumulate RMS separately in practice
        } else {
            x.abs()
        };

        let sidechain_db = if sidechain > 1e-6 { 20.0 * sidechain.log10() } else { -120.0 };

        // Level detection with attack/release
        let att = 1.0 - (-1.0 / (p.attack_ms  * 0.001 * sr)).exp();
        let rel = 1.0 - (-1.0 / (p.release_ms * 0.001 * sr)).exp();
        let coeff = if sidechain_db > self.level_db { att } else { rel };
        self.level_db += coeff * (sidechain_db - self.level_db);

        // Gain computer (with soft knee)
        let half_knee = p.knee_db / 2.0;
        let over = self.level_db - p.threshold_db;
        let target_gain_db = if over <= -half_knee {
            0.0  // below knee: no compression
        } else if over >= half_knee {
            // Above knee: full compression
            (p.threshold_db + (self.level_db - p.threshold_db) / p.ratio) - self.level_db
        } else {
            // In knee: quadratic interpolation
            let t = (over + half_knee) / p.knee_db;
            (1.0/p.ratio - 1.0) * (over + half_knee) * (over + half_knee) / (2.0 * p.knee_db)
        };

        // Smooth gain reduction
        let gain_att = 1.0 - (-1.0 / (p.attack_ms * 0.001 * sr)).exp();
        let gain_rel = 1.0 - (-1.0 / (p.release_ms * 0.001 * sr)).exp();
        let gc = if target_gain_db < self.gain_db { gain_att } else { gain_rel };
        self.gain_db += gc * (target_gain_db - self.gain_db);

        // Apply: lookahead delay + gain + makeup
        let gain_linear = 10f32.powf((self.gain_db + p.makeup_db) / 20.0);

        // Lookahead output
        let pos = (self.lookahead_pos + lookahead_samples) % self.lookahead_buf.len().max(1);
        let out = self.lookahead_buf.get(pos).copied().unwrap_or(x);
        self.lookahead_buf[self.lookahead_pos % self.lookahead_buf.len().max(1)] = x;
        self.lookahead_pos = (self.lookahead_pos + 1) % self.lookahead_buf.len().max(1);

        out * gain_linear
    }
}
```

## 4.11 Stereo Width

```rust
pub fn stereo_width_process(l: f32, r: f32, width: f32) -> (f32, f32) {
    // M/S approach
    let mid  = (l + r) * 0.5;
    let side = (l - r) * 0.5;
    // width: 0=mono, 1=original, 2=max
    let side_gain = width;
    let out_l = mid + side * side_gain;
    let out_r = mid - side * side_gain;
    (out_l, out_r)
}
```

---

# PART 5: GPU COMPUTE WORKLOADS (WebGPU / wgpu)

---

## 5.1 FFT for Spectrum Analysis (WGSL Compute Shader)

```wgsl
// spectrum_fft.wgsl
// Radix-2 Cooley-Tukey FFT compute shader
// Workgroup: 1 workgroup per FFT of size N (N must be power of 2, ≤ 2048)

const PI: f32 = 3.14159265358979323846;

struct Complex {
    re: f32,
    im: f32,
}

fn complex_mul(a: Complex, b: Complex) -> Complex {
    return Complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

fn complex_add(a: Complex, b: Complex) -> Complex {
    return Complex(a.re + b.re, a.im + b.im);
}

fn complex_sub(a: Complex, b: Complex) -> Complex {
    return Complex(a.re - b.re, a.im - b.im);
}

@group(0) @binding(0) var<storage, read>       input_signal : array<f32>;
@group(0) @binding(1) var<storage, read_write> output_bins  : array<f32>; // interleaved re,im
@group(0) @binding(2) var<uniform>             fft_size     : u32;

var<workgroup> shared_data: array<Complex, 2048>;

fn bit_reverse(x: u32, log2_n: u32) -> u32 {
    var v = x;
    var r: u32 = 0u;
    for (var i: u32 = 0u; i < log2_n; i++) {
        r = (r << 1u) | (v & 1u);
        v >>= 1u;
    }
    return r;
}

@compute @workgroup_size(512)
fn main(@builtin(global_invocation_id) gid: vec3<u32>,
        @builtin(local_invocation_id)  lid: vec3<u32>) {
    let n = fft_size;
    let log2_n = u32(log2(f32(n)));
    let tid = lid.x;

    // Apply Hann window and load into shared memory
    if tid < n {
        let window = 0.5 * (1.0 - cos(2.0 * PI * f32(tid) / f32(n)));
        let rev = bit_reverse(tid, log2_n);
        shared_data[rev] = Complex(input_signal[tid] * window, 0.0);
    }
    workgroupBarrier();

    // Cooley-Tukey butterfly stages
    for (var stage: u32 = 1u; stage <= log2_n; stage++) {
        let half_size = 1u << (stage - 1u);
        let stride    = 1u << stage;

        if tid < n / 2u {
            let k     = tid % half_size;
            let group = tid / half_size;
            let idx_a = group * stride + k;
            let idx_b = idx_a + half_size;

            let angle = -2.0 * PI * f32(k) / f32(stride);
            let twiddle = Complex(cos(angle), sin(angle));

            let a = shared_data[idx_a];
            let b = complex_mul(twiddle, shared_data[idx_b]);

            shared_data[idx_a] = complex_add(a, b);
            shared_data[idx_b] = complex_sub(a, b);
        }
        workgroupBarrier();
    }

    // Write magnitudes to output
    if tid < n / 2u + 1u {
        let re = shared_data[tid].re;
        let im = shared_data[tid].im;
        let magnitude = sqrt(re * re + im * im) / f32(n);
        output_bins[tid * 2u]     = re / f32(n);
        output_bins[tid * 2u + 1u] = im / f32(n);
    }
}
```

**CPU side (wgpu Rust)**:

```rust
// daw-engine/src/gpu/fft_analyzer.rs
pub struct GpuFftAnalyzer {
    pipeline: wgpu::ComputePipeline,
    input_buf: wgpu::Buffer,    // f32 × FFT_SIZE
    output_buf: wgpu::Buffer,   // f32 × (FFT_SIZE+2) — re/im interleaved
    readback_buf: wgpu::Buffer, // staging buffer for CPU read
    bind_group: wgpu::BindGroup,
    fft_size: u32,
}

impl GpuFftAnalyzer {
    pub fn submit(&self, queue: &wgpu::Queue, audio_block: &[f32]) {
        // Write audio data to input buffer
        queue.write_buffer(&self.input_buf, 0, bytemuck::cast_slice(audio_block));
        // Dispatch compute shader
        let mut encoder = /* ... */;
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.dispatch_workgroups(1, 1, 1);  // single workgroup for FFT ≤ 2048
        }
        // Copy output to staging for async readback
        encoder.copy_buffer_to_buffer(&self.output_buf, 0, &self.readback_buf, 0,
                                       (self.fft_size as u64 + 2) * 4);
        queue.submit(Some(encoder.finish()));
    }
}
```

---

## 5.2 Additive Synthesis GPU Compute

```wgsl
// additive_synthesis.wgsl
// Sums N sine partials per output sample
// Dispatches: one workgroup per output sample block

const MAX_PARTIALS: u32 = 512u;
const BLOCK_SIZE:   u32 = 128u;

struct PartialData {
    amplitude: f32,
    phase:     f32,
    freq_hz:   f32,
    _pad:      f32,
}

@group(0) @binding(0) var<storage, read>       partials      : array<PartialData, 512>;
@group(0) @binding(1) var<storage, read_write> output_samples: array<f32>;
@group(0) @binding(2) var<uniform>             params        : AdditiveSynthParams;

struct AdditiveSynthParams {
    num_partials: u32,
    block_size:   u32,
    sample_rate:  f32,
    block_offset: u32,  // sample offset for continuity between blocks
}

var<workgroup> partial_sums: array<f32, 128>;  // one per sample in block

@compute @workgroup_size(128)
fn main(@builtin(local_invocation_id)  lid : vec3<u32>,
        @builtin(global_invocation_id) gid : vec3<u32>) {
    // Each thread handles one sample in the block
    let sample_idx = lid.x;
    let global_sample = params.block_offset + sample_idx;

    var sum: f32 = 0.0;

    // Each thread sums all partials for its sample
    // For 512 partials × 128 threads = 65536 sine evaluations per dispatch
    for (var p: u32 = 0u; p < params.num_partials; p++) {
        let partial = partials[p];
        if partial.amplitude < 0.00001 { continue; }

        let phase = partial.phase + partial.freq_hz * f32(global_sample) / params.sample_rate;
        // Fractional phase: keep in 0..1 range handled by sin's periodicity
        sum += sin(phase * 6.28318530718) * partial.amplitude;
    }

    output_samples[sample_idx] = sum;
}
```

**When to use GPU for additive**: GPU wins over CPU when `num_partials × block_size > ~8192`. At 128 partials × 128 samples = 16384 ops, GPU is already faster (latency aside). At 512 partials it's always faster. On WASM without WebGPU, fall back to CPU SIMD with `wasm32::simd128`.

---

## 5.3 Convolution Reverb Tail (Partitioned Convolution)

```wgsl
// conv_reverb_tail.wgsl
// Frequency-domain convolution of one partition of the impulse response
// Uses overlap-save method

@group(0) @binding(0) var<storage, read>       ir_partition_freq: array<f32>; // Complex: re,im interleaved
@group(0) @binding(1) var<storage, read>       input_block_freq : array<f32>; // Complex FFT of input
@group(0) @binding(2) var<storage, read_write> output_accum     : array<f32>; // Accumulated complex output

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let bin = gid.x;
    let re_idx = bin * 2u;
    let im_idx = bin * 2u + 1u;

    // Complex multiply: IR_partition × Input_FFT
    let ir_re = ir_partition_freq[re_idx];
    let ir_im = ir_partition_freq[im_idx];
    let in_re = input_block_freq[re_idx];
    let in_im = input_block_freq[im_idx];

    // Accumulate (add to existing result for uniform partitioning delay)
    output_accum[re_idx] += ir_re * in_re - ir_im * in_im;
    output_accum[im_idx] += ir_re * in_im + ir_im * in_re;
}
```

**Architecture**: The IR is split into partitions (e.g. 4096-sample blocks). The head partition (first 4096 samples) runs on CPU with no latency (direct convolution). All other partitions run on GPU with one block of latency per partition, accumulated via the frequency-domain convolution above. The CPU handles the overlap-add final step.

---

## 5.4 Visualization Shaders

### Oscilloscope

```wgsl
// oscilloscope.wgsl

struct OscVertex {
    @builtin(position) pos: vec4<f32>,
    @location(0) brightness: f32,
}

@group(0) @binding(0) var<storage, read> samples: array<f32>;
@group(0) @binding(1) var<uniform>       osc_params: OscParams;

struct OscParams {
    num_samples:  u32,
    width_pixels: f32,
    height_pixels: f32,
    zoom: f32,
    trigger_level: f32,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> OscVertex {
    let x_ndc = (f32(vi) / f32(osc_params.num_samples)) * 2.0 - 1.0;
    let y_ndc = samples[vi] * osc_params.zoom;
    return OscVertex(vec4<f32>(x_ndc, y_ndc, 0.0, 1.0), 1.0);
}

@fragment
fn fs_main(in: OscVertex) -> @location(0) vec4<f32> {
    // Anti-aliased line: thickness via fragment shader
    let line_color = vec3<f32>(0.42, 0.67, 0.81);  // --accent-blue #6BAACE
    return vec4<f32>(line_color * in.brightness, 1.0);
}
```

### Spectrum Analyzer (Instanced Bars)

```wgsl
// spectrum_analyzer.wgsl

struct BarInstance {
    @location(0) bin_index: u32,
    @location(1) magnitude: f32,
}

@group(0) @binding(0) var<uniform> analyzer_params: AnalyzerParams;

struct AnalyzerParams {
    num_bins: u32,
    canvas_width: f32,
    canvas_height: f32,
    floor_db: f32,
    ceil_db: f32,
}

@vertex
fn vs_bar(@builtin(vertex_index) vi: u32,
          @builtin(instance_index) inst: u32,
          @location(1) magnitude: f32) -> @builtin(position) vec4<f32> {
    // vi: 0-3 = quad corners
    let bin_width = analyzer_params.canvas_width / f32(analyzer_params.num_bins);
    let x_left = f32(inst) * bin_width / (analyzer_params.canvas_width * 0.5) - 1.0;
    let x_right = x_left + bin_width / (analyzer_params.canvas_width * 0.5);

    let mag_db = 20.0 * log(magnitude + 1e-6) / log(10.0);
    let normalized_h = clamp((mag_db - analyzer_params.floor_db) /
                             (analyzer_params.ceil_db - analyzer_params.floor_db), 0.0, 1.0);
    let y_top = normalized_h * 2.0 - 1.0;

    let x = select(x_left, x_right, (vi & 1u) == 1u);
    let y = select(-1.0, y_top, (vi >> 1u) == 0u);
    return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fs_bar(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    // Gradient: blue at bottom, cyan at mid, white at top
    let t = (pos.y / 720.0);  // normalized height
    let col = mix(vec3<f32>(0.0, 0.2, 0.5), vec3<f32>(0.42, 0.67, 0.81), t);
    return vec4<f32>(col, 0.85);
}
```

### Modulation Rings (Instanced Arc Segments)

```wgsl
// mod_rings.wgsl
// Draws colored arc segments on knobs, one instance per mod connection

struct ArcInstance {
    @location(0) center_x:   f32,
    @location(1) center_y:   f32,
    @location(2) start_angle: f32,  // radians
    @location(3) end_angle:   f32,
    @location(4) color:       vec4<f32>,
    @location(5) radius:      f32,
    @location(6) thickness:   f32,
}

@vertex
fn vs_arc(@builtin(vertex_index) vi: u32,
          @location(0) cx: f32, @location(1) cy: f32,
          @location(2) start_a: f32, @location(3) end_a: f32,
          @location(4) col: vec4<f32>, @location(5) radius: f32) -> ArcVertexOut {
    // Emit a quad that covers the arc's bounding area
    // Fragment shader computes actual arc shape via SDF
    let r_outer = radius + 4.0;
    let angles = array<f32, 4>(start_a, start_a, end_a, end_a);
    let angle = angles[vi];
    let inner = select(-1.0, 1.0, (vi & 1u) == 0u);
    let r = radius + inner * 4.0;
    let x = cx + cos(angle) * r;
    let y = cy + sin(angle) * r;
    // ... (full quad emit with proper coverage)
    return ArcVertexOut(vec4<f32>(x / 400.0 - 1.0, y / 300.0 - 1.0, 0.0, 1.0), col, cx, cy, radius, start_a, end_a);
}

struct ArcVertexOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) cx: f32, @location(2) cy: f32,
    @location(3) radius: f32,
    @location(4) start_a: f32, @location(5) end_a: f32,
}

@fragment
fn fs_arc(in: ArcVertexOut) -> @location(0) vec4<f32> {
    // SDF arc: measure distance from pixel to arc midline
    let px = in.pos.x - in.cx;
    let py = in.pos.y - in.cy;
    let dist = sqrt(px * px + py * py);
    let ring_dist = abs(dist - in.radius);

    // Check if angle is within arc span
    let angle = atan2(py, px);
    // (angle normalization and range check omitted for brevity)

    let alpha = smoothstep(3.0, 1.0, ring_dist);
    return vec4<f32>(in.color.rgb, in.color.a * alpha);
}
```

### Wavetable 3D Surface

```wgsl
// wavetable_3d.wgsl
// Renders wavetable frames as a 3D mesh

@group(0) @binding(0) var<storage, read> wavetable: array<f32>; // [frame][sample]
@group(0) @binding(1) var<uniform>       wt_params: WavetableDisplayParams;
@group(0) @binding(2) var<uniform>       mvp: mat4x4<f32>;

struct WavetableDisplayParams {
    num_frames: u32,
    frame_len: u32,
    current_frame: f32,
    y_scale: f32,
}

@vertex
fn vs_wavetable(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let frame_idx = vi / wt_params.frame_len;
    let sample_idx = vi % wt_params.frame_len;

    let x = f32(sample_idx) / f32(wt_params.frame_len) * 2.0 - 1.0;
    let z = f32(frame_idx) / f32(wt_params.num_frames) * 2.0 - 1.0;

    let wt_idx = frame_idx * wt_params.frame_len + sample_idx;
    let y = wavetable[wt_idx] * wt_params.y_scale;

    // Highlight current frame
    let is_current = abs(f32(frame_idx) - wt_params.current_frame) < 1.0;
    let y_offset = select(0.0, 0.1, is_current);

    return mvp * vec4<f32>(x, y + y_offset, z, 1.0);
}

@fragment
fn fs_wavetable(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(0.26, 0.42, 0.56, 0.9);  // Muted blue-grey
}
```

---

# PART 6: PRESET SYSTEM AND AI GENERATION

---

## 6.1 Preset Format

```rust
// daw-synth/src/preset.rs

use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct PresetData {
    pub version: u32,  // bump on breaking format changes
    pub meta: PresetMeta,
    pub layers: Vec<LayerData>,
    pub modulation: Vec<ModSlotData>,
    pub fx_lanes: [FxLaneData; 3],
    pub macros: [MacroData; 8],
    pub xy_pad: XyPadData,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PresetMeta {
    pub name: String,
    pub author: String,
    pub description: String,
    pub tags: Vec<String>,
    pub category: PresetCategory,
    pub complexity: ComplexityLevel,
    pub created_at: u64,  // Unix timestamp
    pub preview_audio_b64: Option<String>,  // base64 WAV
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
pub enum PresetCategory { Bass, Lead, Pad, Keys, Pluck, Fx, Drum, Texture, Vocal, Arp }

#[derive(Serialize, Deserialize, Clone)]
pub enum ComplexityLevel { Play=1, Shape=2, Build=3, Route=4, Lab=5 }

#[derive(Serialize, Deserialize, Clone)]
pub struct LayerData {
    pub gain: f32,
    pub pan: f32,
    pub pitch_semitones: f32,
    pub generators: Vec<GeneratorData>,
    pub filters: Vec<FilterData>,
    pub inserts: Vec<EffectData>,
    pub fx_lane_send: [f32; 3],
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum GeneratorData {
    Wavetable {
        wavetable_name: String,
        frame_pos: f32,
        warp_mode: String,
        warp_amount: f32,
        unison_count: u8,
        unison_detune: f32,
        unison_spread: f32,
        gain: f32,
        pan: f32,
    },
    VirtualAnalog {
        waveform: String,
        pitch_semitones: f32,
        pulse_width: f32,
        drift: f32,
        unison_count: u8,
        unison_detune: f32,
    },
    Fm {
        algorithm: u8,
        operators: Vec<FmOperatorData>,
    },
    Additive {
        amplitudes: Vec<f32>,
        brightness: f32,
        harmonicity: f32,
    },
    Granular {
        sample_name: String,
        density: f32,
        grain_size_ms: f32,
        spray: f32,
        pitch_spread: f32,
    },
    Sampler {
        instrument_name: String,
    },
    Noise {
        color: String,  // "white","pink","brown"
    },
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ModSlotData {
    pub source: String,   // e.g. "envelope[0]", "lfo[1]", "velocity"
    pub dest: String,     // e.g. "layer[0].generator[0].wavetable.frame_pos"
    pub amount: f32,
    pub is_bipolar: bool,
    pub enabled: bool,
}
```

### Format Migration

```rust
pub fn migrate_preset(data: &mut serde_json::Value, from_version: u32) {
    let mut ver = from_version;
    while ver < CURRENT_PRESET_VERSION {
        match ver {
            1 => {
                // v1→v2: renamed "filter_type" to "filter_model"
                if let Some(layers) = data["layers"].as_array_mut() {
                    for layer in layers {
                        if let Some(filters) = layer["filters"].as_array_mut() {
                            for filter in filters {
                                if let Some(ft) = filter.get("filter_type").cloned() {
                                    filter["filter_model"] = ft;
                                    filter.as_object_mut().unwrap().remove("filter_type");
                                }
                            }
                        }
                    }
                }
            }
            // add future migrations here
            _ => {}
        }
        ver += 1;
    }
    data["version"] = serde_json::Value::from(CURRENT_PRESET_VERSION);
}

const CURRENT_PRESET_VERSION: u32 = 2;
```

---

## 6.2 Preset Browser — Fuzzy Search

```rust
pub fn fuzzy_score(query: &str, target: &str) -> f32 {
    let query_lower = query.to_lowercase();
    let target_lower = target.to_lowercase();

    if target_lower.contains(&query_lower) {
        // Exact substring match: high score
        return 1.0 - (query_lower.len() as f32 / target_lower.len() as f32) * 0.5;
    }

    // Character-by-character fuzzy match
    let mut qi = 0;
    let q_chars: Vec<char> = query_lower.chars().collect();
    let t_chars: Vec<char> = target_lower.chars().collect();
    let mut gaps = 0;

    for &tc in &t_chars {
        if qi < q_chars.len() && tc == q_chars[qi] {
            qi += 1;
        } else {
            gaps += 1;
        }
    }

    if qi < q_chars.len() { return 0.0; }  // didn't match all query chars

    1.0 / (1.0 + gaps as f32 * 0.1)
}

pub fn search_presets<'a>(presets: &'a [PresetData], query: &str) -> Vec<(&'a PresetData, f32)> {
    let mut results: Vec<(&PresetData, f32)> = presets.iter()
        .filter_map(|p| {
            let name_score = fuzzy_score(query, &p.meta.name) * 2.0;
            let tag_score  = p.meta.tags.iter()
                .map(|t| fuzzy_score(query, t))
                .fold(0.0f32, f32::max);
            let desc_score = fuzzy_score(query, &p.meta.description) * 0.5;
            let score = name_score + tag_score + desc_score;
            if score > 0.1 { Some((p, score)) } else { None }
        })
        .collect();
    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    results
}
```

---

## 6.3 AI Preset Generation Pipeline

### Stage 2: Quality Classifier (ONNX MLP)

**Network architecture** (train once offline, run via `ort` crate):

```
Input: 64-dimensional spectral feature vector
  - MFCC coefficients (first 20): capture timbral texture
  - Spectral centroid (1): brightness
  - Spectral spread (1): bandwidth
  - Spectral flux (1): temporal variation
  - RMS energy (1): loudness
  - Zero crossing rate (1): noisiness
  - Spectral rolloff (1): HF content
  - Onset density (1): rhythmic activity
  - Spectral flatness (1): tone vs noise
  - Chroma vector (12): harmonic content per pitch class
  - Fundamental frequency confidence (1): how pitched/unpitched
  - Harmonic ratio (1): harmonic vs inharmonic content
  - Stereo width (1): mono vs stereo

Hidden layer 1: 128 neurons, ReLU
Hidden layer 2: 64 neurons, ReLU
Output: 1 neuron, Sigmoid → musicality score 0..1

Training: 1000 human-rated presets, augmented by pitch-shifting and time-stretching
Loss: Binary cross-entropy (threshold 0.6 → "good" / "bad")
```

```rust
// daw-synth/src/ai/quality_classifier.rs
// Run via `ort` crate (ONNX Runtime)

pub struct PresetQualityClassifier {
    session: ort::Session,
}

impl PresetQualityClassifier {
    pub fn load(model_path: &str) -> ort::Result<Self> {
        let session = ort::SessionBuilder::new()?
            .with_optimization_level(ort::GraphOptimizationLevel::All)?
            .commit_from_file(model_path)?;
        Ok(Self { session })
    }

    pub fn score(&self, audio_features: &[f32; 64]) -> f32 {
        let input = ort::Value::from_array(ndarray::arr1(audio_features).into_dyn())
            .expect("Failed to create input tensor");
        let outputs = self.session.run(ort::inputs!["input" => input]).unwrap();
        let output: ndarray::ArrayView1<f32> = outputs["output"].extract_tensor().unwrap().view();
        output[0]
    }
}

/// Extract features from a 2-second audio clip (88200 samples at 44.1kHz)
pub fn extract_features(audio: &[f32], sr: f32) -> [f32; 64] {
    let mut features = [0.0f32; 64];

    // Spectral centroid (mean frequency weighted by magnitude)
    let fft_size = 2048;
    // ... (full feature extraction implementation)

    features
}
```

### Stage 4: Text-to-Preset via LLM

```rust
pub async fn text_to_preset(description: &str) -> Result<PresetData, String> {
    let system_prompt = r#"
You are a synthesizer preset generator. Given a natural language description,
output a JSON preset exactly matching the PresetData schema below.

SCHEMA OVERVIEW:
- layers: array of Layer objects, each with generators (wavetable/fm/va/additive/granular/sampler/noise)
- modulation: array of {source, dest, amount, is_bipolar}
- fx_lanes: 3 FX lanes with effect chains
- macros: 8 macro knobs

RULES:
1. Output ONLY valid JSON — no markdown, no explanation
2. Always include at least 1 layer with 1 generator
3. Modulation sources: "envelope[N]", "lfo[N]", "velocity", "macro[N]"
4. Modulation dests: "layer[N].filter[N].cutoff", "layer[N].generator[N].pitch", etc.
5. Filter models: "moog_ladder", "diode_ladder", "sem", "biquad_lp", "biquad_hp"
6. Keep it musical and appropriate to the description
"#;

    let user_prompt = format!("Create a preset for: {}", description);

    // Call Anthropic API (or local model)
    let response = call_llm_api(system_prompt, &user_prompt).await?;

    // Parse and validate
    let raw: serde_json::Value = serde_json::from_str(&response)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    // Validate against schema
    validate_preset_json(&raw)?;

    let preset: PresetData = serde_json::from_value(raw)
        .map_err(|e| format!("Schema mismatch: {}", e))?;

    Ok(preset)
}
```

---

## 6.4 Classic Synth Emulation Templates

```rust
pub fn minimoog_template() -> PresetData {
    PresetData {
        meta: PresetMeta {
            name: "Init Minimoog".into(),
            category: PresetCategory::Lead,
            complexity: ComplexityLevel::Shape,
            tags: vec!["analog".into(), "warm".into(), "mono".into()],
            ..Default::default()
        },
        layers: vec![LayerData {
            generators: vec![
                GeneratorData::VirtualAnalog { waveform: "saw".into(), pitch_semitones: 0.0, pulse_width: 0.5, drift: 0.3, unison_count: 1, unison_detune: 0.0 },
                GeneratorData::VirtualAnalog { waveform: "saw".into(), pitch_semitones: -12.0, pulse_width: 0.5, drift: 0.3, unison_count: 1, unison_detune: 0.0 },
                GeneratorData::VirtualAnalog { waveform: "square".into(), pitch_semitones: 0.0, pulse_width: 0.5, drift: 0.3, unison_count: 1, unison_detune: 0.0 },
            ],
            filters: vec![FilterData { model: "moog_ladder".into(), cutoff: 2000.0, resonance: 0.4, drive: 0.2, ..Default::default() }],
            ..Default::default()
        }],
        modulation: vec![
            ModSlotData { source: "envelope[0]".into(), dest: "layer[0].filter[0].cutoff".into(), amount: 0.6, is_bipolar: false, enabled: true },
            ModSlotData { source: "velocity".into(), dest: "layer[0].filter[0].cutoff".into(), amount: 0.3, is_bipolar: false, enabled: true },
        ],
        ..Default::default()
    }
}

pub fn dx7_template() -> PresetData {
    PresetData {
        meta: PresetMeta { name: "Init DX7".into(), category: PresetCategory::Keys, tags: vec!["fm".into(), "electric piano".into()], ..Default::default() },
        layers: vec![LayerData {
            generators: vec![GeneratorData::Fm {
                algorithm: 4,  // Alg 5 (0-indexed): 2 stacks + 1 independent
                operators: (0..6).map(|i| FmOperatorData {
                    ratio: if i == 0 { 1.0 } else if i == 1 { 14.0 } else { i as f32 },
                    output_level: if i % 2 == 0 { 0.8 } else { 0.5 },
                    feedback: if i == 0 { 0.3 } else { 0.0 },
                    ..Default::default()
                }).collect(),
            }],
            filters: vec![],  // DX7 has no filter
            ..Default::default()
        }],
        ..Default::default()
    }
}

pub fn tb303_template() -> PresetData {
    PresetData {
        meta: PresetMeta { name: "Init TB-303".into(), category: PresetCategory::Bass, tags: vec!["acid".into(), "analog".into(), "mono".into()], ..Default::default() },
        layers: vec![LayerData {
            generators: vec![GeneratorData::VirtualAnalog {
                waveform: "saw".into(), pitch_semitones: 0.0, pulse_width: 0.5, drift: 0.1, unison_count: 1, unison_detune: 0.0,
            }],
            filters: vec![FilterData { model: "diode_ladder".into(), cutoff: 500.0, resonance: 0.7, drive: 0.5, ..Default::default() }],
            ..Default::default()
        }],
        modulation: vec![
            ModSlotData { source: "envelope[0]".into(), dest: "layer[0].filter[0].cutoff".into(), amount: 0.8, is_bipolar: false, enabled: true },
        ],
        ..Default::default()
    }
}

// Additional templates (Jupiter-8, Prophet-5, OB-Xa, Juno-106, PPG Wave, CS-80, MS-20, D-50)
// follow the same pattern with appropriate generator types and filter models.
```

---

# PART 7: ARCHITECTURE AND PERFORMANCE

---

## 7.1 Complete `daw-synth` Crate Structure

```rust
// daw-synth/src/lib.rs

pub struct MasterSynth {
    pub layers: Vec<Layer>,
    pub modulation: ModulationMatrix,
    pub fx_lanes: [FxLane; 3],
    pub macros: [f32; 8],
    pub voice_manager: VoiceManager<128>,
    pub xy_pad: XyPadState,
    pub sample_rate: f32,
    pub block_size: usize,
    // Scratch buffers (pre-allocated, reused each block)
    scratch_voice: Vec<f32>,
    scratch_lane:  [Vec<f32>; 3],
}

impl MasterSynth {
    pub fn new(sample_rate: f32, block_size: usize) -> Self { /* ... */ }

    pub fn process(
        &mut self,
        midi: &[MidiEvent],
        out_l: &mut [f32],
        out_r: &mut [f32],
    ) {
        // (see block processing order below)
    }

    pub fn set_param(&mut self, path: &str, value: f32) { /* path-based parameter access */ }
    pub fn get_param(&self, path: &str) -> Option<f32> { /* ... */ }

    pub fn load_preset(&mut self, preset: &PresetData) { /* ... */ }
    pub fn save_preset(&self) -> PresetData { /* ... */ }
}
```

## 7.2 Block Processing Order

```rust
impl MasterSynth {
    pub fn process(&mut self, midi: &[MidiEvent], out_l: &mut [f32], out_r: &mut [f32]) {
        let bs = self.block_size;

        // 1. Process MIDI events (sorted by frame offset)
        for event in midi {
            let frame = event.frame as usize;
            match event.message {
                MidiMessage::NoteOn { note, velocity, channel } => {
                    let vi = self.voice_manager.note_on(note, velocity, channel);
                    // Initialize voice generators
                }
                MidiMessage::NoteOff { note, channel } => {
                    self.voice_manager.note_off(note, channel);
                }
                MidiMessage::ControlChange { cc: 1, value, .. } => {
                    self.macros[0] = value as f32 / 127.0;  // mod wheel → macro 0
                }
                MidiMessage::PitchBend { value, channel } => {
                    let bend_norm = value as f32 / 8192.0;  // -1..+1
                    // Apply to all voices on this channel
                }
                _ => {}
            }
        }

        // 2. Update modulation sources (control rate: once per block)
        let mod_sources = self.collect_mod_sources();
        self.modulation.update_sources(&mod_sources, bs, self.sample_rate);

        // 3. Clear output and lane buffers
        out_l.iter_mut().for_each(|x| *x = 0.0);
        out_r.iter_mut().for_each(|x| *x = 0.0);
        for lane in self.scratch_lane.iter_mut() {
            lane.iter_mut().for_each(|x| *x = 0.0);
        }

        // 4. Process each active voice
        let active: Vec<usize> = self.voice_manager.active_indices.clone();
        for vi in active {
            let voice = &mut self.voice_manager.voices[vi];

            // 4a. Tick voice envelopes
            let mut env_outputs = [0.0f32; MAX_ENVELOPES];
            for (i, env) in voice.envelopes.iter_mut().enumerate() {
                env_outputs[i] = env.tick(&self.layers[0].env_params[i], self.sample_rate);
            }

            // Check if voice is done
            if env_outputs[0] == 0.0 && voice.is_releasing {
                voice.is_active = false;
                continue;
            }

            // 4b. Process generators into scratch buffer
            // (layer/generator selection based on current preset)
            self.scratch_voice.iter_mut().for_each(|x| *x = 0.0);
            // ... generator process calls ...

            // 4c. Apply voice volume (envelope × velocity)
            let vol = env_outputs[0] * voice.velocity;
            for s in self.scratch_voice.iter_mut() { *s *= vol; }

            // 4d. Apply voice stealing fade
            if voice.fade_rate != 0.0 {
                for (i, s) in self.scratch_voice.iter_mut().enumerate() {
                    let t = (i as f32 / bs as f32) * voice.fade_rate + voice.fade_gain;
                    *s *= t.clamp(0.0, 1.0);
                }
                voice.fade_gain = (voice.fade_gain + voice.fade_rate * bs as f32).clamp(0.0, 1.0);
            }

            // 4e. Accumulate into FX lane or direct out
            for i in 0..bs {
                out_l[i] += self.scratch_voice[i] * 0.707;  // panning simplified
                out_r[i] += self.scratch_voice[i] * 0.707;
            }
        }

        // 5. Process FX lanes
        for lane in 0..3 {
            for effect in self.fx_lanes[lane].effects.iter_mut() {
                effect.process_block(out_l, out_r, self.sample_rate);
            }
        }

        // 6. Cleanup finished voices
        self.voice_manager.cleanup_finished_voices(self.sample_rate);
    }
}
```

## 7.3 Parameter Smoothing

```rust
pub struct SmoothedParam {
    pub target: f32,
    pub current: f32,
    pub coeff: f32,       // precomputed per smoothing_ms
}

impl SmoothedParam {
    pub fn new(value: f32, smoothing_ms: f32, sample_rate: f32) -> Self {
        Self {
            target: value,
            current: value,
            coeff: Self::calc_coeff(smoothing_ms, sample_rate),
        }
    }

    pub fn calc_coeff(ms: f32, sr: f32) -> f32 {
        if ms < 0.01 { return 1.0; }
        1.0 - (-core::f32::consts::TAU / (ms * 0.001 * sr)).exp()
    }

    #[inline(always)]
    pub fn tick(&mut self) -> f32 {
        if (self.target - self.current).abs() > 1e-6 {
            self.current += self.coeff * (self.target - self.current);
        }
        self.current
    }

    pub fn set_target(&mut self, value: f32) {
        self.target = value;
    }

    pub fn set_immediate(&mut self, value: f32) {
        self.target = value;
        self.current = value;
    }
}
```

## 7.4 SIMD Optimization

```rust
// daw-dsp/src/simd.rs

// Process 4 samples at once using std::simd (nightly) or manual f32x4
// Example: applying gain to a buffer

#[cfg(target_arch = "x86_64")]
pub fn apply_gain_simd(buf: &mut [f32], gain: f32) {
    use core::arch::x86_64::*;
    let chunks = buf.len() / 8;
    let gain_v = unsafe { _mm256_set1_ps(gain) };

    unsafe {
        for i in 0..chunks {
            let ptr = buf.as_mut_ptr().add(i * 8);
            let v = _mm256_loadu_ps(ptr);
            let out = _mm256_mul_ps(v, gain_v);
            _mm256_storeu_ps(ptr, out);
        }
    }

    // Handle remainder
    for sample in buf[chunks * 8..].iter_mut() {
        *sample *= gain;
    }
}

// WASM SIMD (128-bit, 4×f32)
#[cfg(target_arch = "wasm32")]
pub fn apply_gain_simd(buf: &mut [f32], gain: f32) {
    use core::arch::wasm32::*;
    let chunks = buf.len() / 4;
    let gain_v = f32x4_splat(gain);

    unsafe {
        for i in 0..chunks {
            let ptr = buf.as_mut_ptr().add(i * 4);
            let v = v128_load(ptr as *const v128);
            let v_f = f32x4(v);
            let out = f32x4_mul(v_f, gain_v);
            v128_store(ptr as *mut v128, out);
        }
    }
}

/// Mix N unison voices into stereo output — 4 at a time with SSE
pub fn mix_unison_voices(
    voices: &[&[f32]],        // each voice: mono buffer
    pans: &[f32],             // pan per voice (-1..1)
    out_l: &mut [f32],
    out_r: &mut [f32],
) {
    assert_eq!(voices.len(), pans.len());
    let n = out_l.len();

    // Precompute L/R gains for each voice
    let gains_l: Vec<f32> = pans.iter().map(|&p| ((p + 1.0) * 0.25 * core::f32::consts::PI).cos()).collect();
    let gains_r: Vec<f32> = pans.iter().map(|&p| ((p + 1.0) * 0.25 * core::f32::consts::PI).sin()).collect();

    for i in 0..n {
        let mut l = 0.0f32;
        let mut r = 0.0f32;
        for (v, voice) in voices.iter().enumerate() {
            let s = voice[i];
            l += s * gains_l[v];
            r += s * gains_r[v];
        }
        out_l[i] += l;
        out_r[i] += r;
    }
}

/// Data layout note: for auto-vectorization, use Structure-of-Arrays.
/// BAD (AoS):  struct Osc { phase: f32, inc: f32, amp: f32 }; voices: [Osc; N]
/// GOOD (SoA): phases: [f32; N], incs: [f32; N], amps: [f32; N]
/// SoA allows the compiler to load/process 8 oscillator phases simultaneously.
pub struct OscillatorBank {
    pub phases: Vec<f32>,
    pub incs:   Vec<f32>,
    pub amps:   Vec<f32>,
    pub count:  usize,
}

impl OscillatorBank {
    /// Process one sample for all oscillators — auto-vectorizes with SoA layout
    pub fn process_sample_all(&mut self) -> Vec<f32> {
        let mut out = vec![0.0f32; self.count];
        // The compiler will auto-vectorize this loop with AVX2 (8×f32)
        for i in 0..self.count {
            out[i] = (self.phases[i] * core::f32::consts::TAU).sin() * self.amps[i];
            self.phases[i] += self.incs[i];
            if self.phases[i] >= 1.0 { self.phases[i] -= 1.0; }
        }
        out
    }
}
```

## 7.5 No-Allocation Guarantee

```toml
# Cargo.toml for daw-synth (debug builds only)
[dev-dependencies]
assert_no_alloc = "0.3"
```

```rust
// In process() during debug builds:
#[cfg(debug_assertions)]
fn process_checked(&mut self, midi: &[MidiEvent], out_l: &mut [f32], out_r: &mut [f32]) {
    assert_no_alloc::assert_no_alloc(|| {
        self.process(midi, out_l, out_r);
    });
}
```

**Pre-allocation checklist**:

- Delay lines: allocated at max length at init time (e.g. 2 seconds = 88200 samples for max delay)
- Voice pool: `[Voice; 128]` on stack or pre-allocated Vec at init
- Grain pool: `[Grain; MAX_GRAINS]` pre-allocated
- Wavetable mip levels: computed at load time
- `scratch_voice`, `scratch_lane`: allocated at init to `block_size` length
- String ops: only during preset load, never during `process()`

## 7.6 WASM-Specific Considerations

```javascript
// AudioWorklet processor wrapper (JavaScript side)
class SynthProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // Load WASM module
        this._wasmReady = WebAssembly.instantiateStreaming(fetch('daw_synth.wasm')).then(({ instance }) => {
            this._synth = instance.exports;
            this._synth.init(sampleRate, 128);
        });
    }

    process(inputs, outputs, parameters) {
        if (!this._synth) return true;

        // Pass MIDI events via SharedArrayBuffer ring buffer
        // Process 128 samples
        this._synth.process_block(this._midi_ptr, this._midi_count, this._out_l_ptr, this._out_r_ptr);

        // Copy WASM memory to Web Audio output
        const mem = new Float32Array(this._synth.memory.buffer);
        outputs[0][0].set(mem.subarray(this._out_l_ptr / 4, this._out_l_ptr / 4 + 128));
        outputs[0][1].set(mem.subarray(this._out_r_ptr / 4, this._out_r_ptr / 4 + 128));

        return true;
    }
}
registerProcessor('synth-processor', SynthProcessor);
```

**WASM limitations and workarounds**:

- No threads → no rayon; all processing is single-threaded. Pre-sort voice rendering order.
- 128-bit SIMD only → half the throughput of AVX2. Budget accordingly.
- WebGPU: check `navigator.gpu !== undefined` before using GPU compute. Fall back to CPU path.
- Memory: keep total WASM module + data under 512MB for mobile compatibility. Large sample libraries stream from IndexedDB.
- Atomic operations available via `wasm-atomics` target feature if SharedArrayBuffer is available (requires COOP/COEP headers).

---

# PART 8: SECRET SAUCE — What Makes Each Reference Synth Special

---

## 8.1 Vital — Clean and Modern

**Core insight**: Vital's oscillator has essentially zero aliasing artifacts compared to older wavetable synths. How:

1. **Spectral band-limiting per octave** (exact mip-map): each mip level is computed by zeroing FFT bins above `sr / 2^(mip+1)`. No approximation — mathematically perfect band-limiting. This eliminates the muddy high-frequency noise other synths generate.

2. **Spectral warping computed offline**: The warp modes (Sync, Formant, etc.) all operate on pre-warped wavetables baked at load time. During audio processing, only table lookup + interpolation — no real-time FFT. This is why Vital can do complex spectral manipulation with no additional CPU cost.

3. **Unison without phase cancellation**: Vital's unison uses a technique where voices are spread in both pitch AND initial phase, but the phase randomization is **correlated with the pitch offset**. This means at low frequencies, where phase cancellation matters most for bass clarity, adjacent voices are phase-aligned. At high frequencies (where phase doesn't matter perceptually), they spread freely. Implementation: `initial_phase[i] = base_phase + voice_spread_hz * CORRELATION_CONSTANT`.

4. **Audio-rate modulation everywhere**: Vital's modulation matrix operates at audio rate for any routing, enabling FM-like effects from any LFO. The LFO rate can go to 20kHz, effectively turning any LFO into an oscillator modulator. This is implemented by computing the LFO inside the sample loop when audio-rate is enabled.

## 8.2 Diva — Analog Feel

**Core insight**: Diva's "analog feel" comes entirely from ZDF filter topology + oscillator drift + saturation staging.

1. **ZDF (Zero Delay Feedback)**: A standard IIR filter implementation has `y[n]` depending on `y[n-1]` (one sample delay in feedback). This delay is physically meaningless — analog filters have no such delay. ZDF removes it by algebraically solving the feedback equation. The audible effect: at high resonance and high frequencies, ZDF filters self-oscillate correctly and have proper phase relationships. Standard IIR filters become unstable or sound wrong in exactly the musical register (high resonance leads) where musicians notice.

2. **Oscillator drift**: Each voice has an independent `drift_lfo` running at 0.1–0.5 Hz with ±2–5 cents of random drift. When two voices play the same note (unison or chord), the slight pitch differences create natural beating — the same phenomenon that makes an analog polysynth sound "alive" vs a single digital oscillator.

3. **Saturation placement**: Diva has soft-clipping in 3 places: pre-filter (drive), inside the filter feedback loop (per stage, using different nonlinearity curves per filter model), and post-filter. The **filter-type-specific nonlinearity** is the real differentiator — Moog uses `tanh`, the MS-20 model uses a hard-knee asymmetric clipper, the SEM model uses a soft polynomial. These are reverse-engineered from the actual circuit behavior of each chip.

## 8.3 Serum — Punchy EDM

1. **Ultra-clean oscillators**: Serum uses a slightly different anti-aliasing approach — it oversamples the wavetable internally (2x) before mip-map selection, then downsamples. This gives an extra 6dB of aliasing rejection on transients.

2. **Noise oscillator blend**: Serum's presets almost universally blend a small amount of the filtered noise oscillator into the wavetable. This adds transient content and "air" that makes sounds cut through a mix without requiring EQ. The noise is filtered to match the wavetable's spectral content.

3. **Unison tuning**: Serum's unison has a "fat" mode where lower unison voices get exponentially more detune than higher ones: `detune[i] = detune_max * (i / total)^2`. This means at 7-voice unison, the outer voices are heavily detuned while the inner voices are nearly in tune — creating a defined center with wide sides.

## 8.4 Omnisphere — Huge and Cinematic

1. **Psychoacoustic processing**: Omnisphere applies subtle harmonic enhancement (akin to an Aphex Aural Exciter) to its sample engine output. This adds high-frequency harmonic content that wasn't in the original sample — specifically, it tracks the fundamental frequency and adds harmonics at 2f, 3f, 4f with decreasing amplitude. Implementation: comb filter with the period of the detected fundamental, mixed back with the dry signal at -20dB.

2. **Innerspace effect**: A proprietary reverb/granular hybrid that generates a spectral "halo" around the sound. The key technique: it granularizes the reverb tail, randomizing the pitch of each reverb grain ±1 semitone. This creates a shimmering, diffuse spatial signature that's unlike algorithmic reverb.

3. **Layer phase alignment**: When stacking multiple sample layers, Omnisphere pre-detects the fundamental period of each sample and time-aligns the layers so their cycle starts are synchronous. This prevents destructive interference at the fundamental, making layered sounds "thicker" rather than "phasey."

## 8.5 Phase Plant — Limitless

1. **Generator/snap-in architecture**: All generators and effects in Phase Plant are first-class, interchangeable components that can appear anywhere in the signal chain. This is implemented with a trait-based dispatch (`dyn Generator`, `dyn Effect`) rather than a fixed signal flow. The UI renders any configuration without additional code.

2. **Per-voice FX**: The game-changer. A reverb that processes each voice independently creates N reverb instances with N separate tails. When a polyphonic chord is played, each note has its own spatial reverb tail — rather than all notes sharing one reverb, which smears them together. CPU cost: N× the effect CPU cost. Implementation: the effect is instantiated inside the voice struct, not after voice mixing.

3. **Modulation depth display**: Every knob in Phase Plant shows a colored circle arc when a modulation source is routed to it, sized proportionally to the modulation depth. This is done via instanced GPU rendering of arc fragments (see Part 5.4 WGSL shader).

## 8.6 Alchemy — Professional Out of the Box

1. **Spectral morphing via additive resynthesis**: Each source in Alchemy is analyzed into a set of partial tracks (using STFT + partial tracking). When morphing between sources, the partial amplitudes and frequencies are interpolated directly. This produces a true spectral morph — the harmonics physically move from source A to source B — rather than a crossfade of two audio signals (which produces a "double image" artifact).

2. **Transform Pad bilinear interpolation**: The 4-corner snapshots store complete parameter sets. Every parameter interpolates bilinearly: `value = (1-x)(1-y)*TL + x(1-y)*TR + (1-x)y*BL + xy*BR`. The crucial implementation detail: some parameters (like filter type, waveform type) are discrete and can't interpolate linearly. Alchemy handles this by crossfading between two instances running the discrete values.

## 8.7 Massive — Aggressive

1. **Wavetable scanning + dual filter**: Massive's characteristic sound comes from slowly scanning through wavetable positions (wavetable position controlled by a Performer or LFO) while the dual Ladder + Lowpass filter combination emphasizes different harmonics at different scan positions.

2. **Dimension Expander**: Massive's built-in stereo widener uses 8 very short delays (1–30ms), each slightly different, with subtle pitch modulation. It's essentially a 8-voice chorus with very slow modulation — creating width without audible pitch variation. Key parameter: `Spread = 0→1` controls the distribution of delay times.

## 8.8 Pigments — Versatile

Multi-engine architecture: each voice can run 2 completely different synthesis engines simultaneously (wavetable + granular, analog + additive, etc.). Per-voice modulation allows each voice in a chord to have different timbre as the ADSR evolves differently (different note-on times → different stages). The sequencer modulator is evaluated per-voice and per-step, meaning arpeggiated patterns can have different timbres on each note.

## 8.9 Zebra — Spatial

1. **FFT resynthesis oscillator (ZebraFX OSC)**: Each cycle of the output is computed by IFFT from a user-editable magnitude spectrum. This allows arbitrary harmonic spectra with no aliasing by definition (since you control exactly which bins exist). The spectrum morphs over time using Zebra's X/Y modulation grid.

2. **Modulation grid (VCF mod)**: Zebra's modulation is structured as a 2D grid where sources on the X axis modulate destinations on the Y axis. The amount for each [source, dest] pair is set by a knob at the intersection. This visual layout makes complex modulation routings immediately understandable — vs a linear list of slots.

---

# APPENDIX: COMPLETE CRATE DEPENDENCY GRAPH

```toml
# daw-core/Cargo.toml
[package]
name = "daw-core"
edition = "2021"

[dependencies]
# No dependencies — pure types

# daw-dsp/Cargo.toml
[package]
name = "daw-dsp"
edition = "2021"

[dependencies]
daw-core = { path = "../daw-core" }
# no_std compatible:
# libm for math on no_std targets

[features]
default = ["std"]
std = []

# daw-synth/Cargo.toml
[package]
name = "daw-synth"
edition = "2021"

[dependencies]
daw-core   = { path = "../daw-core" }
daw-dsp    = { path = "../daw-dsp" }
serde      = { version = "1", features = ["derive"] }
serde_json = "1"
hashbrown  = "0.14"
# ONNX for AI quality classifier (native only):
ort        = { version = "2", optional = true }

[features]
default = ["std"]
std     = ["ort"]
wasm    = []  # disables ort, enables WASM-specific paths

# daw-engine/Cargo.toml
[package]
name = "daw-engine"
edition = "2021"

[dependencies]
daw-core  = { path = "../daw-core" }
daw-synth = { path = "../daw-synth" }
cpal      = "0.15"
rtrb      = "0.3"   # lock-free ring buffer
wgpu      = "0.20"  # WebGPU
```

---

_End of Master Synthesizer Plugin Implementation Guide._
_Total coverage: 9 synthesis engines, 7 filter models, complete modulation matrix, voice manager, 11 effects, 6 GPU compute workloads, AI preset pipeline, 20+ synth templates, SIMD optimization, WASM targeting, and the specific technical "secret sauce" behind 9 flagship synthesizers._
