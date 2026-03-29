# Gluten: complete implementation guide for a professional bus compressor plugin

**Gluten is a multi-topology bus/glue compressor with a Rust DSP backend targeting native (VST3/CLAP) and WASM.** This guide provides every algorithm, formula, and implementation detail required to build it — from the gain computer math to VCA distortion modeling to the UI progressive disclosure system. The four compressor topologies (VCA, opto, FET, diode bridge) each receive exact DSP modeling approaches derived from published schematics, academic papers, and confirmed circuit analysis. The canonical reference throughout is Giannoulis, Massberg & Reiss (JAES 2012), supplemented by Gyraf Audio's published SSL clone schematics, Andrew Simper's Cytomic documentation, THAT Corporation datasheets, and UA's modeling insights.

---

## Part 1: The gain computer — core DSP shared by all topologies

Every compressor topology in Gluten shares a common gain computer pipeline. The signal flow is: **level detection → static characteristic (gain computer) → attack/release smoothing → gain application**. What differs per topology is the detection method, the smoothing behavior, and optional nonlinear coloration.

### Static characteristic with soft knee

The gain computer maps input level in dB to gain reduction in dB. The soft knee formula from Giannoulis et al. uses quadratic interpolation in the dB domain, with knee width `W` distributed equally around threshold `T`:

```
fn gain_computer(x_dB: f32, T: f32, R: f32, W: f32) -> f32 {
    let slope = 1.0 - 1.0 / R;
    let half_w = W / 2.0;
    let overshoot = x_dB - T;

    if overshoot <= -half_w {
        0.0                                                    // below knee: no compression
    } else if overshoot >= half_w {
        -slope * overshoot                                     // above knee: full compression
    } else {
        -0.5 * slope * (overshoot + half_w).powi(2) / W       // in knee: quadratic
    }
}
```

The exact knee-region formula is **y = x + (1/R − 1) · (x − T + W/2)² / (2W)**. The denominator is `2W`, confirmed by MATLAB Audio Toolbox and the CTAGDRC reference implementation. A variant using `4W` found in some Pure Data posts is incorrect. The function returns gain reduction in dB (always ≤ 0 for downward compression).

### Level detection: RMS vs peak

For bus compression, **RMS detection produces more musical results** than peak detection because it responds to perceived loudness rather than instantaneous transients. The one-pole IIR RMS estimator:

```
// Per-sample RMS update (operates on squared signal)
x_sq = x[n] * x[n];
rms_sq[n] = α_rms * rms_sq[n-1] + (1.0 - α_rms) * x_sq;
x_dB[n] = 10.0 * log10(rms_sq[n]);   // equivalent to 20*log10(sqrt(rms_sq))
```

The coefficient `α_rms = exp(-1.0 / (τ_rms * fs))` where `τ_rms` is the averaging window in seconds. A **5–10 ms** window suits bus compression. Peak detection uses `|x[n]|` directly and responds to every transient — useful for limiting but causes pumping on buses.

### Attack/release smoothing

The **branching smooth filter** recommended by Giannoulis et al. applies separate one-pole coefficients based on whether gain reduction is increasing (attack) or decreasing (release):

```
fn smooth_gain(gc: f32, gs_prev: f32, α_a: f32, α_r: f32) -> f32 {
    if gc <= gs_prev {
        // Attack: more compression needed (gc more negative)
        α_a * gs_prev + (1.0 - α_a) * gc
    } else {
        // Release: compression recovering (gc less negative)
        α_r * gs_prev + (1.0 - α_r) * gc
    }
}
```

**Coefficient calculation** from time constant to filter coefficient:

| Convention         | Formula                      | When to use                               |
| ------------------ | ---------------------------- | ----------------------------------------- |
| 0% → 63% (1 − 1/e) | `α = exp(-1.0 / (τ · fs))`   | Most DSP literature, Giannoulis et al.    |
| 10% → 90%          | `α = exp(-ln(9) / (τ · fs))` | MATLAB Audio Toolbox, some hardware specs |

The distinction matters: an attack time of 1 ms means different things under each convention, differing by a factor of **ln(9) ≈ 2.197**. Gluten should document which convention it uses and stick to it. The 63% convention is standard in DSP.

### The decoupled smooth peak detector

For bus compression, the alternative **decoupled detector** from Giannoulis et al. separates attack and release into two stages, producing cleaner transient handling:

```
// Stage 1: instantaneous attack, controlled release
y1[n] = max(x[n], α_R * y1[n-1] + (1.0 - α_R) * x[n]);

// Stage 2: smoothing with attack time constant
y_L[n] = α_A * y_L[n-1] + (1.0 - α_A) * y1[n];
```

This produces a measured release time of approximately `τ_R + τ_A`, so compensate accordingly when mapping user-facing controls to internal coefficients.

### Applying gain reduction

After smoothing, convert dB gain to linear and multiply:

```
let g_lin = 10.0_f32.powf(g_smoothed / 20.0);
let output = input * g_lin;
```

For efficiency, use a lookup table or fast `exp2` approximation rather than `powf` per-sample.

---

## Part 2: VCA model — SSL G-Bus / API 2500 / Elysia Alpha

The SSL 4000 G-Bus Compressor is the archetype of VCA bus compression. Despite common belief, **the SSL is actually a feedback compressor** — confirmed directly by Andrew Simper (Cytomic) on KVR: "The Glue is a feedback compressor." The sidechain taps from a dedicated "dummy" VCA that parallels the main gain reduction, creating a quasi-feedback loop.

