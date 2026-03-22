# Factory Content & DSP Pipeline Gap Analysis

This document analyzes the current state of WebDaw's factory content and DSP pipeline against the rigorous requirements for a top-tier (5-star) professional built-in suite of instruments and effects (inspired by Logic Pro's factory suite). It identifies missing features, architectural blockers, and UX improvements needed to ship professional-grade native and web DSP.

## 1. Core Architecture & Host Integration (The WAM 2.0 Standard)
The professional standard requires all built-in plugins to run as **Web Audio Modules (WAM 2.0)** with unified parameter automation, state management, and sample-accurate processing.
- **Current State [PARTIAL]:** \`wamPluginHost.ts\` implements the basic WAM registry and plugin loading. \`faustEngine.ts\` successfully compiles Faust DSP to Wasm at runtime. A scaffold \`HighEndPluginProcessor.ts\` exists.
- **Missing / Gap:** 
  - Need full **SharedArrayBuffer (SAB)** + **AudioWorklet** integration for heavy Rust/Wasm DSP (e.g. Alchemy, Space Designer).
  - Zero-latency lock-free **Atomics** (SPSC ring buffers) are not strictly enforced for UI-to-audio thread parameter modulation.
  - Wasm binaries are not lazily instantiated or dynamically imported correctly for a massive Rust plugin suite.

## 2. Built-in Synthesizers (The "Alchemy" Paradigm)
A top-tier DAW requires an ultra-flexible multi-engine synthesizer capable of granular, spectral, and additive synthesis.
- **Current State [PARTIAL]:** \`builtinSynth.ts\` provides a basic subtractive synth leveraging native audio nodes. \`drumKitSynth.ts\` handles basic drum kits. \`proSynthInstruments.ts\` provides Faust-based Wavetable, Supersaw, Additive, and Physical Modeling synths.
- **Missing / Gap:**
  - **Granular Engine:** Missing a memory-safe (object-pool based) granular engine capable of real-time microscopic splicing (1-100ms grains).
  - **Spectral/Additive Engine:** Faust additive synth exists but lacks Wasm SIMD operations for 600+ partials per voice.
  - **Modulation Matrix:** Missing an audio-rate DAG-sorted modulation matrix connecting LFOs/Envelopes to all parameters without single-sample feedback delays.
  - **SFZ Sampler:** Missing SFZ parser and sampler engine with disk streaming (\`creek\`) for native and memory OPFS caching for web.

## 3. Professional FX Suite (The "Space Designer" Paradigm)
Essential mixing tools must be zero-latency (where possible) and extremely high fidelity.
- **Current State [PARTIAL]:** \`faustEngine.ts\` implements several crucial Phase 1 and 3 effects: 1176 Compressor, Pro EQ, Multiband Compressor, Tape Delay, Limiter, Spring Reverb, and Zita-Rev1.
- **Missing / Gap:**
  - **Advanced Convolution Reverb:** Native \`ConvolverNode\` is insufficient. Must implement a **Non-Uniform Partitioned Convolution** engine via \`rustfft\`/\`realfft\`. Small partitions run on AudioWorklet, tails on Web Workers via SAB.
  - **Modulation Effects:** Missing high-quality Chorus, Flanger, and Phaser.
  - **Analog Emulation:** Missing saturation/distortion with Jiles-Atherton hysteresis models and oversampling.
  - **Pitch Correction:** Missing realtime YIN/pYIN pitch tracking and formant-preserving pitch shifting.

## 4. UI/UX & Visualization (Immediate Mode & WebGPU)
Factory plugins in 5-star DAWs require smooth, 60fps hardware-accelerated visuals.
- **Current State [MISSING]:** Mostly standard React DOM UI for native DAW components. Plugin UIs are lacking or entirely missing.
- **Missing / Gap:**
  - **WebGPU / Canvas 2D:** Dense visualizations (3D spectrograms, realtime EQ curves, waveform visualizers) must use WebGPU or HTML5 OffscreenCanvas passing data via SAB. Relying on React DOM nodes for audio-rate visual updates is an architectural blocker.
  - **Interaction Design:** Missing custom input components (rotary knobs with vertical/horizontal drag, shift-for-micro-adjust) that bypass standard `<input type="range">`.

---

## Implementation Roadmap & Tasks
Based on the `plugins.md` roadmap, the following tasks are tracked to bridge the gap.

**IMPORTANT IMPLEMENTATION RULE:** Do not replace existing presets or instruments. All new instruments, DSP engines, and presets must be **strictly additive**.

#### Built-in Audio Effects (Phase 1)
- **Status:** [DONE]
- **Gap:** Foundational effects (EQ, Comp, Delay, Reverb) are implemented via `createWebAudioEngine.ts` or Faust WASM. The missing "Noise Gate" and "Gain Utility" have now been built natively in `faustEngine.ts` and seamlessly wired to the UI via `BUILTIN_PLUGINS`. LUFS / Convolution Reverb are deferred to Rust WASM pipeline.
- [x] Parametric EQ (Pro Parametric EQ in `faustEngine.ts`)
- [x] Compressor (1176 Compressor in Faust)
- [x] Limiter with lookahead (Brick-Wall Limiter in Faust)
- [x] Reverb (Zita-Rev1, Spring Reverb in Faust)
- [x] Delay (Tape Delay in Faust)
- [x] Noise Gate (in Faust)
- [ ] LUFS Meter (via `bs1770` crate)
- [x] Gain / Utility plugin (in Faust)

### Phase 2: Core Instruments [PARTIAL]
- [x] Basic polyphonic synth voice with AHDSR and SVF (`builtinSynth.ts`)
- [x] Drum machine with pad mapping (`drumKitSynth.ts`)
- [x] Wavetable oscillator basic implementation (`proSynthInstruments.ts`)
- [ ] Wavetable oscillator with mip-mapped bandlimiting (Nigel Redmon alg) in Rust
- [ ] SFZ parser in Rust (using \`sfizz\` C++ as reference)
- [ ] Sampler engine with \`creek\` disk streaming (native) and OPFS memory cache (web)

### Phase 3: Extended Effects [PARTIAL]
- [x] Tape delay wow/flutter/saturation (in Faust)
- [x] Multiband compressor (in Faust)
- [ ] Chorus / Flanger / Phaser via delay lines and LFOs
- [ ] Distortion / Saturation via tanh waveshaping and oversampling
- [ ] Convolution reverb (non-uniform partitioned FFT via \`rustfft\`)

### Phase 4: Flagship Synth & Advanced Features [MISSING]
- [ ] Granular synthesis engine
- [ ] Spectral processing (STFT via \`rustfft\`)
- [ ] High-density Additive synthesis with Wasm SIMD
- [ ] DAG-sorted Modulation Matrix
- [ ] Pitch correction (pYIN + correction curve + pitch shifting)
- [ ] Amp simulator (cascaded waveshaping + cabinet IR)

### Phase 5: Content and Polish [MISSING]
- [ ] Factory presets (JSON format, 200+ per synth, 30+ per fx)
- [ ] Sample library with download-on-demand packs
- [ ] Wavetable collection from open-source sources (e.g. AKWF)
- [ ] Impulse Response library from CC-licensed collections
- [ ] WASM SIMD optimization pass for web polyphony targets
