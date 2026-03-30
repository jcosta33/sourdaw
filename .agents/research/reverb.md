# Dutch Oven: Complete Reverb Plugin Implementation Guide

**Target audience:** Audio DSP engineers building a professional, multi-engine reverb plugin for DAW environments. This document specifies every algorithm, delay length, coefficient, matrix, and formula required for implementation. All values are drawn from the primary sources cited inline.

---

## Part 1 — Dattorro plate reverb at 29761 Hz

Jon Dattorro's 1997 JAES paper "Effect Design Part 1: Reverberator and Other Filters" remains the most openly documented high-quality plate reverb algorithm. The design runs at a **reference sample rate of 29761 Hz** and uses approximately **22,500 samples** of total delay memory — far less than Schroeder's eigentone density criterion would predict, yet it achieves remarkably smooth tails through careful topology.

### Input section

The input signal is summed to mono, passed through an optional pre-delay (up to ~1 second), then filtered by a **one-pole bandwidth filter** that controls high-frequency content entering the tank:

```
y[n] = bandwidth * x[n] + (1 - bandwidth) * y[n-1]
```

Default **bandwidth = 0.9995**. A value of 0.9999999 passes all frequencies; lower values progressively attenuate HF. The filtered signal then passes through **four series allpass diffusers** in two pairs:

| Diffuser | Delay (samples @ 29761 Hz) | Coefficient                |
| -------- | -------------------------- | -------------------------- |
| 1        | **142**                    | +0.750 (input_diffusion_1) |
| 2        | **107**                    | +0.750 (input_diffusion_1) |
| 3        | **379**                    | +0.625 (input_diffusion_2) |
| 4        | **277**                    | +0.625 (input_diffusion_2) |

Each diffuser uses a **two-multiplier lattice allpass** topology. Coefficients near |0.5| are optimal; values approaching 1.0 produce buzzing. Setting all coefficients to 0.0 bypasses diffusion entirely, yielding audible discrete echoes in the tank.

### Tank structure: the figure-8

The tank consists of two halves arranged in a **cross-feedback (figure-8) configuration**. The output of the left half feeds the input of the right half, and vice versa. Each half contains, in order: a modulated allpass, a fixed delay, a one-pole damping lowpass, a decay gain multiplier, a fixed allpass, and a second fixed delay.

**Left half (nodes 23→39):**

| Element                   | Delay (samples)     | Coefficient/Gain                                  |
| ------------------------- | ------------------- | ------------------------------------------------- |
| Modulated allpass (23→24) | **672** + excursion | **−0.70** (decay_diffusion_1, note negative sign) |
| Fixed delay (24→30)       | **4453**            | —                                                 |
| Damping LPF (node 30)     | —                   | damping = 0.0005                                  |
| Decay multiplier          | —                   | decay = 0.50                                      |
| Fixed allpass (31→33)     | **1800**            | +0.50 (decay_diffusion_2)                         |
| Fixed delay (33→39)       | **3720**            | —                                                 |

**Right half (nodes 46→63):**

| Element                   | Delay (samples)     | Coefficient/Gain                                  |
| ------------------------- | ------------------- | ------------------------------------------------- |
| Modulated allpass (46→48) | **908** + excursion | **−0.70** (decay_diffusion_1, note negative sign) |
| Fixed delay (48→54)       | **4217**            | —                                                 |
| Damping LPF (node 54)     | —                   | damping = 0.0005                                  |
| Decay multiplier          | —                   | decay = 0.50                                      |
| Fixed allpass (55→59)     | **2656**            | +0.50 (decay_diffusion_2)                         |
| Fixed delay (59→63)       | **3163**            | —                                                 |

**Cross-feedback:** Output of the left half (node 39, after decay multiplication) feeds the right half's summing junction at node 46, and the right half's output (node 63) feeds node 23. Both feed points also receive the diffused input signal.

The **damping filter** in each half is a one-pole lowpass: `y[n] = (1 - damping) * x[n] + damping * y[n-1]`. At damping = 0.0, all frequencies pass equally. Higher values create progressively stronger HF rolloff per loop iteration, causing high frequencies to decay faster than lows — mimicking air absorption in real spaces.

The **decay_diffusion_2** coefficient is linked to the decay parameter: the paper suggests `decay_diffusion_2 = decay + 0.15`, clamped to **[0.25, 0.50]**. This decorrelates the two tank signal paths.

### Modulation

The modulated allpass delay lines at nodes 23→24 and 46→48 use **sinusoidal LFOs** at approximately **1.0 Hz** (left) and **0.707 Hz** (right), running in quadrature for maximum decorrelation. The **EXCURSION** parameter from Table 1 of the paper is **16** (interpreted as peak excursion of ~8 samples, or equivalently ±8 samples at 29761 Hz). The LFO must run at the full audio sample rate — sub-rate updates cause aliasing artifacts within the feedback path.

**Why allpass interpolation is mandatory in the tank:** Linear interpolation of a fractional delay is equivalent to a one-zero FIR lowpass filter `H(z) = (1-α) + α·z⁻¹`, where α is the fractional sample offset. In a non-feedback context this is inaudible at low modulation rates. Inside the tank's feedback loop, however, the signal recirculates hundreds of times for long decays (a 30-second decay with ~0.1s average delay means ~300 passes). **Each pass through linear interpolation cumulatively attenuates high frequencies.** After 300 passes, this unaccounted-for HF damping drastically shortens the high-frequency decay time beyond what the damping parameter specifies. Allpass interpolation maintains **unity gain at all frequencies** while introducing only phase variation, which is inaudible for the slow, microtonal pitch modulations used in reverb (~1 Hz, ±8 samples). Dattorro explicitly states this in Section 4 of the paper: allpass interpolation is "perfectly applicable to reverberators because the required pitch change is microtonal."

### Stereo output tap structure

The stereo output is read from **14 tap points** distributed across both tank halves (7 per channel). Each tap is multiplied by **0.6** and summed with alternating signs for decorrelation:

**Left output (Y_L):**

```
Y_L  = +0.6 * delay_48_54[266]
     + 0.6 * delay_48_54[2974]
     - 0.6 * allpass_55_59[1913]
     + 0.6 * delay_59_63[1996]
     - 0.6 * delay_24_30[1990]
     - 0.6 * allpass_31_33[187]
     - 0.6 * delay_33_39[1066]
```

**Right output (Y_R):**