### SSL circuit topology and confirmed values

From the **Gyraf Audio GSSL** clone documentation (published schematics of SSL 82E26/82E27 cards):

| Parameter | Values                     | Implementation                                                     |
| --------- | -------------------------- | ------------------------------------------------------------------ |
| Attack    | 0.1, 0.3, 1, 3, 10, 30 ms  | 6-position resistor bank → attack cap                              |
| Release   | 0.1, 0.3, 0.6, 1.2 s, Auto | 4 tantalum caps + discharge resistors, or auto circuit             |
| Ratio     | 2:1, 4:1, 10:1             | Resistor network to −12V creating different threshold/ratio curves |
| Threshold | −20 to +20 dBm             | 50 kΩ linear pot (DC offset to sidechain VCA)                      |
| Makeup    | 0 to +20 dB                | 50 kΩ linear pot (DC offset to main VCAs)                          |

**Important note from Simper**: The SSL's labeled release times are approximately **2× off** from measured values. His Glue plugin uses corrected values: 0.1, 0.2, 0.4, 0.6, 0.8, 1.2 s, Auto.

The ratio implementation uses a resistor network that creates different negative input currents against which the rectifier output must work. The transfer curve is **not decilinear** — effective ratio increases the further above threshold, creating a natural dynamic soft-knee behavior distinct from the static soft-knee formula. The rectifier diodes (~0.6 V forward voltage) create a smooth transition into compression, which Simper describes as "the onset of compression caused by the diode-based envelope follower is very smooth — this isn't the same thing as a soft knee, it is more dynamic."

### Auto-release dual time constant

The SSL auto-release uses **two parallel RC networks** sharing the release timing circuit. Verified component values from the Gyraf GSSL schematic:

- **Fast path**: 91 kΩ + 6.8 µF tantalum → **τ₁ = 619 ms**
- **Slow path**: 750 kΩ + 0.47 µF tantalum → **τ₂ = 353 ms**

These interact as follows: for **brief transients**, the 6.8 µF capacitor barely charges, so recovery is dominated by the 91 kΩ / 6.8 µF path (~619 ms fast recovery). For **sustained compression**, both capacitors charge fully; the 0.47 µF / 750 kΩ path then dominates the tail, providing slow final recovery (~353 ms). The loudest ~⅔ of gain reduction recovers quickly; the final few dB release slowly, preventing audible pumping.

```rust
struct AutoRelease {
    env_fast: f32,
    env_slow: f32,
    coeff_release_fast: f32,  // exp(-1.0 / (0.619 * fs))
    coeff_release_slow: f32,  // exp(-1.0 / (0.353 * fs))
}

impl AutoRelease {
    fn new(fs: f32) -> Self {
        Self {
            env_fast: 0.0,
            env_slow: 0.0,
            coeff_release_fast: (-1.0 / (0.619 * fs)).exp(),
            coeff_release_slow: (-1.0 / (0.353 * fs)).exp(),
        }
    }

    fn process(&mut self, rectified: f32, coeff_attack: f32) -> f32 {
        // Fast envelope: charges quickly, releases at τ=619ms
        if rectified > self.env_fast {
            self.env_fast += (1.0 - coeff_attack) * (rectified - self.env_fast);
        } else {
            self.env_fast = self.coeff_release_fast * self.env_fast
                + (1.0 - self.coeff_release_fast) * rectified;
        }

        // Slow envelope: charges quickly, releases at τ=353ms
        if rectified > self.env_slow {
            self.env_slow += (1.0 - coeff_attack) * (rectified - self.env_slow);
        } else {
            self.env_slow = self.coeff_release_slow * self.env_slow
                + (1.0 - self.coeff_release_slow) * rectified;
        }

        // Take the maximum (more compression) — fast dominates initially,
        // slow dominates the tail
        self.env_fast.max(self.env_slow)
    }
}
```

### THAT 2181 VCA distortion modeling

The THAT 2181 (successor to the DBX 202C) is a **Blackmer-topology complementary log/antilog gain cell** with control sensitivity of **−6.1 mV/dB** at room temperature. Its distortion character is almost exclusively **second harmonic**, arising from asymmetry between the four core transistors.

Key specifications from THAT Corporation datasheets:

- **THD (trimmed)**: 0.0025% for 2181A, 0.005% for 2181C
- **Untrimmed THD**: approximately −75 dB (per Gyraf measurements)
- **Control range**: 130 dB
- **Dominant distortion**: 2nd harmonic from Vbe mismatch between transistor pairs

The SYM pin allows trimming this mismatch. Jakob Erland (Gyraf) notes that some builders deliberately trim VCAs **slightly off-center** — "just to get a little more 'sound'." For DSP modeling, this asymmetry maps to a simple polynomial waveshaper:

```rust
fn vca_distortion(x: f32, k2: f32, gain_reduction_db: f32) -> f32 {
    // k2 controls 2nd harmonic amount (typ. 0.001 - 0.01)
    // Distortion increases with gain change (parasitic effects)
    let k_dynamic = k2 * (1.0 + 0.02 * gain_reduction_db.abs());
    x + k_dynamic * x * x
}
```

The waveshaper `y = x + k·x²` produces exactly the asymmetric transfer characteristic that generates predominantly 2nd harmonic content. The coefficient `k` should be signal-level-dependent (THD increases with input level) and gain-dependent (distortion increases during gain changes from rapid VCA modulation).

