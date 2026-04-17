# Drum machine realism — circuit-faithful synthesis engines

## Context

The Toaster drum machine currently implements simplified parametric models for all voices. Reviewing the actual engine code reveals the specific gaps:

- **Kick** (`engines/kick.rs`): sine oscillator + exponential pitch envelope + filtered noise click + tanh drive. No bridged-T resonator, no coupled R_eff sweep, no diode nonlinearity, no feedback buffer, no accent-as-timbre. Pitch envelope is a simple exponential multiplier on a free-running phase accumulator — not a self-decaying resonant circuit.
- **Snare** (`engines/snare.rs`): two sine oscillators at 200/360 Hz (wrong frequencies; 808 components yield ~173/335 Hz) + SVF bandpass noise. No bridged-T filters, no Sallen-Key HPF at 2749 Hz, no tone/snappy circuit behavior.
- **Hi-hat** (`engines/hihat.rs`): six loopback FM oscillators (sine + self-feedback) at generic ratios `[1.0, 1.4, 1.68, 2.0, 2.4, 2.82]` — NOT the 808's six square-wave oscillators at specific measured frequencies (800, 540, 522.7, 369.6, 304.4, 205.3 Hz). No PolyBLEP, no Schmitt trigger model. The current approach produces a different spectral character entirely.
- **Clap** (`engines/clap.rs`): multi-burst noise with correct structure but generic implementation. Burst decay is a fixed `*= 0.995` coefficient rather than circuit-derived RC values. No separate parallel paths (burst + reverb tail).
- **Tom** (`engines/tom.rs`): sine + pitch envelope + noise. No bridged-T, no diode-based pitch sweep in feedback path.
- **Perc** (`engines/perc.rs`): cowbell uses overdriven sines at a generic minor 3rd ratio — not the actual 808 oscillators 1+2 at 800/540 Hz through BPF at 850 Hz. Clave uses a high-Q SVF, not a bridged-T at 2500 Hz.
- **Lo-fi** (`lofi.rs`): basic bitcrusher + sample-and-hold rate reducer + one-pole filter. Missing: anti-aliasing input filter, drop-sample pitch shifting (the critical SP-1200 character element), ZOH DAC, channel-dependent output filters (SSM2044 / Chebyshev).

Research (`.agents/research/factory/active/drum-machine-realism.md`) provides complete circuit-level analysis for five iconic drum machines: TR-808, TR-909, SP-1200, LinnDrum, and CR-78. Werner's 2016 Stanford dissertation gives full ODE systems for the 808's bridged-T networks. The Stanford CCRMA paper (Yeh, Nolting, Smith, 2007) details the exact SP-1200 signal chain. MIT-licensed Rust reference code exists: mi-plaits-dsp-rs (Mutable Instruments Plaits port), ChowKick (Werner-based WDF kick), and DaisySP.

The existing drum machine spec (`.agents/specs/factory/drum-machine.md`) defines the full architecture — pads, sequencer, routing, UI. This spec focuses exclusively on upgrading the synthesis engines to circuit-faithful models, sitting within that larger architecture.

---

## Goal

Replace the simplified drum synth engines in Toaster with circuit-informed models that reproduce the specific timbral characteristics of the TR-808, TR-909, SP-1200, LinnDrum, and CR-78 — using the transfer functions, component values, and nonlinearities documented in the research.

---

## User-visible behavior

- Each drum machine "character" (808, 909, SP-1200, LinnDrum, CR-78) produces sounds perceptually closer to the original hardware than the current simplified models.
- Accent is timbral, not just volume — accented 808 kicks ring longer, chirp more, and have greater harmonic content from diode nonlinearity.
- Component tolerance randomization gives each drum instance organic variation (the "no two units sound alike" property).
- The SP-1200 lo-fi effect reproduces the actual five-stage signal chain (anti-alias filter → 12-bit ADC → drop-sample pitch shift → ZOH DAC → channel-dependent output filters), not just a generic bitcrusher.
- 808 hi-hat choke behavior: triggering closed hat immediately kills open hat envelope.

---

## Scope

### In scope

1. Circuit-faithful 808 voice engines: kick (bridged-T), snare (dual bridged-T + noise), hi-hat/cymbal (6 square oscillators + BPF), clap (multi-burst), toms, cowbell, clave, rimshot, maracas
2. Circuit-faithful 909 voice engines: kick (VCO + waveshaper), snare, clap (4-burst), hi-hat (6-bit EPROM playback model), noise generator (31-bit LFSR)
3. SP-1200 signal chain as a per-pad or per-bus insert effect
4. LinnDrum µ-law companding DAC model and CEM3320 VCF
5. CR-78 bridged-T variants with simpler envelopes
6. Core DSP primitives required by these engines: bridged-T filter, PolyBLEP square oscillators, ADAA for memoryless nonlinearities, bilinear-transformed time-varying biquads (TDF-II)
7. Component tolerance randomization system (per-instance parameter jitter)
8. Accent as timbral modifier (not just amplitude scaling)
9. Denormal protection on all IIR filter states

### Non-goals (explicitly out of scope)

- Pad grid, sequencer, routing, UI, preset management — covered by the main drum machine spec
- Wave digital filter (WDF) implementation — research recommends starting with behavioral models, not full WDF; WDF is a future fidelity upgrade
- GPU compute for visualization
- Sample playback engine, multi-sample, auto-slice
- New effect types (reverb, delay, compressor) — reuse existing
- Time-stretch algorithms
- Oversampling for the nonlinearities — ADAA provides sufficient alias rejection for the saturation curves used here (tanh, diode clip). Oversampling is only needed for aggressive waveshaping (foldback, hard clip), which is not present in these circuits.

---

## Requirements

### TR-808 voices

