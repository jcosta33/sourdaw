# The DSP secrets that separate good from great

**The gap between a technically correct synthesizer and a professional one lies not in architecture but in dozens of subtle implementation choices** — the specific nonlinearity curves inside filter feedback paths, the exact polynomial that distributes supersaw detuning, the 6ms pitch envelope blip that makes an 808 kick thump. This report catalogs those choices across ten critical areas, drawn from developer blogs, academic papers, open-source code, and circuit analyses. Each detail answers the same question: what would a competent programmer miss if they only read textbooks?

The findings reveal a consistent pattern. Professional implementations model the _interactions_ between components — saturation inside the feedback loop, not after it; program-dependent release times, not fixed ones; per-voice component drift, not global detuning. The difference between "technically correct" and "sounds amazing" is almost always about where nonlinearity enters the signal path and how numerical precision is preserved at the boundaries.

---

## Area 1: Analog filter modeling requires topology-specific nonlinearities and iterative solvers

### The tanh distinction that defines filter character

The single most important insight from u-he's Urs Heckmann: the Moog ladder and CEM3320 OTA filters both use `tanh()` saturation, but they apply it at fundamentally different points, producing entirely different sounds.

**Moog transistor ladder** — each stage saturates its inputs independently:

```
I = g * (tanh(V_in / (2 * V_T)) - tanh(V_fb / (2 * V_T)))
```

where **V_T ≈ 0.026V** (thermal voltage = kT/q at room temperature). Because each input is shaped separately, the output is NOT bounded to ±1 even with tanh shaping. The feedback tanh compresses more than the forward path when signal exceeds unity, creating broad, "creamy" intermodulation products across cascaded stages.

**CEM3320 OTA (Prophet-5, OB-Xa)** — the _difference_ is saturated:

```
I = g_m * tanh((V_in - V_fb) / (2 * V_T))
```

This bounds the differential input, producing more "focused" and "acidic" distortion. The OTA's linear range is only **±26mV** differential; beyond that, compression kicks in. The CEM3320 also distributes resonance differently — a separate on-chip VCA controls feedback gain rather than the Moog's direct 4th-stage-to-input path.

**Roland TB-303 diode ladder** — inter-stage coupling creates self-modulation. The diode IV curve is `I = I_s * (exp(V/V_t) - 1)`, but critically, the stages are NOT buffered. Current flow through each diode changes its dynamic resistance (V_t/I_d), causing the cutoff frequency to self-modulate with input amplitude. The first capacitor is **half the value** of the other three, making the first pole an octave higher and giving the famous "broken 24dB" slope that behaves more like 18dB/oct.

### Why zero-delay feedback demands Newton-Raphson

The u-he RePro paper (2016) compared five approaches to solving the implicit feedback equation in ZDF filters, and the results explain why most amateur implementations sound thin. The core problem: analog filters have delayless feedback (`y[n] = f(x[n], y[n])`), and with nonlinearities, this cannot be solved algebraically.

**Pivotal linearization** (cheapest) approximates the nonlinear function with a linear tangent from the previous sample. This causes output gain errors, cutoff frequency drift near waveshaper "corners," and occasional filter explosions. **Unit-delay in feedback** sounds "smooth" but artificial — five feedback paths each delayed one sample kills the dynamic response that makes analog filters exciting.

