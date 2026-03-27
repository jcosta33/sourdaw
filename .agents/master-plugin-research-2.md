# Vital's spectral warp modes: architecture and algorithms

**Vital operates on wavetable frames as arrays of 1,024 complex FFT bins, and its spectral morph system applies real-time transformations to these harmonic amplitudes and phases during oscillator playback.** The core implementation lives in a single header-only file, `src/synthesis/producers/spectral_morph.h`, alongside the oscillator engine in `synth_oscillator.cpp/.h`. This report documents the data structures, the 11 spectral morph modes, and the 7 wave morph modes, reconstructing algorithms from confirmed code fragments, developer statements, FFTW function signatures, and standard DSP technique. Where exact source could not be retrieved through web tools (GitHub renders blob pages via JavaScript), this is noted explicitly.

**Important caveat**: Despite the repository being public GPLv3 at `github.com/mtytel/vital`, the raw file contents of `spectral_morph.h` and `synth_oscillator.cpp` could not be fetched via any web scraping approach. The algorithmic descriptions below are **informed reconstructions** based on confirmed code fragments from `wavetable_edit_section.cpp`, Matt Tytel's own descriptions, the LV2 parameter definitions, FFTW function usage, and DSP first principles. To get the verbatim C++ implementation, clone the repo directly: `git clone https://github.com/mtytel/vital.git`.

---

## How Vital stores a wavetable frame internally

The `WaveFrame` class, defined at `src/synthesis/lookups/wave_frame.h`, is the fundamental unit. From confirmed code references in `wavetable_edit_section.cpp` and the WAV export routine:

```
WaveFrame {
    static kWaveformSize = 2048          // samples per frame (confirmed by WAV export metadata)
    static kNumRealComplex = 1024        // = kWaveformSize / 2 (bin count for display)

    float time_domain[kWaveformSize]
    std::complex<float> frequency_domain[kWaveformSize]  // or [kNumRealComplex + 1]

    fn toFrequencyDomain()    // FFTW r2c: time_domain → frequency_domain
    fn toTimeDomain()         // FFTW c2r: frequency_domain → time_domain
    fn loadTimeDomain(buf)    // memcpy + toFrequencyDomain()
}
```

The following code was directly extracted from `wavetable_edit_section.cpp` and shows how the frequency domain is interpreted:

```cpp
// From wavetable_edit_section.cpp — confirmed source
void WavetableEditSection::updateFrequencyDomain(float* time_domain) {
    static constexpr float kAmplitudeEpsilon = 0.0000001f;
    static constexpr float kPhaseEpsilon = 0.0001f;
    compute_frame_.loadTimeDomain(time_domain);

    for (int i = 0; i < vital::WaveFrame::kWaveformSize / 2; ++i) {
        std::complex<float> val = compute_frame_.frequency_domain[i];
        float amplitude = std::abs(val) / vital::WaveFrame::kWaveformSize;
        float phase = amplitude > kAmplitudeEpsilon ? std::arg(val) : -vital::kPi / 2.0f;
        frequency_amplitudes_->setScaledY(i, amplitude);
        if (phase >= vital::kPi - kPhaseEpsilon)
            phase = -vital::kPi;
        frequency_phases_->setY(i, phase / vital::kPi);
    }
}
```

So bin `i` in `frequency_domain[]` is a `std::complex<float>` where **magnitude = `|bin| / 2048`** and **phase = `arg(bin)`**. The wavetable itself (`src/synthesis/lookups/wavetable.h`) holds multiple `WaveFrame`s — **256 frames maximum** per wavetable when exported to WAV, at **88,200 Hz sample rate**. Presets serialize the time-domain data as Base64-encoded floats in JSON, then call `toFrequencyDomain()` on load.

FFTW functions confirmed in the codebase: `fftwf_plan_dft_r2c_1d`, `fftwf_plan_dft_c2r_1d`, `fftwf_execute_dft_r2c`, `fftwf_execute_dft_c2r`. The library is dynamically loaded via `dlopen` at runtime.

**Runtime vs. load-time transforms**: The spectral morph is applied **at runtime during oscillator playback**, not baked into the wavetable. The `SynthOscillator` reads the wavetable's frequency-domain data and applies the selected `SpectralMorphType` transform before IFFT synthesis. This allows the morph amount to be modulated at control rate (or audio rate). The wavetable editor's modifiers (frequency filter, phase modifier, wave warp modifier) are separate — those are applied at **wavetable-creation time** and baked into the stored frames.