```
Y_R  = +0.6 * delay_24_30[353]
     + 0.6 * delay_24_30[3627]
     - 0.6 * allpass_31_33[1228]
     + 0.6 * delay_33_39[2673]
     - 0.6 * delay_48_54[2111]
     - 0.6 * allpass_55_59[335]
     - 0.6 * delay_59_63[121]
```

The critical design: each output channel taps from **both** tank halves with alternating signs. This cross-tapping creates a synthetic stereo image from a mono input. The final mix is `output_L = dry * input_L + wet * Y_L`.

### Sample rate conversion

All delay lengths convert from 29761 Hz to any target rate with:

```
delay_target = round(delay_29761 × fs_target / 29761)
```

Excursion depth scales identically. At **48 kHz**, the multiplication factor is **1.6129**; at **96 kHz**, it is **3.2257**.

### Default parameter table

| Parameter         | Default | Range        | Notes                                |
| ----------------- | ------- | ------------ | ------------------------------------ |
| decay             | 0.50    | 0.0–~1.0     | At 1.0 with damping=0: infinite hold |
| decay_diffusion_1 | 0.70    | 0.0–0.999    | Negated in tank allpasses            |
| decay_diffusion_2 | 0.50    | 0.25–0.50    | Linked: decay + 0.15, clamped        |
| input_diffusion_1 | 0.750   | 0.0–0.999    | First two input diffusers            |
| input_diffusion_2 | 0.625   | 0.0–0.999    | Last two input diffusers             |
| bandwidth         | 0.9995  | 0.0–0.999999 | Input HF filter                      |
| damping           | 0.0005  | 0.0–0.999999 | Tank HF damping per loop             |
| EXCURSION         | 16      | —            | Peak modulation depth (samples)      |

**Implementation note:** All recursive circuits require **magnitude truncation** (truncate toward zero) when writing to delay memory to eliminate zero-input limit-cycle oscillation — low-level tones persisting after input removal. This reduces the noise floor by **12–24 dB**.

---

## Part 2 — FDN room and hall reverb

A Feedback Delay Network replaces Dattorro's fixed two-path topology with **N parallel delay lines** mixed through a unitary matrix, offering scalable echo density and flexible room modeling. Jot's 1992 doctoral thesis at Telecom Paris established the foundational design methodology: first build a lossless prototype (unitary matrix, poles on the unit circle), then insert absorptive filters for frequency-dependent decay.

### Mixing matrices

The feedback matrix **A** must be **unitary** (A⁻¹ = Aᵀ for real matrices) to preserve energy in the lossless prototype. All eigenvalues must have unit modulus. The matrix should have no zero entries (every delay line feeds back to every other), and all entries should ideally have equal magnitude for maximum diffusion.

**Householder reflection** — `H = I_N - (2/N) · 1·1ᵀ`, where 1 is the all-ones column vector. Diagonal entries equal `1 - 2/N`; off-diagonal entries equal `-2/N`. Computational cost is **O(N)**: compute the sum of all N inputs, multiply by 2/N, subtract from each. For **N = 4**, all entries have equal magnitude (1/2), making it optimally balanced:

```
H₄ = ½ · [ 1  -1  -1  -1]
         [-1   1  -1  -1]
         [-1  -1   1  -1]
         [-1  -1  -1   1]
```

For **N = 8**, diagonal entries are 0.75 and off-diagonal are -0.25 — the matrix becomes imbalanced, with diagonal elements 3× stronger than cross-coupling. The FDN increasingly resembles decoupled parallel comb filters. Jot's workaround for N = 16: **embed four H₄ blocks** in a higher-level Householder structure, maintaining balanced mixing recursively at a cost of only 4N operations.

**Hadamard matrix** — Constructed recursively via Sylvester's method:

```
H₂ = (1/√2) · [ 1   1]
               [-1   1]

H_{2N} = (1/√2) · [H_N    H_N ]
                   [-H_N   H_N ]
```

All entries have **equal magnitude** (±1/√N after normalization) at any size. Applied via the **Fast Walsh-Hadamard Transform** in O(N·log₂N) using only additions and subtractions — log₂N butterfly stages of pairwise sums and differences. The final 1/√N normalization is the only multiplication. For **N = 8**, every delay line feeds every other line with weight ±1/√8 ≈ ±0.354. Hadamard builds echo density "in the fastest possible way" because every delay line feeds into every other with equal amplitude. **Use Hadamard for N ≥ 8; use Householder for N = 4.**

Signalsmith Audio's design uses Hadamard for the **diffuser** stages (where maximum scattering is desired) but Householder for the **feedback loop** itself, arguing that "too much mixing inside the feedback loop can move the eigentones closer together, leaving gaps which colour the sound for longer decays."

### Delay line length selection

Delay lengths must be **mutually prime** (coprime — sharing no common prime factors). Common factors cause the impulse response to repeat prematurely, creating periodic resonances and metallic flutter. The **prime-power method** (Smith, CCRMA) guarantees coprimality: choose each length as `M_i = p_i^(k_i)` where p_i is the i-th prime (2, 3, 5, 7, 11, 13, 17, 19…) and k_i = round(log(desired_length) / log(p_i)).

Room size maps to delay lengths through the **mean free path**: `MFP = 4V/S` where V is room volume (m³) and S is total surface area (m²). Average delay in seconds: `τ_avg = MFP / c` where c ≈ 343 m/s. Example delay sets at 48 kHz (all values prime):

**Small room** (~50 m³, RT60 0.3–0.8s, delays 10–19ms):
{491, 523, 577, 631, 691, 743, 811, 887} samples

**Large hall** (~12000 m³, RT60 1.5–3.0s, delays 31–79ms):
{1499, 1741, 2039, 2357, 2687, 3001, 3371, 3793} samples

Signalsmith Audio recommends dividing the target delay range into equal segments, then **randomizing within each segment** (a velvet-noise pattern) for approximately even distribution without exact regularity.

### Frequency-dependent decay

The gain per delay line at frequency f to achieve target RT60(f), derived from Jot (1992):

```
g_i(f) = 10^(-3 · M_i / (f_s · RT60(f)))
```

Where M_i is delay length in samples and f_s is sample rate. This produces a 60 dB attenuation over the specified RT60. A **one-pole lowpass filter** in each feedback path implements this: compute g_mid and g_hf from the formula, then design the filter so |H(e^(j·0))| = g_mid and |H(e^(jω_hf))| = g_hf. Adding a **high-shelf filter** enables independent control of LF decay (the "bass multiply" found in Lexicon hardware). Real rooms show **HF decaying 2–5× faster** than mid frequencies due to air absorption (~0.003 dB/m at 1 kHz, ~0.06 dB/m at 8 kHz) and surface absorption characteristics.

