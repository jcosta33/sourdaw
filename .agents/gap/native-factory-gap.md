# Native Factory Plugins — Gap Analysis

> **Scope**: Rust `audio-core` crate DSP → WASM AudioWorklet → TS device system → UI

## Current State

| Layer | Status |
|-------|--------|
| `audio-core` Rust crate | **Scaffold only** — sine wave test, `fundsp`/`rustfft`/`realfft` in Cargo.toml but unused |
| WASM AudioWorklet bridge | **Working** — `audioCoreProcessor.ts` loads WASM, calls `process_and_get_ptr`, maps outputs |
| TS device/preset system | **Mature** — `Device` model, `factoryPresets.ts`, `buildDeviceChain`, `applyPreset()` |
| UI device chain | **Mature** — `DeviceChainSection`, `InstrumentsTab`, parameter editing in Inspector |

## What Needs Building

### Phase 1 — Essential Effects (Rust → WASM → AudioWorklet)

| Plugin | Rust Implementation | Status |
|--------|-------------------|--------|
| **Parametric EQ** (8-band) | FunDSP `bell()` + `lowshelf()` + `highshelf()` cascade | MISSING |
| **Compressor** | Giannoulis feed-forward, `fundsp` envelope follower | MISSING |
| **Brick-wall Limiter** | Lookahead peak detection, FunDSP | MISSING |
| **Noise Gate** | Threshold + attack/hold/release + `fundsp` | MISSING |
| **Algorithmic Reverb** | FunDSP `reverb_stereo()` (Dattorro-based) | MISSING |
| **Stereo Delay** | FunDSP `delay()` with feedback + filtering | MISSING |
| **Gain / Utility** | Volume + phase invert + mono/stereo | MISSING |

### Phase 2 — Core Instruments (Rust → WASM → AudioWorklet)

| Plugin | Rust Implementation | Status |
|--------|-------------------|--------|
| **Subtractive Synth** | FunDSP oscillators + SVF filter + ADSR | MISSING |
| **Plaits Multi-Engine** | `mi-plaits-dsp-rs` 24 engines | MISSING — needs crate added |
| **Drum Machine** | FunDSP percussion synthesis | MISSING |
| **Basic Sampler** | Memory-backed sample playback in worklet | MISSING |

### Phase 3 — Extended Effects

| Plugin | Rust Implementation | Status |
|--------|-------------------|--------|
| **Chorus** | Multi-tap modulated delay | MISSING |
| **Flanger** | Short modulated delay + feedback | MISSING |
| **Phaser** | Cascaded allpass filters + LFO | MISSING |
| **Distortion/Saturation** | Waveshaper (`tanh`) + oversampling | MISSING |
| **Convolution Reverb** | `realfft` partitioned convolution | MISSING |
| **Multiband Compressor** | Linkwitz-Riley crossovers + per-band | MISSING |

### TS/UI Integration Needed

| Component | Work |
|-----------|------|
| New device type: `native-dsp` | Add to `Device.type` union, handle in `buildDeviceChain` |
| `NativeDspWorkletNode` class | AudioWorkletNode wrapper that routes params to WASM |
| Parameter bridge | `SharedArrayBuffer` or `MessagePort` param updates to worklet |
| Factory presets | Add `native-*` presets to `factoryPresets.ts` |
| Web-unavailable overlay | Disabled state + tooltip for native-only plugins in web mode |
| `isTauri()` gating | Show/hide or enable/disable native-only plugins |

### Web vs Native Availability

| Plugin | Web (WASM) | Native (Rust) | Notes |
|--------|-----------|--------------|-------|
| EQ, Comp, Limiter, Gate | ✅ via WASM AudioWorklet | ✅ native | Same Rust code, both targets |
| Reverb (algorithmic) | ✅ via WASM AudioWorklet | ✅ native | Same Rust code |
| Delay, Chorus, Phaser | ✅ via WASM AudioWorklet | ✅ native | Same Rust code |
| Convolution Reverb | ⚠️ limited (< 5s IRs) | ✅ native | Web: single-thread constraint |
| Plaits Synth | ✅ via WASM AudioWorklet | ✅ native | Same Rust code |
| Disk-streaming Sampler | ❌ web only loads to memory | ✅ uses creek | Web disabled with message |

> [!IMPORTANT]
> Most plugins compile to **both** WASM and native from the same Rust source. Only disk-streaming sampler and long convolution are truly native-only.