1. **808 kick — bridged-T resonator model.** The kick engine must implement the bridged-T bandpass network as a time-varying biquad (bilinear transform, TDF-II topology). Coefficients update per-sample from `R_eff`, which is controlled by the envelope. The six-block cascade is: trigger logic → pulse shaper (with 1N4148 diode clip) → bridged-T → feedback buffer (high-shelf, decay-controlled) → envelope → output (tone LPF + DC block).

    **Component values** (from Roland service manual, June 1981): R165=47kΩ, R166=6.8kΩ, R167=1MΩ, C41=15nF, C42=15nF. Center frequency: `fc = 1 / (2π × √(R_eff × R167 × C41 × C42))`.

    **Attack chirp:** The envelope generator produces a ~5 ms pulse grounding R165 through Q43, reducing R_eff from 53.8 kΩ (R165+R166) to 6.8 kΩ (R166 alone). This raises fc from ~49 Hz to ~130 Hz. The resulting downward chirp is sub-period but creates the characteristic punch.

    **Pitch sigh:** After the attack pulse, Q43 leakage current causes R_eff to drift gradually from 6.8 kΩ back toward 53.8 kΩ. Werner fits this as: `i_C = −ln(1 + e^(α × (V_comm − V₀)))^m / α` with fitted constants α=14.3150, V₀=−0.5560, m=1.4765×10⁻⁵. This creates a ~300 ms slow pitch descent from ~58 Hz to ~49 Hz.

    **Bridged-T transfer function** (continuous-time bandpass):
    ```
    H(s) = (β₂s² + β₁s + β₀) / (α₂s² + α₁s + α₀)
    β₂ = R_eff × R167 × C41 × C42
    β₁ = R_eff × C41 + R167 × C41 + R_eff × C42
    β₀ = 1
    α₂ = R_eff × R167 × C41 × C42
    α₁ = R_eff × (C41 + C42)
    α₀ = 1
    ```

    **Pulse shaper diode clip** (1N4148, Is≈10⁻¹² A, VT≈26 mV, n≈1): The memoryless nonlinearity after the linear shelf filter clips the negative swing at ~0.71 V:
    ```rust
    fn pulse_shape(v: f32) -> f32 {
        if v >= 0.0 { v } else { -0.71 * (v.exp() - 1.0) }
    }
    ```

    **Feedback buffer** (decay control): First-order high-shelf filter whose gain increases with the decay knob position k ∈ [0,1], sustaining oscillation longer. Decay range: 50–800 ms (300 ms at center).

    **Feedback loop resolution:** Insert a single unit delay (z⁻¹) after the feedback buffer to break the delay-free loop. At 48 kHz this is ~21 µs — negligible relative to kick drum periods (~20 ms).

2. **808 kick — accent is timbral.** Trigger voltage ranges from 5 V (unaccented) to 15 V (full accent). The velocity parameter maps linearly to this range. Higher voltage increases pulse amplitude into the bridged-T, producing:
    - Longer ring time (more energy in the resonator)
    - More pronounced pitch chirp (higher initial excitation of the frequency-shifted mode)
    - Greater harmonic content from the diode nonlinearity seeing larger signals
    This is NOT just a volume multiplier on the output.

3. **808 snare — dual bridged-T plus filtered noise.** Two bridged-T oscillators at frequencies derived from service manual components:
    - Lower oscillator: R196=680Ω, R197=820kΩ, C58=56nF, C59=27nF → fc ≈ 173 Hz
    - Upper oscillator: R195=2.2kΩ, R198=1MΩ, C60=6.8nF, C61=15nF → fc ≈ 335 Hz
    - **Tone** knob (VR8) crossfades between oscillators
    - **Snappy** knob (VR9) controls the noise VCA envelope amplitude
    - Noise source: reverse-biased 2SC828 NPN transistor generating white noise, filtered through a **Sallen-Key 2-pole HPF at ~2749 Hz**. An attenuated noise envelope is also summed into the oscillator excitation, coupling snappy character into the tonal attack.

4. **808 hi-hat — six PolyBLEP square oscillators at measured frequencies.** The hi-hat uses a Hitachi HD14584 hex Schmitt trigger inverter IC generating six square waves via RC astable multivibrators. Werner (ICMC 2014) measured these from SPICE simulation:

    | Oscillator | Frequency  | Tunable                   |
    | ---------- | ---------- | ------------------------- |
    | 1          | 800 Hz     | Yes (TM1), 359–1150 Hz   |
    | 2          | 540 Hz     | Yes (TM2), 254–627 Hz    |
    | 3          | 522.7 Hz   | Fixed                     |
    | 4          | 369.6 Hz   | Fixed                     |
    | 5          | 304.4 Hz   | Fixed                     |
    | 6          | 205.3 Hz   | Fixed                     |

    Schmitt trigger oscillator frequency: `f = 1 / (2 × R_osc × C_osc × ln((VDD − VT⁻)/(VDD − VT⁺)))`

    All six outputs are summed equally, then split into **two bandpass filters**: BPF1 at ~3440 Hz and BPF2 at ~7100 Hz. Each feeds a separate VCA with independent envelope. Closed hat: fixed 50 ms decay. Open hat: adjustable 90–600 ms.

    **All square oscillators must use second-order PolyBLEP antialiasing.** The current hi-hat engine uses loopback FM sine oscillators — this is a complete replacement, not a modification.

5. **808 hi-hat — choke mechanism.** When closed hat triggers while open hat is sounding, the open hat VCA envelope is immediately killed via a fast fade (≤1 ms, ~48 samples at 48 kHz). This is managed at the voice/pad level, not inside the engine — the engine's `release()` method triggers the fast fade.

6. **808 clap — dual-path multi-burst envelope.** Bandpass-filtered white noise centered at ~1000 Hz through two parallel VCA paths:
    - **Path 1 (bursts):** 3 rapid sawtooth-shaped sub-envelopes at ~100 Hz rate (~10 ms each) with diminishing amplitudes, followed by a 20 ms final discharge. Total burst phase: ~50 ms.
    - **Path 2 (reverb tail):** Simple 100 ms RC decay, starts after bursts complete. This creates a fake reverb effect.
    - Both paths summed at output.