**Vectorial Newton-Raphson** (u-he's choice) iteratively solves the full nonlinear system, typically converging in **2–4 iterations**. It handles cutoff frequencies approaching Nyquist and never explodes. As Urs Heckmann states: "32× oversampling at 44.1kHz will make the non-ZDF version behave almost as well as a 4× oversampled version with an iterative solver, but the solver uses only 2-3 iterations — which computes a lot faster." **u-he's RePro runs at 8× oversampling** at 44.1/48kHz, 4× at 88.2/96kHz, with filter frequency capped at 25kHz.

### Where saturation lives determines warmth vs harshness

This is arguably the most critical insight in the entire report. From Urs Heckmann's "One Pole Unlimited" blog and Dave Rossum's 1992 paper "Making Digital Filters Sound Analog":

**Saturation INSIDE the feedback path** = warm. It compresses the resonance peak naturally — as input level rises, resonance is "pushed down." Self-oscillation amplitude is inherently limited. This is exactly how analog filters work: the Moog's transistor pairs, the CEM3320's OTA, the TB-303's diodes all saturate _inside_ the filter.

**Saturation OUTSIDE** (only at input or output) = harsh. Resonance grows unchecked until it clips abruptly, producing a brittle, digital quality. The correct implementation:

```rust
// WARM: saturate inside the feedback loop
let feedback = tanh(self.output * resonance);
let input_to_filter = audio_in - feedback;

// HARSH: saturate only at output (wrong)
let input_to_filter = audio_in - self.output * resonance;
let output = tanh(raw_output); // Resonance was unbounded
```

The **Korg MS-20 Sallen-Key** places its nonlinearity specifically in the resonance path via diodes (3 silicon diodes in series ≈ **1.8–2.1V** forward voltage, or a single LED at ~2V). Below forward voltage, diodes barely conduct → maximum Q. Above, they conduct hard → increased damping. This creates the distinctive behavior where input signal amplitude and resonance compete — driving the input harder _suppresses_ resonance, producing the "screaming, breaking-up" character.

### Filter type morphing uses simultaneous SVF outputs

The state-variable filter naturally produces LP, BP, HP simultaneously from the same state variables. Morphing is simply `output = m0*hp + m1*bp + m2*lp` — no clicks, no phase discontinuities. Andrew Simper's (Cytomic) trapezoidal SVF computes all outputs with a single set of coefficients:

```
g = tan(π * fc / fs)
k = 1/Q
a1 = 1 / (1 + g*(g + k))
```

All filter outputs share identical state, so crossfading between types is inherently glitch-free.

### Thermal drift needs incommensurate frequencies

Real analog VCOs drift **±2–5 cents** due to thermal effects, on timescales of seconds to minutes. Professional implementations (Diva, Surge XT) use a sum of **3 slow sine oscillators at incommensurate frequencies** (e.g., 0.05Hz, 0.13Hz, 0.31Hz) per voice and per component. The incommensurate rates ensure the pattern never repeats. Each voice gets independent drift generators with randomized initial phases. The key perceptual insight from KVR developers: "the charm of VCOs is in phase-shift-like effects, NOT VCOs going 12 cents up/down" — micro-detuning creates timbral richness, not pitch instability.

---

## Area 2: Oscillator life comes from anti-aliasing quality, phase randomness, and spectral interpolation

### PolyBLEP works until it doesn't

The standard 2-sample quadratic PolyBLEP produces audible aliasing when the fundamental exceeds roughly **fs/6 to fs/4** (5–11kHz at 44.1kHz). Above 8kHz, aliased harmonics appear at only -30 to -40dB below the fundamental. MinBLEP achieves **-70 to -80dB** suppression with typical tables of 16–48 zero crossings at 32–64× oversampling (~1500–6000 table entries). The standard practical approach: use PolyBLEP with **2× oversampling** for clean results, or use MinBLEP for critical applications.

MinBLEP's key advantage for **hard sync**: its minimum-phase property means correction energy is front-loaded (no lookahead required), which is essential when the sync discontinuity position isn't known in advance. At the sync event, calculate the fractional sample position where the master phase crossed the threshold, compute the discontinuity amplitude, and inject a scaled MinBLEP correction at the appropriate sub-sample offset.

### The JP-8000 supersaw detune curve is not linear

Adam Szabo's thesis (KTH, 2010) reverse-engineered the Roland JP-8000's 7-voice supersaw. The architecture: 1 center voice + 6 detuned (3 above, 3 below), all free-running with **random initial phase on each note-on**. The detune distribution follows an **11th-order polynomial** mapping the linear knob (0–1) to actual detune amount:

```
g(x) = 10028.7x¹¹ - 50818.9x¹⁰ + 111363.5x⁹ - ... + 0.672x + 0.003
```

At maximum detune, the frequency ratios are approximately **0.893, 0.939, 0.980, 1.000, 1.020, 1.064, 1.110** — the inner voices cluster near center while outer voices spread wider, roughly following a Gaussian distribution. The mix curve is equally important: the center oscillator decreases linearly as the Mix control increases, while the six outer oscillators increase on a **parabolic curve**. The JP-8000 deliberately did NOT band-limit its oscillators — the aliasing adds characteristic "airiness." A pitch-tracked highpass filter at the fundamental removes sub-fundamental artifacts.

### Wavetable mipmapping eliminates aliasing at the source

Vital achieves its "extremely low noise floor and sharp cutoff at Nyquist" through per-octave FFT-based harmonic removal. For a **2048-sample** wavetable (the recommended size from Nigel Redmon's earlevel.com), this produces approximately **10–11 mipmap levels**, each removing the upper half of harmonics via zeroing FFT bins above the current octave's Nyquist. Table selection at playback: choose the table whose maximum harmonic just fits below Nyquist at the current oscillator frequency, with crossfading between adjacent mipmap levels. This entirely avoids the "metallic" crossfade artifacts of time-domain wavetable interpolation, which occur because linearly blending waveforms with different harmonic phase relationships creates intermodulation products present in neither source frame.

### FM synthesis must use phase modulation

The DX7 maintains perfect pitch stability because it uses **phase modulation (PM)**, not frequency modulation. In PM, the modulator output is added to a _copy_ of the phase value going into the sine lookup — the phase accumulator itself continues incrementing at exactly the carrier frequency. In true FM, the modulator changes the phase increment directly, meaning any DC offset or numerical asymmetry causes permanent pitch drift. The DX7 uses integer phase accumulators with **only the top 12 bits** indexing into a sine ROM stored in **logarithmic format** (enabling amplitude scaling via addition). The self-feedback path averages the last two samples (Tomisawa "anti-hunting filter") to prevent wild oscillation.

---

## Area 3: The 808 kick is a self-damping filter, not an oscillator with an envelope

### The bridged-T network creates a pitch envelope that isn't exponential

Kurt James Werner's Stanford CCRMA paper (DAFx-14, 2014) is the definitive analysis. The 808 kick uses a **bridged-T network** (Zobel topology) in an op-amp feedback path, forming a bandpass filter that "rings" when excited by a pulse. It has no separate VCA — the oscillation is inherently self-damping.

The pitch behavior involves **two distinct phenomena**:

1. **A 6ms frequency shift on attack**: An envelope generator briefly grounds a transistor collector, changing the effective resistance and raising both the Q and center frequency to approximately **130Hz** (C3 minus 11 cents) for about 6ms — less than one full period at the higher frequency. Werner notes this "isn't long enough to be perceived as a pitch shift" but "greatly affects the attack, making it punchier and crisper."

2. **A 300ms "pitch sigh"**: Leakage current through a resistor creates a voltage-dependent, memoryless nonlinear relationship (modeled with a softplus-like function, α=14.315, V₀=-0.556) that gradually shifts the resting frequency from ~58Hz down to **~49Hz** (G1 plus 14 cents) over 300ms.

The click transient is simply the **1ms trigger pulse passing through to the output** via the op-amp — not a separate circuit. The Tone control is a passive lowpass in the output stage. The Decay knob controls a high-shelf filter in the feedback buffer, governing how much signal recirculates (range: **50–800ms** decay time).

### The 808 hi-hat uses 6 inharmonic square waves through two bandpass filters

Six square-wave oscillators feed a hex Schmitt trigger inverter, mixed at equal levels. Two oscillators are tunable (shared with the cowbell circuit): **~800Hz** and **~540Hz**. The other four are fixed. Crucially, the frequencies are **inharmonic** — no integer ratios, creating metallic rather than pitched character. The mix passes through two bandpass filters centered at **~3440Hz** and **~7100Hz**, strongly accentuating upper overtones while de-emphasizing fundamentals. Closed hi-hat decays in ~50ms; open hi-hat is adjustable from 350–1200ms. Triggering the closed hat chokes the open hat.

### The 808 clap is 3 noise bursts in 30ms, not a single envelope

A 30ms trigger pulse drives a charging/discharging chain producing **3–4 rapid sawtooth-shaped sub-envelopes** at approximately **100Hz rate** (~10ms each), with diminishing amplitudes. The noise source is bandpass-filtered at **1000Hz**. A separate "reverb" path applies a longer **~100ms** smooth decay envelope to the same filtered noise, creating a fake reverb tail. The 808 snare uses two bridged-T oscillators at **238Hz** and **476Hz** (an octave apart, mixed via the Tone pot) plus noise through a **2749Hz highpass Sallen-Key filter**.

### The 909 kick is a hybrid with a separate noise/click path

Unlike the 808's self-exciting filter, the 909 uses a dedicated VCO (sawtooth → waveshaper → approximate sine) controlled by a fast pitch envelope, plus a **separate noise/click path** mixed in for attack definition. The Attack knob controls the click/noise amplitude; the Tune parameter controls pitch envelope decay time, not base pitch. Default tuning sits around **E3 (~165Hz)**, much higher than the 808.

### The SP-1200 sound is five interacting analog stages

The SP-1200's character comes from: (1) **12-bit linear DAC** at only **26.04kHz** sample rate, (2) **no reconstruction filter** causing spectral imaging above Nyquist, (3) **zero-order hold** DAC creating a sinc-shaped frequency rolloff with staircase artifacts, (4) **drop-sample pitch shifting** (truncating fractional indices, no interpolation) introducing heavy aliasing at non-integer tuning ratios, and (5) the **SSM2044 4-pole lowpass filter** (Dave Rossum's design) on channels 0 and 1 only, driven by a Z80-generated 5ms-attack AR envelope. Channels 2–5 have static 5-pole 1dB Chebyshev lowpass filters at different fixed frequencies. Channels 6–7 are unfiltered. All 8 channels sum through an analog mixer.

---

## Area 4: Professional reverb replaces static resonances with modulated density

### Sean Costello's core insight: modulation breaks periodicity

A static feedback network has fixed eigentones that create metallic coloration. Modulating delay times **continuously shifts these resonant frequencies**, spreading energy across wider bandwidth without adding delay memory. Costello traces this to the EMT-250 (1977), whose designers used "an enormous amount of modulation, to the point where it sounded like a chorus unit" — far beyond anything found in real acoustic spaces.

The practical parameters: modulation rate of **0.3–2Hz** (below 0.1Hz: still metallic; above 4Hz: obvious chorus); depth of **4–16 samples** at 44.1kHz (±0.09–0.36ms). Each delay line should use different rates and phases. Depth must scale with decay time — long decays pass through modulators many more times, so "back off on modulation depth" for long reverbs. For interpolation of modulated delay lines, Dattorro recommends **allpass interpolation** over linear, specifically because linear interpolation causes high-frequency attenuation that accumulates through feedback iterations.

### The Lexicon 224's character comes from quantization artifacts

The 224 operated at **20kHz sample rate** with only **16K words of memory** and a **6-bit multiplier** for delay interpolation. The quantized interpolation (approximately 32–64 chunks per sample) produced a characteristic "halo" of broadband noise around reverbed signals. The 12-bit AD/DA converters and hard **~10kHz bandwidth cutoff** contributed warmth. The Concert Hall algorithm used allpass delays with time-varying elements inside the recursive network, increasing perceived modal density and imparting lush chorusing.

The 480L (1986) added 18-bit conversion and the **Random algorithm** with **Spin** (modulation rate) and **Wander** (modulation depth) parameters, producing the smoothest and most natural-sounding algorithm.

### Echo density must reach 2000–4000 per second for diffuse sound

Below this threshold, individual echoes are audible as "grain." Allpass diffusion cascades multiply echo count exponentially: 8 channels × 4 stages = **8⁴ = 4096 echoes** from a single pulse. But more allpasses cause metallic coloration (their frequency response is flat only over time, not instantaneously) and slow "fade-in" attacks. Costello's solution in ValhallaPlate: a novel diffusion technique achieving sharp attack without grain or metallic character, different from cascaded allpass diffusors.

For FDN mixing matrices: **Householder** is optimal at N=4 (all entries same magnitude, O(N) operations). **Hadamard** works better for N≥8 using Fast Walsh-Hadamard (O(N·log₂N), additions only). Too much inter-channel mixing can lock delays together, moving eigentones closer and leaving gaps.

### Frequency-dependent decay uses filters inside the feedback loop

Damping filters go inside each delay line's feedback path, accumulating frequency-dependent attenuation per loop iteration. The standard formula: for delay length M samples at sample rate fs, the gain at frequency f needed for RT60(f) is `g(f) = 10^(-3·M / (fs·RT60(f)))`. Professional reverbs implement this with one-pole lowpass (Freeverb, Dattorro), shelving EQ (Lexicon Split Decay), or full parametric EQ (FabFilter Pro-R's 6-band Decay Rate EQ). Typical real-room behavior: high frequencies decay **2–5× faster** than midrange.

