# Native Factory Plugins — Gap Analysis

> **Scope**: Rust `audio-core` crate DSP → WASM AudioWorklet → TS device system → UI
> **Last Updated**: 2026-03-22

## Current State

| Layer | Status |
|-------|--------|
| `audio-core` Rust crate | **DONE** — 7 DSP modules (EQ, Compressor, Limiter, Reverb, Delay, Gate, Gain) |
| WASM AudioWorklet bridge | **DONE** — `nativeDspProcessor.ts` loads WASM (`--target web` ES module), `NativeDspNode.ts` engine wrapper |
| TS device/preset system | **DONE** — `Device` model handles `native-dsp` type, `buildDeviceChain` dispatches, factory presets included |
| UI device chain | **DONE** — `DeviceChainSection`, `TrackDevicesSection`, Inspector parameter editing, sidebar Effects tab |
| Platform gating | **DONE** — `PluginDescriptor.platform` field, `getPlatformPlugins()` filter, native hidden in web, web hidden in native |

## Faust DSP Modules (22 total — all DONE)

### Effects (13)
| Module | Source File | Category |
|--------|-----------|----------|
| Zita-Rev1 Reverb | `faustEngine.ts` | Reverb |
| Spring Reverb | `faustEngine.ts` | Reverb |
| 1176 Compressor | `faustEngine.ts` | Dynamics |
| Multiband Compressor | `faustEngine.ts` | Dynamics |
| Brick-Wall Limiter | `faustEngine.ts` | Dynamics |
| Noise Gate | `faustEngine.ts` | Dynamics |
| Pro Parametric EQ | `faustEngine.ts` | EQ |
| Tape Delay | `faustEngine.ts` | Delay |
| Gain Utility | `faustEngine.ts` | Utility |
| Multi-Voice Chorus | `proModulationEffects.ts` | Modulation |
| Through-Zero Flanger | `proModulationEffects.ts` | Modulation |
| Phaser | `proModulationEffects.ts` | Modulation |
| Tremolo | `proModulationEffects.ts` | Modulation |

### Instruments (9)
| Module | Source File |
|--------|-----------|
| FM Synth | `faustEngine.ts` |
| Rhodes | `faustEngine.ts` |
| Hammond B3 | `faustEngine.ts` |
| Minimoog Lead | `faustEngine.ts` |
| Wavetable Synth | `proSynthInstruments.ts` |
| Supersaw Unison | `proSynthInstruments.ts` |
| Physical Model String | `proSynthInstruments.ts` |
| Additive Synth | `proSynthInstruments.ts` |
| Auto-Pan | `proModulationEffects.ts` |

## Builtin Web Audio Plugins (17 — all DONE)

6 web-only (have native counterparts): EQ, Compressor, Reverb, Delay, Gain, Limiter
11 both-platform: Sidechain Compressor, Chorus, Phaser, Distortion, Flanger, Tremolo, Bitcrusher, Filter, Autopan, Synth, Drum Kit

## Native DSP Plugins (7 — all DONE)

All native-only (hidden in web): EQ, Compressor, Limiter, Reverb, Delay, Gate, Gain

## What Still Needs Building

### Phase 1 — Missing Effects

| Plugin | Priority | Implementation Strategy | Status |
|--------|----------|------------------------|--------|
| **LUFS Meter** | HIGH | `bs1770` algorithm in Rust WASM, or Web Audio `AnalyserNode` based | MISSING |
| **Convolution Reverb** | HIGH | Web: native `ConvolverNode` + IR loading. Native: Rust partitioned FFT | MISSING |
| **Stereo Widener** | MEDIUM | Mid/side processing (already in native-gain module, expose as standalone) | MISSING |
| **De-esser** | MEDIUM | Sidechain compressor with bandpass on sidechain | MISSING |
| **Pitch Correction** | LOW | `pitch-detection` crate + correction curve — complex, defer | MISSING |
| **Amp Simulator** | LOW | Cascaded waveshaping + cabinet IR convolution — defer | MISSING |

### Phase 2 — Missing Instruments

| Plugin | Priority | Implementation Strategy | Status |
|--------|----------|------------------------|--------|
| **SFZ Sampler** | HIGH | SFZ parser in Rust, memory-based playback in WASM | MISSING |
| **Plaits Multi-Engine** | MEDIUM | `mi-plaits-dsp-rs` crate — 24 synthesis engines | MISSING |
| **Granular Engine** | LOW | FunDSP `granular.rs` or custom grain scheduler | MISSING |

### Phase 3 — Content & Polish

| Item | Priority | Status |
|------|----------|--------|
| **More factory presets** (target: 200+ per synth, 30+ per effect) | HIGH | PARTIAL — ~150 total, need 500+ |
| **Impulse Response library** (50–100 CC-licensed IRs) | HIGH | MISSING |
| **Wavetable collection** (100–200 from AKWF/open sources) | MEDIUM | MISSING |
| **Effect visualization** (EQ curves, compression graphs, spectrum) | MEDIUM | MISSING |

### Phase 4 — Advanced Architecture

| Item | Priority | Status |
|------|----------|--------|
| **Modulation Matrix** | LOW | MISSING — no off-the-shelf crate, custom build |
| **Sample library download-on-demand** | LOW | MISSING |
| **WASM SIMD optimization** | LOW | MISSING |

> [!IMPORTANT]
> The gap analysis is now current as of 2026-03-22. Most Phase 1 effects and Phase 2 instruments from the original roadmap are DONE. The primary remaining gaps are content (presets, IRs, wavetables), LUFS metering, convolution reverb, and the SFZ sampler.