---

## The spectral morph type enum

From the `.jucer` project file, LV2 parameter mappings, and consistent ordering across all documentation, the `SpectralMorphType` enum in `spectral_morph.h` maps to these integer values stored in `osc_N_spectral_morph_type`:

| Value | Likely enum name     | UI label           | Domain                                |
| ----- | -------------------- | ------------------ | ------------------------------------- |
| 0     | `kNoSpectralMorph`   | (Off)              | —                                     |
| 1     | `kVocode`            | Vocode             | Amplitude envelope shift (keytracked) |
| 2     | `kFormScale`         | Formant Scale      | Amplitude envelope shift (absolute)   |
| 3     | `kHarmonicStretch`   | Harmonic Stretch   | Frequency remapping (linear)          |
| 4     | `kInharmonicStretch` | Inharmonic Stretch | Frequency remapping (nonlinear)       |
| 5     | `kSmear`             | Smear              | Spectral blur/convolution             |
| 6     | `kRandomAmplitudes`  | Random Amplitudes  | Amplitude randomization               |
| 7     | `kLowPass`           | Low Pass           | Spectral rolloff (high)               |
| 8     | `kHighPass`          | High Pass          | Spectral rolloff (low)                |
| 9     | `kPhaseDisperse`     | Phase Disperse     | Phase scrambling                      |
| 10    | `kShepardTone`       | Shepard Tone       | Octave-wrapped pitch shift            |
| 11    | `kSpectralTimeSkew`  | Spectral Time Skew | Per-harmonic frame offset             |

The morph **amount** is a separate continuous parameter (`osc_N_spectral_morph_amount`, range 0.0–1.0). An additional **Spect Spread** control in the Advanced tab distributes different morph amounts across unison voices.

---

## Spectral morph mode algorithms

All operations below act on the frequency-domain representation: an array of 1,024 complex bins where bin `k` represents harmonic `k` (with bin 0 = DC, bin 1 = fundamental). The morph amount parameter `t` ranges from 0.0 to 1.0. Each Rust pseudocode block operates on `bins: &mut [Complex<f32>; 1024]`.

### 1. Vocode (keytracked formant shift)

Matt Tytel confirmed: "Vocode and Formant do the same technique of moving a timbre's formants up and down in pitch. The difference is that **Vocode is keytracked** so keeps the timbre's formants in the same place no matter what note you're playing."

The operation shifts the spectral envelope by resampling harmonic amplitudes at offset positions. Vocode compensates for the MIDI note so that formants stay at their absolute frequency regardless of pitch. The shift amount combines the morph knob with an automatic note-tracking offset.

```rust
/// Vocode: shift spectral envelope, keytracked to cancel pitch-dependent formant shift
/// `t` = morph amount [0,1], `note_ratio` = played_freq / reference_freq
fn vocode(bins: &mut [Complex<f32>; N], t: f32, note_ratio: f32) {
    let src = bins.clone();
    // Keytrack offset cancels the natural formant shift from pitch transposition
    // Then morph knob adds additional shift on top
    let shift = (1.0 / note_ratio - 1.0) + t * VOCODE_RANGE; // VOCODE_RANGE ~ 2.0
    for k in 0..N {
        let src_k = (k as f32) * (1.0 + shift);
        // Linearly interpolate amplitudes from source bins
        let lo = src_k.floor() as usize;
        let hi = lo + 1;
        let frac = src_k - lo as f32;
        if hi < N {
            let mag = lerp(src[lo].norm(), src[hi].norm(), frac);
            // Preserve original phase (or interpolate)
            bins[k] = Complex::from_polar(mag, src[k].arg());
        } else {
            bins[k] = Complex::new(0.0, 0.0);
        }
    }
}
```

### 2. Formant Scale (absolute formant shift)

Identical technique to Vocode but **without keytracking**, and with a wider range. The morph amount directly controls how far the spectral envelope is shifted.