**Why the VCA "glues"**: The exponential (linear-in-dB) control law means gain changes are perceptually uniform — a 1 dB/ms change sounds identical whether compressing 2 dB or 20 dB. Combined with the diode rectifier's smooth onset creating emergent soft-knee behavior, the feedback topology's program-dependence, and gentle 2nd harmonic warmth, the result is smooth, predictable envelope control with minimal audible artifacts at **2–4 dB of gain reduction**.

### Feed-forward vs feedback topology math

```
// FEED-FORWARD: gain computer sees input level
x_dB = 20 * log10(|input|)
gc = gain_computer(x_dB, T, R, W)    // R maps directly to static I/O curve

// FEEDBACK: gain computer sees output level (requires 1-sample delay)
y_dB = 20 * log10(|output[n-1]|)
gc = gain_computer(y_dB, T, R_fb, W)
// Effective ratio: R_eff = R_fb / (R_fb - 1)
// To match feed-forward ratio R_ff: R_fb = R_ff / (R_ff - 1)
```

Feedback compressors cannot achieve infinite ratio (brickwall limiting) and have ratio-dependent attack/release behavior that sounds "smoother" and more program-dependent. The SSL uses feedback; most modern digital compressors use feed-forward for predictability.

---

## Part 3: Opto model — LA-2A / Shadow Hills style

The optical compressor uses a **T4 opto cell** containing a CdS (cadmium sulfide) photoresistor coupled with an electroluminescent panel. Its defining characteristic is **program-dependent release with physical memory** — the CdS material's charge-carrier trapping states fill during sustained illumination, requiring progressively longer times to deplete. A brief transient recovers in ~60 ms; sustained compression can extend release to **5+ seconds**.

### T4 cell behavior and the memory effect

| Parameter       | Value                                              |
| --------------- | -------------------------------------------------- |
| Attack          | ~10 ms (fixed, limited by EL panel rise time)      |
| Fast release    | ~60 ms (50% recovery from brief peak)              |
| Slow release    | 0.5 – 5 s (full recovery, program-dependent)       |
| Effective ratio | ~3:1 soft knee (Compress mode), ~10:1 (Limit mode) |
| Topology        | Feedback (sidechain monitors output)               |

The memory effect is the key to opto's smoothness. The model tracks a `memory_state` variable that **accumulates during compression and decays slowly**, stretching the release time proportionally:

```rust
struct OptoCompressor {
    gr_state: f32,          // current gain reduction (linear, 0.0-1.0)
    memory_state: f32,      // CdS memory accumulator (0.0-1.0)
    last_output: f32,       // for feedback topology
    tau_attack: f32,        // ~10ms
    tau_release_fast: f32,  // ~60ms
    tau_memory_charge: f32, // ~200ms
    tau_memory_decay: f32,  // ~2s
}

impl OptoCompressor {
    fn process(&mut self, input: f32, threshold_db: f32, fs: f32) -> (f32, f32) {
        // Feedback: detect from previous output
        let detect_db = 20.0 * (self.last_output.abs().max(1e-8)).log10();
        let excess = (detect_db - threshold_db).max(0.0);

        // Soft, program-dependent ratio (inherent to opto I-V curve)
        let effective_ratio = 3.0 + 2.0 * (excess / 20.0).min(1.0);
        let desired_gr_db = excess * (1.0 - 1.0 / effective_ratio);

        // Update memory: accumulates during compression, decays slowly
        if desired_gr_db > 0.5 {
            let charge_alpha = 1.0 - (-1.0 / (self.tau_memory_charge * fs)).exp();
            self.memory_state += charge_alpha * (1.0 - self.memory_state);
        } else {
            let decay_alpha = 1.0 - (-1.0 / (self.tau_memory_decay * fs)).exp();
            self.memory_state -= decay_alpha * self.memory_state;
        }

        // Release time stretches with memory
        let tau_release = self.tau_release_fast
            + (5.0 - self.tau_release_fast) * self.memory_state;

        // Ballistics
        let alpha = if desired_gr_db > self.gr_state {
            1.0 - (-1.0 / (self.tau_attack * fs)).exp()
        } else {
            1.0 - (-1.0 / (tau_release * fs)).exp()
        };

        self.gr_state += alpha * (desired_gr_db - self.gr_state);
        let gain = 10.0_f32.powf(-self.gr_state / 20.0);
        let output = input * gain;
        self.last_output = output;
        (output, self.gr_state)
    }
}
```

A more physically accurate model uses Jatin Chowdhury's signal-dependent time constant: **τ(x) = G · exp(A · |x_history|)**, where `G` and `A` are tuning constants calibrated against real T4 cell measurements. The exponential relationship captures how CdS resistance recovery time increases nonlinearly with accumulated illumination.

---

## Part 4: FET model — 1176 style

The 1176 uses a **JFET as a voltage-controlled variable resistor** in a feedback topology, with ultra-fast attack times (**20 µs to 800 µs**) and significant harmonic coloration from the FET's square-law transfer characteristic and output transformer saturation.

### JFET gain element

In the triode/ohmic region where the FET operates as a variable resistor, the Shichman-Hodges model gives:

```
I_D = (I_DSS / V_P²) · (2(V_GS - V_P) - V_DS) · V_DS
```

The squared term creates **nonlinear distortion** — primarily odd harmonics from the symmetric transfer function. The FET sits in a voltage divider: `output = input · R_load / (R_load + R_ds(V_gs))`, where `R_ds` varies with gate voltage.