### Early reflections

Implemented as a **tapped delay line (TDL)** separate from the FDN late tail: `y(n) = Σ_k a_k · x(n - d_k)`, where d_k are tap delays and a_k are per-tap gains decreasing approximately as 1/√t. The image-source method derives tap times from room geometry; first reflections from 6 walls at times `t = 2 × distance_to_wall / c`. Jot's modular architecture chains three stages: sparse early TDL → denser cluster module (cascaded matrix + delay bank) → FDN late tail. Pre-delay separating direct sound from first reflection onset ranges from **1–5 ms** (small rooms) to **15–50 ms** (large halls).

### Echo density verification

Target: **2,000–4,000 echoes/second** for perceptual diffuseness. Echo density in an N-channel FDN grows as a polynomial of time with degree N−1 (Schlecht & Habets, 2016). An **N = 8 FDN** grows as ~t⁷, reaching sufficient density in 30–60 ms. An **N = 16 FDN** grows as ~t¹⁵, achieving near-instantaneous diffuseness in 15–30 ms. Measure echo density using the **Normalized Echo Density (NED)** metric: window the impulse response with a Hanning window, count zero-crossings or peaks per unit time, and normalize to 1.0 at the statistical late-field limit.

---

## Part 3 — Creative, shimmer, and infinite reverb engine

### Shimmer: pitch shifter in feedback

The shimmer effect, pioneered by Brian Eno and Daniel Lanois using an AMS DMX 15-80s delay → Lexicon 224 Concert Hall with mixer-based feedback, places a pitch shifter inside the reverb's recirculation path. Each feedback pass shifts the signal up by an **octave (+1200 cents)** or **perfect fifth (+700 cents)**, creating stacked harmonics that produce an orchestral wash.

**Granular implementation** (preferred for characteristic shimmer artifacts): Two overlapping read pointers traverse a circular buffer at a rate different from the write pointer. Each pointer is windowed with a **Hann envelope** for crossfade:

```rust
// Granular pitch shifter — octave up
let grain_size_samples = (0.030 * sample_rate) as usize; // 30ms grain
let pitch_ratio = 2.0; // octave up

for sample in buffer.iter_mut() {
    let read1 = write_pos as f64 - grain_size_samples as f64 * phase1;
    let read2 = write_pos as f64 - grain_size_samples as f64 * phase2;

    phase1 += (pitch_ratio - 1.0) / grain_size_samples as f64;
    phase2 += (pitch_ratio - 1.0) / grain_size_samples as f64;
    if phase1 >= 1.0 { phase1 -= 1.0; }
    if phase2 >= 1.0 { phase2 -= 1.0; }

    let env1 = 0.5 * (1.0 - (2.0 * PI * phase1).cos());
    let env2 = 0.5 * (1.0 - (2.0 * PI * phase2).cos());

    *sample = circ_buf[wrap(read1)] * env1 + circ_buf[wrap(read2)] * env2;
}
```

Grain size of **20–50 ms** (30 ms default); 2–4 overlapping grains; adding **±5–10 ms random jitter** to grain position is critical for the Eno/Lanois wash — the reverb's allpass delays scramble phase so the pitch shifter's splice-point detection fails randomly, spreading sidebands into the orchestral thickness. The pitch-shifted signal is mixed back into the feedback at **10–30%** (shimmer_amount), not 100%. A lowpass filter at **8–12 kHz** in the shimmer return path masks aliasing artifacts that accumulate across passes.

**Phase vocoder alternative:** FFT window of 2048 samples, analysis hop = window/4 (75% overlap), Hann window, with Laroche-Dolson phase locking for harmonic coherence. Cleaner but more organ-like, less characteristically "shimmery."

### Infinite sustain (decay ≥ 1.0)

When feedback gain reaches or exceeds 1.0, energy grows without bound. **Soft saturation** placed at each delay line output, before the mixing matrix, prevents runaway:

```c
// tanh saturation — warm, tube-like compression
inline double soft_saturate(double x) {
    return tanh(x);  // maps (-∞,+∞) → (-1,+1)
}

// Fast approximation (Aleksey Vaneev, KVR):
inline double fast_tanh(double x) {
    double x2 = x * x;
    return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}
```

Tom Erbe's Erbe-Verb module allows feedback up to **1.25 (+2 dB above unity)** using a 3rd-degree Chebyshev polynomial `f(x) = x - x³/3` as a soft clipper generating only 3rd-harmonic distortion. Placement is critical: **saturate BEFORE the mixing matrix**, per delay line, so individual lines cannot run away before being mixed. Saturation after the matrix allows inter-channel energy transfer to bypass the limiter.

### Freeze

Freeze captures the current reverb state indefinitely by setting feedback to exactly **1.0** and muting new input. Smooth implementation requires a **10–50 ms crossfade ramp** to avoid clicks:

```c
void toggle_freeze(bool engage) {
    float target_feedback = engage ? 1.0f : normal_decay;
    float target_input    = engage ? 0.0f : 1.0f;
    float target_mod      = engage ? 0.0f : normal_mod_depth;
    // Ramp all three over 30ms using equal-power cosine curve
    start_ramp(&feedback_gain, target_feedback, 0.030f * sample_rate);
    start_ramp(&input_gain,    target_input,    0.030f * sample_rate);
    start_ramp(&mod_depth,     target_mod,      0.030f * sample_rate);
}
```

Disabling modulation during freeze is essential — modulation causes pitch drift in the frozen content, eventually degrading it over minutes. Similarly, disable or bypass any lowpass filters in the loop to prevent gradual HF attenuation of the frozen signal.

### Reverse reverb

Three approaches serve different contexts. **Method 1 (convolution):** Time-reverse an IR sample array and convolve normally — creates a "swell-up" envelope but requires latency equal to the IR length for the pre-echo effect. **Method 2 (offline):** Reverse audio → apply forward reverb → reverse result → layer with dry. This is the classic studio technique producing the pre-vocal swell. **Method 3 (real-time):** Double-buffered circular buffer where grains play in reverse with Hann-windowed crossfades at buffer boundaries (5–20 ms crossfade). Buffer size equals the desired reverse time (0.5–3 seconds).

### Eventide Blackhole gravity