```rust
/// Formant Scale: shift spectral envelope without keytracking
fn formant_scale(bins: &mut [Complex<f32>; N], t: f32) {
    let src = bins.clone();
    // t=0.5 → no shift; t<0.5 → shift down; t>0.5 → shift up
    let shift_factor = 2.0f32.powf((t - 0.5) * FORMANT_RANGE); // wider range than vocode
    for k in 1..N {
        let src_k = (k as f32) * shift_factor;
        let lo = src_k.floor() as usize;
        let frac = src_k - lo as f32;
        if lo + 1 < N {
            let mag = lerp(src[lo].norm(), src[lo + 1].norm(), frac);
            bins[k] = Complex::from_polar(mag, src[k].arg());
        } else {
            bins[k] = Complex::new(0.0, 0.0);
        }
    }
}
```

### 3. Harmonic Stretch (linear frequency remapping)

Matt Tytel: "This mode scales harmonics up the frequency domain, **leaving the fundamental where it is**."

Each harmonic's frequency position is scaled by a factor that increases with harmonic number. The fundamental (bin 1) stays at bin 1; higher harmonics spread apart or compress.

```rust
/// Harmonic Stretch: remap harmonic k to position k^stretch_factor
/// t in [0,1] maps to a stretch exponent, e.g. [0.5, 2.0]
fn harmonic_stretch(bins: &mut [Complex<f32>; N], t: f32) {
    let src = bins.clone();
    let stretch = lerp(0.5, 2.0, t);  // or similar mapping
    let mut dest = [Complex::new(0.0, 0.0); N];
    dest[0] = src[0]; // DC unchanged
    for k in 1..N {
        // New position for harmonic k: k * stretch (linear scaling)
        let new_pos = (k as f32) * stretch;
        let lo = new_pos.floor() as usize;
        let frac = new_pos - lo as f32;
        if lo < N {
            // Scatter: add source bin's energy to the new position with interpolation
            dest[lo] += src[k] * (1.0 - frac);
            if lo + 1 < N {
                dest[lo + 1] += src[k] * frac;
            }
        }
    }
    *bins = dest;
}
```

### 4. Inharmonic Stretch (nonlinear frequency remapping)

Matt Tytel: "Moves oscillator harmonics up the spectrum in a **non-linear way**." Community users report audible "stepping" when modulating this parameter, consistent with discrete harmonic repositioning.

This mimics physical inharmonicity (like piano string stiffness) where higher partials deviate more from integer multiples. The standard formula is `f_k = k * f0 * sqrt(1 + B * k²)`.

```rust
/// Inharmonic Stretch: nonlinear remapping inspired by string inharmonicity
/// t controls the inharmonicity coefficient B
fn inharmonic_stretch(bins: &mut [Complex<f32>; N], t: f32) {
    let src = bins.clone();
    let b = t * INHARMONIC_MAX;  // B coefficient, 0 = harmonic, higher = more inharmonic
    let mut dest = [Complex::new(0.0, 0.0); N];
    dest[0] = src[0];
    for k in 1..N {
        // Inharmonicity formula: new_freq = k * sqrt(1 + B * k^2)
        let new_pos = (k as f32) * (1.0 + b * (k as f32).powi(2)).sqrt();
        let lo = new_pos.floor() as usize;
        let frac = new_pos - lo as f32;
        if lo < N {
            dest[lo] += src[k] * (1.0 - frac);
            if lo + 1 < N {
                dest[lo + 1] += src[k] * frac;
            }
        }
    }
    *bins = dest;
}
```

### 5. Smear (spectral blur)

Matt Tytel: "Creates a lot of high frequency content so you can create interesting percussive sounds with just the oscillator."

Smear convolves the amplitude spectrum with a broadening kernel, spreading each harmonic's energy into neighboring bins. This is essentially a spectral Gaussian blur.

```rust
/// Smear: blur amplitude spectrum by convolving with a widening kernel
fn smear(bins: &mut [Complex<f32>; N], t: f32) {
    let src = bins.clone();
    let width = (t * MAX_SMEAR_WIDTH).max(0.001); // kernel half-width in bins
    for k in 0..N {
        let mut sum = Complex::new(0.0, 0.0);
        let mut weight_sum = 0.0f32;
        // Gather from neighbors weighted by Gaussian or triangular kernel
        let half = (width * 4.0) as i32; // reach ~4 sigma
        for j in -half..=half {
            let src_idx = k as i32 + j;
            if src_idx >= 0 && (src_idx as usize) < N {
                let w = (-((j as f32) / width).powi(2) / 2.0).exp(); // Gaussian weight
                sum += src[src_idx as usize] * w;
                weight_sum += w;
            }
        }
        bins[k] = sum / weight_sum;
    }
}
```

