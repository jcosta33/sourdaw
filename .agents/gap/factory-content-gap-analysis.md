# Factory Content & DSP Pipeline Gap Analysis

> **Last Updated**: 2026-03-25

This document tracks the state of Sourdaw's factory content and DSP pipeline against the requirements in `native-factory.md` and `performance-native.md`.

## 1. Core Architecture & Host Integration

| Component                      | Status   | Notes                                                                        |
| ------------------------------ | -------- | ---------------------------------------------------------------------------- |
| WAM 2.0 plugin host            | **DONE** | `wamPluginHost.ts` — registry, loading, lifecycle                            |
| Faust → WASM runtime           | **DONE** | `faustEngine.ts` — compiles DSP at runtime, instrument/effect categorization |
| Native DSP (Rust → WASM)       | **DONE** | `audio-core` crate, `nativeDspProcessor.ts`, `NativeDspNode.ts`              |
| Platform gating                | **DONE** | `PluginDescriptor.platform`, `getPlatformPlugins()`, preset filtering        |
| Device chain builder           | **DONE** | 3 dispatch paths: builtin Web Audio, Faust, native DSP                       |
| Parameter bridge               | **DONE** | `MessagePort` for native DSP, Faust params via WAM API                       |
| Faust instrument wiring        | **DONE** | `presetLoading.ts` recognizes `faust-*` IDs, `isInstrument` flag in compiler |
| SharedArrayBuffer ring buffers | MISSING  | Needed for heavy DSP offloading to Worker thread                             |

## 2. Built-in Effects

### Phase 1 — Essential Effects

| Effect         | Web (Builtin)         | Web (Faust)           | Native (Rust)        | Status   |
| -------------- | --------------------- | --------------------- | -------------------- | -------- |
| Parametric EQ  | ✅ builtin-eq         | ✅ Pro Parametric EQ  | ✅ native-eq         | **DONE** |
| Compressor     | ✅ builtin-compressor | ✅ 1176 Compressor    | ✅ native-compressor | **DONE** |
| Limiter        | ✅ builtin-limiter    | ✅ Brick-Wall Limiter | ✅ native-limiter    | **DONE** |
| Reverb         | ✅ builtin-reverb     | ✅ Zita-Rev1, Spring  | ✅ native-reverb     | **DONE** |
| Delay          | ✅ builtin-delay      | ✅ Tape Delay         | ✅ native-delay      | **DONE** |
| Noise Gate     | —                     | ✅ Noise Gate         | ✅ native-gate       | **DONE** |
| Gain / Utility | ✅ builtin-gain       | ✅ Gain Utility       | ✅ native-gain       | **DONE** |
| LUFS Meter     | ✅ builtin-lufs-meter | ✅ Faust LUFS Meter   | —                    | **DONE** |

### Phase 3 — Extended Effects

| Effect               | Web                                                | Faust                   | Status      |
| -------------------- | -------------------------------------------------- | ----------------------- | ----------- |
| Multiband Compressor | —                                                  | ✅                      | **DONE**    |
| Chorus               | ✅ builtin-chorus                                  | —                       | **DONE**    |
| Flanger              | ✅ builtin-flanger                                 | —                       | **DONE**    |
| Phaser               | ✅ builtin-phaser                                  | —                       | **DONE**    |
| Tremolo              | ✅ builtin-tremolo                                 | —                       | **DONE**    |
| Distortion           | ✅ builtin-distortion                              | —                       | **DONE**    |
| Bitcrusher           | ✅ builtin-bitcrusher                              | —                       | **DONE**    |
| Filter               | ✅ builtin-filter                                  | —                       | **DONE**    |
| Auto-Pan             | ✅ builtin-autopan                                 | —                       | **DONE**    |
| Sidechain Compressor | ✅ builtin-sidechain-compressor                    | —                       | **DONE**    |
| Convolution Reverb   | ✅ builtin-convolution-reverb (10 algorithmic IRs) | —                       | **DONE**    |
| De-esser             | ✅ builtin-deesser                                 | ✅ Faust De-esser       | **DONE**    |
| Stereo Widener       | ✅ builtin-stereo-widener (M/S)                    | ✅ Faust Stereo Widener | **DONE**    |
| Pitch Correction     | —                                                  | —                       | **MISSING** |
| Amp Simulator        | —                                                  | —                       | **MISSING** |

