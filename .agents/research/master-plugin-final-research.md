# Master Synthesizer Plugin - Outstanding Research & Implementation Gaps

This document consolidates the remaining unimplemented or partially implemented concepts from the original master plugin research (`master-plugin-research.md`, `master-plugin-research-2.md`, `master-plugin-ux.md`). Features that have already been fully integrated into the WebDAW codebase (such as PolyBLEP oscillators, Moog/Diode/MS-20/SEM/Formant filters, basic FM/Additive/Granular/Sampler/Physical engines, Dattorro Plate/FDN reverbs, Compressor, MacroStrip, and LayerStack) have been removed.

## 1. Advanced Spectral Morph Modes (Missing)

_Annotation: The current DSP backend (`crates/daw-dsp/src/fermenter/spectral.rs`) only implements a subset of warp modes (`Sync`, `Quantize`, `Squeeze`, `Bend`, `Formant`, `Fold`). The following advanced spectral and wave morph modes from Vital's architecture are missing:_

- **Vocode (keytracked formant shift):** Shifts the spectral envelope by resampling harmonic amplitudes at offset positions. Compensates for MIDI note so formants stay at absolute frequencies.
- **Harmonic Stretch (linear frequency remapping):** Scales harmonics up the frequency domain while leaving the fundamental where it is.
- **Inharmonic Stretch (nonlinear frequency remapping):** Moves oscillator harmonics up the spectrum in a non-linear way (e.g., `f_k = k * f0 * sqrt(1 + B * k²)`), mimicking string inharmonicity.
- **Smear (spectral blur):** Convolves the amplitude spectrum with a broadening kernel (spectral Gaussian blur) to spread each harmonic's energy.
- **Random Amplitudes:** Randomizes the magnitude of each harmonic while preserving phase (using deterministic seeded RNG).
- **Low Pass / High Pass (Spectral):** Progressively attenuates harmonics above/below a cutoff determined by the morph amount in the frequency domain.
- **Phase Disperse:** Shifts the phase of each harmonic by an amount that increases with harmonic number (allpass operation).
- **Shepard Tone:** Octave-wrapped pitch shift with a bell-curve envelope for an infinite ascending/descending pitch illusion.
- **Spectral Time Skew:** Each harmonic reads from a different wavetable frame, creating a per-harmonic wavetable offset. Requires access to the full wavetable, not just one frame.

## 2. MinBLEP Oscillator Engine (Missing)

_Annotation: The codebase implements `PolyBlepOsc` for virtual analog oscillators (`crates/daw-dsp/src/fermenter/oscillator.rs`). The alternative `MinBLEP` technique is missing._

- **MinBLEP (precomputed step response):** Uses a precomputed minimum-phase bandlimited step added at discontinuities. Preferable for hard sync with frequent resets, arbitrary discontinuous waveforms, and PWM with fast modulation.

## 3. GPU Compute Workloads and Visualization (Missing)

_Annotation: A search through `crates/daw-dsp` and `crates/daw-engine` reveals no WebGPU (`wgpu`) or compute shader implementation._

- **Dataflow rule:** Audio thread writes analysis taps into an SPSC ring buffer; Render thread submits GPU workloads.
- **GPU FFT for spectrum analysis:** Upload windowed time-domain data to a storage buffer and compute radix-2 FFT in multiple passes on the GPU.
- **GPU additive synthesis:** Parallelize across samples per workgroup to sum partials, offloading heavy CPU computation for high polyphony.
- **GPU convolution tail partitions:** Compute head partition on CPU for low latency and tail partitions as FFT blocks on GPU.
- **Visualization shaders:** Oscilloscope (polyline with AA), Spectrum (instanced quads per bin), Wavetable 3D mesh, Mod rings (instanced quads + fragment arc drawing).

## 4. Advanced Modulation System Features (Partial/Missing)

_Annotation: While basic modulation routing (e.g., `ModDest::ReverbMix`) exists, advanced structural dependencies and the dedicated `ModulationDock` are missing in the `Fermenter` module (only found in `Bacteria`)._

- **Modulation dependency ordering (meta-modulation):** Mod sources can modulate other mod depths. Requires building a directed graph and topologically sorting at patch compile time. Cycles must be broken (e.g., by 1-block delay) or disallowed.
- **Audio-rate modulation:** Control-rate modulators compute one value per block; audio-rate modulators compute `next()` per sample (needed for FM-like pitch modulation, filter pinging, oscillator audio-rate sweeps).
- **Modulation Dock & Summary Popover:** A unified UI bottom dock for envelopes, LFOs, MSEGs, etc. Target controls should show multiple arc segments for multiple sources with hover states.

## 5. UI/UX: Unified Block Interface & Context Inspector (Partial)

_Annotation: The frontend `src/modules/Fermenter/presentations/` implements `MacroStrip` and `LayerStack`, serving as the foundation for the unified view._

- **Unified UI Blocks:**
    - _Play & Macros:_ Preset browser and macro strip. (Implemented via `MacroStrip`).
    - _Generators & Layers:_ Layer stack, basic generator/filter/envelope controls. (Implemented via `LayerStack`).
    - _Mix & Modulation:_ Full layer stack, per-layer mixer, full modulation dock.
    - _Routing & FX:_ Lane routing map, serial/parallel/split toggles, per-voice FX placement.
    - _Advanced / Lab:_ Import/analysis workflows, wavetable editor, additive editor, granular source editor.
- **Context Inspector:** A stable center panel that shows details for the currently selected object (generator, filter, FX lane) to avoid giant knob walls.
- **Guided Empty-State Flows:** "Start with Analog", "Drag in Audio", etc., instead of a dead modular shell.
- **Bounce / Freeze Workflow:** Every layer row should have a bounce/freeze option (Instrument Only, Full Output) since the synth can be CPU-heavy.

## 6. AI Preset Pipeline (Missing)

_Annotation: No implementation of AI preset generation or auto-tagging was found in the codebase._

- **Quality classifier:** Render audio → mel-spectrogram → small CNN (using `ort` bindings for ONNX Runtime natively, or `onnxruntime-web` in browser).
- **Auto-tagging:** Compute spectral centroid, flux, RMS, onset density to automatically map tags.
- **Text-to-preset:** LLM outputs JSON matching schema.
- **Preset morphing:** Morphing parameters linearly/logarithmically or crossfading discrete types between two existing presets.