### 6. Random Amplitudes

Randomizes the magnitude of each harmonic while preserving phase. The morph amount controls the degree of randomization as a crossfade between original and random amplitudes.

```rust
/// Random Amplitudes: randomize harmonic magnitudes
/// Uses deterministic seeded RNG so result is stable per note/frame
fn random_amplitudes(bins: &mut [Complex<f32>; N], t: f32, seed: u32) {
    let mut rng = Rng::new(seed);
    for k in 1..N {
        let original_mag = bins[k].norm();
        let random_mag = rng.next_f32() * original_mag * 2.0; // or uniform [0, max]
        let new_mag = lerp(original_mag, random_mag, t);
        let phase = bins[k].arg();
        bins[k] = Complex::from_polar(new_mag, phase);
    }
}
```

### 7. Low Pass (spectral low-pass filter)

Progressively attenuates harmonics above a cutoff determined by the morph amount. At `t=1.0`, only the fundamental remains.

```rust
/// Low Pass: attenuate higher harmonics
fn low_pass(bins: &mut [Complex<f32>; N], t: f32) {
    let cutoff_bin = ((1.0 - t) * N as f32).max(1.0);
    for k in 1..N {
        if k as f32 > cutoff_bin {
            let rolloff = ((cutoff_bin / k as f32).powi(2)).min(1.0); // 12dB/oct rolloff
            bins[k] *= rolloff;
        }
    }
}
```

### 8. High Pass (spectral high-pass filter)

From user documentation: "Removes all the lower order harmonics until all harmonics in the hearing range have been removed."

```rust
/// High Pass: attenuate lower harmonics
fn high_pass(bins: &mut [Complex<f32>; N], t: f32) {
    let cutoff_bin = (t * N as f32).max(0.0);
    for k in 1..N {
        if (k as f32) < cutoff_bin {
            let rolloff = ((k as f32 / cutoff_bin).powi(2)).min(1.0);
            bins[k] *= rolloff;
        }
    }
}
```

### 9. Phase Disperse

User manual: "Randomly spreading out the waveform horizontally." Shifts the phase of each harmonic by an amount that increases with harmonic number, controlled by the morph parameter. Magnitudes are unchanged — this is functionally an allpass operation.

```rust
/// Phase Disperse: apply frequency-dependent phase offset
fn phase_disperse(bins: &mut [Complex<f32>; N], t: f32) {
    for k in 1..N {
        let mag = bins[k].norm();
        let original_phase = bins[k].arg();
        // Phase offset increases with harmonic number (quadratic or linear dispersion)
        let dispersion = t * PI * (k as f32 / N as f32).powi(2) * DISPERSE_RANGE;
        bins[k] = Complex::from_polar(mag, original_phase + dispersion);
    }
}
```

### 10. Shepard Tone (infinite pitch illusion)

Matt Tytel: "Creates Shepard Tones (the never ending ascending/descending pitch effect) with any wavetable." The morph knob continuously shifts harmonics upward with octave-wrapping. A bell-shaped spectral envelope ensures smooth fading at boundaries.

Community observation: with simple waveforms (sine), there is an audible click at the wrap point because there aren't enough overlapping partials. Complex waveforms (saw) mask the transition.

```rust
/// Shepard Tone: octave-wrapped pitch shift with bell-curve envelope
fn shepard_tone(bins: &mut [Complex<f32>; N], t: f32) {
    let src = bins.clone();
    let shift_octaves = t; // 0→0 octaves, 1→1 octave of shift
    let mut dest = [Complex::new(0.0, 0.0); N];

    for k in 1..N {
        // Shift this harmonic up by shift_octaves
        let log_pos = (k as f32).log2() + shift_octaves;
        let new_k = 2.0f32.powf(log_pos);

        // Bell-shaped amplitude envelope based on absolute log-frequency position
        // Harmonics near edges of audible range fade out
        let center = (N as f32).log2() / 2.0; // center of bell
        let sigma = (N as f32).log2() / 3.0;
        let env = (-(log_pos - center).powi(2) / (2.0 * sigma * sigma)).exp();

        // Also handle wraparound: if new_k >= N, wrap down by octave
        let mut wrapped_k = new_k;
        while wrapped_k >= N as f32 { wrapped_k /= 2.0; }
        while wrapped_k < 1.0 { wrapped_k *= 2.0; }

        let lo = wrapped_k.floor() as usize;
        let frac = wrapped_k - lo as f32;
        if lo < N {
            let weighted = src[k] * env;
            dest[lo] += weighted * (1.0 - frac);
            if lo + 1 < N {
                dest[lo + 1] += weighted * frac;
            }
        }
    }
    *bins = dest;
}
```