---

## Area 5: Musical compression emerges from program-dependent behavior and feedback topology

### The 1176 "all buttons in" creates a lagging limiter, not infinite ratio

When all four ratio buttons are pressed, the ratio reaches approximately **12:1 to 20:1** — not infinity. The critical behavior: there is a **lag on the initial transient attack** that lets the transient through before clamping, and the ratio **increases after the transient** as the feedback topology's self-regulating loop catches up. The release "drops off severely and suddenly." This creates a trademark "plateau" compression curve that acts as a distortion-inducing brick-wall limiter with a slight delay. Attack range: **20µs to 800µs**. Release: **50ms to 1.1s**. The 1176's feedback topology (sidechain monitors the already-attenuated output) makes it inherently program-dependent — heavy gain reduction reduces the sidechain signal, which reduces gain reduction, creating self-regulation.

### The LA-2A's magic is a dual-time-constant photoresistor with memory

The T4 opto cell combines an electroluminescent panel with a cadmium-sulfide photoresistor. Attack is fixed at **~10ms**. Release has two phases: **~60ms for the first 50%**, then **0.5–5 seconds** for the remainder. The slow phase depends on _how long and how intensely_ the signal was above threshold — the CdS photoresistor has a physical "light memory" where longer/brighter illumination causes slower recovery. Jatin Chowdhury (ChowDSP) models this with a signal-dependent time constant: `τ = G·exp(A·x)`, solved via Newton-Raphson for the resulting transcendental equation. The resistance-vs-illumination curve follows a power law: `R = R_dark × (L/L_ref)^(-γ)` where γ ≈ 0.7–0.9.