Blackhole uses approximately **32 cascading modulated allpass delays in series** (split into ~24 per stereo output channel). The **Gravity parameter** controls the distribution of allpass coefficients across the chain. At **positive gravity**, early allpasses have lower gain (fast pass-through) and later allpasses have higher gain (longer ringing), producing conventional exponential decay. At **negative gravity**, the coefficient distribution inverts — early allpasses trap energy longer (high gain) while later allpasses release quickly (low gain), creating a **reverse-swell envelope** where energy accumulates before releasing. The Size parameter ranges from −10 to 120 (values above 100 are "truly galactic"). Freeze sets feedback to infinite and blocks new input.

### Lexicon 224 Concert Hall modulation character

The 224's distinctive lush chorusing comes from **time-varying delay lines** inside the recursive allpass network, operating at a native sample rate of only **20 kHz** (10 kHz Nyquist). Modulation depths of **8–32 samples** at rates of **0.5–3.0 Hz** across multiple LFOs at incommensurate frequencies (e.g., 0.7, 1.1, 1.7, 2.3 Hz):

```c
float lfo1 = sinf(2.0f * PI * 0.7f * t);   // ~0.7 Hz
float lfo2 = cosf(2.0f * PI * 1.1f * t);   // ~1.1 Hz, quadrature
float lfo3 = sinf(2.0f * PI * 1.7f * t);   // ~1.7 Hz
float lfo4 = cosf(2.0f * PI * 2.3f * t);   // ~2.3 Hz
// Each allpass tap modulated by different LFO, depth 8-32 samples
```

The 224 used **6-bit quantized linear interpolation** (32–64 discrete substeps per sample), creating a characteristic noise halo around signals that increased decorrelation and spaciousness. Its fixed-point processing with only 24 dB headroom caused benign internal clipping that raised the broadband noise floor rather than producing harsh distortion.

### Granular diffusion

Replace traditional allpass diffusion with granular processing on the feedback signal: record into a circular buffer, read back with **30–500 ms grains** at 30–40 grains/second, ±5–50 ms random position scatter, Hann envelope, optional per-grain pitch randomization (±cents for diffuse cloud, ±octave for shimmer-like texture). Unlike deterministic allpass diffusion, granular diffusion produces inherently evolving, stochastic echo patterns. Commercial implementations include Audio Damage Descent and Sinevibes Albedo.

---

## Part 4 — Convolution engine

### Non-uniform partitioned convolution

Direct convolution of an audio stream with a multi-second IR is O(N²) per sample — impractical. **Non-uniform partitioned convolution** (Gardner 1995, García 2002) solves this by splitting the IR into segments of increasing size:

**Head partition** (64–256 samples): Processed with direct time-domain convolution `y[n] = Σ h[k]·x[n-k]` for **zero added latency**. Only the first 64–256 samples of the IR need time-domain processing. At 256 samples, this costs 256 multiply-adds per output sample.

**Tail partitions** (FFT overlap-add, increasing block sizes): Subsequent IR segments are processed using FFT convolution with progressively larger blocks — typically 256, 512, 1024, 2048, 4096, 8192 samples. Larger blocks are more CPU-efficient (fewer FFTs per second) but only needed for later portions of the IR where temporal precision matters less.

García's optimal partition for a ~3-second IR (131,072 samples) at 256-sample latency uses just **three stages**: 8 blocks of 256, 7 blocks of 2048, and 7 blocks of 16384, costing only **304 multiply-adds/sample** — over 6× cheaper than uniform partitioning at the same latency (2,102 madds) and over 2× cheaper than Gardner's original non-uniform scheme (769 madds). García uses the **Viterbi algorithm** to find the globally optimal partition given latency and IR length.

All IR partitions are **pre-transformed via FFT at load time**. Only the input signal's forward FFT and the final inverse FFT run in real-time. For tail stages, the **Frequency-Domain Delay Line (FDL)** optimization accumulates all partition products in the frequency domain, requiring only one inverse FFT per stage rather than one per partition.

```
// Per audio callback (buffer_size = head_block_size):
output = direct_convolve(input_buffer, ir_head)  // zero latency

for each FDL stage s > 0:
    input_accumulator[s].append(input_buffer)
    if input_accumulator[s].full():
        X[s] = FFT(input_accumulator[s], block_size[s] * 2)
        fdl[s].push(X[s])  // shift frequency-domain delay line
        Y[s] = sum(fdl[s][b] * IR_FFT[s][b] for b in fdl[s])
        overlap_add(output, IFFT(Y[s]), delay_offset[s])
```

### True stereo convolution

A true stereo IR captures the full 2×2 spatial transfer function: **LL** (left→left), **LR** (left→right), **RL** (right→left), **RR** (right→right). Processing requires four independent convolution engines:

```
Left_Out  = convolve(Left_In, IR_LL) + convolve(Right_In, IR_RL)
Right_Out = convolve(Left_In, IR_LR) + convolve(Right_In, IR_RR)
```

True stereo IRs are stored as 4-channel interleaved WAV files (Steinberg convention: LL, LR, RL, RR) or as two stereo files ("L" containing LL+LR, "R" containing RL+RR). Detection: 1-channel = mono, 2-channel = stereo parallel, 4-channel = true stereo.

### IR management

**Auto-trimming:** Scan the IR from the end backward, find the last sample exceeding **−60 dB below peak** (`threshold = peak × 10^(-60/20)`). Trim everything after this point. This dramatically reduces partition count for IRs with long silence tails.

**IR stretching:** Three approaches — (1) simple resampling changes both time and pitch, (2) phase vocoder preserves pitch during time-stretch but introduces phasiness, (3) **exponential decay envelope modification** multiplies the IR by a gain curve to lengthen or shorten apparent decay without time-stretching the waveform, yielding the most natural results for reverb tails. LiquidSonics Reverberate 3 achieves 0.25×–1.75× decay time adjustment using this technique.

**IR EQ:** Since partitions are already stored in FFT form, EQ is a one-time offline multiplication: `IR_EQ_FFT[k] = IR_FFT[k] × EQ_TransferFunction`. Recompute whenever EQ settings change.

**Latency compensation:** Report plugin latency to the DAW host for automatic PDC. Zero-latency mode uses direct convolution for the head; fixed-latency mode trades latency for lower CPU.

---

## Part 5 — Hybrid mode

### Why hybrid is the modern gold standard