## 3. Built-in Instruments

| Instrument                       | Implementation                                              | Presets     | Status      |
| -------------------------------- | ----------------------------------------------------------- | ----------- | ----------- |
| Basic Polyphonic Synth           | `builtinSynth.ts` (Web Audio nodes)                         | 111 presets | **DONE**    |
| Drum Machine                     | `drumKitSynth.ts` + `drumSynthEngine` (808 kit)             | 12 presets  | **DONE**    |
| Wavetable Synth                  | `proSynthInstruments.ts` (Faust)                            | 3 presets   | **DONE**    |
| Supersaw Unison                  | `proSynthInstruments.ts` (Faust)                            | 4 presets   | **DONE**    |
| FM Synth                         | `builtinDSP.ts` (Faust, ADSR + mod envelope)                | 6 presets   | **DONE**    |
| Rhodes Piano                     | `builtinDSP.ts` (Faust, body/bell dual-envelope FM)         | 5 presets   | **DONE**    |
| Hammond B3                       | `builtinDSP.ts` (Faust, 9 drawbars + click + perc + Leslie) | 5 presets   | **DONE**    |
| Minimoog Lead                    | `builtinDSP.ts` (Faust, 3 oscs + Moog ladder + glide)       | 5 presets   | **DONE**    |
| Acid Bass 303                    | `builtinDSP.ts` (Faust, diode ladder filter)                | 5 presets   | **DONE**    |
| Physical Model String            | `proSynthInstruments.ts` (Faust, Karplus-Strong)            | 3 presets   | **DONE**    |
| Additive Synth                   | `proSynthInstruments.ts` (Faust, 16 partials)               | 3 presets   | **DONE**    |
| SFZ Sampler                      | —                                                           | —           | **MISSING** |
| Plaits Multi-Engine (24 engines) | —                                                           | —           | **MISSING** |
| Granular Engine                  | —                                                           | —           | **MISSING** |

## 4. Content & Polish

| Item                        | Target                          | Current                                        | Status      |
| --------------------------- | ------------------------------- | ---------------------------------------------- | ----------- |
| Factory presets (effects)   | 30+ per effect                  | ~50 total                                      | **PARTIAL** |
| Factory presets (synths)    | 200+ total                      | ~154 total (111 builtin + 43 Faust instrument) | **PARTIAL** |
| Impulse Response library    | 50–100 CC-licensed IRs          | 10 algorithmic generators                      | **PARTIAL** |
| Wavetable collection        | 100–200 from AKWF               | 0                                              | **MISSING** |
| Sample drum kits            | 5+ kits                         | 1 synth kit (808)                              | **PARTIAL** |
| Effect visualization panels | EQ curves, spectrum, comp graph | Implemented in inspector                       | **DONE**    |

## 5. Remaining Implementation Tasks

### HIGH Priority (Immediate)

- [ ] **Factory presets expansion** — Add more presets for Faust instruments (target 200+ total)
- [ ] **Real IR library** — Curate 50+ CC-licensed IRs from OpenAIR/Voxengo/EchoThief
- [ ] **Wavetable collection** — AKWF public domain + generated tables for Wavetable Synth

### MEDIUM Priority

- [ ] SFZ Sampler — SFZ parser in Rust, memory-based playback in WASM AudioWorklet
- [ ] Sample drum kits — Import CC0 kits for `drumKitSynth`
- [ ] Plaits Multi-Engine — `mi-plaits-dsp-rs` 24 synthesis engines

### LOW Priority (Deferred)

- [ ] Pitch correction — Complex, requires pYIN + formant-preserving shifting
- [ ] Amp simulator — Cascaded waveshaping + cabinet IR convolution
- [ ] Granular engine — Grain scheduler, pool, windowing
- [ ] SharedArrayBuffer ring buffers for heavy DSP offloading
- [ ] WASM SIMD optimization pass