### The SSL bus compressor's "glue" comes from dual auto-release time constants

The exact circuit values from Gyraf Audio's clone documentation: Auto release combines **91kΩ + 6.8µF** (τ ≈ 619ms, fast) paralleled with **750kΩ + 0.47µF** (τ ≈ 353ms, slow). Short peaks trigger the fast constant; sustained compression engages the slow one. Attack times are exactly **0.1, 0.3, 1, 3, 10, 30ms**; release times are **0.1, 0.3, 0.6, 1.2s** plus Auto. The VCA (originally DBX 202C, now THAT 2181) produces distortion that is "almost exclusively second harmonic." The audio path is remarkably simple — very few components touch the signal. The character comes "almost completely from the compression character, not from transformers or tubes."

### The soft knee equation is a quadratic in dB domain

The standard from Giannoulis et al. (2012), used by FabFilter, MATLAB, and most professional implementations:

Within the knee region (|2·(X_dB - T)| ≤ W):

```
Y_dB = X_dB + (1/R - 1) · (X_dB - T + W/2)² / (2·W)
```

This provides C1 continuity (smooth first derivative) at knee boundaries. Knee width values: **0dB** = hard knee (dbx 160 style), **6–12dB** = medium soft (LA-2A style, vocals), **12–20dB** = wide soft (mastering, transparent). The ideal sidechain highpass — per TDR's Vladislav Goncharov — is **3dB/octave**, which compensates for the natural ~3dB/oct spectral slope of typical audio, ensuring all frequency regions trigger compression equally.