Convolution delivers the accuracy of real captured spaces with complex early reflection patterns, but produces static tails with no modulation, limited parameter control, and high CPU for long IRs. Algorithmic reverb delivers modulatable, controllable tails with efficient computation, but struggles to match specific real spaces. **Hybrid reverb combines convolution for the first 50–200 ms** (where spatial accuracy matters most and CPU cost is low) **with an FDN for the late tail** (where statistical properties dominate and modulation adds life).

The IRCAM paper by Carpentier et al. (DAFx-14) demonstrated that listeners **cannot distinguish** a properly calibrated hybrid reverb from full convolution of the original IR, while saving ~35% CPU.

### Parallel hybrid

Both engines process the input independently. A crossfader blends between convolution output (early reflections, room character) and algorithmic output (controllable tail). The convolution IR can be trimmed to only the first 100–200 ms for efficiency.

### Series hybrid

Audio passes through the convolution engine first (providing early reflections and initial room character), then the convolution output feeds the algorithmic engine (which extends the tail with controllable decay, modulation, and frequency-dependent damping). Ableton Hybrid Reverb implements this as one of four routing options alongside parallel, algorithm-only, and convolution-only.

### Seamless transition: spectral matching at the crossover

The critical challenge is energy continuity at the transition point t_mix. Carpentier's method:

1. Compute the **Energy Decay Relief (EDR)** of the original IR: `EDR(t,f) = |∫[τ=t→∞] h(τ)·e^(-j2πfτ) dτ|²`
2. Extract frequency-dependent RT60 from the EDR and configure FDN absorptive filters to match
3. Apply a **spectral correction filter** at the transition: `correction(f) = √(EDR_IR(t_mix, f) / EDR_FDN(t_mix, f))`, implemented as a 256-tap FIR
4. Use a **power-complementary crossfade**: `w_conv²(t) + w_fdn²(t) = 1` at all times in the transition region

An alternative from Signalsmith Audio: "Subtract the early part of your algorithmic reverb from the convolution kernel before windowing/fading it out, so that the early parts of the algorithmic reverb are cancelled out." This ensures perfect phase and energy continuity.

---

## Part 6 — Decay Rate EQ

### Concept and motivation

Introduced by FabFilter in Pro-R (~2017), **Decay Rate EQ** applies a familiar parametric EQ interface to control **decay time per frequency band** rather than level. Boosting a band at 4 kHz makes that frequency ring longer; cutting it makes it die faster. This is fundamentally different from post-reverb EQ (which changes level, not decay character) and far more intuitive than traditional one-pole damping (which offers only a single LF/HF crossover).

### 6-band implementation

Six bands, each configurable as **bell, low shelf, high shelf, or notch**:

| Band | Default Type | Default Freq | Purpose              |
| ---- | ------------ | ------------ | -------------------- |
| 1    | Low shelf    | 100 Hz       | LF decay control     |
| 2    | Bell         | 400 Hz       | Low-mid shaping      |
| 3    | Bell         | 1.2 kHz      | Mid presence         |
| 4    | Bell         | 3.5 kHz      | Upper-mid clarity    |
| 5    | Bell         | 8 kHz        | Air/brilliance decay |
| 6    | High shelf   | 12 kHz       | Overall HF decay     |

Each band's gain/cut maps to a **decay time multiplier** (Pro-R 2 range: **25%–400%** of the base RT60). The multiplier translates to a feedback gain modification inside each FDN delay line.

### Implementation inside the FDN

For each delay line i with length M_i samples, and for each frequency band with target RT60_band:

```
g_i_band = 10^(-3 × M_i / (f_s × RT60_band))
```

Design a multi-band filter H_i(z) per delay line such that |H_i(e^(jω))| = g_i(ω) at each band's center frequency. This filter sits in series within each feedback path. When the user adjusts a Decay Rate EQ band, recompute the target gains and redesign the filters. A cascade of **second-order biquad sections** (one per band) provides adequate precision.

The default "flat" Decay Rate EQ curve naturally matches real room behavior: **HF decays 2–3× faster** than mid frequencies, LF decays slightly slower. This default curve is set by the base damping parameter; the Decay Rate EQ then provides deviation from this baseline.

### How this differs from one-pole damping

Traditional one-pole damping provides exactly two parameters: a crossover frequency and HF/LF decay ratio. Decay Rate EQ provides **6 independent bands with parametric Q**, enabling surgical control — for instance, a narrow bell boosting decay at 2 kHz creates a resonant "ring" at that frequency, while a steep high shelf at 6 kHz kills cymbal splash in the tail. This level of control is impossible with a single first-order filter.

---

## Part 7 — Sean Costello's key DSP insights

Sean Costello, founder of Valhalla DSP and self-described "reverberation algorithm fanatic" with 10+ years of dedicated reverb research, has shared publicly the following technical insights across his blog and presentations.

### Modulation as the primary weapon against metallic coloration

Costello identifies modulation as the "quickest way of reducing metallic artifacts." Long allpass delays benefit most from modulation; short input diffusion allpasses should generally not be modulated (it produces "a sound similar to water sloshing around in a metal pan"). The EMT250's "enormous amount of modulation, to the point where it sounded like a chorus unit" was specifically designed to mask coloration from its tiny 300 ms delay memory. **Modulation rate sweet spots: 0.2–0.5 Hz** for smoothing artifacts, 0.5–2.0 Hz for general use, 1–2 Hz for lush chorusing. Depths should be reduced for long decays since the signal passes through modulators many more times. Costello uses "several dozen random LFOs" in FutureVerb (2025), centered around the user's Mod Rate setting.

### Echo density and the size tradeoff

"Longer delay lengths = higher modal density = less metallic = lower echo density." This fundamental tradeoff means larger reverb sizes sound smoother but have slower attack and more audible discrete echoes. Smaller sizes have faster attack but more metallic coloration at long decays. Costello's advice: "Set the Size as big as you can get away with, until either the attack is too slow or you start hearing objectionable grain." Real acoustic spaces have "a few orders of magnitude higher modal density" than digital reverbs of equivalent size.

Echo density in real rooms grows as t² (time squared). Plate reverbs build density linearly with time. Schroeder's parallel comb/series allpass reverbs have constant echo density — a critical deficiency that nested allpasses and FDNs solve.

### VintageVerb's three eras

**1970s mode:** Internally downsampled to reproduce ~20 kHz sample rate artifacts. Maximum output frequency ~10 kHz. "Dark and noisy" modulation producing "strange and random sidebands." Emulates 12-bit gain-stepping converters of the EMT250/Lexicon 224 era. Bandwidth deliberately limited.

