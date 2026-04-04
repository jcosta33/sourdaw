# Consolidated Instruments & DSP Research

This document consolidates research and specifications for Sourdaw's instruments, modular environments, and generative AI features. Features that have already been implemented exactly as specified have been removed. The remaining content details missing features, future architectural plans, and valuable research context, annotated with current codebase findings.

---

## 1. The Bakery (Modular Synthesis Environment)

*Codebase Annotation: The Bakery is currently missing from the DSP and UI engine. It is only referenced in UI placeholders (Export Dialog, Alpha Notice Dialog for Discord). The entire modular patching, compilation engine, and UI described below remain unimplemented.*

### Purpose
The Bakery is Sourdaw’s built-in visual patching and modular synthesis environment. It must function as a first-class instrument, audio effect, note/MIDI processor, learning environment, and community-sharing format. The core product promise is: A user patch in The Bakery compiles into the same optimized Rust audio graph infrastructure used by Sourdaw’s built-in devices.

### Mission-Critical Product Goals
1. Native-speed execution
2. Full DAW integration
3. Visual clarity
4. Shallow entry, deep ceiling
5. Sub-patch ecosystem and community flywheel
6. Compatibility with browser/WASM execution for patch sharing
7. Direct reuse of Sourdaw’s internal DSP building blocks

### Core Patch Data Model & Compilation
Every patch is one of: `Poly Bakery` (Instrument), `FX Bakery` (Effect), or `Note Bakery` (MIDI processor). 
The patcher is edited as a graph, but executed as a compiled schedule: no graph walking on the audio thread, no hash lookups.
Poly Bakery splits into two execution domains:
- **Voice Domain**: Runs once per active voice (oscillators, envelopes, per-voice filters).
- **Global Domain**: Runs once per patch (global reverb, final width/pan).

### Compilation Pipeline
1. Parse and Normalize
2. Port Resolution (infer lane counts, voice-local vs global)
3. Graph Build (nodes = module instances, edges = cables)
4. Domain Split (event, continuous, voice-local, global)
5. Feedback / SCC Analysis (insert 1-sample delay on cyclic edges)
6. Topological Schedule
7. Buffer Planning (linear-scan / liveness-based buffer allocator)
8. Optimization Passes (constant folding, dead code elimination, fusion)
9. Schedule Emission (flat `ProcessTask` schedule)

### User-Facing Signal Domains
- **Audio** (orange), **Gate** / **Trigger** (green), **Value / Modulation** (blue), **Phase** (purple), **Event / Note Stream** (teal).

---

## 2. Crumb (Advanced Sampler Engine)

*Codebase Annotation: Crumb's dedicated sampler engine (`daw-sampler`) and UI mapping grid are missing. Currently, "Crumb" only exists as a naming convention in preset strings (e.g., "Glitch Crumb" in Toaster, "Stale Crumbs" in Fermenter).*

### Product Definition
Crumb is Sourdaw’s general-purpose sampler for multisampling, slicing, warping, granular playback, disk streaming, and expressive modulation. It uses a five-tier structure: Instrument, Layer, Group, Zone, and Sample Asset.

### Playback Modes & Resampling
- **Modes**: One-Shot, Classic Gated, Slice, Granular, Warp / Tempo-Sync.
- **Resampling Quality Tiers**:
  - Linear (2-point): Draft playback, highest polyphony.
  - Cubic Hermite (4-point): Default playback sweet spot.
  - Windowed Sinc: Premium mode, high CPU / offline bounce.
- **Warping**: Use Signalsmith Stretch for premium tonal/polyphonic stretching, decoupled from pitch.
- **Slicing**: Spectral-flux-based onset detection for auto-slice.

### Disk Streaming & Memory
- Large libraries should use direct-from-disk playback with configurable attack preloads (64 KB - 256 KB) in RAM.
- Use SPSC ring buffers, double-buffering, and read-ahead scheduling. No file I/O on the real-time audio thread.

### UX & Interface (Progressive Disclosure)
- **Level 1 (Play)**: Preset browser, 8 macros, basic amplitude.
- **Level 2 (Shape)**: Single sample instrument view, waveform, envelopes.
- **Level 3 (Build)**: 2D key/velocity mapping grid, overlap-aware equal-power crossfades.
- **Level 4 (Route)**: Insert/send chains, multi-output matrix.
- **Level 5 (Lab)**: Resampler selection, warp-engine options, vintage emulation.
- **WebGPU Visualization**: Used for waveform rendering, mapping grid, modulation rings, and loop-correlation overlays.

---

## 3. Bacteria (Creative Multi-Effects Framework)

*Codebase Annotation: Bacteria is largely implemented exactly as specified in the research. The Rust DSP engine (`crates/daw-dsp/src/bacteria/`) includes the LR4 crossover, SVF filter, Bezier custom waveshaper, distortion, granular, convolution, STFT processing, and modulation sources (LFO, Env Follower, Lorenz). The React frontend (`BacteriaPanel.tsx`) and WASM integration are also present. The text below contains only the features that are MISSING or implemented differently.*

### Missing Feature: Linear Phase FIR Crossover
While the default 4th-order Linkwitz-Riley (LR4) crossover is implemented, the **Linear Phase FIR** mode for high-fidelity/mastering use is missing.
- **Requirements**: Use windowed-sinc FIR filters to preserve identical delay across all frequencies. Accept high latency and pre-ringing (e.g., 32,768 taps at 44.1 kHz yielding ~371 ms latency).