---

## Area 6: The mix-ready signal path handles denormals, DC, and saturation order

### Oversampling filter design determines CPU vs quality tradeoff

**Halfband IIR filters** (allpass decomposition) are the standard for real-time work — ~1 sample latency vs. hundreds for linear-phase FIR. For 4× oversampling, cascade two halfband stages; for 8×, three stages. Professional stopband attenuation: **100–144dB**. The critical insight: **2× is sufficient for gentle saturation** (tanh), but aggressive waveshaping or hard clipping needs **4–8×**. For synth oscillators, band-limited methods (PolyBLEP, wavetable mipmapping) are vastly superior to oversampling — each 2× only provides 6dB of alias rejection, which is terrible compared to MinBLEP's 70–80dB.

Aliased distortion creates inharmonic frequencies reflected off Nyquist (a 25kHz harmonic reflects to 19.1kHz at 44.1kHz). This "V-shaped" spectral reflection produces metallic fizz that accumulates across stacked plugins.

### DC blocking and denormal handling are non-negotiable

The standard DC blocker (Julius O. Smith): `y[n] = x[n] - x[n-1] + R × y[n-1]` with **R ≈ 0.995** at 44.1kHz (≈32Hz cutoff). For denormals, set the SSE MXCSR register: `_mm_setcsr(csr | 0x8040)` (FTZ bit 15, DAZ bit 6). ARM/Apple Silicon flush denormals by default. As a portable fallback, add **1e-15** (alternating sign each buffer to prevent DC accumulation) to the input of any IIR filter chain. Without denormal protection, IIR filter states decaying toward zero during silence cause **10–100× CPU spikes**.