**1980s mode:** Full sampling rate but retains "dark and noisy" modulation character. Represents the Lexicon 224XL (15 kHz bandwidth), 480L (44.1/48 kHz, 16-bit converters), and AMS RMX-16 era. "Reverbs were no longer being used simply to smooth out a mix."

**Now mode:** Full bandwidth, full sampling rate, "clean and colorless" modulation using modern high-quality interpolation. Represents current algorithmic capability without vintage artifacts.

### Supermassive: delay network as reverb

Supermassive's architecture uses FDNs that "combine feedforward and feedback techniques" with delays up to 2 seconds each. The **WARP parameter** spreads delay times: at 0% all delays equal the DELAY setting; at 5–15% delays shift into "harmonic delay" territory with downward-shifting resonances; at 20–50% delays form "clusters" that gradually become reverberant; above 50% the sound is "more reverberant." The **DENSITY parameter** controls inter-delay mixing, effectively functioning as echo density/diffusion. The 22 modes across versions 1.0–5.0 represent increasingly sophisticated FDN topologies, with later modes (Leo, Pleiades, Sirius) achieving smooth, dense reverb that fed directly into FutureVerb development.

### Interpolation philosophy

Costello deliberately uses linear interpolation's HF attenuation in "Dark" modes: "The high frequency attenuation of linear interpolation can result in a far less 'glassy' high end than modern high fidelity interpolation techniques." The Lexicon 224's linear interpolation was "quantized to fairly big subsample chunks (32 or 64 per sample)," creating noise that "will increase every time it passes through the reverb network." For a 70-second decay, this means hundreds of passes, each accumulating noise and HF loss — a deliberate design choice in vintage modes, a problem to solve in modern modes.

### Published structure

In his 2015 AES presentation, Costello described a reverb combining "techniques from both allpass loops and FDNs": a **4×4 FDN with Householder feedback matrix and 12 embedded allpass delays**. He uses "similar structures in a few of my products" with "lots of possible variations & extensions."

---

## Part 8 — Spring reverb character

### Physics of the helical spring

Helical springs support **three coupled vibrational modes**: longitudinal (compression waves along the axis), torsional (rotational waves twisting along the wire), and transverse (lateral displacement perpendicular to the axis). The helix angle creates coupling between these modes, and critically, each mode has a **different propagation velocity** that varies with frequency. This creates **dispersion** — different frequency components travel at different speeds — producing the characteristic chirp-like response where energy arrives as a descending frequency sweep following each end-to-end reflection.

Below a "transition frequency" determined by spring geometry, longitudinal and torsional modes dominate; above it, transverse modes become significant. The sparse modal distribution (far fewer modes than plates or rooms), strong frequency-dependent propagation, and the fact that energy bounces between only two endpoints create spring reverb's unmistakable metallic, resonant character.

### The drip transient

The "drip" or "boing" is the initial burst of broadband energy when the input transducer (electromagnetic coil driving a magnetic bead) excites the spring. The dispersive nature causes frequency components to arrive at the pickup at different times, producing a dense cluster of chirp-like echoes. This initial transient concentrates enormous energy into a brief window, distinguishing spring from all other reverb types.

### DSP implementation: dispersive allpass cascade

Julian Parker's 2011 EURASIP paper provides the key implementation: a **cascade of identical first-order allpass filters** creates frequency-dependent group delay, simulating dispersion. The total group delay of N cascaded allpass sections with coefficient a:

```
τ(ω) = N × (1 - a²) / (1 - 2a·cos(ω) + a²)
```

This allpass cascade is placed into a **feedback loop with a long delay line** (representing the spring length) and a selectable loop gain (controlling decay time). The delay line is **modulated** with a strongly correlated random-number sequence for self-modulation effects. Parker's multirate optimization splits into frequency bands processed at appropriate sample rates, reducing computational cost to **one-third** of the naive cascade.

The Abel-Smith CCRMA model goes further, simulating both longitudinal and torsional waves with separate waveguide sections and dispersion filters, producing the widening of successive arrivals characteristic of real springs.

### Why spring sounds unique

Spring reverb is instantly distinguishable from plate or room because of (1) audible dispersive chirps absent in other reverb types, (2) extremely sparse modal density creating metallic coloration, (3) multi-mode coupling producing complex amplitude and frequency modulation, (4) clear end-to-end reflection patterns from only two boundary points, and (5) nonlinear behavior from transverse waves limited by the spring enclosure and coil spacing. No other natural or mechanical reverberator exhibits this combination of characteristics.

---

## Part 9 — UI/UX with 5-level progressive disclosure

### Design philosophy

Dutch Oven uses **progressive disclosure** to serve both producers wanting a quick "set and forget" reverb and engineers requiring deep algorithmic control. Each level reveals more parameters while maintaining the previous level's controls. A real-time **GPU-rendered spectrogram** (inspired by Logic ChromaVerb) shows frequency on the vertical axis, time on the horizontal axis, and brightness/color mapping to amplitude, with frequency-dependent decay visible as the higher bands dimming faster. A ripple animation pulses outward from the center on each transient, with decay rate and color matching the current algorithm settings.

### Level 1 — Play

The simplest possible interface for immediate results.

| Control | Type     | Range                                                            | Default |
| ------- | -------- | ---------------------------------------------------------------- | ------- |
| Space   | Dropdown | Hall, Room, Plate, Chamber, Spring, Cathedral, Shimmer, Infinite | Hall    |
| Size    | Knob     | 0–100%                                                           | 50%     |
| Decay   | Knob     | 0.1–30s (log)                                                    | 1.8s    |
| Mix     | Knob     | 0–100%                                                           | 25%     |

Layout: Large spectrogram display (60% of panel). Four knobs in a single row below. Space selector as a styled dropdown or horizontal pill selector above the spectrogram. Everything else hidden.

### Level 2 — Shape

Full algorithm parameters for shaping the reverb character.

| Control          | Type | Range              | Default |
| ---------------- | ---- | ------------------ | ------- |
| Pre-Delay        | Knob | 0–500 ms           | 15 ms   |
| High Cut         | Knob | 1–20 kHz           | 12 kHz  |
| Low Cut          | Knob | 20–1000 Hz         | 80 Hz   |
| Width            | Knob | 0–200% (mono→wide) | 100%    |
| Diffusion        | Knob | 0–100%             | 75%     |
| Modulation Rate  | Knob | 0.1–5.0 Hz         | 1.0 Hz  |
| Modulation Depth | Knob | 0–100%             | 30%     |
| Brightness       | Knob | −100% to +100%     | 0%      |