### "All buttons in" mode

Pressing all four ratio buttons (4:1, 8:1, 12:1, 20:1) simultaneously engages all ratio-setting resistor networks in parallel, creating unpredictable behavior: the compression ratio **increases after the transient** (opposite of normal), the threshold drops dramatically, and the release becomes severe and sudden. Model this by computing parallel resistance of all four ratio networks and adding a lagging envelope that increases effective ratio post-transient:

```rust
fn all_buttons_ratio(parallel_r: f32, time_since_peak_ms: f32) -> f32 {
    let base_ratio = compute_parallel_ratios(4.0, 8.0, 12.0, 20.0); // ~12-20
    let lag_factor = 1.0 + 0.5 * (1.0 - (-time_since_peak_ms / 50.0).exp());
    base_ratio * lag_factor
}
```

### Transformer saturation

The 1176's input and output transformers add even-order harmonics through core saturation. A `tanh` waveshaper or asymmetric soft-clipper models this effectively:

```rust
fn transformer_saturate(x: f32, drive: f32) -> f32 {
    (x * drive).tanh() / drive.tanh()  // normalized tanh waveshaper
}
```

---

## Part 5: Diode bridge model — Neve 33609 style

The 33609 uses four diodes in a **Wheatstone bridge configuration** as the gain reduction element. Audio is applied across two opposite corners (differential); DC bias current applied across the other two corners controls incremental resistance. UA's Dr. Dave Berners notes: "The 33609 has more significant, distributed nonlinearities than any other unit we have modeled."

### Diode bridge gain reduction

The Shockley diode equation governs each element: **I = Iₛ · (exp(V / (n·Vₜ)) − 1)**, where Iₛ ≈ 1e-12 A, Vₜ ≈ 25.85 mV at 20°C, and n = 1.0–2.0. All four diodes are kept forward-biased by the DC control current, operating in the exponential region. Small audio voltage variations around this bias point create the nonlinearity.

```rust
fn diode_bridge_attenuation(audio: f32, bias_current: f32) -> f32 {
    let vt = 0.02585;      // thermal voltage
    let n = 1.8;           // ideality factor
    let is = 1e-12_f32;    // saturation current

    // Diode conductance at operating point
    let g_diode = (is / (n * vt)) * (bias_current / (n * vt * is)).ln().exp();
    let r_bridge = 1.0 / (2.0 * g_diode);

    // Voltage divider attenuation
    let r_source = 600.0;  // source impedance
    let gain = r_bridge / (r_bridge + r_source);

    // Nonlinear coloration: bridge symmetry → predominantly odd harmonics
    // Taylor expansion of exp around operating point adds k3·x³ terms
    let k3 = 0.005 * (1.0 / r_bridge);  // increases with compression
    audio * gain + k3 * audio.powi(3)
}
```

The diode bridge's symmetrical arrangement **cancels even harmonics** (like a push-pull tube stage), producing **predominantly odd-harmonic distortion**. The transformers and Class-A amplifiers in the 33609's signal path then add even harmonics, creating a "lush array of odd and even upper harmonics." THD ranges from 0.075% in bypass to 0.45% during limiting. **Requires 2–4× oversampling** for accurate nonlinearity modeling without aliasing.

### Harmonic character comparison across topologies

| Topology             | Primary harmonics                                | THD range | Character              |
| -------------------- | ------------------------------------------------ | --------- | ---------------------- |
| VCA (SSL)            | 2nd (asymmetric Blackmer cell)                   | <0.01%    | Clean, precise, "glue" |
| Opto (LA-2A)         | Minimal (from tubes/transformers, not cell)      | <0.1%     | Smooth, invisible      |
| FET (1176)           | Odd (JFET square-law) + even (transformers)      | 0.5–5%    | Punchy, aggressive     |
| Diode bridge (33609) | Odd (bridge symmetry) + even (transformers/amps) | 0.075–3%  | Warm, thick, forward   |

---

## Part 6: The glue algorithm — why 2–4 dB of SSL compression glues a mix

Three mechanisms work together. First, **attack times of 10–30 ms let transients pass through** uncompressed, preserving the punch and definition of drums and plucks. The compressor only acts on the sustained body of sounds. Second, **auto-release adapts to program material** — fast recovery prevents pumping on transient-heavy material while slow recovery on sustained passages maintains transparent leveling. Third, **shared 2nd-harmonic distortion** from the VCA applies a subtle common coloration to all elements passing through the bus, creating a perceptual "family resemblance" that binds disparate sources together.

At **2–4 dB of gain reduction**, these effects are subliminal. The dynamic range is barely reduced (perceptually), but the micro-dynamics are gently controlled, the transient/sustain balance is optimized, and the harmonic signature is unified. Go beyond ~6 dB and the compression becomes audible as pumping or squashing.

### The Thrust concept — sidechain spectral tilt

The API 2500's Thrust circuit is **not a simple highpass filter** but a frequency-tilting EQ applied to the sidechain before the detector. Three modes:

- **Normal**: Flat sidechain response
- **Medium**: Tilt EQ with +3 dB/octave below ~200 Hz, flat 200 Hz–3 kHz, +3 dB/octave above 3 kHz
- **Loud**: Continuous **+3 dB/octave tilt** across the entire spectrum (inverse pink noise curve: −15 dB at 20 Hz, +15 dB at 20 kHz)

