# Advanced Instruments Research

> **Codebase Annotation:** Sourdaw currently relies heavily on SVF filters and basic linear envelopes (`crates/daw-dsp/src`). The advanced analog modeling techniques described below (ZDF Moog/MS-20 ladder filters, capacitor charge curve envelopes, MinBLEP hard sync) and the AI Groove/Pattern Generation are currently **Missing / Pending Implementation**.

## Analog DSP & Drum Synthesis Secrets

### Missing/Changed Features:

- **Analog filter modeling & ZDF:** Analog filters require delayless feedback (`y[n] = f(x[n], y[n])`). Professional implementations use Vectorial Newton-Raphson iteratively solving the nonlinear system. [ANNOTATION: No Zero-Delay Feedback (ZDF) filters or Newton-Raphson solvers found in the codebase. **SUPERIOR METHOD:** Original Research - Zero-Delay Feedback with Newton-Raphson solvers prevents high-frequency cramping and provides accurate analog resonance, whereas naive digital filters fail under heavy modulation.]
- **Saturation placement:** Saturation INSIDE the feedback path compresses the resonance peak naturally (warm). Saturation OUTSIDE is harsh. [ANNOTATION: Current filter models don't appear to explicitly place `tanh` inside the feedback loop. **SUPERIOR METHOD:** Original Research - Placing saturation inside the feedback path naturally compresses the resonance peak for a warm analog sound, whereas external saturation just hard-clips the output and sounds harsh.]
- **Thermal Drift:** Real analog VCOs drift ±2–5 cents. Requires independent drift generators using incommensurate frequencies (e.g., 0.05Hz, 0.13Hz, 0.31Hz). [ANNOTATION: Missing in codebase.]
- **Wavetable Mipmapping:** FFT-based harmonic removal per octave to avoid metallic crossfade artifacts. [ANNOTATION: `WavetableOsc` exists, but mipmapping is not explicitly confirmed. Missing/Unverified.]
- **Vintage Drum Circuit Models:**
    - **808 Kick:** Bridged-T network (Zobel topology) with a 6ms frequency shift on attack and 300ms "pitch sigh".
    - **808 Hi-hat:** 6 inharmonic square waves through two bandpass filters.
    - **808 Clap:** 3 noise bursts in 30ms.
    - **909 Kick:** Dedicated VCO plus a separate noise/click path.
    - [ANNOTATION: Specific vintage drum circuit models are missing; the engine currently uses basic synth kicks and noise bursts.]
- **SP-1200 Character:** 12-bit linear DAC, zero-order hold, drop-sample pitch shifting, and SSM2044 4-pole lowpass filter.
- **Loopback FM / PM Drums:** Phase Modulation where the carrier feeds back as its own modulator (`y[n] = sin(φ[n] + I * y[n-1])`).
- **Waveguide Drum Components:** Karplus-Strong string/bar layer for percussive plucks.

## Slicing, Resampling, and Time-Stretch

### Missing/Changed Features:

- **Transient Detection (ODFs) for Auto-slicing:**
    - Energy envelope derivative
    - Spectral flux
    - Phase/complex-domain methods
    - Multi-band fusion
- **Time-Scale / Pitch Processing:**
    - **WSOLA:** Time-domain, transient-friendly (for rhythmic loops).
    - **Phase Vocoder:** Frequency-domain, phase-locking (for pads/sustains).
    - **Signalsmith Stretch:** Recommended MIT-licensed library path for polyphonic pitch/time stretching. [ANNOTATION: External crates like `wsola` or `signalsmith-stretch` are not included.]

## Sequencer & Pattern Logic

### Missing/Changed Features:

- **Pattern Representation:** Step conditions, probability, ratchets (sub-interval triggers), and microtiming.
- **Polyrhythms / Polymeters:** Separate track lengths wrapping independently of the global cursor.
- **Groove Quantize & Humanization:** Groove templates mapping ideal grid times to shifted times/velocities with filtered random jitter.

## Orchestral Engine & Sampling

### Missing/Changed Features:

- **Disk Streaming (Native Only):** DFD-style streaming loading only the initial 64-240KB of a sample into RAM and streaming the rest from disk via a background thread. [ANNOTATION: The `creek` crate or equivalent async file reading is missing. Currently, samples must be fully loaded in memory. **SUPERIOR METHOD:** Original Research - Direct-from-disk (DFD) streaming is critical for large orchestral sample libraries to prevent RAM exhaustion and long load times, whereas fully loading samples limits scalability.]
- **Microphone Positions & Phase Alignment:** [ANNOTATION: The `zone_lut` handles mic IDs, but time-delay compensation and phase alignment are missing.] Use GCC-PHAT offline to estimate sample delay for mic alignment. Room mics should remain physically delayed to preserve depth.
- **Score Import & Tempo Mapping:** Parse SMF files (via `midly`) to build piecewise tempo maps and extract articulation metadata. [ANNOTATION: The `midly` crate is not present in the dependency graph.]

## Orchestral Physical Modeling & Resynthesis

### Missing/Changed Features:

- **Bowed Strings (Commuted/Waveguide):** Bidirectional delay line (string) + nonlinear friction curve (bow). Provides continuous energy changes under MPE.
- **Woodwinds/Brass (Reed/Lip Excitation):** Bore delay line + Reed/Lip nonlinearity + breath turbulence noise source.
- **Spectral Modeling Synthesis (SMS):** Deterministic sinusoids + stochastic noise + explicit transient handling for phrase morphing and vibrato spectral envelope modulation (SEM).
- **String Resonance:** Bank of bandpass filters tuned to the instrument's open strings to simulate sympathetic vibration.
- **Release Synthesizer:** Synthesize releases using a filtered noise burst for string lift / breath stop when release trigger samples aren't available.

## GPU Acceleration & Visualization

### Missing/Changed Features:

- **WGSL Compute Workloads:**
    - Radix-2 Stockham FFT for spectrograms and frequency-domain convolution tail partitions.
    - Waveform peak computation (min/max per pixel column).
    - Pattern heatmap rendering.
- **Audio Thread Invariants:** The audio thread must write visualization taps into a lock-free ring buffer. It must NEVER wait on the GPU.

## AI Pipeline & Preset Generation

### Missing/Changed Features:

- **ONNX Runtime Engine:** Native inference via `ort` crate; Web inference via ONNX Runtime Web.
- **CNN Classifier:** Score groove quality or genre fit using mel-spectrograms.
- **Text-to-Pattern (LLM):** Prompt outputs JSON pattern and kit deltas.
- **Template-based Generation:** Style templates and swing seeds.