### Saturation placement creates four distinct characters

- **Pre-filter** (Osc → Saturation → Filter): Warm, controlled — filter tames distortion harmonics. How most analog synths work.
- **Post-filter** (Osc → Filter → Saturation): "Constantly bright" — harmonics above cutoff are regenerated, partially negating the filter.
- **In feedback loop**: Self-limiting resonance with harmonic richness. The Moog sound.
- **Post-VCA**: Level-dependent — loud notes distort, quiet notes stay clean. "Bright when loud, pure on tail."

Cutting lows before saturation prevents intermodulation "mush" — exactly what guitar amp tone stacks do between preamp stages.

### Parallel compression is mathematically upward compression

`output = dry + gain × compressed(dry)`. At high levels, the dry signal dominates (compressed signal is at nearly the same level). At low levels, the compressed signal with makeup gain is much louder than the quiet dry signal. Result: **quiet signals are raised substantially; peaks are barely affected** — the opposite of serial compression, which lowers the ceiling rather than raising the floor.

---

## Area 7: Modulation smoothing and envelope behavior define playability

### Envelope retrigger from current level is the analog default

Classic analog synths (Minimoog, MS-20) retrigger envelopes from their current capacitor charge level, not from zero. This creates varying attack brightness depending on the previous note's state — essential for expressive legato. Modern synths (Vital, Serum) offer both modes. The Minimoog's single-trigger legato (envelopes don't restart until all keys are released) is a defining characteristic of its lead sound.

### Zipper noise requires block-rate interpolation, not just smoothing

Beyond the standard one-pole lowpass (time constant **5–10ms**, `a = exp(-2π / (τ_ms × 0.001 × fs))`), professional plugins use **block-rate parameter updates with linear interpolation** within each block. Update the target once per buffer (64–512 samples), then ramp linearly between old and new values. JUCE's `SmoothedValue` implements both linear and multiplicative ramps with a "dirty flag" optimization — mark clean when target is reached, skip processing until the next change.

For audio-rate filter modulation, the **TPT/SVF topology** is inherently more stable than Direct Form biquads. Direct Form II can produce loud transients on sudden coefficient changes. Always smooth coefficient updates with at minimum a 1ms one-pole filter, and prefer the trapezoidal integrator approach from Zavalishin.

---

## Area 8: Voice management subtleties create the illusion of analog hardware

### Voice stealing needs a one-pole decay, not a hard crossfade

Urs Heckmann's approach: dump the last output sample value into a one-pole filter state and let it decay naturally over **5–10ms** (~220–440 samples at 44.1kHz). Multiple stolen voices can share the same one-pole by adding offset values. This is more transparent than linear fades and more efficient than cosine crossfades. The "benchwarmer" pattern maintains 1–2 reserve voices beyond the polyphony count — new notes start immediately on a reserve voice while the stolen voice fades out using its own envelope.

### Round-robin voice allocation creates per-note variation

Professional analog emulations (Diva, OB-Xd) cycle through voices in order (1, 2, 3, 4, 5, 6, 1, 2...) rather than reusing the last freed voice. Each voice instance has independent random offsets for oscillator tuning (±2–5 cents), filter cutoff, envelope timing, and gain. When the same note is played repeatedly, it cycles through different "hardware" — creating the living quality of real analog polysynths.

### Legato mode preserves oscillator phase and envelope state

In legato mode on a Minimoog: oscillators **do not reset phase** (they just change frequency with portamento), envelopes **continue from current level**, and the LFO continues running. Note priority is lowest-note. This contrasts with retrigger mode where all envelopes restart from zero. Modern synths typically offer both, with the addition of "retrigger filter envelope but not amp envelope" options for hybrid behavior.

---

## Area 9: GPU audio is viable only for massively parallel workloads

GPU→CPU readback latency is only **4–7µs for ≤8KB** (Joel de Guzman, Cycfi Research), making it negligible compared to audio buffer periods. A proof of concept achieved 96-sample buffer latency (1ms) at 96kHz with 50 parallel tracks. The real constraint is the **asynchronous pipeline**: practical minimum is one additional buffer of latency for double-buffered compute-then-read. WebGPU specifically lacks persistent mapped buffers and blocking readback, requiring triple-buffering through the browser event loop.

**32-bit float precision** is adequate for standard wrapping oscillators but problematic for IIR filter state variables (especially narrow-bandwidth filters at low frequencies) and non-wrapping accumulators. The workaround: double-float emulation using pairs of 32-bit values, at 2–3.5× overhead.

GPU excels at: additive synthesis (**1M+ simultaneous sines** demonstrated), modal synthesis (600K+ modes at 48kHz), large FFT convolution, and finite-difference physical modeling. It fails at: sample-by-sample feedback loops, single-voice processing, and anything with sequential dependencies. The power crossover point: GPU becomes worthwhile only when processing **hundreds to thousands of parallel voices simultaneously**. For typical 1–16 voice synth work, CPU is far more battery-efficient.

---

## Area 10: Preset design decisions shape perception as much as DSP

### Init patch: single sawtooth, filter open, no effects

Vital and Serum both default to a single sawtooth oscillator with the filter fully open, standard ADSR amplitude envelope, no effects, empty modulation matrix. Sawtooth is preferred over sine because it's harmonically rich — filter movements are immediately audible. GForce Software recommends leveling presets at approximately **-6dB** when played at full velocity with 4 notes.

### Velocity mapping follows a square law, not a linear or logarithmic curve

Roger Dannenberg's CMU research (ICMC 2006) measured 7 synthesizers across 128 programs each: a **square-root/quadratic relationship** (`amplitude = (m × velocity + b)²`) fits most hardware. Dynamic ranges vary wildly: Roland Sound Canvas = 89dB, Yamaha DX7 = only 11dB. A practical implementation from KVR developer Borogove (praised by beta testers): apply a power of **0.8** to the normalized velocity before exponential mapping — this was found empirically to feel most musical.

### Filter cutoff must use exponential frequency mapping

Since pitch perception is logarithmic, a linear-in-Hz filter knob dedicates most of its travel to inaudible high frequencies. The standard formula: `freq = 20 × pow(1000, knob_position)`, mapping 0→20Hz, 0.5→632Hz, 1.0→20kHz. All envelope times (attack, decay, release) should similarly use logarithmic mapping (1ms to 10s) so short times are resolvable on the knob.

### Layer detuning has specific sweet spots

- **±2–5 cents**: Subtle chorusing, warmth without obvious pitch shift
- **±5–15 cents**: Classic unison richness — the sweet spot for most pads and leads
- **±15–25 cents**: Aggressive, clearly detuned
- **±25–50+ cents**: Supersaw territory (the JP-8000's outer voices reach ±180 cents at maximum)

**Exponential detuning** (constant cents, so beat rate varies by register) sounds more natural than linear Hz detuning. Bass sounds need tighter detuning to avoid muddiness; high registers tolerate more spread. Non-linear spacing (Gaussian-like, with inner voices closer together) sounds richer than linear spacing because it avoids synchronized beating between voice pairs.

---

## Conclusion: the pattern is nonlinear interaction, not linear specification

Across all ten areas, the same principle emerges: professional audio software models the _interactions_ between components, not just the components themselves. The Moog ladder sounds like a Moog because saturation lives inside every stage, not because it's a 4-pole lowpass. The 808 kick thumps because its pitch envelope isn't an exponential but a coupled RC network with voltage-dependent nonlinearity. The LA-2A compresses musically because its time constants physically depend on the signal history.

For a Rust implementation, the three highest-impact improvements over textbook DSP are: (1) implementing Newton-Raphson solving for the ZDF filter feedback loop rather than using unit delays or linearization, (2) placing tanh saturation _inside_ every filter stage with topology-specific application (independent per-input for Moog, differential for OTA), and (3) giving every voice independent drift generators with incommensurate LFO rates. These three changes alone will move a synthesizer from "technically correct" to "sounds alive."

The remaining details — the specific allpass interpolation in reverb tanks, the dual time constants in the SSL's auto release, the 6ms pitch blip in the 808 kick, the square-law velocity mapping — are each individually small but collectively constitute the difference between a plugin that engineers reach for and one they don't.