7. **808 remaining voices:**
    - **Toms** (Low/Mid/High): bridged-T oscillator with diodes D80–D85 in the feedback path. The diode's forward resistance increases at lower signal levels, reducing effective resonance and creating a subtle downward pitch sweep as amplitude decays. Low: 80–100 Hz, Mid: 120–160 Hz, High: 165–220 Hz (all tunable). Decay: Low=200ms, Mid=130ms, High=100ms.
    - **Cowbell:** Oscillators 1 (800 Hz) and 2 (540 Hz) from the hi-hat bank, through BPF centered at ~850 Hz (Q≈4.25), with 50 ms decay envelope.
    - **Clave:** Single bridged-T at 2500 Hz, natural ring decay ~20 ms.
    - **Rimshot:** Two bridged-T oscillators at 1667 Hz and 455 Hz, ~10 ms decay, with HPF for snap character.
    - **Maracas:** White noise through VCA with 25–35 ms decay envelope. Broadband, no resonant filter.

### TR-909 voices

8. **909 kick — VCO with diode waveshaper.** Two parallel signal paths mixed at output:
    - **Upper path (tone):** VCO generates triangle/sawtooth, soft-clipped by back-to-back 1N4148 diodes. The waveshaper transfer function: `f(x) ≈ V_clip × tanh(x / V_clip)` where V_clip ≈ 0.6–0.7 V. More precisely: `I = Is × (e^(V/(n×VT)) − 1)` with Is≈2.52nA for 1N4148, n≈1.0, VT≈25.85mV. **EG3** provides instant-attack pitch sweep down to resting frequency ~55 Hz (set by R59=47kΩ). VCO phase resets on every trigger via Q11 for consistent click.
    - **Lower path (attack/click):** Trigger shaped through LPF and BPF into a short transient, mixed with filtered LFSR noise, through separate VCA with ENV-2.
    - Key component: C9=0.22–0.33µF (varies by PCB revision) sets tune range. Default resting pitch: ~55 Hz.

    **909 vs 808 critical difference:** The 808 kick is a self-decaying resonant circuit (bridged-T IS the oscillator, natural decay IS the envelope). The 909 separates oscillation from amplitude shaping: free-running VCO + explicit envelope generators for pitch and amplitude. This gives the 909 more punch and midrange presence; the 808 produces deeper, cleaner sub-bass.

9. **909 noise — 31-bit LFSR.** Shared noise generator for snare, clap, and toms. Two CD4006 18-stage shift registers + one CD4070 quad-XOR gate form a 31-stage maximal-length LFSR with feedback taps at stages 31 and 13:
    ```rust
    fn lfsr_step(&mut self) -> f32 {
        let new_bit = ((self.state >> 30) ^ (self.state >> 12)) & 1;
        self.state = (self.state << 1) | new_bit;
        self.state &= 0x7FFFFFFF; // 31-bit mask
        if (self.state >> 30) & 1 == 1 { 1.0 } else { -1.0 }
    }
    ```
    Sequence length: 2³¹ − 1 = 2,147,483,647. Run at sample rate. The existing xorshift32 PRNG produces white noise but with different statistical properties — the LFSR must be used for 909-specific voices to match the hardware's noise character.

10. **909 snare.** Similar dual-oscillator + noise structure to 808 but with sharper noise character from LFSR noise (requirement 9) instead of white noise. Use the same dual bridged-T architecture as 808 snare but with 909-appropriate component values for higher, sharper frequencies.

11. **909 clap — four-burst envelope.** Bandpass-filtered LFSR noise at ~1140 Hz (Q≈1.95) through two parallel VCA paths:
    - **Primary path:** Four op-amp stages chained together, each burst ~11 ms apart, creating the "ta-ta-ta-TAA" signature pattern. Four sequential attack-decay envelopes, not three like the 808.
    - **Reverb tail path:** Simple AR envelope with longer decay (C61=0.01µF controls timing).