The "Loud" setting equalizes per-octave energy so each octave drives the detector equally, compensating for the natural spectral tilt of music (which concentrates energy in the low end). The result: **less bass-triggered pumping, more punch, perceived as "less compressed"** for a given amount of gain reduction.

Implementation as a first-order tilt filter centered at ~640 Hz (geometric mean of 20 Hz–20 kHz):

```rust
struct ThrustFilter {
    // First-order tilt/shelving filter
    // +3 dB/octave = +10 dB/decade
    lp_state: f32,
    tilt_gain: f32,  // 0.0 = flat, 1.0 = full tilt
}

impl ThrustFilter {
    fn process(&mut self, x: f32, fc: f32, fs: f32) -> f32 {
        let wc = 2.0 * std::f32::consts::PI * fc / fs;
        let coeff = (1.0 - wc.sin()) / wc.cos();  // Regalia-Mitra allpass
        let lp = (1.0 - coeff) * 0.5 * x + self.lp_state;
        self.lp_state = coeff * lp + (1.0 - coeff) * 0.5 * x;
        let hp = x - lp;
        // Tilt: boost HP, cut LP (or vice versa)
        lp * (1.0 - self.tilt_gain) + hp * (1.0 + self.tilt_gain)
    }
}
```

For a general sidechain HPF (60–300 Hz adjustable), implement a 2nd-order Butterworth:

```rust
fn butterworth_hpf_coeffs(fc: f32, fs: f32) -> BiquadCoeffs {
    let w0 = 2.0 * PI * fc / fs;
    let alpha = w0.sin() / (2.0 * 0.7071);  // Q = √2/2 for Butterworth
    let cos_w0 = w0.cos();
    BiquadCoeffs {
        b0: (1.0 + cos_w0) / 2.0,
        b1: -(1.0 + cos_w0),
        b2: (1.0 + cos_w0) / 2.0,
        a0: 1.0 + alpha,
        a1: -2.0 * cos_w0,
        a2: 1.0 - alpha,
    }
}
```

---

## Part 7: Hardware compressor models — specific implementation notes

### Cytomic "The Glue" — Andrew Simper's approach

Simper's SSL emulation models the **sidechain at component level** while keeping the audio path perfectly clean. Key insights from his KVR and Ableton interviews:

- The sidechain envelope follower is simulated as an analog circuit, not approximated with DSP primitives. "There were a couple of unexpected, but great sounding, behaviours of this part of the circuit that I wouldn't have deliberately coded myself."
- The diode-based rectifier creates **emergent dynamic soft-knee behavior** — "the onset of compression is very smooth. This isn't the same thing as a soft knee; it is more dynamic, with attack and release times also smoothly ramping up."
- The **Range control** (unique to The Glue, not present on any SSL hardware) caps maximum gain reduction. Implementation: `actual_gr = max(computed_gr, -range_db)`. Simper recommends **−15 dB** as a good default with fast attack times to prevent excessive pumping.
- **The Glue V2** (in development as of early 2026) implements PNP/PJFET input op-amp macromodels and THAT 2181 VCA modeling with selectable VCA types (Ideal, THAT 2181, DBX 202) and quality modes (Medium Detail / High Detail).
- The **Peak Clip** feature is a simple waveshaper: "linear shape, then bend at the edges till full clip at −0.5 dB." Not anti-aliased — use at higher sample rates.

### FabFilter Pro-C 2 — eight compression styles

Each style differs in detector characteristics, topology, and program-dependent behavior:

| Style     | Topology                            | Key DSP distinction                           |
| --------- | ----------------------------------- | --------------------------------------------- |
| Clean     | Feed-forward, low distortion        | Program-dependent, transparent                |
| Classic   | **Feedback** (unique among the 8)   | Vintage, highly program-dependent             |
| Opto      | Feed-forward, very soft knee        | Slowest response, smoothest                   |
| Vocal     | Feed-forward, fixed soft knee       | Auto-ratio (~100:1), user sets only threshold |
| Mastering | Feed-forward, minimal THD           | Maximum transparency, CPU-heavy               |
| Bus       | Feed-forward, musical response      | Glue-oriented, SSL-inspired                   |
| Punch     | Feed-forward, transient-emphasizing | Faster transients get more GR                 |
| Pumping   | Feed-forward, exaggerated envelope  | Deep, EDM-style pumping                       |

All styles are program-dependent: recovery from transients is fast, recovery from sustained compression is slower. Classic is the only feedback design.

### Shadow Hills Mastering Compressor — dual-stage stacking

Signal flow: **input transformer → optical compressor → discrete VCA compressor → output transformer switch**. The optical stage (using an actual T4B cell) handles broad dynamic swings with gentle, transparent leveling (fixed ~2:1 ratio, program-dependent timing). The VCA stage catches remaining peaks with precisely adjustable controls (6 ratios from 1.2:1 to 10:1, 6 attack times 0.1–30 ms, 6 release times 0.1–1.2 s + Auto, 90 Hz sidechain HPF).

The three output transformers add distinct color:

- **Nickel**: Transparent, minimal distortion, subtle HF shimmer
- **Iron**: Routes through Class-A output stage → **even-order harmonics**, slight +110 Hz bump
- **Steel**: Stronger harmonic saturation, subtle +40 Hz bump, tight low end

The dual-stage approach works because **neither stage works hard** — each contributes 2–4 dB of reduction, staying in the sweet spot where distortion is minimal and compression is musical.

### Elysia Alpha — warm mode and GR limit