### Missing Feature: Phase-Linear Subtractive Crossover Variant
An alternative to heavy FIR filters was researched but is missing:
$$y_{HP}[n] = x[n - d] - y_{LP}[n]$$
Where $d$ is the group delay of the low-pass filter. This achieves linear-phase behavior with significantly lower throughput delay.

### Missing Feature: Full DAG-Based Routing Execution
The research specifies representing the signal path as a **Directed Acyclic Graph (DAG)** to support arbitrary serial, parallel, mid/side routing, and internal sidechain paths. Currently, the codebase processes bands sequentially and lacks a fully dynamic node-based DAG for arbitrary user routing (Level 4 "Route").

---

## 4. Instruments Library (Free Resources vs Logic Pro)

*Codebase Annotation: The Faust/WASM compilation pipeline and synthesizer instruments (Analog, FM, Organ, 808s) are fully implemented. The gap analysis below highlights the missing sample-based instrument strategy and library curation.*

### Quality Gap Assessment
~60% of a Logic Pro-caliber instrument suite is achievable today with free resources. Synthesis (Faust) matches or exceeds Logic Pro's equivalents (Retro Synth, Vintage B3), but sampled instruments (Orchestral, Choir, Guitars) face significant gaps.

### Recommended CC0 / Free Sample Libraries to Integrate
- **Acoustic Piano**: Salamander Grand Piano (CC-BY-3.0, 16 velocity layers, 707 MB FLAC) as primary. Sofia MZ Pianos (premium), Splendid Grand (fallback).
- **Acoustic Drums**: Virtuosity Drums (CC0, 36 dynamic levels, 1.5 GB FLAC) as primary. Naked Drums (CC-BY-4.0) for rock/metal.
- **Bass Guitar**: Karoryfer Growlybass (CC0, 4 velocity layers, 4 round-robins).
- **Orchestral**: VSCO 2 Community Edition (CC0, ~2.3 GB). Gap: Lacks true legato interval sampling and deep velocity layers compared to Logic Studio Strings.
- **Choir**: No CC0 SATB choir library exists. Use Faust formant synthesis (`pm.SFFormantModelBP`) as a "Vocal Pad" workaround.
- **Mellotron**: No CC0 Mellotron samples exist. Workaround: Process clean CC0 orchestral samples (VCSL) through a Faust tape effect chain (wow, flutter, saturation, bandpass noise).

### Packaging and Delivery Strategy
1. **Bundled with installer (~100–200 MB)**: Faust synthesis instruments (zero sample cost), Splendid Grand Piano, Gogodze Phu drum kit.
2. **First-run download (~1–2 GB)**: Salamander Grand Piano, Virtuosity Drums, VSCO 2 CE core.
3. **On-demand download (~3–5 GB)**: Full orchestral suite, Karoryfer guitars/basses.
Distribute as FLAC. Decode to PCM at load time using Rust/symphonia in the Tauri backend, then transfer to WASM virtual filesystem to respect WASM memory limits (≤1 GB uncompressed per loaded instrument).

---

## 5. Local AI Audio Generation

*Codebase Annotation: The Tauri v2 sidecar architecture is fully implemented exactly as specified. `src/commands/audio_gen.rs` and `sidecar/audio_gen.py` handle the Stable Audio Open generation, progress events, and Rust post-processing (tempo/pitch/trim via `ssstretch` and `hound`). LLM prompt parsing is also integrated using `llama-cpp-python` / Qwen2.5. The text below contains only the high-level research and performance expectations.*

### Model Selection & Licensing Realities
- **Stable Audio Open 1.0 / Small**: The strongest choice for a commercial product. Outputs 44.1kHz stereo, natively conditions on timing, and the Stability Community License permits commercial use under $1M revenue. The **Small variant** (341M params) generates up to 11 seconds in just 8 diffusion steps using a `pingpong` sampler.
- **MusicGen (Small/Medium/Stereo)**: Excellent quality but **CC-BY-NC 4.0** weights prohibit commercial use. Requires embedding BPM/key into the text prompt.
- **JASCO / MAGNeT**: Accept native chord/drum conditioning or generate faster, but inherit the CC-BY-NC 4.0 license.

### MPS (Apple Silicon) Gotchas
- **MusicGen does not work on PyTorch MPS.** The EnCodec decoder crashes with unsupported ops. Requires the MLX port (`musicgen-mlx`) or CPU fallback.
- **Stable Audio Open works on MPS** but requires `torch.float32` (MPS does not support float64 and some float16 paths trigger errors).
- **Quantization**: `optimum-quanto` (int8 weight-only) is the only quantization library that works on both CUDA and MPS.

### Realistic Generation Times
- **MusicGen-small (300M, 8s clip)**: ~2–4s on RTX 3080 (CUDA), ~6s on M4 Max (MLX), ~10–13s on M2 Mac.
- **Stable Audio Open Small (8 steps)**: Under 2 seconds on CUDA, ~7–8s on smartphone ARM chips.
- **LLM Prompt Parse (Qwen2.5-1.5B)**: ~150–200 ms on CPU.
- **Rust Post-Processing**: ~100 ms.
Model loading is the dominant latency (5-15s), so the Python sidecar must be kept warm in memory between requests.
