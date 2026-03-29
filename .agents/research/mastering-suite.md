# Proof — Mastering Suite: Complete Implementation Specification

> **For Sourdaw** · Tauri v2 + Rust DSP backend, React 19 frontend  
> Status: Implementation-ready research document for AI coding agents  
> Rivals: iZotope Ozone 11, FabFilter Pro chain, IK T-RackS, Brainworx bx_masterdesk, Waves Abbey Road TG Mastering

---

## Table of Contents

1. [Mastering Signal Chain Architecture](#part-1)
2. [Mastering EQ](#part-2)
3. [Multiband Dynamics](#part-3)
4. [Stereo Processing](#part-4)
5. [Harmonic Exciter / Saturation](#part-5)
6. [Final Limiter (Crust integration)](#part-6)
7. [Comprehensive Metering](#part-7)
8. [AI-Assisted Mastering](#part-8)
9. [UI/UX — 5-Level Progressive Disclosure](#part-9)
10. [The Secret Sauce — Mastering Philosophy](#part-10)

---

## Part 1: Mastering Signal Chain Architecture {#part-1}

### 1.1 The Standard Chain (and why this order)

The canonical mastering signal chain, from Ozone's own documentation and widespread professional consensus:

```
┌─────────────────────────────────────────────────────┐
│                    PROOF CHAIN                       │
│                                                     │
│  ┌──────┐  ┌────┐  ┌──────────┐  ┌────────┐        │
│  │ IN   │→ │ EQ │→ │ DYNAMICS │→ │STEREO  │→       │
│  │METER │  │    │  │(Multiband│  │IMAGER  │        │
│  └──────┘  └────┘  │Comp/Exp) │  └────────┘        │
│                    └──────────┘       │             │
│       ┌───────────────────────────────┘             │
│       ↓                                             │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐            │
│  │HARMONIC │→ │LIMITER  │→ │  OUT     │            │
│  │EXCITER  │  │(Crust)  │  │  METER   │            │
│  └─────────┘  └─────────┘  └──────────┘            │
└─────────────────────────────────────────────────────┘
```

**Rationale for each stage position:**

| Stage              | Position      | Reason                                                                             |
| ------------------ | ------------- | ---------------------------------------------------------------------------------- |
| Input Metering     | First         | Establish baseline LUFS, true peak, LRA before any processing                      |
| EQ (subtractive)   | Second        | Remove problems before amplifying them with dynamics and limiting                  |
| Multiband Dynamics | Third         | Shape dynamics in the corrected spectral context                                   |
| Stereo Imager      | Fourth        | Adjust width after dynamics so width changes don't confuse compressors             |
| Harmonic Exciter   | Fifth         | Add harmonics after dynamics; compressing after exciter would reduce the harmonics |
| Final Limiter      | Last          | Always last — the ceiling is absolute                                              |
| Output Metering    | After limiter | Measure the deliverable                                                            |

**Ozone 11 actual module list** (from the Ozone 11 manual): Clarity, Dynamic EQ, Dynamics, Equalizer 1, Equalizer 2, Exciter, Imager, Impact, Bass Concentration, Master Rebalance, Matching EQ, Maximizer, Spectral Shaper, Tonal Balance Control, Vintage Compressor, Vintage EQ, Vintage Limiter, Vintage Tape. All are drag-to-reorder.

**Practical mastering chain from professionals:**

```
Subtractive EQ → Vintage Tape/Saturation → Harmonic Exciter →
Upward Compression (Dynamics) → Additive Dynamic EQ →
Stereo Imager → Vintage Limiter → Maximizer
```

### 1.2 Reorderable Module Architecture

Each module is a node in an audio processing graph. The Rust DSP implementation must:

```rust
pub trait MasteringModule: Send + Sync {
    fn process(&mut self, buffer: &mut AudioBuffer<f32>);
    fn bypass(&self) -> bool;
    fn set_bypass(&mut self, bypass: bool);
    fn latency_samples(&self) -> usize;  // for compensation
    fn module_id(&self) -> ModuleId;
}

pub struct ProofChain {
    modules: Vec<Box<dyn MasteringModule>>,
    // Inline metering taps between modules
    meter_taps: Vec<MeterTap>,
}

impl ProofChain {
    pub fn reorder(&mut self, from: usize, to: usize) {
        // drag-to-reorder: remove and re-insert
        let module = self.modules.remove(from);
        self.modules.insert(to, module);
        self.recalculate_latency_compensation();
    }

    fn recalculate_latency_compensation(&mut self) {
        // Sum latency of all linear-phase modules
        // Apply delay compensation to IIR/non-latency modules to align
        let total_latency: usize = self.modules.iter()
            .map(|m| m.latency_samples())
            .sum();
        // Report to host via plugin API
    }
}
```

### 1.3 Latency and Linear Phase Considerations

Linear phase EQ and FIR crossovers add significant latency:

| Processing                         | Typical Latency @ 44.1kHz |
| ---------------------------------- | ------------------------- |
| IIR biquad EQ                      | 0 samples                 |
| Linear phase EQ (2048-tap FIR)     | 1024 samples (~23ms)      |
| Linear phase EQ (8192-tap FIR)     | 4096 samples (~93ms)      |
| Linear phase crossover (multiband) | 4096–8192 samples         |
| Look-ahead limiter                 | 512–2048 samples          |

**Implementation rule:** Report total plugin latency to the DAW host via `set_latency_samples()`. The DAW will compensate by delaying all other tracks. In Proof, show a "Latency" indicator in the UI showing current reported latency.

### 1.4 Inline Metering Taps

Between each module, Proof should insert a lightweight level-reading tap (peak + RMS, non-blocking ring buffer read). This enables Ozone-style "signal level between modules" display without adding processing overhead.

```rust
pub struct MeterTap {
    peak_l: AtomicF32,
    peak_r: AtomicF32,
    rms_l: AtomicF32,
    rms_r: AtomicF32,
}
```

---

## Part 2: Mastering EQ {#part-2}

### 2.1 Minimum Phase EQ — IIR Biquad (Robert Bristow-Johnson Cookbook)

The foundation. Every EQ band is a biquad filter in Direct Form I:

```
y[n] = (b0/a0)*x[n] + (b1/a0)*x[n-1] + (b2/a0)*x[n-2]
                    - (a1/a0)*y[n-1] - (a2/a0)*y[n-2]
```

**Intermediate variables** (computed once per parameter change):

```
A  = 10^(dBgain/40)          [for peaking/shelving only]
w0 = 2π * f0 / Fs
α  = sin(w0) / (2*Q)         [general form]
```

**Bell (Peaking EQ):**

```
b0 =  1 + α*A
b1 = -2*cos(w0)
b2 =  1 - α*A
a0 =  1 + α/A
a1 = -2*cos(w0)
a2 =  1 - α/A
```

**Low Shelf:**

```
b0 =    A*[ (A+1) - (A-1)*cos(w0) + 2*sqrt(A)*α ]
b1 =  2*A*[ (A-1) - (A+1)*cos(w0)               ]
b2 =    A*[ (A+1) - (A-1)*cos(w0) - 2*sqrt(A)*α ]
a0 =       (A+1) + (A-1)*cos(w0) + 2*sqrt(A)*α
a1 =   -2*[ (A-1) + (A+1)*cos(w0)               ]
a2 =        (A+1) + (A-1)*cos(w0) - 2*sqrt(A)*α
```

**High Shelf:**

```
b0 =    A*[ (A+1) + (A-1)*cos(w0) + 2*sqrt(A)*α ]
b1 = -2*A*[ (A-1) + (A+1)*cos(w0)               ]
b2 =    A*[ (A+1) + (A-1)*cos(w0) - 2*sqrt(A)*α ]
a0 =       (A+1) - (A-1)*cos(w0) + 2*sqrt(A)*α
a1 =    2*[ (A-1) - (A+1)*cos(w0)               ]
a2 =        (A+1) - (A-1)*cos(w0) - 2*sqrt(A)*α
```

**Low Pass:**

```
b0 = (1 - cos(w0))/2
b1 =  1 - cos(w0)
b2 = (1 - cos(w0))/2
a0 =  1 + α
a1 = -2*cos(w0)
a2 =  1 - α
```

**High Pass:**

```
b0 =  (1 + cos(w0))/2
b1 = -(1 + cos(w0))
b2 =  (1 + cos(w0))/2
a0 =   1 + α
a1 =  -2*cos(w0)
a2 =   1 - α
```

**Rust biquad implementation:**

```rust
pub struct BiquadFilter {
    b0_a0: f64, b1_a0: f64, b2_a0: f64,
    a1_a0: f64, a2_a0: f64,
    x1: f64, x2: f64,
    y1: f64, y2: f64,
}

impl BiquadFilter {
    pub fn process(&mut self, x: f64) -> f64 {
        let y = self.b0_a0 * x
              + self.b1_a0 * self.x1
              + self.b2_a0 * self.x2
              - self.a1_a0 * self.y1
              - self.a2_a0 * self.y2;
        self.x2 = self.x1; self.x1 = x;
        self.y2 = self.y1; self.y1 = y;
        y
    }

    pub fn set_peaking(
        &mut self, freq: f64, q: f64, db_gain: f64, sample_rate: f64
    ) {
        let a = 10f64.powf(db_gain / 40.0);
        let w0 = 2.0 * std::f64::consts::PI * freq / sample_rate;
        let alpha = w0.sin() / (2.0 * q);
        let a0 = 1.0 + alpha / a;
        self.b0_a0 = (1.0 + alpha * a) / a0;
        self.b1_a0 = (-2.0 * w0.cos()) / a0;
        self.b2_a0 = (1.0 - alpha * a) / a0;
        self.a1_a0 = (-2.0 * w0.cos()) / a0;
        self.a2_a0 = (1.0 - alpha / a) / a0;
    }
}
```

**Important:** Use `f64` (double precision) for all coefficient arithmetic. Convert to `f32` only at the sample processing boundary if needed for performance.

**Parameter ranges for mastering EQ:**

| Parameter | Range          | Default        |
| --------- | -------------- | -------------- |
| Frequency | 20 Hz – 22 kHz | Band-dependent |
| Gain      | ±18 dB         | 0 dB           |
| Q         | 0.1 – 10.0     | 0.707          |
| Bands     | Up to 8        | 4 active       |

### 2.2 Linear Phase EQ — FIR-Based

Linear phase EQ has zero phase distortion at the cost of latency and pre-ringing.

**Design process:**

1. Compute desired frequency response H(f) at N frequency bins (e.g., N=4096)
2. Apply inverse FFT to get impulse response h[n]
3. Apply a window function (Blackman-Harris recommended for mastering — excellent sidelobe rejection)
4. Result is a linear-phase FIR filter of length N

```rust
use rustfft::{FftPlanner, num_complex::Complex};

pub struct LinearPhaseEq {
    fir_coeffs: Vec<f32>,
    overlap_add: OverlapAddConvolver,
    latency: usize,
}

impl LinearPhaseEq {
    pub fn build_from_bands(bands: &[EqBand], fft_size: usize, sr: f64) -> Self {
        let mut h_magnitude = vec![1.0f64; fft_size / 2 + 1];

        // Accumulate gain from all bands at each frequency bin
        for i in 0..=fft_size / 2 {
            let freq = i as f64 * sr / fft_size as f64;
            for band in bands {
                h_magnitude[i] *= band.gain_at(freq);
            }
        }

        // Build symmetric complex spectrum (linear phase = symmetric impulse response)
        let mut spectrum = vec![Complex::new(0.0f64, 0.0); fft_size];
        for i in 0..=fft_size / 2 {
            spectrum[i] = Complex::new(h_magnitude[i], 0.0);
            if i > 0 && i < fft_size / 2 {
                spectrum[fft_size - i] = Complex::new(h_magnitude[i], 0.0);
            }
        }

        // IFFT to get impulse response
        let mut planner = FftPlanner::new();
        let ifft = planner.plan_fft_inverse(fft_size);
        ifft.process(&mut spectrum);

        // Apply Blackman-Harris window
        let mut h: Vec<f32> = spectrum.iter().enumerate().map(|(n, c)| {
            let w = blackman_harris(n, fft_size);
            (c.re / fft_size as f64 * w) as f32
        }).collect();

        // Circularly shift so the peak is at center (causal + linear phase)
        h.rotate_right(fft_size / 2);

        let latency = fft_size / 2;
        Self {
            fir_coeffs: h,
            overlap_add: OverlapAddConvolver::new(fft_size),
            latency,
        }
    }
}

fn blackman_harris(n: usize, len: usize) -> f64 {
    let x = 2.0 * std::f64::consts::PI * n as f64 / (len - 1) as f64;
    0.35875 - 0.48829 * x.cos() + 0.14128 * (2.0 * x).cos() - 0.01168 * (3.0 * x).cos()
}
```

**When to use linear phase vs minimum phase:**

- Linear phase: final mastering polish, when phase coherence is critical (e.g., classical, acoustic)
- Minimum phase: when you need zero latency (real-time monitoring), or want the "analog" phase character
- **Pre-ringing:** Linear phase EQ will ring _before_ transients if cuts are steep. Keep cuts gentle (≤6dB) and use wide Q in linear phase mode.

### 2.3 Dynamic EQ

A Dynamic EQ band acts like an EQ only when the signal in that frequency range crosses a threshold. It is a hybrid of a bell EQ band and a compressor/expander.

**Algorithm:**

```
1. Bandpass-filter the input → sidechain signal
2. Compute envelope of sidechain:
   env[n] = α_release * env[n-1] + (1 - α_release) * |sidechain[n]|  if |sidechain| < env
           α_attack  * env[n-1] + (1 - α_attack)  * |sidechain[n]|  otherwise
3. Compute gain reduction:
   if env > threshold:
     GR_dB = (env_dB - threshold_dB) * (1/ratio - 1)  [compression]
   else:
     GR_dB = 0  [no processing below threshold]
4. Apply GR_dB as gain to the EQ band (scale the biquad output by dB_to_linear(GR_dB))
```

**Rust sketch:**

```rust
pub struct DynamicEqBand {
    band_filter: BiquadFilter,       // bandpass for sidechain detection
    eq_filter: BiquadFilter,         // the actual EQ band to modulate
    envelope: f32,
    attack_coeff: f32,               // α = exp(-1 / (attack_ms * sr / 1000))
    release_coeff: f32,
    threshold_lin: f32,
    ratio: f32,                      // > 1 = compress, < 1 = expand
    knee_width_db: f32,
}

impl DynamicEqBand {
    pub fn process(&mut self, input: f32) -> f32 {
        // 1. Sidechain detection via bandpass
        let sidechain = self.band_filter.process(input as f64) as f32;
        let level = sidechain.abs();

        // 2. Envelope follower
        let coeff = if level > self.envelope {
            self.attack_coeff
        } else {
            self.release_coeff
        };
        self.envelope = coeff * self.envelope + (1.0 - coeff) * level;

        // 3. Gain computer (hard knee for simplicity; soft knee optional)
        let env_db = lin_to_db(self.envelope);
        let threshold_db = lin_to_db(self.threshold_lin);
        let gr_db = if env_db > threshold_db {
            (env_db - threshold_db) * (1.0 / self.ratio - 1.0)
        } else {
            0.0
        };

        // 4. Apply to EQ band output (not input directly — modulate the band gain)
        // Rebuild EQ coefficients with modified gain is expensive; instead blend
        // EQ output with dry signal based on GR
        let eq_out = self.eq_filter.process(input as f64) as f32;
        let wet = db_to_lin(gr_db);
        input + (eq_out - input) * wet
    }
}
```

**Parameters:**

- Frequency: 20 Hz – 20 kHz
- Threshold: −60 to 0 dBFS
- Ratio: 1:1 to ∞:1 (expand: 0.1:1 to 1:1)
- Attack: 1 – 200 ms
- Release: 10 – 2000 ms
- Range: max gain change in dB (±24 dB)

### 2.4 Match EQ Algorithm

Match EQ analyzes a reference track and computes a corrective EQ curve to make the input track match the reference spectrally.

**Full algorithm:**

```
1. ANALYSIS PASS (reference track):
   a. Break into overlapping frames (e.g., 8192 samples, 50% overlap)
   b. Apply Hann window to each frame
   c. FFT → magnitude spectrum (in dB)
   d. Average all frames → H_ref[k] (average power spectrum of reference)

2. ANALYSIS PASS (input track):
   d. Same process → H_input[k]

3. DIFFERENCE CURVE:
   H_diff[k] = H_ref[k] - H_input[k]   (in dB, per frequency bin)

4. SMOOTHING:
   a. Apply fractional-octave smoothing (1/3 or 1/6 octave) to H_diff
   b. This prevents extreme narrow corrections that sound unnatural
   c. Smoothing kernel: Gaussian or moving average in log-frequency space
   d. Limit correction range: clamp to ±12 dB per bin

5. FIR FILTER DESIGN:
   a. Convert H_diff_smoothed to linear magnitude
   b. Build linear-phase FIR filter (same as §2.2)
   c. Apply as convolution to the input

6. AMOUNT CONTROL:
   Blend between identity (0%) and full correction (100%)
   Can exceed 100% to over-correct if desired
```

**Octave smoothing in log space:**

```rust
fn smooth_spectrum_fractional_octave(
    spectrum_db: &[f32],
    fraction: f32,  // e.g. 1.0/3.0 for 1/3 octave
    sample_rate: f64,
    fft_size: usize,
) -> Vec<f32> {
    let n_bins = spectrum_db.len();
    let mut smoothed = vec![0.0f32; n_bins];

    for i in 1..n_bins {
        let freq = i as f64 * sample_rate / fft_size as f64;
        let oct_low = freq / 2.0f64.powf(fraction as f64 / 2.0);
        let oct_high = freq * 2.0f64.powf(fraction as f64 / 2.0);

        let bin_low = (oct_low * fft_size as f64 / sample_rate).round() as usize;
        let bin_high = (oct_high * fft_size as f64 / sample_rate)
            .round().min(n_bins as f64 - 1.0) as usize;

        let sum: f32 = spectrum_db[bin_low..=bin_high].iter().sum();
        smoothed[i] = sum / (bin_high - bin_low + 1) as f32;
    }
    smoothed
}
```

### 2.5 Mid/Side EQ

```rust
pub fn mid_side_encode(l: f32, r: f32) -> (f32, f32) {
    let mid  = (l + r) * std::f32::consts::FRAC_1_SQRT_2;
    let side = (l - r) * std::f32::consts::FRAC_1_SQRT_2;
    (mid, side)
}

pub fn mid_side_decode(mid: f32, side: f32) -> (f32, f32) {
    let l = (mid + side) * std::f32::consts::FRAC_1_SQRT_2;
    let r = (mid - side) * std::f32::consts::FRAC_1_SQRT_2;
    (l, r)
}
```

Apply separate EQ instances to mid and side. Common mastering M/S EQ moves:

- Cut side below 80–100 Hz (mono bass compatibility)
- Boost side at 10–16 kHz (air and width)
- Cut mid at 1–3 kHz if vocals are harsh
- Boost mid at 60–120 Hz for bass body

### 2.6 Tonal Balance Target Curves (Harman)

The Harman target curve (research-derived by Sean Olive, Harman Int'l) represents the preferred frequency response for consumer headphones and speakers. For mastering, it defines a "balanced" spectral target.

Approximate Harman curve key points (simplified, for display overlay in spectrum analyzer):

| Freq (Hz) | Target (dBr, relative to 1kHz) |
| --------- | ------------------------------ |
| 20        | −8                             |
| 100       | −3                             |
| 200       | −1                             |
| 1000      | 0 (reference)                  |
| 3000      | +2                             |
| 6000      | −2                             |
| 10000     | −5                             |
| 16000     | −10                            |
| 20000     | −15                            |

**Genre-specific target adjustments:**

- **EDM/Club:** +3–6 dB sub-bass (20–80 Hz), +2 dB presence (3–6 kHz)
- **Classical:** Flat or slight high-shelf boost, minimal EQ
- **Hip-hop:** +4 dB sub (30–60 Hz), +2 dB upper mid (3–5 kHz)
- **Pop/Rock:** Generally close to Harman neutral

---

## Part 3: Multiband Dynamics {#part-3}

### 3.1 Linkwitz-Riley Crossover Filters

The 4th-order Linkwitz-Riley (LR-4) crossover is the professional standard. It consists of two cascaded 2nd-order Butterworth filters (Q = 1/√2 ≈ 0.707).

**Property:** The LP and HP outputs sum to a flat all-pass response (no amplitude coloring at crossover). At the crossover frequency, each output is −6 dB (−3 dB × 2 cascaded stages = correct).

**LR-4 implementation (two cascaded Butterworth biquads):**

```rust
pub struct LR4Crossover {
    lp1: BiquadFilter,
    lp2: BiquadFilter,
    hp1: BiquadFilter,
    hp2: BiquadFilter,
}

impl LR4Crossover {
    pub fn new(cutoff: f64, sample_rate: f64) -> Self {
        // Q = 1/sqrt(2) for Butterworth characteristic
        let q = std::f64::consts::FRAC_1_SQRT_2;
        let mut lp1 = BiquadFilter::default();
        let mut lp2 = BiquadFilter::default();
        let mut hp1 = BiquadFilter::default();
        let mut hp2 = BiquadFilter::default();

        lp1.set_lowpass(cutoff, q, sample_rate);
        lp2.set_lowpass(cutoff, q, sample_rate);
        hp1.set_highpass(cutoff, q, sample_rate);
        hp2.set_highpass(cutoff, q, sample_rate);

        Self { lp1, lp2, hp1, hp2 }
    }

    pub fn process(&mut self, x: f64) -> (f64, f64) {
        let low  = self.lp2.process(self.lp1.process(x));
        let high = self.hp2.process(self.hp1.process(x));
        // Note: hp sum needs polarity flip for flat sum in some implementations
        (low, high)
    }
}
```

**N-band splitter (3–5 bands):**

For 4 bands with crossovers at f1, f2, f3:

1. Split at f1 → low, high_a
2. Split high_a at f2 → low_mid, high_b
3. Split high_b at f3 → high_mid, high

When doing nested splitting, bands above the first split need an all-pass compensation filter applied to the un-split path to maintain phase alignment.

### 3.2 Per-Band Compressor

Feed-forward compressor topology, applied independently per band:

```
Input → Level Detection → Gain Computer → Gain Smoothing → Gain Application → Output
```

**Level detection (RMS with time constant):**

```
x_sq[n]  = x[n]^2
rms[n]   = α * rms[n-1] + (1 - α) * x_sq[n]
level    = sqrt(rms[n])
α        = exp(-1 / (rms_time_ms * Fs / 1000))
```

**Gain computer (soft-knee):**

```
threshold_db = 20 * log10(threshold)
level_db     = 20 * log10(max(level, 1e-9))
distance     = level_db - threshold_db

if 2 * |distance| <= knee_db:
    # In the knee region
    GR_db = (1/ratio - 1) * (distance + knee_db/2)^2 / (2 * knee_db)
elif distance > 0:
    # Above threshold
    GR_db = (1/ratio - 1) * distance
else:
    GR_db = 0
```

**Gain smoothing (ballistics):**

```
if GR_db < gr_smooth[n-1]:  # gain decreasing (attack)
    α = attack_coeff
else:                        # gain increasing (release)
    α = release_coeff

gr_smooth[n] = α * gr_smooth[n-1] + (1 - α) * GR_db
```

**Apply gain:**

```
gain_linear = 10^(gr_smooth[n] / 20) * 10^(makeup_gain_db / 20)
output = input * gain_linear
```

**Parameters per band:**

| Parameter   | Range                    | Default  |
| ----------- | ------------------------ | -------- |
| Threshold   | −60 to 0 dBFS            | −20 dBFS |
| Ratio       | 1:1 to ∞:1               | 2:1      |
| Attack      | 1–200 ms                 | 10 ms    |
| Release     | 10–2000 ms               | 100 ms   |
| Knee        | 0–12 dB                  | 3 dB     |
| Makeup Gain | −12 to +24 dB            | auto     |
| Mode        | Compress / Expand / Gate | Compress |

### 3.3 Auto-Gain Compensation

For transparent multiband compression, compute approximate gain reduction and apply inverse:

```rust
fn auto_makeup_gain_db(threshold_db: f32, ratio: f32) -> f32 {
    // Approximate: for a typical program level of -18 dBFS RMS,
    // estimate how much gain reduction occurs and compensate.
    // Simple approximation: return half the threshold-above-average-level
    // Full implementation: measure actual GR over a training pass.
    let approx_program_level_db = -18.0;
    let excess = (approx_program_level_db - threshold_db).max(0.0);
    excess * (1.0 - 1.0 / ratio)
}
```

### 3.4 Expander/Gate Mode

Below threshold, apply downward expansion:

```
if level_db < threshold_db:
    GR_db = (ratio - 1) * (threshold_db - level_db)  [downward expansion]
else:
    GR_db = 0
```

With ratio = ∞:1, this becomes a noise gate.

### 3.5 Ozone "Low End Focus" Concept

Low End Focus specifically targets the 20–120 Hz sub-bass band with a combination of:

1. **Sub-compressor:** Compress only the sub band (20–80 Hz) with a fast attack to tighten kick/bass transients
2. **Sub-expander:** Expand the same band (increase contrast between loud and quiet moments) for more punch
3. **Harmonic enhancement:** Add even harmonics to sub to increase perceived bass on small speakers
4. **Mono enforcement below 80 Hz:** Ensure sub is phase-coherent

In Proof, implement this as a preset for the Multiband Dynamics + Stereo sections:

- Band 1: 20–120 Hz, compression ratio 2:1, fast attack (5ms), medium release (100ms)
- Sub-harmonic generator: add 2nd harmonic (+6–12 dB at 40–80 Hz octave above)
- Auto mono below 80 Hz

### 3.6 Per-Band Solo Monitoring

```rust
pub enum BandMonitorMode {
    AllBands,
    Solo(usize),      // which band index
    SoloCompare,      // A/B between solo and full
}
```

When solo is active, route only that band's output to the output and silence others.

---

## Part 4: Stereo Processing {#part-4}

### 4.1 Mid/Side Encoding

(See §2.5 for encode/decode formulas)

The √2 normalization factor preserves total power:

- `|M|² + |S|² = |L|² + |R|²`
- Mid/Side processing is power-conserving when M and S levels sum correctly

### 4.2 Stereo Width Control

Width is controlled by adjusting the balance between Mid and Side signals:

```
width = 0.0   → pure mono (Side = 0)
width = 1.0   → original (unity)
width = 2.0   → doubled width (Side × 2, Mid unchanged)
```

**Implementation:**

```rust
pub fn apply_stereo_width(l: f32, r: f32, width: f32) -> (f32, f32) {
    let (mid, side) = mid_side_encode(l, r);
    // width of 1.0 = unity; scale side channel
    let side_gain = width;        // simple linear scale
    let mid_gain  = 2.0 - width;  // reduce mid as width increases (optional)
    let mid_out  = mid * mid_gain;
    let side_out = side * side_gain;
    mid_side_decode(mid_out, side_out)
}
```

More sophisticated implementation interpolates on a curve (perceptual, not linear):

```
effective_side_gain = width^1.5   // slightly faster than linear for perceptual uniformity
```

### 4.3 Per-Band Stereo Width

Apply different width values in different frequency bands using the same LR-4 crossover bank from §3.1:

```
Band 1 (sub, 0–120 Hz):   width = 0.0 (mono bass)
Band 2 (low, 120–500 Hz): width = 0.8 (slightly narrow)
Band 3 (mid, 500–5kHz):   width = 1.0 (unity)
Band 4 (high, 5kHz+):     width = 1.3 (slightly wider for air)
```

Then sum all bands back together. Correct allpass compensation is required.

### 4.4 Mono Compatibility Meter (Correlation)

```
r[n] = Σ(L[i] · R[i]) / sqrt(Σ(L[i]²) · Σ(R[i]²))
```

- **r = +1.0**: Perfectly mono-compatible (L == R)
- **r = 0.0**: Completely uncorrelated
- **r = −1.0**: Fully out of phase (L == -R, will cancel to silence in mono)

Running implementation with smoothing:

```rust
pub struct CorrelationMeter {
    lr_sum: f64,
    l_sq_sum: f64,
    r_sq_sum: f64,
    alpha: f64,    // smoothing coefficient
}

impl CorrelationMeter {
    pub fn process(&mut self, l: f32, r: f32) -> f32 {
        let l = l as f64;
        let r = r as f64;
        self.lr_sum   = self.alpha * self.lr_sum   + (1.0 - self.alpha) * l * r;
        self.l_sq_sum = self.alpha * self.l_sq_sum + (1.0 - self.alpha) * l * l;
        self.r_sq_sum = self.alpha * self.r_sq_sum + (1.0 - self.alpha) * r * r;

        let denom = (self.l_sq_sum * self.r_sq_sum).sqrt();
        if denom < 1e-9 { return 0.0; }
        (self.lr_sum / denom) as f32
    }
}
```

### 4.5 Auto Mono Bass

Below a configurable frequency (typically 80–200 Hz), collapse stereo to mono:

```rust
pub fn auto_mono_bass(
    l: f32, r: f32,
    crossover: &mut LR4Crossover,
) -> (f32, f32) {
    let (l_low, l_high) = crossover.process(l as f64);
    let (r_low, r_high) = crossover.process(r as f64);

    // Mono the low band
    let mono_low = (l_low + r_low) * 0.5;

    // Recombine
    let out_l = (mono_low + l_high) as f32;
    let out_r = (mono_low + r_high) as f32;
    (out_l, out_r)
}
```

### 4.6 Vectorscope / Goniometer Rendering

A goniometer rotates the stereo field by 45° and plots each sample as an XY point (Lissajous figure).

**Transform:**

```
X = (L + R) / √2   ← this is Mid
Y = (L - R) / √2   ← this is Side
```

**WebGL/Canvas rendering approach (for React frontend):**

```typescript
// In a React component using canvas/WebGL
function drawVectorscope(
    ctx: CanvasRenderingContext2D,
    samples: Float32Array, // interleaved L/R
    width: number,
    height: number
) {
    const cx = width / 2;
    const cy = height / 2;
    const scale = Math.min(width, height) * 0.45;

    ctx.fillStyle = 'rgba(0, 20, 0, 0.15)'; // decay/persistence
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(0, 255, 80, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = 0; i < samples.length - 1; i += 2) {
        const l = samples[i];
        const r = samples[i + 1];
        const x = (l + r) * INV_SQRT2; // mid → X axis
        const y = (l - r) * INV_SQRT2; // side → Y axis
        const px = cx + x * scale;
        const py = cy - y * scale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, px);
    }
    ctx.stroke();
}
```

For performance, use WebGL with a points shader and a persistence/decay uniform. Each point fades based on time since it was last drawn.

### 4.7 Haas Effect Widening (and why to use carefully)

Haas effect: delay one channel by 1–30 ms. Makes stereo wider perceptually, but **collapses to a flange comb filter when summed to mono**. For mastering:

- Maximum 20 ms Haas delay
- Always check correlation meter after applying
- Prefer M/S width control over Haas for mastering
- Haas is best for effect tracks, not full masters

---

## Part 5: Harmonic Exciter / Saturation {#part-5}

### 5.1 Saturation Character Types

| Character  | Harmonic Emphasis         | Wave Shape                        | Use Case             |
| ---------- | ------------------------- | --------------------------------- | -------------------- |
| Tape       | Even harmonics (2nd, 4th) | Soft symmetric tanh               | Warmth, glue         |
| Tube       | Even + odd (2nd, 3rd)     | Asymmetric soft-clip              | Richness, presence   |
| Transistor | Odd harmonics (3rd, 5th)  | Hard clip with knee               | Aggression, bite     |
| Retro      | Even, frequency-shaped    | Pre-emphasis + tanh + de-emphasis | Vintage color        |
| Warm       | Subtle even harmonics     | Low-drive tanh                    | Subtle analog warmth |

**Key insight:** A symmetric transfer function `f(x) = -f(-x)` produces only **odd harmonics** (3rd, 5th, 7th...). Introducing asymmetry introduces **even harmonics** (2nd, 4th, 6th...). Even harmonics = warmth. Odd harmonics = edge.

`tanh(x)` is symmetric → mostly odd harmonics. To add warmth (even harmonics), add DC bias before the tanh:

```
y = tanh(drive * (x + bias)) - tanh(bias)
```

### 5.2 Tape Saturation Algorithm

Tape emulation = pre-emphasis EQ + soft saturation + de-emphasis EQ + HF softening + subtle compression behavior.

```rust
pub struct TapeSaturator {
    pre_emphasis:  BiquadFilter,   // boost HF before saturation
    de_emphasis:   BiquadFilter,   // cut HF after saturation
    hf_damping:    BiquadFilter,   // 1-pole LP for tape HF rolloff
    drive: f32,
    bias: f32,                     // small DC offset for even harmonics
}

impl TapeSaturator {
    pub fn process_sample(&mut self, x: f32) -> f32 {
        // Pre-emphasis: boost highs before saturation (models tape record EQ)
        let x_pre = self.pre_emphasis.process(x as f64) as f32;

        // Soft saturation with bias for even harmonics
        let driven = self.drive * (x_pre + self.bias);
        let saturated = driven.tanh() - self.bias.tanh();

        // De-emphasis: cut highs after saturation
        let x_de = self.de_emphasis.process(saturated as f64) as f32;

        // HF damping: tape doesn't preserve ultra-high frequencies
        self.hf_damping.process(x_de as f64) as f32
    }
}
```

**Pre/de-emphasis EQ settings (approximate Ampex 456 tape EQ):**

- Pre: +6 dB high shelf at 10 kHz
- De: −6 dB high shelf at 10 kHz
- Net result: approximately flat, but saturation happens on boosted HF → more even harmonics in high frequencies

**Tape compression behavior:**
Tape also applies subtle frequency-dependent compression (high frequencies are compressed more than low). Model with a fast-attack compressor on the high band after pre-emphasis.

### 5.3 Tube Saturation Algorithm

Tubes (triodes like 12AX7) produce a characteristic asymmetric transfer curve — harder clipping on the positive half, softer on the negative.

**Piecewise tube approximation:**

```rust
fn tube_transfer(x: f32, drive: f32) -> f32 {
    let x = x * drive;
    // Positive half: harder clipping
    let pos = if x >= 0.0 {
        1.0 - (-x).exp()  // asymptotic approach to +1
    } else {
        // Negative half: softer, extends further
        -(1.0 - (x * 0.7).exp())
    };
    pos / drive.max(1.0)
}
```

**More accurate: Koren tube model (simplified):**

```
mu = 100    // amplification factor (12AX7)
ex = 1.4    // transfer characteristic exponent
Kg = 1060   // plate constant
Kp = 600    // plate constant

// Plate current formula (simplified):
Ia = (V_gk + Vp/Kp * log(1 + exp(Kp*(1/mu + V_gk/Vp))))^ex / Kg

// For DSP purposes, use a lookup table of the above for speed
```

In practice, a carefully designed asymmetric tanh with bias achieves perceptually equivalent results:

```rust
fn tube_simple(x: f32, drive: f32, asymmetry: f32) -> f32 {
    let pos_drive = drive * (1.0 + asymmetry);
    let neg_drive = drive * (1.0 - asymmetry * 0.5);
    if x >= 0.0 {
        (pos_drive * x).tanh() / pos_drive
    } else {
        (neg_drive * x).tanh() / neg_drive
    }
}
```

### 5.4 Transistor / Solid State Saturation

Transistors clip symmetrically but harder than tape — more odd harmonics, sharper knee.

```rust
fn transistor_clip(x: f32, drive: f32, knee: f32) -> f32 {
    let x = x * drive;
    // Soft-knee clipper: smooth transition to hard clip
    let threshold = 1.0 - knee;
    if x.abs() < threshold {
        x
    } else {
        let excess = x.abs() - threshold;
        let knee_region = excess / (knee + 1e-6);
        let clipped = threshold + knee * (2.0 * knee_region - knee_region * knee_region).max(0.0).min(1.0);
        clipped * x.signum()
    }
}
```

### 5.5 Multi-Band Exciter Architecture

```rust
pub struct MultibandExciter {
    crossovers: Vec<LR4Crossover>,     // e.g., 80Hz, 500Hz, 6kHz
    band_saturators: Vec<BandExciter>,
}

pub struct BandExciter {
    saturator: Box<dyn Saturator>,
    drive: f32,       // 0.0–1.0, how hard to drive
    blend: f32,       // 0.0–1.0, wet/dry mix for this band
    oversampler: Oversampler,  // 2x or 4x
}

impl BandExciter {
    pub fn process(&mut self, x: f32) -> f32 {
        // 1. Upsample
        let upsampled = self.oversampler.upsample(x);
        // 2. Saturate at higher sample rate
        let saturated: Vec<f32> = upsampled.iter()
            .map(|&s| self.saturator.process(s * (1.0 + self.drive * 3.0)))
            .collect();
        // 3. Downsample (includes LP filter to remove aliases)
        let downsampled = self.oversampler.downsample(&saturated);
        // 4. Blend wet with dry (parallel saturation)
        x * (1.0 - self.blend) + downsampled * self.blend
    }
}
```

### 5.6 Oversampling Requirements

| Saturation Type      | Min Oversampling | Recommended |
| -------------------- | ---------------- | ----------- |
| Tape (gentle tanh)   | 2x               | 2x          |
| Tube (asymmetric)    | 2x               | 4x          |
| Transistor (sharper) | 4x               | 4x–8x       |
| Hard clip            | 8x               | 8x–16x      |

**Oversampling filter design:** Use a Kaiser-windowed FIR lowpass at `Fs/2 - guard_band`, with guard band of ~1 kHz. In Rust, the `rubato` crate provides high-quality sample rate conversion.

### 5.7 Why Harmonics Increase Perceived Loudness

Adding harmonics above the fundamental increases the spectral energy at higher frequencies, which the ear is more sensitive to (Fletcher-Munson curves). LUFS meters will read slightly louder because:

1. The K-weighting pre-filter boosts 1–5 kHz region
2. Added harmonic content in this region increases LKFS
3. Perceptually: the mix sounds "louder" and "more present" without actually increasing peak level

This is why subtle saturation is a mastering tool — it increases _perceived_ loudness without increasing true peak level.

---

## Part 6: Final Limiter (Crust Integration) {#part-6}

### 6.1 Crust as an Embedded Module

Proof's limiter should be the exact same Crust DSP code, instantiated as a module in the chain:

```rust
pub struct ProofLimiter {
    crust: CrustLimiter,      // exact same struct as standalone Crust plugin
    dither: DitherProcessor,
}

impl MasteringModule for ProofLimiter {
    fn process(&mut self, buffer: &mut AudioBuffer<f32>) {
        self.crust.process(buffer);
        // Dithering is last — applied after all processing
        if self.dither.enabled {
            self.dither.process(buffer);
        }
    }
}
```

### 6.2 True Peak Detection

Inter-sample peaks exceed 0 dBFS because digital audio is band-limited (between samples, reconstruction filters create peaks higher than any individual sample value).

**ITU-R BS.1770-4 true peak algorithm:**

1. Upsample signal by 4× using a high-quality interpolation filter
2. Measure peak of the upsampled signal
3. This is the true peak (dBTP)

```rust
pub struct TruePeakDetector {
    oversampler: Oversampler4x,
    peak: f32,
}

impl TruePeakDetector {
    pub fn process_block(&mut self, block: &[f32]) -> f32 {
        let upsampled = self.oversampler.process(block);
        for &s in &upsampled {
            self.peak = self.peak.max(s.abs());
        }
        20.0 * self.peak.log10()  // return dBTP
    }
}
```

**Ceiling:** Target −1.0 dBTP for streaming (−0.1 dBTP for safety margin).

### 6.3 Look-Ahead Limiting

```rust
pub struct LookaheadLimiter {
    lookahead_ms: f32,
    delay_buffer: VecDeque<[f32; 2]>,
    gain_buffer: VecDeque<f32>,
    ceiling: f32,
    release_coeff: f32,
    current_gain: f32,
}

impl LookaheadLimiter {
    pub fn process_sample(&mut self, l: f32, r: f32) -> (f32, f32) {
        // Push the current sample into the delay buffer
        self.delay_buffer.push_back([l, r]);

        // Compute future peak (from lookahead window)
        let future_peak = self.gain_buffer
            .iter()
            .map(|&g| g)
            .fold(0.0f32, f32::max);

        // Required gain to bring peak to ceiling
        let peak_lin = future_peak.max(1e-9);
        let required_gain = (self.ceiling / peak_lin).min(1.0);

        // Smooth gain reduction (release only — attack uses look-ahead)
        self.current_gain = if required_gain < self.current_gain {
            required_gain  // instant attack (look-ahead)
        } else {
            self.release_coeff * self.current_gain
                + (1.0 - self.release_coeff) * required_gain
        };

        // Apply gain to delayed sample
        let [dl, dr] = self.delay_buffer.pop_front().unwrap_or([0.0, 0.0]);
        (dl * self.current_gain, dr * self.current_gain)
    }
}
```

### 6.4 IRC Limiter Concepts (iZotope Intelligent Release Control)

iZotope's IRC (IRC I through IRC IV) are proprietary algorithms, but the public characteristics are:

| Algorithm | Character                          | Key Technique                                                                                           |
| --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| IRC I     | "Brickwall" — hard but clean       | Classic look-ahead peak limiting                                                                        |
| IRC II    | More transient preservation        | Frequency-selective gain reduction                                                                      |
| IRC III   | Improved stereo width preservation | M/S linking for gain decisions                                                                          |
| IRC IV    | Most transparent                   | Psychoacoustic model for gain curves; applies minimal gain reduction to perceptually masked frequencies |

**IRC IV–inspired approach:** Rather than applying identical gain reduction to all frequencies, use psychoacoustic masking to apply _less_ gain reduction at frequencies that are masked by loud nearby frequencies. Implement by:

1. FFT the signal
2. Compute masking thresholds per bin (simplified Moore-Glasberg masking model)
3. Compute per-bin gain that brings peaks to ceiling while respecting masking
4. IFFT to get time-domain signal
5. True peak detect and apply a final safety brick-wall limiter

### 6.5 TPDF Dithering Implementation

```rust
pub struct TpdfDither {
    /// Target bit depth (e.g., 16 for CD)
    bit_depth: u32,
    rng: SmallRng,
}

impl TpdfDither {
    pub fn process_sample(&mut self, x: f32) -> f32 {
        // LSB amplitude for target bit depth
        let lsb = 2.0f32.powi(-(self.bit_depth as i32 - 1));

        // Two uniform random numbers in [-0.5 LSB, +0.5 LSB]
        let r1: f32 = self.rng.gen::<f32>() - 0.5;
        let r2: f32 = self.rng.gen::<f32>() - 0.5;

        // TPDF noise = triangular distribution = r1 + r2
        let noise = (r1 + r2) * lsb;

        x + noise
    }
}
```

### 6.6 Noise-Shaped Dithering (Error Feedback)

```rust
pub struct NoiseShapedDither {
    tpdf: TpdfDither,
    error_feedback: Vec<f32>,   // feedback filter state
    feedback_coeffs: Vec<f32>,  // noise shaping filter coefficients
    error_history: VecDeque<f32>,
}

impl NoiseShapedDither {
    pub fn process_sample(&mut self, x: f32) -> f32 {
        // 1. Add shaped error from previous quantization errors
        let shaped_error: f32 = self.feedback_coeffs.iter()
            .zip(self.error_history.iter())
            .map(|(c, e)| c * e)
            .sum();

        let x_dithered = x - shaped_error;

        // 2. Add TPDF dither
        let x_with_dither = self.tpdf.process_sample(x_dithered);

        // 3. Quantize
        let lsb = 2.0f32.powi(-(self.tpdf.bit_depth as i32 - 1));
        let quantized = (x_with_dither / lsb).round() * lsb;

        // 4. Compute quantization error and feed back
        let error = quantized - x_with_dither;
        self.error_history.push_front(error);
        if self.error_history.len() > self.feedback_coeffs.len() {
            self.error_history.pop_back();
        }

        quantized
    }
}
```

**POW-R #1 feedback filter coefficients** (approximation, shapes noise toward Nyquist):

```rust
let pow_r1_coeffs = vec![
    2.033, -2.165, 1.959, -1.590, 0.869, -0.382
];
```

### 6.7 Target Loudness Presets

| Target                    | Integrated LUFS | True Peak | Notes                      |
| ------------------------- | --------------- | --------- | -------------------------- |
| Streaming (Spotify/Apple) | −14 LUFS        | −1 dBTP   | ITU-R BS.1770-4            |
| YouTube                   | −14 LUFS        | −1 dBTP   | Same as streaming          |
| CD (modern)               | −9 to −6 LUFS   | −0.1 dBTP | No streaming normalization |
| Club/DJ                   | −6 LUFS         | −0.5 dBTP | Maximum loudness           |
| Broadcast (EBU R128)      | −23 LUFS ±1 LU  | −1 dBTP   | Television/radio           |
| Podcast                   | −16 LUFS        | −1 dBTP   |                            |

---

## Part 7: Comprehensive Metering {#part-7}

### 7.1 ITU-R BS.1770 LUFS Algorithm (Full Implementation)

**Step 1: K-Weighting Pre-filter (two cascaded IIR filters)**

Stage 1 — High-frequency shelf (models acoustic effect of listener's head):

```
At 48 kHz:
b0 =  1.53512485958697
b1 = -2.69169618940638
b2 =  1.19839281085285
a1 = -1.69065929318241
a2 =  0.73248077421585
```

Stage 2 — High-pass filter (RLB weighting, cuts below ~100 Hz):

```
At 48 kHz:
b0 =  1.0
b1 = -2.0
b2 =  1.0
a1 = -1.99004745483398
a2 =  0.99007225036688
```

**At other sample rates:** Pre-warp the cutoff frequencies and redesign using the bilinear transform. Use the `biquad_from_analog` approach.

**Step 2: Mean square per channel**

```
x_sq_mean = (1/N) * Σ y_k[i]^2    (y_k = K-weighted samples for channel k)
```

**Step 3: Channel-weighted sum**

```
z = Σ G_i * x_sq_mean_i
    where G_i = 1.0 for L, R, C (and 1.0 for surround, historically 1.5 dB boost)
    For stereo: z = (x_sq_mean_L + x_sq_mean_R) / 2
```

**Step 4: Loudness computation**

```
L_block = -0.691 + 10 * log10(z)     [LUFS]
```

**Step 5: Gating (for Integrated LUFS)**

Compute loudness of 400 ms blocks (hop = 100 ms, 75% overlap):

```rust
pub struct IntegratedLufsCalculator {
    k_filter_l: [BiquadFilter; 2],
    k_filter_r: [BiquadFilter; 2],
    block_buffer: Vec<f32>,           // 400ms of samples
    block_hop: usize,                 // 100ms hop
    blocks_above_absolute: Vec<f64>, // all blocks > -70 LUFS
    sample_count: usize,
}

impl IntegratedLufsCalculator {
    pub fn process_block(&mut self, l: &[f32], r: &[f32]) -> f32 {
        for (&sl, &sr) in l.iter().zip(r.iter()) {
            // K-weight each channel
            let wl = self.k_filter_l[1].process(
                       self.k_filter_l[0].process(sl as f64)) as f32;
            let wr = self.k_filter_r[1].process(
                       self.k_filter_r[0].process(sr as f64)) as f32;
            self.accumulate(wl, wr);
        }
        self.integrated_lufs()
    }

    fn integrated_lufs(&self) -> f32 {
        // Absolute gate: -70 LUFS
        let above_absolute: Vec<f64> = self.blocks_above_absolute.iter()
            .copied()
            .filter(|&b| b > -70.0)
            .collect();

        if above_absolute.is_empty() { return f32::NEG_INFINITY; }

        // Relative gate: 10 LU below mean of above-absolute blocks
        let mean_absolute = above_absolute.iter().sum::<f64>() / above_absolute.len() as f64;
        let relative_threshold = mean_absolute - 10.0;

        let above_relative: Vec<f64> = above_absolute.iter()
            .copied()
            .filter(|&b| b > relative_threshold)
            .collect();

        if above_relative.is_empty() { return f32::NEG_INFINITY; }

        let integrated = above_relative.iter().sum::<f64>() / above_relative.len() as f64;
        integrated as f32
    }
}
```

**Momentary LUFS:** 400 ms sliding window, no gating
**Short-term LUFS:** 3000 ms sliding window, no gating

### 7.2 Loudness Range (LRA)

LRA measures the variation of loudness within a programme. High LRA = highly dynamic (classical), low LRA = compressed (EDM).

```
1. Compute short-term loudness every 100 ms (3s window)
2. Apply gating: exclude blocks below -70 LUFS (absolute gate)
3. Apply relative gate: exclude blocks below (overall integrated - 20 LU)
4. Sort remaining blocks by loudness value
5. LRA = (95th percentile) - (10th percentile)   [in LU]
```

Typical values:

- Classical music: LRA 15–25 LU
- Pop/rock: LRA 6–12 LU
- Heavily compressed pop: LRA 2–6 LU
- EBU R128 recommendation: LRA < 20 LU for broadcast

### 7.3 FFT Spectrum Analyzer

```rust
pub struct SpectrumAnalyzer {
    fft_size: usize,           // 4096 or 8192
    window: Vec<f32>,          // Hann or Blackman-Harris
    overlap: usize,            // 50% overlap
    input_buffer: Vec<f32>,
    magnitude_db: Vec<f32>,    // current frame
    peak_hold: Vec<f32>,       // peak hold
    peak_decay: f32,           // dB per frame decay rate
}

impl SpectrumAnalyzer {
    pub fn process(&mut self, samples: &[f32]) {
        // Overlap-add input
        self.input_buffer.extend_from_slice(samples);

        while self.input_buffer.len() >= self.fft_size {
            let frame: Vec<f32> = self.input_buffer[..self.fft_size]
                .iter()
                .zip(&self.window)
                .map(|(s, w)| s * w)
                .collect();

            // FFT
            let mut complex_frame: Vec<Complex<f32>> = frame.iter()
                .map(|&s| Complex::new(s, 0.0))
                .collect();
            // ... run FFT, compute magnitude

            // Convert to dB and apply octave smoothing
            for (i, c) in complex_frame[..self.fft_size/2].iter().enumerate() {
                let mag_db = 20.0 * c.norm().log10();
                // Smooth with previous frame (temporal averaging)
                self.magnitude_db[i] = 0.8 * self.magnitude_db[i] + 0.2 * mag_db;
                // Peak hold
                if mag_db > self.peak_hold[i] {
                    self.peak_hold[i] = mag_db;
                } else {
                    self.peak_hold[i] -= self.peak_decay;
                }
            }
            // Advance by hop size
            self.input_buffer.drain(..self.fft_size / 2);
        }
    }
}
```

**Octave smoothing for display:** Aggregate FFT bins into fractional-octave bands (1/6 or 1/3 octave) using the smoothing algorithm from §2.4 for a professional-looking spectrum display.

### 7.4 Crest Factor / PLR

```
Crest Factor = Peak_dBFS - RMS_dBFS
PLR (Peak-to-Loudness Ratio) = True_Peak_dBTP - Integrated_LUFS
```

High PLR = dynamic content (classical: PLR 20+). Low PLR = compressed (loud EDM: PLR 6–8).

Bob Katz recommends monitoring PLR. Streaming services' normalization effectively rewards higher PLR — a dynamic master normalized up sounds better than a compressed master normalized down.

### 7.5 A/B Comparison with Auto Gain-Matching

```rust
pub struct AbComparison {
    state: AbState,
    a_lufs: f32,      // measured input LUFS
    b_lufs: f32,      // measured output LUFS
}

impl AbComparison {
    pub fn gain_match_offset_db(&self) -> f32 {
        // When listening to A (bypass): offset output to match B loudness
        // When listening to B (processed): no offset
        match self.state {
            AbState::A => self.b_lufs - self.a_lufs,  // bring A up to match B
            AbState::B => 0.0,
        }
    }
}
```

**Critical:** Without gain matching, the processed (louder) signal always sounds better due to the psychoacoustic "louder = better" effect. Auto gain-matching eliminates this bias, enabling honest processing evaluation.

---

## Part 8: AI-Assisted Mastering {#part-8}

### 8.1 Analysis Features

Before AI can suggest settings, extract audio features from the input:

```rust
pub struct MasteringAnalysis {
    // Loudness
    integrated_lufs: f32,
    short_term_lufs_max: f32,
    lra: f32,
    true_peak_db: f32,
    plr: f32,

    // Spectral
    spectral_centroid_hz: f32,       // "brightness" measure
    spectral_flatness: f32,          // 0=tonal, 1=noise-like
    bass_energy_ratio: f32,          // 20-300Hz / total
    mid_energy_ratio: f32,           // 300-3kHz / total
    high_energy_ratio: f32,          // 3kHz+ / total
    tonal_balance_deviation: f32,    // deviation from Harman curve

    // Dynamics
    crest_factor_db: f32,
    dynamic_range_db: f32,

    // Stereo
    stereo_correlation: f32,
    stereo_width_rms: f32,           // RMS of side signal
    has_mono_bass: bool,             // is bass already mono?
}
```

### 8.2 Heuristic Rule Engine

Given analysis results, apply rules to suggest initial settings:

```rust
pub fn suggest_settings(analysis: &MasteringAnalysis) -> MasteringSuggestion {
    let mut sug = MasteringSuggestion::default();

    // --- EQ suggestions ---
    if analysis.bass_energy_ratio > 0.35 {
        // Too much bass
        sug.eq.push(EqBandSuggestion {
            freq: 80.0, gain_db: -2.0, q: 0.7,
            reason: "Reduce excess bass buildup".into(),
        });
    }
    if analysis.tonal_balance_deviation > 3.0 {
        // Far from Harman target — suggest matching
        sug.use_match_eq = true;
        sug.match_eq_target = MatchTarget::Harman;
    }

    // --- Dynamics suggestions ---
    if analysis.lra > 18.0 {
        // Very dynamic — suggest gentle compression
        sug.dynamics.ratio = 1.5;
        sug.dynamics.threshold_db = -20.0;
        sug.dynamics.attack_ms = 30.0;
        sug.dynamics.release_ms = 200.0;
    } else if analysis.lra < 4.0 {
        // Already very compressed — suggest minimal dynamics
        sug.dynamics.bypass = true;
    }

    // --- Stereo suggestions ---
    if analysis.stereo_correlation < 0.3 {
        sug.stereo.auto_mono_bass = true;
        sug.stereo.mono_bass_freq = 80.0;
    }

    // --- Limiter suggestions ---
    let headroom_needed = -14.0 - analysis.integrated_lufs;
    sug.limiter.gain_db = headroom_needed.min(6.0);  // never more than 6dB of lifting
    sug.limiter.ceiling_db = -1.0;

    sug
}
```

### 8.3 Reference Track Matching

```
1. User loads a reference track (WAV/AIFF)
2. Analyze reference: compute H_ref[k] (average power spectrum, §2.4)
3. Analyze input: compute H_input[k]
4. Build Match EQ correction curve: H_diff = H_ref - H_input (smoothed)
5. Measure reference integrated LUFS: L_ref
6. Set limiter gain to bring input to L_ref
7. User can control "Match Amount" (0–100%) to blend correction
```

### 8.4 ONNX Model Integration (Future)

For genre classification and more sophisticated mastering decisions, an ONNX model trained on mastering engineer decisions can be integrated via `ort` (ONNX Runtime for Rust):

```rust
use ort::{Environment, Session, SessionBuilder};

pub struct MasteringModel {
    session: Session,
}

impl MasteringModel {
    pub fn predict(&self, features: &MasteringAnalysis) -> MasteringSuggestion {
        let input_tensor = features.to_tensor();
        let outputs = self.session.run(vec![("features", input_tensor)]).unwrap();
        MasteringSuggestion::from_tensor(&outputs[0])
    }
}
```

Training data: pairs of (input audio features, expert mastering engineer settings) from real mastering sessions. An ONNX model of 10–50 parameters is sufficient for the initial version.

---

## Part 9: UI/UX — 5-Level Progressive Disclosure {#part-9}

### Level 1 — Play (One-Knob Mastering)

**Target user:** Non-technical musician who wants a quick master.

```
┌─────────────────────────────────────────────────────┐
│  PROOF                                              │
│                                                     │
│  Style: [Warm ▼]  Intensity: [──●────]              │
│                                                     │
│  Target: [Streaming -14 LUFS ▼]                     │
│                                                     │
│  ┌────────────────────────────────────┐             │
│  │  IN: -18.3 LUFS    OUT: -14.0 LUFS│  ●●●●●●●○   │
│  └────────────────────────────────────┘             │
│                                                     │
│  [Analyze & Master]                [▶ Play]         │
└─────────────────────────────────────────────────────┘
```

**Style presets map Intensity (0–100%) to:**

- EQ curve (Warm = +2dB at 200Hz, +1dB at 10kHz; Clean = neutral; Loud = slight presence boost; Balanced = Harman target)
- Dynamics amount (Loud = harder compression; Warm = gentler)
- Exciter amount (Warm = tape; Clean = minimal; Retro = tube)
- Limiter ceiling (Streaming = -1.0 dBTP; CD = -0.1 dBTP)

### Level 2 — Shape (Module Enable/Disable + Primary Controls)

```
┌─────────────────────────────────────────────────────┐
│  EQ       [●]  ▼ Warmth  ▼ Air       [Bypass]       │
│  DYNAMICS [●]  ▼ Amount  ▼ Attack    [Bypass]        │
│  STEREO   [●]  ▼ Width                [Bypass]       │
│  EXCITER  [●]  ▼ Amount  ▼ Character [Bypass]        │
│  LIMITER  [●]  ▼ Ceiling ▼ Mode      [Bypass]        │
│                                                     │
│  [IN: -18.3] → EQ → DYN → STEREO → EXC → LIM → [OUT: -14.0]  │
│                 ↑    ↑      ↑        ↑    ↑                    │
│               -16  -15    -14.8   -14.2 -14.0  ← inline meter  │
└─────────────────────────────────────────────────────┘
```

### Level 3 — Build (Full Per-Module Controls + Multiband Crossover)

Full UI for each module with all parameters visible. Multiband compressor shows crossover frequency sliders. EQ shows a frequency response graph with draggable nodes.

Key controls per module:

**EQ Module:**

- Phase: [Min Phase | Linear Phase]
- M/S mode toggle per band
- Up to 8 bands (bell, shelf, high/lowpass, dynamic)
- Frequency response display (drag nodes)

**Dynamics Module:**

- 3–5 bands with crossover sliders
- Per-band: Threshold, Ratio, Attack, Release, Knee, Makeup
- Per-band bypass/solo buttons
- Mode: Compress | Expand | Gate

**Stereo Module:**

- Width knob (0–200%)
- Per-band width controls
- Correlation meter
- Auto mono bass: [On/Off] [Freq: 80–200Hz]

**Exciter Module:**

- 3–4 bands
- Per-band: Type (Tape/Tube/Trans/Retro), Amount, Blend
- Oversampling quality: [2x | 4x | 8x]

**Limiter Module:**

- Ceiling, Mode (IRC-style | Look-ahead | Clip)
- True Peak enable
- Dither: [Off | TPDF | Noise-Shaped]
- Target: [Streaming | CD | Club | Broadcast | Custom]

### Level 4 — Route (Reordering + M/S + Match EQ + Reference)

- Drag-to-reorder module slots in the signal chain (HTML5 drag-and-drop or pointer events)
- M/S processing mode: process entire chain in M/S (split at input, merge at output)
- Match EQ: reference track loader + amount slider + curve display
- Full module-level M/S toggle (process only mid, only side, or both)
- Latency display (total reported latency to host in ms)

**Drag-to-reorder implementation (React):**

```tsx
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, arrayMove } from '@dnd-kit/sortable';

function SignalChain() {
    const [modules, setModules] = useState(defaultModules);

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setModules((items) =>
                arrayMove(
                    items,
                    items.findIndex((m) => m.id === active.id),
                    items.findIndex((m) => m.id === over.id)
                )
            );
            // Send new order to Rust backend via Tauri invoke
            invoke('set_module_order', { order: modules.map((m) => m.id) });
        }
    }

    return (
        <DndContext onDragEnd={handleDragEnd} collisionDetection={closestCenter}>
            <SortableContext items={modules.map((m) => m.id)}>
                {modules.map((m) => (
                    <SortableModule key={m.id} module={m} />
                ))}
            </SortableContext>
        </DndContext>
    );
}
```

### Level 5 — Lab (AI + Advanced Metering + Algorithm Selection)

- **AI Assistant panel:** Run analysis → show tonal balance deviation, LRA, correlation, suggest settings → one-click apply
- **Advanced metering dashboard:**
    - Vectorscope/Goniometer (full screen or panel)
    - Loudness history graph (scrolling LUFS over full track)
    - Phase meter
    - True peak history
    - Tonal balance comparison with reference/target curve
- **Algorithm selection:**
    - EQ: Min Phase IIR | Linear Phase FIR | Hybrid
    - Crossover: IIR LR4 | Linear Phase FIR
    - Limiting: IRC-style | Look-ahead | Clipping
    - Dithering type selection with noise spectrum preview
- **Match EQ algorithm tuning:**
    - Smoothing amount (1/12 to 1 octave)
    - Max correction (±3 to ±18 dB)
    - Reference segment selector (choose specific time range of reference to analyze)

---

## Part 10: The Secret Sauce — Mastering Philosophy {#part-10}

### 10.1 Less Is More

The golden rule from Bob Katz (_Mastering Audio: The Art and the Science_) and professional mastering engineers worldwide:

**A professional master typically uses:**

- 1–3 dB of EQ correction (additive or subtractive)
- 2–4 dB of gentle compression (barely moving the needle)
- 3–6 dB of transparent limiting (the final push to target loudness)

More processing does not equal better sound. Each stage compounds errors. The best masters sound like the mix with the rough edges softened and the level raised — not like a different recording.

**Practical limits for each stage in Proof:**

- EQ: ≤ ±6 dB per band; warn above ±4 dB ("Consider fixing in the mix")
- Dynamics: ≤ 6 dB of gain reduction average
- Limiter: ≤ 8 dB of gain reduction (more = visible over-limiting indicator)

### 10.2 The Multi-Stage Gentle Processing Philosophy

Rather than one aggressive stage, Proof's architecture naturally encourages gentle stacking:

```
Input at -18 LUFS
→ EQ: gentle tonal correction (+1 to -2 dB)
→ Multiband dynamics: gentle compression (2–3 dB GR, ratio 1.5:1)
→ Exciter: subtle harmonic warmth (+0.5 LUFS perceived, no actual level change)
→ Limiter: transparent peak control (4–5 dB of limiting to reach -14 LUFS)
Output at -14 LUFS
```

Each stage does a small amount. Combined, the result sounds natural and professional. One stage trying to do all the work sounds harsh and processed.

### 10.3 Why M/S Processing Is the Mastering Secret Weapon

Mid/Side processing provides surgical access unavailable in L/R processing:

| Problem                      | M/S Solution                                 |
| ---------------------------- | -------------------------------------------- |
| Muddy bass                   | Cut side below 120 Hz (mono bass is cleaner) |
| Narrow stereo field          | Boost side 2–5 dB                            |
| Harsh center vocals          | Cut mid at 2–4 kHz                           |
| Weak "air"                   | Boost side at 10–16 kHz                      |
| Out-of-phase low end         | Check correlation meter; fix with auto-mono  |
| Boomy mono-incompatible bass | Cut side very steeply below 80 Hz            |

The reason M/S is so powerful: it lets you process the center (vocals, kick, snare) and the stereo spread (reverb, guitars, pads) completely independently.

### 10.4 The K-System (Bob Katz)

Three calibrated monitoring levels:

| System | Headroom | Use                               |
| ------ | -------- | --------------------------------- |
| K-20   | 20 dB    | Mixing, classical recording, film |
| K-14   | 14 dB    | Music mastering (home listening)  |
| K-12   | 12 dB    | Broadcast/radio                   |

The K-number = headroom above the reference level (0 VU = K dB below 0 dBFS). Monitor SPL is calibrated to 83 dB SPL with K-20 pink noise. This provides a consistent loudness reference independent of genre.

Proof should include a K-system meter mode alongside LUFS metering.

### 10.5 The Loudness War and Streaming Normalization

Streaming services normalize all content to a target:

- Spotify: −14 LUFS (with ReplayGain-style normalization)
- Apple Music: −16 LUFS (Sound Check)
- YouTube: −14 LUFS
- Tidal: −14 LUFS

**Implication:** A master at −14 LUFS integrated plays at native level on streaming. A master at −6 LUFS (loud, compressed) is _turned down_ by the platform to −14 LUFS — and sounds worse because the dynamics were destroyed for no benefit.

**The modern mastering target:** A dynamic, transparent master at −14 LUFS sounds better on streaming than an over-compressed master that used to "win" the loudness war. The war is over.

Proof's UI should communicate this clearly:

> "Your master at -7.2 LUFS will be turned down by 7.2 dB on Spotify. Consider targeting -14 LUFS for better results."

### 10.6 Genre-Specific Processing Approaches

| Genre             | Typical Approach                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| **EDM/Club**      | Wide stereo (width 1.3–1.5x), strong sub-bass, bright highs, aggressive limiting (−6 to −9 LUFS), LRA 4–8  |
| **Classical**     | Minimal processing, preserve dynamics (LRA 15–25), gentle HP filter, true peak −1 dBTP, TPDF dither        |
| **Hip-hop**       | Strong sub-bass (30–60 Hz +3–4 dB), controlled highs, midrange presence, moderate dynamics, −9 to −12 LUFS |
| **Pop**           | Balanced Harman curve, moderate width, transparent limiting, −14 LUFS for streaming                        |
| **Rock**          | Punchy dynamics (multiband comp on low end), presence boost (3–5 kHz), −10 to −14 LUFS                     |
| **Jazz/Acoustic** | Minimal processing, natural tonal balance, gentle HF air boost, −16 to −20 LUFS                            |
| **Podcast/Voice** | Mono or narrow stereo, heavy limiting (−16 LUFS, −1 dBTP), noise reduction first                           |

### 10.7 A/B Testing Discipline

The only way to know if your mastering is helping or hurting:

1. Bypass all processing. Note the level.
2. Enable processing.
3. Use A/B comparison with auto gain-matching.
4. If you can't tell the difference (or prefer bypass), **use less processing**.

Proof's A/B comparison button is therefore one of its most important features. Train users to use it constantly.

---

## Implementation Checklist

### DSP (Rust)

- [ ] Biquad filter with all types (bell, shelf, HP/LP, bandpass)
- [ ] Linear phase FIR EQ (overlap-add convolver)
- [ ] Dynamic EQ (sidechain + envelope follower + gain modulation)
- [ ] Match EQ (FFT analysis + octave smoothing + FIR design)
- [ ] M/S encoder/decoder
- [ ] LR-4 crossover (cascaded Butterworth)
- [ ] N-band crossover with allpass compensation
- [ ] Feed-forward compressor (RMS detection, soft-knee, ballistics)
- [ ] Downward expander/gate
- [ ] tanh saturation (symmetric + asymmetric bias)
- [ ] Tube transfer function
- [ ] Transistor soft clip
- [ ] Multi-band exciter architecture
- [ ] Oversampler (2x, 4x, 8x) using Kaiser-windowed FIR
- [ ] Look-ahead limiter
- [ ] True peak detector (4x oversample)
- [ ] TPDF dithering
- [ ] Noise-shaped dithering (error feedback)
- [ ] ITU-R BS.1770 K-weighting filter (stereo, both SR)
- [ ] Momentary/Short-term/Integrated LUFS
- [ ] LRA (loudness range) computation
- [ ] Stereo correlation meter
- [ ] FFT spectrum analyzer with peak hold
- [ ] Goniometer data output (XY pairs for UI)
- [ ] Crust limiter embedding
- [ ] Inline metering taps
- [ ] Reorderable module chain
- [ ] Latency reporting

### Frontend (React 19 / TypeScript)

- [ ] Frequency response graph (draggable EQ nodes)
- [ ] Spectrum analyzer display (fractional-octave smoothed)
- [ ] Multiband dynamics crossover UI
- [ ] Goniometer/vectorscope (Canvas or WebGL)
- [ ] LUFS metering display (momentary + short-term + integrated)
- [ ] LRA, PLR, crest factor display
- [ ] Stereo correlation meter (±1 bar)
- [ ] Loudness history graph (scrolling)
- [ ] Signal chain with inline level meters
- [ ] Drag-to-reorder modules (`@dnd-kit/core`)
- [ ] A/B comparison button with auto gain-matching
- [ ] 5-level progressive disclosure UI
- [ ] Level presets (Streaming/CD/Club/Broadcast)
- [ ] AI assistant panel (Level 5)
- [ ] Tonal balance reference curve overlay
- [ ] Match EQ reference loader

---

## Key References

- Robert Bristow-Johnson, "Cookbook Formulae for Audio EQ Biquad Filter Coefficients" — webaudio.github.io/Audio-EQ-Cookbook
- ITU-R BS.1770-5 (LUFS measurement, true peak)
- EBU R128 (broadcast loudness, LRA)
- Bob Katz, _Mastering Audio: The Art and the Science_, 3rd ed. — Focal Press
- Linkwitz & Riley, "Active Crossover Networks for Noncoincident Drivers" — JAES 1976
- iZotope Ozone 11 User Guide — izotope.com
- Elementary Audio, "Distortion, Saturation, and Wave Shaping" — elementary.audio/docs
- Ian Shepherd, ProductionAdvice.co.uk — loudness and mastering best practices
- POW-R Consortium specifications — Wikipedia + Gearspace discussions
- Alexey Lukin, "Sonically Optimized Noise Shaping Techniques" — audio.rightmark.org