100% discrete Class-A circuitry. The "Warm" mode engages the Lehle transformer path, introducing subtle harmonic saturation and a softer ratio/threshold curve. The feed-forward/feedback topology is **selectable per-channel**: feed-forward allows ratios up to infinity and negative ratios; feedback maxes at ~1:2.5 but sounds smoother. The GR Limit control caps maximum gain reduction: `actual_gr = max(computed_gr, -gr_limit_db)`. Also features "Auto Fast" semi-automatic attack/release and a soft-clip limiter at the output.

---

## Part 8: Advanced features — exact implementation

### Mid/Side compression

Encode L/R to M/S with energy-preserving normalization, compress independently, decode back:

```rust
fn encode_ms(l: f32, r: f32) -> (f32, f32) {
    let inv_sqrt2 = std::f32::consts::FRAC_1_SQRT_2; // 0.7071
    let m = (l + r) * inv_sqrt2;
    let s = (l - r) * inv_sqrt2;
    (m, s)
}

fn decode_ms(m: f32, s: f32) -> (f32, f32) {
    let inv_sqrt2 = std::f32::consts::FRAC_1_SQRT_2;
    let l = (m + s) * inv_sqrt2;
    let r = (m - s) * inv_sqrt2;
    (l, r)
}
```

**Proof of perfect reconstruction**: L' = ((L+R)/√2 + (L−R)/√2) / √2 = 2L/2 = L ✓. The √2 factor preserves RMS power (−3.01 dB at each matrix stage). Compress M harder to tighten center image (vocals, bass, kick); compress S lightly to maintain stereo width and ambience.

### Parallel compression (wet/dry mix)

```rust
fn parallel_mix(dry: f32, wet: f32, mix: f32) -> f32 {
    // mix: 0.0 = fully dry, 1.0 = fully wet
    // FabFilter extends to 2.0 (doubled compression effect)
    let dry_gain = (1.0 - mix.min(1.0));
    dry_gain * dry + mix * wet
}
```

This is "upward compression" because the dry signal preserves peaks at full level while the compressed signal brings up quiet passages. **Both paths must have identical latency** to avoid comb filtering — delay the dry path by the same amount as any lookahead in the compressed path.

### Lookahead with circular buffer

```rust
struct LookaheadDelay {
    buffer: Vec<f32>,
    write_pos: usize,
    size: usize,
}

impl LookaheadDelay {
    fn new(max_delay_ms: f32, fs: f32) -> Self {
        let size = (max_delay_ms * 0.001 * fs) as usize + 1;
        Self { buffer: vec![0.0; size], write_pos: 0, size }
    }

    fn process(&mut self, input: f32, delay_samples: usize) -> f32 {
        self.buffer[self.write_pos] = input;
        let read_pos = (self.write_pos + self.size - delay_samples) % self.size;
        let output = self.buffer[read_pos];
        self.write_pos = (self.write_pos + 1) % self.size;
        output
    }
}
```

The sidechain processes the **undelayed** input while the audio path reads from the delayed buffer. Report lookahead as latency to the DAW host: `latency_samples = (lookahead_ms * 0.001 * sample_rate) as u32`. Typical range: **0–20 ms**. Sophisticated implementations (like DMG Compassion) use FIR smoothing within the lookahead window for optimal attack ramps.

### Stereo linking

Blend between dual-mono and fully-linked sidechain:

```rust
fn stereo_link(level_l: f32, level_r: f32, link: f32) -> (f32, f32) {
    // link: 0.0 = independent (dual-mono), 1.0 = fully linked
    // Use max-based linking to avoid phase cancellation issues
    let linked_level = level_l.max(level_r);
    let final_l = level_l + link * (linked_level - level_l);
    let final_r = level_r + link * (linked_level - level_r);
    (final_l, final_r)
}
```

Using `max()` rather than `(L+R)/2` prevents cancellation of out-of-phase material. At **100% link**, both channels receive identical gain reduction, perfectly preserving stereo image. At **0%**, each channel compresses independently (can cause image shifts). The API 2500 adds **frequency-selective linking** via HP/LP/BP filters on the link bus — e.g., HP shape means only high-frequency content triggers linked compression.

### Auto makeup gain

Three validated approaches:

```rust
// Method 1: Half-compensation (TASCAM method, empirically validated)
fn auto_makeup_simple(threshold: f32, ratio: f32) -> f32 {
    let gr_at_0 = (0.0 - threshold).max(0.0) * (1.0 - 1.0 / ratio);
    gr_at_0 / 2.0  // half compensation
}

// Method 2: Full compensation at reference level (Logic Pro style)
fn auto_makeup_reference(threshold: f32, ratio: f32, ref_db: f32) -> f32 {
    let excess = (ref_db - threshold).max(0.0);
    excess * (1.0 - 1.0 / ratio)
}

// Method 3: Proportional (Ableton style, reverse-engineered)
fn auto_makeup_ableton(threshold: f32, ratio: f32) -> f32 {
    0.7 * (1.0 - 1.0 / ratio) * threshold.abs()
}
```

Method 1 with half-compensation is the safest general approach — adding the full GR back would make quiet parts perceptibly louder. With soft knee, compute the actual output at 0 dBFS through the full gain computer function rather than using the simplified formula.

### Range / GR limit

Cap maximum gain reduction at a configurable floor:

```rust
fn apply_range(gain_reduction_db: f32, range_db: f32) -> f32 {
    // range_db is positive (e.g., 6.0 means max 6 dB of reduction)
    gain_reduction_db.max(-range_db)
}
```