Layout: Two rows of four knobs below the spectrogram. Level 1 controls remain visible in a condensed top bar. Spectrogram now shows HF/LF cut lines as overlay.

### Level 3 — Build

Decay Rate EQ, dynamics, and advanced shaping.

| Control            | Type              | Range                | Default                   |
| ------------------ | ----------------- | -------------------- | ------------------------- |
| Decay Rate EQ      | 6-band parametric | Per-band: ×0.25–×4.0 | Flat (natural room curve) |
| Early/Late Balance | Knob              | 0–100% (early→late)  | 40%                       |
| Early Damping      | Knob              | 0–100%               | 30%                       |
| Attack             | Knob              | 0–100%               | 50%                       |
| Ducking Amount     | Knob              | 0–100%               | 0%                        |
| Ducking Release    | Knob              | 50–2000 ms           | 300 ms                    |
| Sidechain Source   | Toggle            | Internal / External  | Internal                  |

Layout: Decay Rate EQ displayed as an interactive overlay on the spectrogram — draggable nodes for each band. Other knobs in a row below. The EQ curve visually maps onto the spectrogram's decay visualization.

### Level 4 — Route

IR loading, hybrid routing, true stereo configuration.

| Control         | Type                     | Range                  | Default |
| --------------- | ------------------------ | ---------------------- | ------- |
| IR Loader       | Drag-drop zone + browser | WAV/AIFF files         | (none)  |
| Hybrid Mode     | Selector                 | Off, Parallel, Series  | Off     |
| Hybrid Blend    | Knob                     | 0–100% (conv→algo)     | 50%     |
| True Stereo     | Toggle                   | On/Off                 | Off     |
| Input Mode      | Selector                 | Stereo, Mono, Mid-Side | Stereo  |
| Output Mode     | Selector                 | Stereo, Mid-Side       | Stereo  |
| Sidechain Input | Toggle                   | On/Off                 | Off     |

Layout: IR browser panel slides in from the left with categorized folders (Hall, Room, Plate, Spring, Chamber, Cathedral, Outdoor, Creative, User). Waveform display of loaded IR with trim handles. Routing diagram showing signal flow for current hybrid mode.

### Level 5 — Lab

Deep algorithm access for DSP engineers and sound designers.

| Control                         | Type                | Range                                              | Default      |
| ------------------------------- | ------------------- | -------------------------------------------------- | ------------ |
| Algorithm                       | Selector            | Dattorro Plate, FDN-8, FDN-16, Spring, Convolution | FDN-8        |
| Matrix Type                     | Selector            | Householder, Hadamard                              | Hadamard     |
| Delay Lengths                   | 8/16 numeric fields | Per-line (samples)                                 | Auto (prime) |
| Input Diffusion Stages          | Slider              | 0–8                                                | 4            |
| Tank Modulation LFO Shape       | Selector            | Sine, Triangle, Noise                              | Sine         |
| Freeze                          | Momentary/Toggle    | On/Off                                             | Off          |
| Shimmer                         | Toggle              | On/Off                                             | Off          |
| Shimmer Pitch                   | Selector            | +5th, +Oct, +Oct+5th, Custom                       | +Oct         |
| Shimmer Amount                  | Knob                | 0–100%                                             | 20%          |
| Shimmer Mode                    | Selector            | Granular, Phase Vocoder                            | Granular     |
| Gravity                         | Knob                | −100 to +100                                       | +50          |
| Infinite Sustain                | Toggle              | On/Off                                             | Off          |
| Saturation Type                 | Selector            | tanh, Chebyshev, Hard Clip                         | tanh         |
| Custom IR EQ                    | 6-band parametric   | Applied to IR in frequency domain                  | Flat         |
| Grain Size (granular diffusion) | Knob                | 20–500 ms                                          | 50 ms        |

Layout: Full parameter panel with collapsible sections for each engine. Algorithm topology diagram updates dynamically to show current signal flow. Per-delay-line visualizations showing modulation state and energy. Export/import of complete parameter presets as JSON.

### Spectrogram display specification

The real-time display uses GPU fragment shaders to render a **scrolling spectrogram** where the horizontal axis represents time (most recent at right, scrolling left), vertical axis represents frequency (log scale, 20 Hz–20 kHz), and color/brightness represents amplitude. Frequency-dependent decay is directly visible: bands with shorter RT60 dim faster. On each input transient detected by envelope follower, a **ripple animation** radiates outward from the frequency centroid of the transient, with the ripple's decay rate and color warmth reflecting the current decay and damping settings. Frame rate: 60 fps minimum, rendering via Metal/Vulkan/OpenGL compute shader with STFT analysis running at 1024-point windows, 75% overlap.

---

## Part 10 — Secret sauce: synthesis of key insights

### Why mutually prime delay lengths are essential

When delay line lengths share a common factor k, the FDN's impulse response contains a periodic component at period k/f_s. This creates audible pitch coloration — a metallic ringing tone at frequency f_s/k. With mutually prime lengths, the combined period before repetition equals the product of all lengths (astronomically long), ensuring no audible periodicity. However, mutual primality alone is insufficient: delay lengths must also be well-distributed (not clustered) and avoid low-order harmonic relationships. Smith's prime-power method (M_i = p_i^(k_i) for distinct primes p_i) guarantees coprimality regardless of scaling.

### Modulation depth and rate sweet spots

From Dattorro: **~1 Hz rate, ±8 samples depth** at 29761 Hz (scaling proportionally with sample rate). From Costello: **0.2–0.5 Hz** for artifact smoothing, **0.5–2.0 Hz** for general use, up to **2 Hz** for lush synth reverbs. For Lexicon 224 character: **0.5–3.0 Hz** with **8–32 samples** depth. Reduce depth for long decays (signal passes through modulators hundreds of times). Use multiple LFOs at **incommensurate frequencies** (e.g., 0.7, 1.1, 1.7, 2.3 Hz) to prevent periodic artifacts. Sinusoidal LFOs preferred; triangle creates square-wave pitch modulation (constant-pitch trill effect). All algorithmic reverbs produce an audible artifact at a rate equal to 1/(total delay time) — modulation's primary purpose is breaking this periodicity.

### Allpass chains versus diffusion networks

**Allpass loops/chains** (Schroeder, Dattorro, Lexicon): Nested allpass loops produce the smoothest reverb with minimal tuning effort. Echo density increases with time (like real rooms). The Central Limit Theorem causes very long allpass cascades (>24 stages) to produce reverse-like swells — useful creatively (Blackhole, ValhallaShimmer) but unnatural for room simulation. Disadvantage: metallic coloration if too few stages or poor coefficient choice.