### 11. Spectral Time Skew (per-harmonic wavetable offset)

Matt Tytel: "Scrolls through your wavetable a **different amount for every harmonic**. Hard to describe, but fun to experiment with!"

This mode is unique because it doesn't just transform a single frame's bins — it reads different wavetable frame positions per harmonic. Lower harmonics come from one frame while higher harmonics read from increasingly offset frames.

```rust
/// Spectral Time Skew: each harmonic reads from a different wavetable frame
/// This requires access to the full wavetable, not just one frame
fn spectral_time_skew(
    output_bins: &mut [Complex<f32>; N],
    wavetable: &Wavetable,    // all frames
    base_frame: f32,          // current frame position [0, num_frames)
    t: f32                    // morph amount
) {
    let num_frames = wavetable.num_frames() as f32;
    for k in 0..N {
        // Each harmonic reads from a frame offset proportional to harmonic number
        let frame_offset = t * (k as f32 / N as f32) * num_frames;
        let frame_pos = (base_frame + frame_offset) % num_frames;

        // Interpolate between adjacent frames for this specific bin
        let lo_frame = frame_pos.floor() as usize;
        let hi_frame = (lo_frame + 1) % wavetable.num_frames();
        let frac = frame_pos - lo_frame as f32;

        let bin_lo = wavetable.frame(lo_frame).frequency_domain[k];
        let bin_hi = wavetable.frame(hi_frame).frequency_domain[k];

        // Linear interpolation of complex bins
        output_bins[k] = bin_lo * (1.0 - frac) + bin_hi * frac;
    }
}
```

---

## Wave morph modes (time-domain, for completeness)

The user's query included several modes that are actually **wave morph** (time-domain) operations, stored under `osc_N_distortion_type`. These operate on the time-domain waveform via phase distortion or waveshaping, not on FFT bins.

### Sync (wave morph type 1)

Classic hard-sync: the waveform's phase accumulator is reset at a rate determined by the morph amount, causing the waveform to restart within each cycle. The morph parameter controls the "slave" frequency ratio.

```rust
/// Sync: hard-sync style phase distortion
fn sync(phase: f32, t: f32) -> f32 {
    let sync_ratio = 1.0 + t * MAX_SYNC_RATIO; // e.g. 1x to 8x
    let slave_phase = (phase * sync_ratio) % 1.0;
    wavetable_lookup(slave_phase) // read the wavetable at the warped phase
}
```

### Formant (wave morph type 2)

Time-domain formant preservation. Compresses or stretches the waveform within each cycle to shift formant positions while maintaining the fundamental pitch.

```rust
/// Formant: compress/stretch waveform within each cycle
fn formant_warp(phase: f32, t: f32) -> f32 {
    let ratio = 2.0f32.powf((t - 0.5) * FORMANT_RANGE);
    let warped = (phase * ratio).min(1.0);
    wavetable_lookup(warped)
}
```

### Quantize (wave morph type 3)

Stepped quantization of the waveform — reduces amplitude resolution for bitcrush-like effects.

```rust
fn quantize(sample: f32, t: f32) -> f32 {
    let levels = lerp(256.0, 2.0, t); // more t = fewer levels
    (sample * levels).round() / levels
}
```

### Bend (wave morph type 4)

Asymmetric phase distortion that warps the waveform shape. Matt Tytel described "Distortion phase moves where an oscillator's phase distortion happens. Moving the 'Bend' position can make infinitely rising or falling sounds."

```rust
fn bend(phase: f32, t: f32) -> f32 {
    // Attempt to skew the phase accumulator using a power curve
    let skew = lerp(0.25, 4.0, t);
    let warped = phase.powf(skew);
    wavetable_lookup(warped)
}
```