For SSL-style limits corresponding to rail voltage headroom: **−72 dB** for 18V rail units, **−60 dB** for 15V rail units. Simper recommends **−15 dB** as a practical default.

---

## Part 9: Metering and visualization architecture

### Thread-safe DSP-to-UI communication

The audio thread must **never allocate, lock, or block**. Use lock-free SPSC (single-producer, single-consumer) ring buffers for streaming data and `AtomicU32` with `f32::to_bits()`/`from_bits()` for instantaneous meter values:

```rust
use std::sync::atomic::{AtomicU32, Ordering};

struct AtomicF32(AtomicU32);

impl AtomicF32 {
    fn store(&self, val: f32) {
        self.0.store(val.to_bits(), Ordering::Relaxed);
    }
    fn load(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }
}
```

For GR history, use a ring buffer of **min/max pairs per display column**. At 44.1 kHz, a 5-second / 800-pixel display requires ~275 audio samples per pixel column. The DSP thread accumulates min/max/RMS per display interval and pushes a struct:

```rust
struct DisplaySample {
    input_min: f32, input_max: f32,
    output_min: f32, output_max: f32,
    gr_min: f32, gr_max: f32,
}
```

Recommended Rust crates: `rtrb` (real-time safe SPSC by the audio community), `ringbuf` (SharedRb with slice operations), or a custom implementation using atomic read/write indices with power-of-2 buffer sizes and bitmask instead of modulo.

### Peak hold algorithm

```rust
struct PeakHold {
    current_peak: f32,
    hold_counter: u32,
    hold_time: u32,     // e.g., 3 seconds × (sample_rate / block_size)
    decay_rate: f32,    // e.g., 0.01 dB per UI frame (~1 dB/s at 60fps)
}

impl PeakHold {
    fn update(&mut self, value: f32) {
        if value < self.current_peak {           // More compression (more negative)
            self.current_peak = value;
            self.hold_counter = self.hold_time;
        } else if self.hold_counter > 0 {
            self.hold_counter -= 1;              // Hold phase
        } else {
            self.current_peak += self.decay_rate; // Decay toward 0 dB
            self.current_peak = self.current_peak.min(0.0);
        }
    }
}
```

### Transfer curve display

Plot the static characteristic by sweeping input dB through the gain computer and drawing input vs output:

```rust
fn draw_transfer_curve(threshold: f32, ratio: f32, knee: f32, range: f32) -> Vec<(f32, f32)> {
    let mut points = Vec::new();
    for input_db in (-60..=0).map(|i| i as f32) {
        let gr = gain_computer(input_db, threshold, ratio, knee);
        let capped_gr = gr.max(-range);
        let output_db = input_db + capped_gr;
        points.push((input_db, output_db));
    }
    points
}
```

Overlay a **real-time operating point dot** by computing the current RMS input level and mapping it to the curve, smoothed with a ~50 ms exponential filter for visual stability.

### Gain-matched bypass

Measure input and output loudness using EBU R128 Momentary (400 ms window) and apply the difference as compensation when bypass is toggled:

```rust
fn compute_bypass_compensation(input_lufs: f32, output_lufs: f32) -> f32 {
    let target = input_lufs - output_lufs; // dB compensation needed
    // Smooth to avoid audible jumps
    10.0_f32.powf(target / 20.0)
}
```

---

## Part 10: UI/UX — five-level progressive disclosure

### Level 1 — Play

**Three controls**: Style selector (Glue / Punch / Smooth / Pump), Amount knob (0–100%, internally maps to threshold + ratio), Mix knob (0–100%). One bar GR meter. Target: **400 × 200 px**. Each style loads calibrated presets — "Glue" uses SSL topology with 4:1, 10 ms attack, auto release; "Punch" uses FET with fast attack, medium release; "Smooth" uses opto with program-dependent everything; "Pump" uses VCA with fast attack, long release for rhythmic pumping.

### Level 2 — Shape

**Full compressor controls**: Threshold (−60 to 0 dB), Ratio (1:1 to ∞:1), Attack (0.02–250 ms), Release (25–5000 ms with Auto toggle), Knee (0–30 dB), Makeup Gain (−12 to +24 dB with Auto toggle), Mix. Transfer curve display with operating point, GR meter with peak hold, I/O meters. Target: **600 × 400 px**.

### Level 3 — Build

**Adds**: Sidechain HPF (20–500 Hz), Sidechain LPF (1–20 kHz), Sidechain parametric EQ band, Stereo Link (0–100%), Range (−60 to 0 dB), Hold (0–500 ms), Auto Release toggle. GR history waveform (scrolling FabFilter-style display), sidechain frequency visualization. Target: **800 × 500 px**.

### Level 4 — Route

**Adds**: External sidechain toggle + routing, Mid/Side mode selector (Stereo/Mid/Side), Lookahead (0–20 ms), Oversampling (1×/2×/4×), Detection mode (Peak/RMS), Multi-model blend crossfader (morph between topologies), Feedback/Feed-forward toggle. Sidechain waveform display, M/S separate metering, routing diagram. Target: **900 × 600 px**.

### Level 5 — Lab

**Adds**: VCA type selector (Ideal/THAT 2181/DBX 202), diode curve parameters, transformer harmonic controls (per-harmonic k2/k3 knobs), raw time constant entry, gain-matched bypass with LUFS display, delta listen (hear only the difference), advanced metering (spectrogram, phase correlation, crest factor), ballistics mode selector (VU/PPM-I/PPM-II/K-14/True-Peak), latency report. Full-screen resizable.

