# Factory Content & DSP Pipeline Gap Analysis

> **Last Updated**: 2026-03-22

This document tracks the state of WebDaw's factory content and DSP pipeline against the requirements in `native-factory.md` and `performance-native.md`.

## 1. Core Architecture & Host Integration

| Component | Status | Notes |
|-----------|--------|-------|
| WAM 2.0 plugin host | **DONE** | `wamPluginHost.ts` — registry, loading, lifecycle |
| Faust → WASM runtime | **DONE** | `faustEngine.ts` — compiles DSP at runtime, 22 modules registered |
| Native DSP (Rust → WASM) | **DONE** | `audio-core` crate, `nativeDspProcessor.ts`, `NativeDspNode.ts` |
| Platform gating | **DONE** | `PluginDescriptor.platform`, `getPlatformPlugins()`, preset filtering |
| Device chain builder | **DONE** | 3 dispatch paths: builtin Web Audio, Faust, native DSP |
| Parameter bridge | **DONE** | `MessagePort` for native DSP, Faust params via WAM API |
| SharedArrayBuffer ring buffers | MISSING | Needed for heavy DSP offloading to Worker thread |

## 2. Built-in Effects

### Phase 1 — Essential Effects
| Effect | Web (Builtin) | Web (Faust) | Native (Rust) | Status |
|--------|--------------|-------------|---------------|--------|
| Parametric EQ | ✅ builtin-eq | ✅ Pro Parametric EQ | ✅ native-eq | **DONE** |
| Compressor | ✅ builtin-compressor | ✅ 1176 Compressor | ✅ native-compressor | **DONE** |
| Limiter | ✅ builtin-limiter | ✅ Brick-Wall Limiter | ✅ native-limiter | **DONE** |
| Reverb | ✅ builtin-reverb | ✅ Zita-Rev1, Spring | ✅ native-reverb | **DONE** |
| Delay | ✅ builtin-delay | ✅ Tape Delay | ✅ native-delay | **DONE** |
| Noise Gate | — | ✅ Noise Gate | ✅ native-gate | **DONE** |
| Gain / Utility | ✅ builtin-gain | ✅ Gain Utility | ✅ native-gain | **DONE** |
| LUFS Meter | — | — | — | **MISSING** |

### Phase 3 — Extended Effects
| Effect | Web | Faust | Status |
|--------|-----|-------|--------|
| Multiband Compressor | — | ✅ | **DONE** |
| Chorus | ✅ builtin-chorus | ✅ Multi-Voice Chorus | **DONE** |
| Flanger | ✅ builtin-flanger | ✅ Through-Zero Flanger | **DONE** |
| Phaser | ✅ builtin-phaser | ✅ Phaser | **DONE** |
| Tremolo | ✅ builtin-tremolo | ✅ Tremolo | **DONE** |
| Distortion | ✅ builtin-distortion | — | **DONE** |
| Bitcrusher | ✅ builtin-bitcrusher | — | **DONE** |
| Filter | ✅ builtin-filter | — | **DONE** |
| Auto-Pan | ✅ builtin-autopan | ✅ Auto-Pan | **DONE** |
| Sidechain Compressor | ✅ builtin-sidechain-compressor | — | **DONE** |
| Convolution Reverb | — | — | — | **MISSING** |
| De-esser | — | — | — | **MISSING** |
| Stereo Widener | — | — | — | **MISSING** |
| Pitch Correction | — | — | — | **MISSING** |
| Amp Simulator | — | — | — | **MISSING** |

## 3. Built-in Instruments

| Instrument | Implementation | Status |
|-----------|---------------|--------|
| Basic Polyphonic Synth | `builtinSynth.ts` (Web Audio nodes) | **DONE** |
| Drum Machine | `drumKitSynth.ts` | **DONE** |
| Wavetable Synth | `proSynthInstruments.ts` (Faust) | **DONE** |
| Supersaw Unison | `proSynthInstruments.ts` (Faust) | **DONE** |
| FM Synth | `faustEngine.ts` (Faust) | **DONE** |
| Rhodes Piano | `faustEngine.ts` (Faust) | **DONE** |
| Hammond B3 | `faustEngine.ts` (Faust) | **DONE** |
| Minimoog Lead | `faustEngine.ts` (Faust) | **DONE** |
| Physical Model String | `proSynthInstruments.ts` (Faust) | **DONE** |
| Additive Synth | `proSynthInstruments.ts` (Faust) | **DONE** |
| SFZ Sampler | — | **MISSING** |
| Plaits Multi-Engine (24 engines) | — | **MISSING** |
| Granular Engine | — | **MISSING** |

## 4. Content & Polish

| Item | Target | Current | Status |
|------|--------|---------|--------|
| Factory presets (effects) | 30+ per effect | ~50 total | **PARTIAL** |
| Factory presets (synths) | 200+ per synth | ~100 total | **PARTIAL** |
| Impulse Response library | 50–100 CC-licensed IRs | 0 | **MISSING** |
| Wavetable collection | 100–200 from AKWF | 0 | **MISSING** |
| Sample drum kits | 5+ kits | 4 kits | **PARTIAL** |
| Effect visualization panels | EQ curves, spectrum, comp graph | 0 | **MISSING** |

## 5. Remaining Implementation Tasks

### HIGH Priority (Immediate)
- [ ] **LUFS Meter** — BS.1770-4 algorithm, K-weighting, momentary/short-term/integrated
- [ ] **Convolution Reverb** — Web: `ConvolverNode`, WASM: partitioned FFT
- [ ] **Impulse Response library** — Curate 50+ CC-licensed IRs from OpenAIR/Voxengo/EchoThief
- [ ] **Factory presets expansion** — Add 200+ presets across all instruments and effects
- [ ] **Stereo Widener** — Mid/side processing (logic already in native-gain)
- [ ] **De-esser** — Bandpass sidechain + compressor

### MEDIUM Priority
- [ ] SFZ Sampler — SFZ parser in Rust, memory-based playback in WASM AudioWorklet
- [ ] Wavetable collection — AKWF public domain + generated tables
- [ ] Effect visualization panels — Canvas 2D EQ curves, compression graphs
- [ ] Plaits Multi-Engine — `mi-plaits-dsp-rs` 24 synthesis engines

### LOW Priority (Deferred)
- [ ] Pitch correction — Complex, requires pYIN + formant-preserving shifting
- [ ] Amp simulator — Cascaded waveshaping + cabinet IR convolution
- [ ] Granular engine — Grain scheduler, pool, windowing
- [ ] Modulation matrix — Custom build, no off-the-shelf crate
- [ ] SharedArrayBuffer ring buffers for heavy DSP offloading
- [ ] WASM SIMD optimization pass