12. **909 hi-hat — pre-baked 6-bit buffer playback model.** Three 32KB HN61256P EPROMs store cymbal samples at 6-bit resolution. Model this as:
    - At engine init, generate a metallic noise buffer from the 6-oscillator bank (same frequencies as 808 hi-hat), sum, and quantize to 6-bit resolution (64 levels). Buffer length: ~1 second at 32 kHz = 32,000 samples. This is pre-baked, not regenerated per trigger — matching the hardware's fixed EPROM content.
    - Playback at ~32 kHz base rate (tunable via "tune" parameter, which adjusts the playback rate like the hardware's counter clock).
    - Post-DAC lowpass filter removes clock artifacts.
    - Exponential decay envelope VCA: closed hat = fixed short decay, open hat = longer adjustable decay.
    - Choke behavior: same as 808 (requirement 5).
    - The tune parameter affects playback speed, not the buffer content. Higher tune = faster playback = higher pitch + shorter duration (hardware-accurate).

### SP-1200 signal chain

13. **SP-1200 signal chain — five-stage insert effect.** Implement as a new struct `Sp1200Effect` (separate from `LofiProcessor`) with the complete signal chain:
    - **Stage 1 — Anti-aliasing input filter:** 8th-order elliptic IIR lowpass at ~13 kHz, targeting 42 dB attenuation at Nyquist (13.02 kHz). Implemented as cascade of 4 biquad sections (TDF-II). The original uses an order-11 opamp-based filter; an 8th-order elliptic achieves equivalent steepness with fewer sections and is standard for `no_std` implementation.
    - **Stage 2 — ADC:** 12-bit linear quantization: `(x * 2047.0).round() / 2047.0` (±1.0 normalized range, 4096 levels, 72 dB theoretical dynamic range).
    - **Stage 3 — Drop-sample pitch shifting:** `buffer[floor(n × ratio) % len]` with NO interpolation. Ratio: `2.0_f64.powf(semitones / 12.0)`. This is the single most important element of the SP-1200 sound. When ratio is irrational (non-equal-temperament intervals), irregular sample skips create unpredictable non-harmonic aliasing patterns — the "stardust" artifacts. A circular buffer of ~1 second at 26.04 kHz is sufficient.
    - **Stage 4 — ZOH DAC:** No reconstruction filter. Each output sample is held for N output samples (N = ceil(output_rate / 26040)). The ZOH frequency response `sinc(f/fs)` creates spectral images at f + k×26040 Hz perceived as brightness.
    - **Stage 5 — Output filter (channel-dependent mode selector):**
        - Mode A (Toms/Ch1-2): SSM2044 4-pole (24dB/oct) ladder VCF, modeled as 4 cascaded one-pole sections with resonance feedback. In the SP-1200, Q is fixed at minimal (no user control), cutoff modulated by Z80 AR envelope (5ms attack, exponential decay) via internal trimpot. Key SSM2044 characteristic: passband gain decreases as Q increases. External caps: 6.8nF on C1-C3, 560pF on C4.
        - Mode B (Snare-Bass/Ch3-4 and Claps-Cowbell/Ch5-6): 5-pole 1dB Chebyshev LPF, fixed cutoff (higher cutoff on Ch5-6 than Ch3-4). Implemented as cascade of 2 biquads + 1 one-pole.
        - Mode C (Hi-hats-Cymbals/Ch7-8): Unfiltered — direct output.
    - Sample rate: exactly 26.04 kHz (measured; NOT 27.5 kHz as originally specified by E-mu).
    - The existing `LofiProcessor` in `lofi.rs` remains for generic lo-fi effects. `Sp1200Effect` is a separate, more accurate model.

### LinnDrum

14. **LinnDrum — µ-law companding DAC model.** The LinnDrum plays back 8-bit samples at 35 kHz through AM6070 µ-law companding DACs. Implement µ-255 law expansion:
    ```rust
    fn mu_law_expand(compressed: u8) -> f32 {
        let mu: f32 = 255.0;
        let sign = if compressed & 0x80 != 0 { -1.0 } else { 1.0 };
        let magnitude = (compressed & 0x7F) as f32 / 127.0;
        sign * (1.0 / mu) * ((1.0 + mu).powf(magnitude) - 1.0)
    }
    ```
    Effective dynamic range: ~72–78 dB (equivalent to 12–13 linear bits). This non-linear quantization sounds dramatically warmer than linear 8-bit.

    **No anti-aliasing filter on playback** — Roger Linn deliberately chose to let high-frequency aliasing through because "the results sounded like the sizzle of drums."

    **CEM3320 VCF** on kick, toms, and congas: 24 dB/oct multimode ladder filter. Model as 4 cascaded one-pole sections with saturation in feedback (the CEM3320 saturates the difference: `gm × tanh((Vin − Vfb) / 2Vt)`). In the LinnDrum context, used as lowpass only.

    Each voice has its own DAC and clock — pitch shifting equals variable sample-rate playback with attendant aliasing.

### CR-78

15. **CR-78 — simplified bridged-T with single-transistor VCA.** The CR-78 shares the bridged-T oscillator topology with the 808 for drum tones, but with key differences:
    - **Simpler envelopes:** Single-transistor "swing-type VCA" throughout (less defined transients, more organic/delicate decay than the 808).
    - **Hi-hat:** Square waves mixed with white noise through a bridged-T bandpass filter.
    - **Metallic beat:** Three filtered square waves through an **RLC resonator** (inductor-based filter). Model as a second-order bandpass biquad with Q≈10–15 to capture the inductor's resonant character. The inductor's nonlinear saturation is negligible at the CR-78's signal levels — a linear RLC biquad is sufficient.
    - The CR-78 sounds more delicate and organic than the 808, owing to simpler VCA envelopes and less defined transients.

### DSP primitives

16. **Bridged-T filter primitive.** Implement a reusable `BridgedTFilter` struct as a time-varying biquad using bilinear transform (`s → (2/T)(z−1)/(z+1)`) in Transposed Direct Form II. Interface:
    ```rust
    struct BridgedTFilter {
        s1: f32, s2: f32,          // TDF-II state
        b0: f32, b1: f32, b2: f32, // numerator coefficients
        a1: f32, a2: f32,          // denominator coefficients (a0 normalized to 1)
    }
    ```
    - `update_coefficients(r_eff, r_shunt, c1, c2, sample_rate)` — computes biquad coefficients from continuous-time β/α values via bilinear transform.
    - `process(input) -> output` — single-sample processing.
    - Coefficients are derived from the transfer function in requirement 1.
    - Must be numerically stable under rapid coefficient changes (R_eff sweeps from 6.8k to 53.8k in ~240 samples at 48 kHz). TDF-II is chosen specifically for this stability property.

17. **PolyBLEP square oscillator.** Implement `PolyBlepSquare` struct with second-order polynomial bandlimited step correction at each transition:
    ```rust
    fn poly_blep(t: f32, dt: f32) -> f32 {
        if t < dt {
            let t = t / dt;
            t + t - t * t - 1.0
        } else if t > 1.0 - dt {
            let t = (t - 1.0) / dt;
            t * t + t + t + 1.0
        } else {
            0.0
        }
    }
    ```
    Apply correction at both rising and falling edges of the square wave. The 808 hi-hat bank instantiates 6 of these at the frequencies in requirement 4.

18. **ADAA for memoryless nonlinearities.** First-order antiderivative antialiasing for all nonlinear saturation stages:
    ```rust
    fn adaa_first_order(f1_xn: f32, f1_xprev: f32, xn: f32, xprev: f32, f_xn: f32) -> f32 {
        let dx = xn - xprev;
        if dx.abs() > 1e-7 {
            (f1_xn - f1_xprev) / dx
        } else {
            f_xn // limiting case: direct evaluation
        }
    }
    ```
    Antiderivatives for specific nonlinearities:
    - **tanh(x):** F₁(x) = ln(cosh(x))
    - **Hard clip at ±1:** F₁(x) = x²/2 if |x|<1, |x|−0.5 if |x|≥1
    - **Pulse shaper diode clip:** compute numerically from the piecewise function in requirement 1.
    ADAA introduces 0.5 sample delay — acceptable for all drum voice applications. This provides sufficient antialiasing for the gentle saturation curves (tanh, diode) used in these circuits without the cost of oversampling.

19. **Exponential RC envelopes.** All envelopes use exponential RC decay:
    ```rust
    fn rc_decay(state: &mut f32, target: f32, coefficient: f32) -> f32 {
        // coefficient = exp(-1.0 / (decay_time_seconds * sample_rate))
        *state = target + (*state - target) * coefficient;
        *state
    }
    ```
    Multi-burst envelopes (808 clap, 909 clap) use state machines chaining RC stages. The existing exponential envelope pattern in the codebase (`env *= coeff`) is the correct approach — reuse it.

20. **Component tolerance randomization.** Each circuit-faithful engine instance accepts an optional `tolerance_seed: u32` parameter. When non-zero, apply jitter to component values using a deterministic PRNG seeded from this value:
    - Capacitors: ±20% (ceramic capacitors had wide tolerances in the 1980s)
    - Resistors: ±5% (carbon film resistors)
    - This shifts center frequencies (via the bridged-T fc formula), decay times, and timbral character per-instance.
    - `tolerance_seed = 0` means nominal (datasheet) values — deterministic, identical output every time.
    - The jitter is applied once at construction time, not per-sample. Component values are stored as fields on the engine struct.

21. **DC blocking on all voice outputs.** Every voice output passes through a DC blocker (Julius O. Smith):
    ```
    y[n] = x[n] − x[n−1] + R × y[n−1],  R ≈ 0.995 at 44.1 kHz (~32 Hz cutoff)
    ```
    The existing engines do NOT have DC blockers — this is a new requirement for all circuit-faithful engines. The bridged-T feedback loop and nonlinearities can accumulate DC offset.

22. **Denormal protection.** All IIR filter states (bridged-T, SVF, biquad cascades, one-pole filters) must flush denormals. On x86: set MXCSR FTZ+DAZ bits (`_mm_setcsr(csr | 0x8040)`). On ARM/Apple Silicon: flush by default. Portable WASM fallback: add ±1e-15 (alternating sign each buffer) to IIR filter inputs when state magnitude falls below 1e-20. Without protection, IIR states decaying toward zero cause 10–100× CPU spikes.

23. **No allocation in process().** All engines must be fully pre-allocated at construction. No heap allocation, no mutex, no blocking in the audio callback. This includes the 909 hi-hat's pre-baked buffer (allocated in `new()`) and the SP-1200's circular buffer.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`).
- All DSP code must be `no_std`-compatible, compilable to both native and WASM.
- Must fit within the existing Toaster engine architecture: `DrumEngineType` enum, `DrumSynthEngine` wrapper, unified `trigger()`/`release()`/`tick()`/`set_param()` interface in `crates/daw-dsp/src/toaster/engines/mod.rs`.
- Must reuse existing DSP primitives where they exist: `fast_tanh` (rational polynomial `x*(27+x²)/(27+9x²)`), `xorshift32` noise, exponential envelope `env *= coeff` pattern, SVF bandpass (TPT zero-delay feedback). Only introduce new primitives (bridged-T, PolyBLEP, ADAA, LFSR) where no existing equivalent exists.
- Real-time safety: no allocation, no blocking, no mutex in `process()`. Pre-allocate all buffers at init.
- 128-sample block processing at 44.1/48 kHz. Control-rate parameter updates once per block are acceptable for knob parameters; bridged-T coefficients must update per-sample during the attack phase (~5 ms = ~240 samples at 48 kHz) when R_eff is actively changing, then can fall back to per-block updates once R_eff stabilizes.
- The SP-1200 effect is an insert processor, not a synthesis engine — it processes audio from any source. It lives alongside `LofiProcessor` in the toaster module, not inside the engines directory.
- `pnpm deps:validate` must pass with zero violations.
- The `std::f32::consts::TAU` import used by existing engines must be replaced with `core::f32::consts::TAU` for `no_std` compatibility in new code.

---

## Design decisions

### Decision: behavioral simulation vs. wave digital filters

**Chosen:** Behavioral simulation using time-varying biquads derived from circuit transfer functions (bilinear transform, TDF-II). This is the approach used by mi-plaits-dsp-rs and recommended by the research as the practical starting point.

**Considered and rejected:** Full wave digital filter (WDF) implementation (as used by ChowKick/WDR-8). WDFs model individual circuit components and produce the highest fidelity, but are significantly more complex to implement and more CPU-intensive. The research recommends WDF as a future fidelity upgrade path, not the starting point. The behavioral approach captures the essential timbral characteristics (pitch chirp, decay shape, accent behavior, nonlinear saturation) at lower implementation and CPU cost.

### Decision: bridged-T as time-varying biquad vs. state-space (DK-method)

**Chosen:** Time-varying biquad with bilinear-transformed coefficients, updated per-sample during active sweeps. Werner recommends TDF-II for numerical stability under rapid coefficient changes.

**Considered and rejected:** Yeh's K-method/DK-method state-space formulation, which handles nonlinearities more elegantly via Newton-Raphson iteration. More accurate for extreme parameter ranges but requires matrix operations per sample, which is expensive and complex to implement in `no_std` Rust. The biquad approach is sufficient for the target fidelity level.

### Decision: 909 hi-hat uses pre-baked buffer (not real-time synthesis)

**Chosen:** Generate the metallic noise buffer once at engine init from the 6-oscillator bank, quantize to 6 bits, and store as a fixed buffer. Tuning adjusts playback rate, not buffer content. This matches the hardware architecture (fixed EPROM content played back at variable rate) and is cheaper at runtime.

**Considered and rejected:** Real-time synthesis of oscillator bank + 6-bit quantization per trigger. This would allow the tune parameter to affect the metallic character (oscillator frequencies would shift), but this is not hardware-accurate — the 909's EPROMs contain fixed recordings of real Paiste/Zildjian cymbals. The tune knob on the hardware adjusts the counter clock (playback rate), not the source material.

### Decision: SP-1200 anti-aliasing filter — 8th-order elliptic

**Chosen:** 8th-order elliptic lowpass at ~13 kHz with 42 dB stopband attenuation, implemented as cascade of 4 biquad sections. Elliptic filters achieve the steepest rolloff for a given order.

**Considered and rejected:** Reproducing the exact order-11 IIR from SPICE AC analysis (as in the CCRMA paper). The SPICE-derived coefficients would need to be re-derived from scratch, and the SP-1200's character comes overwhelmingly from the drop-sample pitch shifting and absence of reconstruction filter — not the exact anti-alias filter shape. An 8th-order elliptic with equivalent stopband attenuation is perceptually indistinguishable and standard to implement.

### Decision: CR-78 inductor filter — linear RLC biquad

**Chosen:** Model the CR-78's inductor-based metallic beat filter as a standard second-order bandpass biquad with Q≈10–15. The inductor's nonlinear saturation at high signal levels is negligible at the CR-78's signal levels (small-signal analog drum machine, not a guitar amp driving into clipping).

**Considered and rejected:** Nonlinear inductor model with saturation curve. Would add complexity (per-sample nonlinear solve) for an effect that is inaudible at the signal levels present in the CR-78 circuit.

### Decision: new engine types coexist with existing ones

**Chosen:** Add new `DrumEngineType` variants (e.g., `Kick808`, `Kick909`, `Snare808`, `HiHat808`, etc.) to the existing enum. The current engines (`Kick`, `Snare`, `HiHat`, etc.) remain as-is — they serve as lightweight "generic analog" models suitable for low-CPU contexts and as the starting point for users who want simpler, more parametric control.

**Considered and rejected:** Replacing the existing engines in-place. The current engines are simpler, cheaper, and provide a different (more generic) sound that has its own utility. Replacement would break existing presets and remove a valid creative option.

### Decision: ADAA over oversampling for nonlinearities

**Chosen:** First-order ADAA for all memoryless nonlinearities (tanh, diode clip). ADAA provides ~20 dB alias rejection at 0.5 sample delay cost, sufficient for the gentle saturation curves used in these circuits.

**Considered and rejected:** 2× or 4× oversampling via halfband IIR filters. Oversampling adds ~1 sample latency per stage and doubles/quadruples the processing cost of the entire signal chain. The research notes that 2× oversampling only provides 6 dB alias rejection (vs ADAA's ~20 dB), and is primarily needed for aggressive waveshaping (foldback, hard clip) which is not present in these circuits.

---

## Acceptance criteria

- [ ] 808 kick produces a sub-bass tone at ~49 Hz with a downward pitch chirp from ~130 Hz on attack, audibly distinct from the existing `KickEngine`'s simple sine + pitch envelope
- [ ] 808 kick accent modifies timbre (ring time, chirp depth, harmonic content), not just amplitude — verified by spectral comparison of accented vs unaccented hits at the same output level
- [ ] 808 snare produces two distinct tonal components (lower ~173 Hz, upper ~335 Hz) controllable via Tone knob, with filtered noise controllable via Snappy knob — frequencies must differ from current engine's 200/360 Hz
- [ ] 808 hi-hat produces metallic (non-pitched) character from 6 inharmonic PolyBLEP square oscillators at the specific measured frequencies, NOT from loopback FM sine oscillators
- [ ] 808 hi-hat square waves produce no spectral content above 20 kHz at −60 dB threshold (PolyBLEP verification)
- [ ] 808 closed hat chokes open hat within 1 ms of trigger
- [ ] 808 clap produces audible multi-burst attack (3 distinct "hits" before tail) through two separate signal paths (bursts + reverb tail)
- [ ] 808 cowbell uses oscillators at 800 Hz and 540 Hz (not generic minor-3rd ratio) through BPF at ~850 Hz
- [ ] 909 kick sounds distinctly different from 808 kick — more midrange punch, less sub-bass, audible click transient from separate attack path
- [ ] 909 kick VCO phase resets on trigger (consistent attack character regardless of phase at time of trigger)
- [ ] 909 LFSR noise is deterministic (same initial state → same sequence) with period 2³¹ − 1
- [ ] 909 hi-hat plays back from a pre-baked 6-bit quantized buffer; tune parameter changes playback rate, not oscillator frequencies
- [ ] SP-1200 effect applied to a clean sine sweep produces audible non-harmonic aliasing artifacts from drop-sample pitch shifting at non-integer ratios
- [ ] SP-1200 effect sounds distinctly different from the existing `LofiProcessor` — the pitch-dependent aliasing patterns and ZOH spectral imaging are present
- [ ] SP-1200 effect at ratio=1.0 (no pitch shift) passes signal through with only 12-bit quantization artifacts and anti-alias filtering — no aliasing
- [ ] LinnDrum µ-law expansion produces warmer low-level detail than linear 8-bit quantization — verified by comparing quiet-signal SNR
- [ ] Component tolerance randomization with different seeds produces audibly different instances of the same voice type — at minimum, bridged-T center frequency and decay time vary measurably
- [ ] Component tolerance with `seed=0` produces identical output to nominal component values (deterministic)
- [ ] All engines pass through DC blocker; sustained retriggering at 4 Hz for 10 seconds does not accumulate DC offset above ±0.01
- [ ] No heap allocation occurs during `tick()` / `process()` calls — verified by code review
- [ ] All new code compiles to `wasm32-unknown-unknown` target without errors
- [ ] Existing `DrumSynthEngine` interface (`trigger`/`release`/`tick`/`set_param`/`is_active`) is preserved — new engines are additive variants in the enum, existing variants unchanged
- [ ] New engine types appear in `DrumEngineType` enum and are constructable via `DrumSynthEngine::new()`
- [ ] `pnpm deps:validate` passes with zero violations

---

## Implementation notes

### Reference code

- **Start with mi-plaits-dsp-rs** (`github.com/sourcebox/mi-plaits-dsp-rs`, MIT, Rust). The Mutable Instruments Plaits drum engines implement behavioral models of 808 kick (bridged-T excitation), snare (dual resonators + noise), and hi-hat (6 square oscillators). These are proven in thousands of Eurorack modules. Émilie Gillet's code comment: "No fancy acronyms or patented technology here... Just behavioral simulation of circuits from classic drum machines!" Use as architectural reference for the engine structs and processing flow.

- **ChowKick** (`github.com/Chowdhury-DSP/ChowKick`, BSD 3-clause, C++) — kick drum plugin directly based on Werner's 808 analysis, using chowdsp_wdf. Reference for the bridged-T coefficient computation and pulse shaper behavior, even though we use biquads instead of WDFs.

- **DaisySP** (`github.com/electro-smith/DaisySP`, MIT, C++) — clean embedded API port of Plaits drum engines. Useful for understanding the simplified behavioral models: `AnalogBassDrum.cpp`, `AnalogSnareDrum.cpp`, `HiHat.cpp`.

### Bridged-T coefficient computation

The continuous-time transfer function (requirement 1) maps to a digital biquad via bilinear transform with `c = 2 × sample_rate`:
```
s → c × (z−1)/(z+1)
```
Substituting into H(s) and collecting terms in z⁻¹ and z⁻² yields the biquad coefficients b0, b1, b2, a0, a1, a2. Normalize by a0. During the attack phase, R_eff changes rapidly — recompute per-sample during this phase (~240 samples), then switch to per-block updates once R_eff stabilizes (change < 0.1% per sample).

### File organization

New engine files in `crates/daw-dsp/src/toaster/engines/`:
- `kick_808.rs` — bridged-T kick
- `kick_909.rs` — VCO + waveshaper kick
- `snare_808.rs` — dual bridged-T + Sallen-Key noise
- `hihat_808.rs` — 6 PolyBLEP square oscillators
- `clap_808.rs` — dual-path multi-burst
- `clap_909.rs` — four-burst LFSR noise
- `hihat_909.rs` — pre-baked 6-bit buffer playback
- `tom_808.rs` — bridged-T with diode pitch sweep
- `perc_808.rs` — cowbell, clave, rimshot, maracas (808 variants)
- `cr78.rs` — CR-78 voices
- `lfsr.rs` — 31-bit LFSR noise generator (shared by 909 engines)

New shared primitives in `crates/daw-dsp/src/toaster/`:
- `bridged_t.rs` — `BridgedTFilter` struct
- `poly_blep.rs` — `PolyBlepSquare` struct
- `adaa.rs` — `adaa_first_order()` and antiderivative functions
- `dc_block.rs` — `DcBlocker` struct
- `tolerance.rs` — component jitter from seed

New effect in `crates/daw-dsp/src/toaster/`:
- `sp1200.rs` — `Sp1200Effect` struct (five-stage signal chain)
- `mu_law.rs` — µ-law expand/compress for LinnDrum

### Enum extension pattern

Add new variants to `DrumEngineType`:
```rust
pub enum DrumEngineType {
    // Existing generic engines (unchanged)
    Kick, Snare, HiHat, Clap, Perc, Tom, Cymbal, Modal, FmPerc,
    Cowbell, Clave, Shaker, Rim,
    // New circuit-faithful engines
    Kick808, Kick909, Snare808, HiHat808, HiHat909,
    Clap808, Clap909, Tom808, Cowbell808, Clave808,
    Rimshot808, Maracas808, Cr78Drum, Cr78Metallic,
}
```
Each new variant gets a corresponding `DrumSynthEngine` enum variant and match arm in all five methods (`trigger`, `release`, `tick`, `is_active`, `set_param`).

### Existing `LofiProcessor` — do not modify

The existing `LofiProcessor` in `lofi.rs` serves a different purpose (generic lo-fi effect). The SP-1200 effect is a separate struct with a fundamentally different architecture (five-stage chain with drop-sample pitch shifting). Do not merge them.

### `std` vs `core` imports

The existing engines import `std::f32::consts::TAU`. New engines should use `core::f32::consts::TAU` for `no_std` compatibility. This is not a requirement to change existing engines — only new code.

---

## Test plan

- [ ] Unit test: `BridgedTFilter` with fixed R_eff=53.8kΩ, R167=1MΩ, C41=C42=15nF produces bandpass response centered within ±5% of calculated fc≈49.4 Hz
- [ ] Unit test: `BridgedTFilter` with swept R_eff (6.8k→53.8k over 5ms at 48kHz) does not produce NaN, Inf, or denormals
- [ ] Unit test: `PolyBlepSquare` at 800 Hz / 48 kHz has no spectral content above 20 kHz (FFT analysis, −60 dB threshold)
- [ ] Unit test: naive square at 800 Hz / 48 kHz DOES have aliased content above 20 kHz (control test proving PolyBLEP is necessary)
- [ ] Unit test: `adaa_first_order` with tanh matches direct tanh output within 0.01 dB for slowly-varying input (1 Hz sine at 48 kHz)
- [ ] Unit test: LFSR with initial state 0x00000001 produces correct period (2³¹ − 1 steps before returning to initial state)
- [ ] Unit test: LFSR is deterministic — two instances with same initial state produce identical sequences
- [ ] Unit test: µ-law expand of 0x00 and 0xFF produces values close to 0.0 and ±full-scale respectively
- [ ] Unit test: µ-law expand produces monotonically increasing output for monotonically increasing magnitude input
- [ ] Unit test: SP-1200 drop-sample at ratio=1.0 passes signal unchanged (within 12-bit quantization noise floor)
- [ ] Unit test: SP-1200 drop-sample at ratio=√2 produces spectral content at frequencies not present in input (aliasing verification)
- [ ] Unit test: SP-1200 8th-order elliptic filter attenuates 13.02 kHz by ≥42 dB relative to 1 kHz passband
- [ ] Unit test: component tolerance with `seed=0` returns nominal component values exactly (no jitter)
- [ ] Unit test: component tolerance with `seed=42` and `seed=43` produces different capacitor/resistor values
- [ ] Unit test: component tolerance jitter stays within ±20% for capacitors and ±5% for resistors
- [ ] Unit test: `DcBlocker` removes 5 Hz DC component by ≥40 dB while passing 100 Hz within ±0.5 dB
- [ ] Unit test: `DcBlocker` at 1 kHz introduces ≤0.01 dB attenuation
- [ ] Integration test: `Kick808` engine renders 1 second of audio at 48 kHz without NaN/Inf in output buffer
- [ ] Integration test: `HiHat808` open hat followed by closed hat trigger reduces open hat output to <−60 dB within 1 ms
- [ ] Compilation test: all new code compiles to `wasm32-unknown-unknown` target without errors
- [ ] Manual: A/B comparison of `Kick` (existing) vs `Kick808` (new) — new version has audible pitch chirp on attack that old version lacks
- [ ] Manual: A/B comparison of `HiHat` (existing loopback FM) vs `HiHat808` (square oscillators) — different metallic character

---

## Credits and attribution

### License obligations (required if code is adapted)

Any engine that adapts code, algorithms, or structural patterns from these sources **must** include the appropriate copyright notice in the source file header. Use the format below.

**mi-plaits-dsp-rs** (MIT) — primary reference for 808 kick, snare, hi-hat behavioral models:
```
// Adapted from mi-plaits-dsp-rs by Oliver Rockstedt (sourcebox)
// Original: Mutable Instruments Plaits by Émilie Gillet
// License: MIT — Copyright (c) 2021 Oliver Rockstedt
// https://github.com/sourcebox/mi-plaits-dsp-rs
```

**Mutable Instruments Plaits** (MIT) — if referencing the original C++ rather than the Rust port:
```
// Based on Mutable Instruments Plaits by Émilie Gillet
// License: MIT — Copyright (c) 2016 Émilie Gillet
// https://github.com/pichenettes/eurorack
```

**DaisySP** (MIT) — if referencing the Electrosmith embedded port:
```
// Adapted from DaisySP by Electrosmith
// License: MIT — Copyright (c) 2020 Electrosmith
// https://github.com/electro-smith/DaisySP
```

**ChowKick / chowdsp_wdf** (BSD 3-clause) — if adapting bridged-T or WDF coefficient computation:
```
// Adapted from ChowKick by Jatin Chowdhury
// License: BSD 3-Clause — Copyright (c) 2021 Jatin Chowdhury
// https://github.com/Chowdhury-DSP/ChowKick
```

**Rule of thumb:** if you read a source file from one of these projects and your implementation follows its structure, variable naming, or algorithm flow — add the notice. If you implement from the math in this spec or the research document without looking at their code, no notice is needed (math cannot be copyrighted).

### Academic citations (courtesy, not legally required)

Include these as comments in the relevant source files (e.g., at the top of `kick_808.rs`). They help future maintainers trace the DSP back to its source:

- **808 circuit analysis:** Werner, K.J., Abel, J.S., Smith, J.O. (2014). "The TR-808 Bass Drum Circuit." DAFx-14. And: Werner, K.J. (2016). "Virtual Analog Modeling of Audio Circuitry Using Wave Digital Filters." Stanford PhD dissertation.
- **808 hi-hat/cymbal oscillator bank:** Werner, K.J., Abel, J.S., Smith, J.O. (2014). "The TR-808 Cymbal." ICMC 2014.
- **SP-1200 signal chain:** Yeh, D.T., Nolting, N., Smith, J.O. (2007). "Digital Implementation of the SP-1200 Drum Machine." Stanford CCRMA.
- **ADAA antialiasing:** Bilbao, S., Esqueda, F., Parker, J., Välimäki, V. (2017). "Antiderivative Antialiasing for Memoryless Nonlinearities." IEEE Signal Processing Letters.
- **PolyBLEP:** Välimäki, V. (2010). "Oscillator and Filter Algorithms for Virtual Analog Synthesis." IEEE TASLP. And: Esqueda, F. (2019). "Aliasing Reduction in Nonlinear Audio Signal Processing." Aalto dissertation.
- **DK-method (reference, not used):** Yeh, D.T. (2009). "Digital Implementation of Musical Distortion Circuits by Analysis and Simulation." Stanford PhD dissertation.

---

## Tradeoffs and risks

- **CPU cost vs. fidelity.** Circuit-faithful models are 3–5× more expensive than the current simplified engines. The bridged-T model adds per-sample coefficient recomputation during the attack phase. Risk: hitting WASM AudioWorklet budget with many simultaneous voices. Mitigation: existing simplified engines remain as the "Generic" tier for low-CPU contexts; circuit-faithful engines are the "Circuit" tier. Per-sample coefficient updates automatically fall back to per-block during the sustain phase (when R_eff is stable), reducing steady-state cost to near-parity with current engines.
- **Implementation complexity.** The 808 kick has six cascaded stages with a feedback loop. Risk: subtle numerical issues under edge cases. Mitigation: TDF-II is specifically recommended by Werner for stability under rapid coefficient changes; denormal protection (requirement 22) prevents the most common IIR pathology; DC blockers (requirement 21) prevent offset accumulation.
- **Perceptual diminishing returns.** Some circuit details (exact transistor leakage Is values, precise diode forward voltage) may be inaudible in a mix. Mitigation: implement in layers of priority. The bridged-T bandpass + R_eff sweep is the biggest perceptual upgrade (requirement 1). Accent-as-timbre (requirement 2) is second. The Q43 leakage "pitch sigh" (α=14.315 model) is third. Pulse shaper diode clip is fourth. Each layer can be validated independently.
- **909 hi-hat buffer size.** A 1-second pre-baked buffer at 32 kHz = 32,000 × 4 bytes = 128 KB per engine instance. For 2 hi-hat pads (open + closed) this is 256 KB. Acceptable for both native and WASM contexts.
- **SP-1200 circular buffer.** The drop-sample pitch shifter needs a circular buffer of ~1 second at 26.04 kHz = 26,040 × 4 bytes ≈ 104 KB per SP-1200 effect instance. Acceptable.
- **Enum size growth.** Adding ~14 new `DrumEngineType` variants approximately doubles the enum. The match arms in `DrumSynthEngine` methods grow proportionally. This is mechanical boilerplate but unavoidable with the current polymorphic enum architecture. A trait-object approach would reduce boilerplate but add vtable indirection in the audio path — not worth the tradeoff for RT safety.