### Squeeze (wave morph type 5)

Horizontal compression/expansion of the waveform within each cycle.

### Pulse (wave morph type 6)

Pulse-width modulation: adjusts the duty cycle of the waveform, creating square/pulse-like timbres.

### FM/RM from other oscillators (types 7–10)

Frequency modulation or ring modulation using another oscillator or the sample player as the modulator. These cross-modulate in real time.

---

## Relevant source files and their confirmed locations

| File                               | Path                       | Role                                                         |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `spectral_morph.h`                 | `src/synthesis/producers/` | **All spectral morph algorithms** (header-only, compile="0") |
| `synth_oscillator.cpp/.h`          | `src/synthesis/producers/` | Oscillator engine; calls spectral morph at runtime           |
| `wave_frame.h/.cpp`                | `src/synthesis/lookups/`   | WaveFrame class: 2048-sample frames, FFT via FFTW            |
| `wavetable.h/.cpp`                 | `src/synthesis/lookups/`   | Wavetable: collection of WaveFrames with interpolation       |
| `oscillator_module.cpp/.h`         | `src/synthesis/modules/`   | Module wrapper connecting oscillator to voice routing        |
| `frequency_filter_modifier.cpp/.h` | `src/common/wavetable/`    | Wavetable editor: spectral filtering                         |
| `phase_modifier.cpp/.h`            | `src/common/wavetable/`    | Wavetable editor: phase manipulation                         |
| `wave_warp_modifier.cpp/.h`        | `src/common/wavetable/`    | Wavetable editor: time-domain warping                        |
| `wave_source.cpp/.h`               | `src/common/wavetable/`    | Wavetable source: serialization (Base64 time-domain)         |
| `shepard_tone_source.h`            | `src/common/wavetable/`    | Shepard tone wavetable generation                            |
| `wavetable_component_factory.h`    | `src/common/wavetable/`    | Factory for wavetable editor components                      |

---

## What the community has (and hasn't) analyzed

Despite the source being public since February 2021, **no published community analysis dissects the actual spectral morph algorithms at a code level**. The closest effort is David Vogel's ongoing Doxygen documentation project at `davidmvogel.com/docs/Vital/Vital-Code-Docs`, where he is adding comments to the sparsely documented codebase using AI-assisted generation.

A Vital forum user (xvvxv42, April 2022) explicitly asked "what is the algorithm of Vocode and Formant Scale?" Matt Tytel's response confirmed only the keytracking difference: Vocode compensates for the played note's pitch to keep formants stationary, while Formant Scale provides raw shifting without keytracking. No additional algorithmic details were shared.

The Gearspace thread "The Oscillator Is Vital" contains the most technically informed community discussion. One user correctly identified that Vital's wave morph modes are "phase distortion techniques, where a phase accumulator reading a sine wave — by distorting this phasor/ramp you get these new waveforms." But no source-code-level analysis was posted for the spectral morph modes.

The KVR DSP development forum has relevant general discussions about wavetable oscillator implementation (storing spectra, running IFFT every N samples, mipmap tables) that likely inform Vital's approach. Urs Heckmann (u-he developer) described storing spectra and running IFFT every 256 samples with crossfading — a technique Vital likely employs given its FFTW usage and SSE optimizations.

---

## Conclusion: what's novel and what remains uncertain

Vital's spectral morph system represents a **well-executed integration of standard DSP operations into a real-time wavetable oscillator**, made distinctive by the breadth of available transforms and the ability to modulate them at audio rate via SSE-optimized paths. The most novel modes are **Spectral Time Skew** (per-harmonic wavetable frame offset, which is unusual in commercial synthesizers) and the **Vocode/Formant Scale** pair (which elegantly solves the common "chipmunking" problem in wavetable synthesis through keytracked spectral envelope shifting).

The exact implementation details — kernel shapes for Smear, the precise frequency mapping curves for Harmonic/Inharmonic Stretch, the Shepard Tone's bell-curve parameters, and the SSE vectorization strategy — remain locked behind the need to read the actual `spectral_morph.h` source. The reconstructions above are DSP-principled best estimates. For verbatim code: `git clone https://github.com/mtytel/vital.git && cat src/synthesis/producers/spectral_morph.h`.