**FDN (Gerzon, Jot):** More flexible topology, scalable to arbitrary channel counts, easier to implement frequency-dependent decay via per-line filters. But "huge pain to tune" (mystran, KVR). The matrix choice matters more than delay lengths — irregular Gibbs rotation angles outperform regular Hadamard/Householder for some developers. Costello's approach combines both: 4×4 FDN with 12 embedded allpass delays, borrowing from both paradigms.

### What makes the Bricasti M7 exceptional

The M7 runs **three separate reverb engines simultaneously** on 6 dual-core DSP chips (12 cores total): (1) exceptionally dense early reverberation (not discrete early reflections — "very dense and complex, making it sound closer to what happens in real life"), (2) a separate late decay tail, and (3) a dedicated **sub-80 Hz early reverberation engine** for conveying the "depth and power of large spaces." The M7 uses an "entirely different principle" from Lexicon's allpass/comb approach (per Brian Zolner, Bricasti co-founder). Because the algorithm doesn't suffer from inherent allpass/comb coloration, it needs **less modulation** than competitors — the modulation in older reverbs was originally introduced to mask coloration, not increase realism. The M7 achieves "the density of convolution with the editability of algorithmic" reverb.

### Smooth versus grainy reverb tails

**Grainy tails** result from low echo density, regular/repetitive delay patterns, insufficient diffusion, and small room sizes (low modal density). Cross-channel feedback in FDNs can degrade smoothness by creating inter-channel energy oscillation. **Smooth tails** require high echo density (>2000 echoes/second), effective modulation to break repetitive patterns, well-designed mixing matrices with irregular coefficient angles, and maximum total delay length in the loop (which permits lower loop gain for the same RT60, reducing cumulative filter artifacts). Costello notes: "A rough initial sound with a smooth tail is really neat" — feeding the reverb at few points and tapping from few points naturally produces this character.

### Why linear interpolation degrades modulated feedback loops

Linear interpolation is a one-zero FIR lowpass: `H(z) = (1-α) + α·z⁻¹`. Its magnitude response rolls off toward Nyquist depending on the fractional delay α. In a single pass, this is inaudible at typical modulation rates. In a feedback loop with ~0.1 s average delay lines, a 30-second decay means **~300 passes** through the interpolator. Each pass multiplicatively attenuates high frequencies — after 300 passes, the cumulative HF loss is tens of dB, creating far more darkening than the damping parameter accounts for. **Allpass interpolation** (same computational cost: one multiply, two adds) maintains unity gain at all frequencies, with only phase variation that is inaudible for the slow, microtonal pitch changes in reverb modulation. Use allpass interpolation in all feedback paths; reserve linear interpolation for deliberate vintage character ("Dark" modes).

### Signalsmith Audio's two-stage architecture

Geraint Luff's key insight: **separate diffusion from sustain** into independent processing stages. A multi-channel Hadamard diffuser (8 channels, 4 steps with doubling delays: 20→40→80→160 ms) produces 8⁴ = 4,096 echoes from a single pulse — sufficient density without any feedback. A separate feedback loop with Householder matrix (providing moderate mixing) and frequency-dependent decay handles sustain independently. This separation eliminates the traditional coupling between diffusion and decay time that makes conventional reverbs difficult to tune.

---

## Implementation checklist

**Core engines:**

- [ ] Dattorro plate reverb with all 8 tank delay lines, 4 input diffusers, modulated allpasses with allpass interpolation, 14-tap stereo output
- [ ] FDN reverb with configurable 8/16 delay lines, Hadamard and Householder matrix options, FWHT implementation
- [ ] Mutually-prime delay length generator using prime-power method
- [ ] Per-delay-line absorptive filters for frequency-dependent decay (Jot formula)
- [ ] Tapped delay line early reflections with configurable tap patterns per room type
- [ ] Convolution engine with non-uniform partitioned convolution (García optimal), zero-latency head, pre-computed FFT partitions
- [ ] True stereo convolution (4-channel IR support)
- [ ] Spring reverb engine with dispersive allpass cascade (Parker method) in feedback loop

**Creative features:**

- [ ] Shimmer with granular pitch shifter (30 ms grains, Hann window, ±random jitter) and phase vocoder option
- [ ] Infinite sustain with configurable saturation (tanh, Chebyshev, hard clip) placed before mixing matrix
- [ ] Freeze with 30 ms crossfade ramp on feedback/input/modulation
- [ ] Reverse reverb via reversed IR convolution and real-time double-buffered grain reversal
- [ ] Gravity parameter controlling allpass coefficient distribution for normal/reverse envelopes
- [ ] Granular diffusion with 30–500 ms grains, stochastic scatter, per-grain pitch randomization

**Signal processing:**

- [ ] Decay Rate EQ: 6-band parametric controlling per-band RT60 via feedback loop filter design
- [ ] Hybrid mode: parallel and series routing with power-complementary crossfade and spectral correction filter
- [ ] Sample rate conversion for all delay lengths: `delay_target = round(delay_ref × fs_target / fs_ref)`
- [ ] Magnitude truncation in all recursive paths to eliminate limit-cycle oscillation
- [ ] Modulation system: multiple sinusoidal LFOs at incommensurate frequencies, per-delay-line assignment

**IR management:**

- [ ] WAV/AIFF loader with mono/stereo/true-stereo detection
- [ ] Auto-trim at −60 dB below peak
- [ ] Frequency-domain IR EQ via FFT partition multiplication
- [ ] IR stretching via exponential envelope modification
- [ ] Categorized IR browser with drag-and-drop user import

**UI/UX:**

- [ ] 5-level progressive disclosure (Play → Shape → Build → Route → Lab)
- [ ] GPU-rendered scrolling spectrogram with frequency-dependent decay visualization
- [ ] Ripple animation on transient detection
- [ ] Interactive Decay Rate EQ overlay on spectrogram
- [ ] Dynamic signal flow diagram in Lab mode

**Infrastructure:**

- [ ] Plugin latency reporting to host for PDC
- [ ] Background thread for IR loading and FFT pre-computation
- [ ] SIMD-optimized FFT with cache-aligned memory layout
- [ ] Parameter smoothing (30 ms ramp) on all real-time controls to prevent clicks
- [ ] Preset system with JSON export/import for Lab-level parameters
