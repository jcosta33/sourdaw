# Metering module — Agent Guidelines

Real-time audio visualization: provides visual level meters, loudness meters, phase scopes, goniometers, and spectrum/spectrogram analyzers.

## Domain Ownership

Owns real-time visual audio meters, scopes, and spectrum visualizations (peak/RMS level meters, LUFS meter, Goniometer/Lissajous, Phase correlation, Oscilloscope, Spectrogram, Canvas/WebGPU Spectrum Analyzers, Wavetable 3D, Spatial Panner UI). Does not own low-level WebAudio `AnalyserNode` instances or raw DSP feature calculation (AudioEngine).

## Public Contract Surface

- **`presentations/views`**: `AnalysisPanel`, `Goniometer`, `LevelMeter`, `LUFSMeter`, `Oscilloscope`, `PhaseCorrelationDisplay`, `SpatialPanner`, `Spectrogram`, `SpectrumAnalyzer`, `Wavetable3D`, `WebGpuSpectrumAnalyzer`.
- **`useCases`**: None.
- **`events`**: None.
- **`stores`**: None.
- **Handler maps**: None.

## Key Subsystems

- **`presentations/views/`**: React component meters and visualizers interfacing with WebAudio analysers.
- **`presentations/renderers/`**: `createWebGpuSpectrumRenderer.ts` — high-performance WebGPU compute and vertex rendering pipeline for frequency spectrum visualization.

## Invariants & Traps

- **Animation frame lifecycle**: All `requestAnimationFrame` render loops must bind to the React component lifecycle and cleanly cancel on unmount to prevent memory leaks and background CPU draw.
- **Zero allocation in render loops**: Frame rendering cycles must reuse pre-allocated typed arrays (`Float32Array`, `Uint8Array`) for FFT frequency/time-domain data rather than allocating per-frame arrays.
- **WebGPU fallback**: WebGPU renderers must detect WebGPU availability and degrade gracefully to Canvas 2D or static representations in unsupported or headless environments.

## Verification

- **Focused unit tests**: `pnpm test:run src/modules/Metering`
- **Module boundaries**: `pnpm deps:validate`