---

## Part 11: Rust/WASM plugin architecture

### Framework selection

**nih-plug** is the dominant Rust audio plugin framework, supporting VST3 and CLAP natively. Use **VIZIA** for the GUI (GPU-accelerated via Femtovg/Skia, most active nih-plug integration). The architecture separates DSP core from format wrappers:

```
gluten-dsp/         ← #[no_std]-compatible DSP library crate
gluten-plugin/      ← nih-plug wrapper (VST3/CLAP)
gluten-wasm/        ← wasm-bindgen wrapper (AudioWorklet)
gluten-ui/          ← VIZIA UI (desktop) or Canvas/WebGL (web)
```

### Core plugin structure

```rust
#[derive(Params)]
struct GlutenParams {
    #[id = "threshold"] threshold: FloatParam,
    #[id = "ratio"]     ratio: FloatParam,
    #[id = "attack"]    attack: FloatParam,
    #[id = "release"]   release: FloatParam,
    #[id = "knee"]      knee: FloatParam,
    #[id = "makeup"]    makeup: FloatParam,
    #[id = "mix"]       mix: FloatParam,
    #[id = "style"]     style: EnumParam<CompStyle>,
    #[id = "link"]      stereo_link: FloatParam,
    #[id = "range"]     range: FloatParam,
    #[id = "sc_hpf"]    sidechain_hpf: FloatParam,
    #[id = "lookahead"] lookahead: FloatParam,
}

struct Gluten {
    params: Arc<GlutenParams>,
    meters: Arc<MeterData>,
    // Per-channel DSP state
    compressors: [ChannelCompressor; 2],
    lookahead_delay: [LookaheadDelay; 2],
    sidechain_hpf: [BiquadFilter; 2],
    // Metering accumulators
    display_acc: DisplayAccumulator,
}

impl Plugin for Gluten {
    const NAME: &'static str = "Gluten";
    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[
        AudioIOLayout { main_input_channels: NonZeroU32::new(2),
                        main_output_channels: NonZeroU32::new(2),
                        aux_input_ports: &[new_nonzero_u32(2)], // sidechain
                        ..AudioIOLayout::const_default() }
    ];

    fn process(&mut self, buffer: &mut Buffer, aux: &mut AuxiliaryBuffers,
               context: &mut impl ProcessContext<Self>) -> ProcessStatus {
        context.set_latency_samples(self.lookahead_samples());
        for mut frame in buffer.iter_samples() {
            // 1. Read parameters (smoothed)
            // 2. Encode M/S if enabled
            // 3. Sidechain HPF
            // 4. Level detection (RMS or peak)
            // 5. Stereo linking
            // 6. Gain computer + smoothing (per-topology)
            // 7. Apply range limit
            // 8. Apply gain via lookahead delay
            // 9. Parallel mix
            // 10. Decode M/S if enabled
            // 11. Update meters (atomic stores + ring buffer push)
        }
        ProcessStatus::Normal
    }
}
```

### WASM target

Compile the `gluten-dsp` crate to `wasm32-unknown-unknown` and load it in an `AudioWorkletProcessor`. The DSP core is shared between native and web targets. WASM SIMD is available in Chrome for vectorized sample processing. Communication between main thread and AudioWorklet uses `MessagePort` for parameter changes and `SharedArrayBuffer` for real-time meter data.

---

## Secret sauce insights from hardware analysis

**The SSL's magic is in what you can't see on a schematic.** Andrew Simper's core insight is that the diode-based rectifier, op-amp saturation, capacitor charge/discharge asymmetry, and feedback loop all interact to create emergent behavior that no simplified DSP model captures. The "dynamic soft-knee" — where attack and release times smoothly ramp up from zero to their full values as the signal crosses threshold — is not the same as a static soft knee in the gain computer. It's a consequence of component nonlinearities in a feedback loop. To model it accurately, you must either simulate the circuit at component level (Simper's approach) or carefully tune multiple interacting parameters.

**The T4 opto cell's memory is irreplaceable.** No simple dual-time-constant model fully captures CdS behavior. The physical charge-carrier trapping mechanism means release time depends on illumination _history_ over seconds to minutes. A good approximation uses an exponentially-weighted moving average of recent gain reduction to modulate release time, but the real cell has quasi-random variation that gives each LA-2A its personality.

**Oversampling matters for nonlinear models.** The diode bridge (33609) and FET (1176) models generate significant harmonic content that will alias at standard sample rates. UA's 33609 model requires upsampling for the diode bridge nonlinearity specifically. Budget 2–4× oversampling for these topologies, with the oversampling applied only around the nonlinear elements, not the entire signal chain.

**The Range control is the single most useful addition** over any hardware SSL. It lets users dial in aggressive attack/ratio settings for character while preventing the compressor from diving too deep on momentary peaks. Simper considers it essential for practical use. Default to **−15 dB** for bus compression.

**Stacking topologies is more than the sum of parts.** The Shadow Hills approach — gentle opto followed by precise VCA — works because each stage stays in its sweet spot. Neither is asked to do more than 2–4 dB. The opto handles macro-dynamics (leveling across phrases) while the VCA handles micro-dynamics (transient control). This principle should inform Gluten's multi-model blending at Level 4: rather than morphing between topologies, consider serial routing where one model feeds another.
