# Building a professional DAW plugin suite in Tauri v2

**Faust compiled to WAM 2.0 via `faust2wam` is the optimal foundation for a comprehensive built-in plugin suite.** It provides the richest open-source DSP library available (hundreds of production-ready algorithms), generates Web Audio Module plugins directly, produces compact WASM binaries (tens of KB each), and its LGPL-with-exception licensing explicitly permits commercial distribution of compiled output. Combined with sfizz (BSD-2-Clause) for sample playback and Rust via Tauri for disk streaming and audio decoding, this architecture covers every category a professional DAW requires — synthesizers, effects, samplers, MIDI processors — across all three Tauri WebView engines.

The critical constraint is **SharedArrayBuffer support on WebKitGTK (Linux)**, which has been historically problematic. WAM 2.0 degrades gracefully to MessagePort communication without SAB, but parameter automation latency increases. All other required Web APIs — AudioWorklet, WebAssembly, ES dynamic imports — work across WKWebView, WebView2, and WebKitGTK on current OS versions.

---

## WAM 2.0 works across all Tauri WebViews — with one caveat

WAM 2.0 requires AudioWorklet, SharedArrayBuffer, WebAssembly, and MessagePort. Here is the compatibility matrix for all three Tauri v2 WebView engines:

| API                   | WKWebView (macOS)           | WebView2 (Windows)        | WebKitGTK (Linux)                       |
| --------------------- | --------------------------- | ------------------------- | --------------------------------------- |
| **AudioWorklet**      | ✅ Safari 14.1+             | ✅ Chrome 66+             | ✅ WebKitGTK 2.36+                      |
| **SharedArrayBuffer** | ✅ Safari 15.2+ (COOP/COEP) | ✅ Chrome 92+ (COOP/COEP) | ⚠️ Requires COOP/COEP + WebKitGTK 2.40+ |
| **WebAssembly**       | ✅ Safari 11+               | ✅ Chrome 57+             | ✅ Universal                            |
| **WASM SIMD**         | ✅ Safari 16.4+             | ✅ Chrome 91+             | ⚠️ Depends on version                   |
| **ES Dynamic Import** | ✅ Safari 11+               | ✅ Chrome 63+             | ✅ Modern WebKitGTK                     |

**The Linux caveat**: WebKitGTK's SharedArrayBuffer support has been historically problematic. WebKit bug #237144 (SAB posted to AudioWorkletProcessor wasn't actually shared) was fixed in Safari 15.4+ and corresponding WebKitGTK versions, but older distros may ship insufficient WebKitGTK. Ubuntu 22.04 ships WebKitGTK 2.36; Ubuntu 24.04 ships ~2.44. **Set a minimum WebKitGTK 2.40+ requirement** for full functionality. WAM falls back to MessagePort-based communication without SAB — functional but with higher latency for parameter automation.

**Safari/WebKit-specific issues to watch**: `console.log` does not work inside AudioWorklet processors in Safari (use `postMessage` for debugging). Safari/WKWebView does not support OGG/Opus audio — use WAV, FLAC, MP3, or AAC for all sample content. Most WAM plugin developers test only on Chrome, so expect to fix minor WebKit incompatibilities in third-party WAM plugins.

### Tauri v2 configuration for cross-origin isolation

SharedArrayBuffer requires Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers. Tauri v2.1+ supports these in `tauri.conf.json` — but **only for production builds**. The dev server must be configured separately.

```json
// tauri.conf.json
{
    "app": {
        "security": {
            "csp": "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src ipc: http://ipc.localhost",
            "headers": {
                "Cross-Origin-Opener-Policy": "same-origin",
                "Cross-Origin-Embedder-Policy": "require-corp"
            }
        }
    }
}
```

```typescript
// vite.config.ts — mirrors production headers in dev
export default defineConfig({
    server: {
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
});
```

`unsafe-eval` in CSP may be needed if WAM plugins use `new Function()` or dynamic code patterns. `wasm-unsafe-eval` permits WASM instantiation. Runtime feature detection should check `window.crossOriginIsolated` and `typeof SharedArrayBuffer !== 'undefined'` to enable graceful degradation.

---

## All built-in plugins should be WAM 2.0 plugins

The correct architecture is to build every built-in plugin as a WAM 2.0 plugin, bundled locally rather than loaded from remote URLs. This eliminates dual maintenance of internal versus external formats, ensures third-party WAMs work identically to built-ins, and gives every plugin standardized parameter automation, MIDI, and state save/restore for free.

### How WAM hosting works in code

```typescript
import { addFunctionModule, initializeWamEnv, initializeWamGroup } from '@webaudiomodules/sdk';
import { VERSION } from '@webaudiomodules/api';

// 1. Initialize WAM environment on audio thread (once per AudioContext)
await addFunctionModule(audioContext.audioWorklet, initializeWamEnv, VERSION);

// 2. Create host group
const hostGroupId = 'daw-host';
const hostGroupKey = crypto.randomUUID();
await addFunctionModule(audioContext.audioWorklet, initializeWamGroup, hostGroupId, hostGroupKey);

// 3. Load a built-in plugin (same API as remote plugins)
const { default: PluginCtor } = await import('./plugins/eq/index.js');
const plugin = await PluginCtor.createInstance(audioContext, {});

// 4. Connect to audio graph
sourceNode.connect(plugin.audioNode);
plugin.audioNode.connect(audioContext.destination);

// 5. Parameter automation
plugin.audioNode.scheduleEvents({
    type: 'wam-automation',
    data: { id: 'gain', value: 0.8, normalized: false },
    time: audioContext.currentTime + 1.0,
});

// 6. MIDI
plugin.audioNode.scheduleEvents({
    type: 'wam-midi',
    data: { bytes: [0x90, 60, 127] }, // Note On C4
    time: audioContext.currentTime,
});

// 7. State save/restore
const state = await plugin.audioNode.getState();
await plugin.audioNode.setState(state);
```

### Built-in vs third-party plugin loading

```typescript
const BUILTIN_PLUGINS: Record<string, () => Promise<any>> = {
    'com.mydaw.eq': () => import('./plugins/eq/index.js'),
    'com.mydaw.compressor': () => import('./plugins/compressor/index.js'),
    'com.mydaw.synth-sub': () => import('./plugins/synth-sub/index.js'),
};

async function loadPlugin(id: string, ctx: AudioContext) {
    const builtin = BUILTIN_PLUGINS[id];
    if (builtin) {
        const { default: Ctor } = await builtin();
        return Ctor.createInstance(ctx, {});
    }
    // Third-party: load from URL
    const { default: Ctor } = await import(/* @vite-ignore */ id + '/index.js');
    return Ctor.createInstance(ctx, {});
}
```

Each WAM plugin exposes a `descriptor.json` with metadata:

```json
{
    "identifier": "com.mydaw.eq",
    "name": "Parametric EQ",
    "vendor": "MyDAW",
    "version": "1.0.0",
    "apiVersion": "2.0.0",
    "isInstrument": false,
    "hasAudioInput": true,
    "hasAudioOutput": true,
    "hasMidiInput": false,
    "hasMidiOutput": false
}
```

**Key NPM packages**: `@webaudiomodules/api` (2.0.0-alpha.6 — TypeScript types), `@webaudiomodules/sdk` (0.0.12 — base classes), `@webaudiomodules/sdk-parammgr` (0.0.13 — AudioParam mapping). All MIT licensed.

**WAM MIDI routing**: WAM uses its own event protocol (`wam-midi`, `wam-automation`, `wam-transport`, `wam-mpe`, `wam-osc`), not Web MIDI API directly. MIDI effects connect via `sourcePlugin.audioNode.connectEvents(destPlugin.audioNode.instanceId)`. The `wam-extensions` package (github.com/boourns/wam-extensions) adds modulation targets, sequencer clips, and note name publishing.

---

## Faust is the primary DSP engine for the plugin suite

Faust (Functional Audio Stream) is a mature functional programming language for real-time audio DSP with a **native WASM backend** and a tool called **`faust2wam`** that compiles `.dsp` files directly into WAM 2.0 plugins. Its standard libraries contain hundreds of production-ready DSP algorithms covering every synthesis and effects category.

### Licensing verdict for commercial use

The Faust licensing situation is nuanced but favorable:

- **Faust compiler**: GPL — but it's a build tool, not distributed to end users. **The GPL does not apply to generated output code** (confirmed in official FAQ).
- **Standard library functions**: Licensed **per-function** with mixed licenses. Most use **LGPL with a special exception**: _"you may create a larger FAUST program which directly or indirectly imports this library file and still distribute the compiled code generated by the FAUST compiler...under your own copyright and license."_
- Many filter functions use **MIT-style STK-4.3 license** (fully permissive).
- **`demos.lib` functions are GPL-2+** — avoid importing these for commercial products.
- **Bottom line**: Using LGPL-excepted or STK-licensed library functions allows **fully commercial, closed-source distribution** of compiled WASM output.

### The faust2wam workflow

Three compilation paths exist:

**Static CLI compilation** (recommended for built-in plugins):

```bash
npx faust2wam mysynth.dsp output/
```

Generates: `dsp-module.wasm`, `dsp-meta.json`, `index.js` (WAM entry), `descriptor.json`, optionally `gui.js`.

**Export from Faust IDE**: At faustide.grame.fr, set Platform → "web", Architecture → "wam2-ts". Download a complete WAM plugin ZIP.

**Dynamic in-browser compilation** (for user-created plugins):

```javascript
const { default: generate } = await import('./faust2wam/dist/index.js');
const dspCode = await fetch('./mysynth.dsp').then((r) => r.text());
const WAM = await generate(dspCode, 'MySynth');
const instance = await WAM.createInstance(audioContext, {});
```

This requires `libfaust-wasm` (several MB) but enables live coding.

### Performance and bundle size

Faust-generated WASM runs at **~70–95% of native C++ speed** depending on the algorithm and browser. Chrome's V8 is typically fastest. A typical synth module compiles to **10–50 KB** of WASM. The native Faust→WASM backend (not Emscripten) produces tightly optimized code. Use the `-ftz` flag for flush-to-zero denormal protection, critical for recursive filters. Faust has **built-in polyphonic voice allocation** with MIDI support, handling voice stealing and allocation automatically.

**⚠️ Faust does not currently generate WASM SIMD instructions.** For SIMD-accelerated DSP, use Rust→WASM with explicit SIMD intrinsics.

---

## Open-source engines for every synthesis category

### Synthesizers

| Category              | Recommended Engine                                                   | License                         | WASM Status | Notes                                                                                                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------- | ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Subtractive**       | Faust `oscillators.lib` + `filters.lib`                              | LGPL+exception                  | ✅ Native   | PolyBLEP/DPW oscillators, Moog ladder/SVF/Korg35 filters, ADSR envelopes — everything needed                                                                                                                                                                                    |
| **FM**                | webdx7 (existing WAM) / Dexed `msfa` engine / Faust `synths.lib` DX7 | Apache-2.0 / LGPL+exception     | ✅ Ready    | webdx7 already runs as WASM WAM plugin. Dexed's core `msfa` engine is **Apache-2.0** (not GPL). Faust includes complete DX7 implementation with all 32 algorithms                                                                                                               |
| **Wavetable**         | Faust `rdtable`/`rwtable` + custom loader                            | LGPL+exception                  | ✅ Native   | Faust supports wavetable lookup primitives. Combine with JS-side wavetable loading. Casey Primozic demonstrated full wavetable synth in Rust→WASM                                                                                                                               |
| **Granular**          | Faust / Csound WASM / pd4web                                         | LGPL+exception / LGPL-2.1 / BSD | ✅          | Faust table-access primitives support granular patterns. Csound has mature granular opcodes (partikkel, grain3, fog). pd4web compiles existing Pd granular patches                                                                                                              |
| **Physical modeling** | STK / Faust `physmodels.lib`                                         | **MIT** / LGPL+exception        | ⚠️/✅       | STK (github.com/thestk/stk) is MIT-licensed, includes bowed string, brass, clarinet, flute, plucked string, sitar, percussion. Not yet compiled to WASM but pure C++ makes it straightforward. Faust `physmodels.lib` has waveguide + modal synthesis models, compiles natively |
| **Additive**          | Faust / FunDSP (Rust)                                                | LGPL+exception / MIT+Apache-2.0 | ✅          | Algorithmically simple (sum of sine partials). Both work well                                                                                                                                                                                                                   |

**GPL-licensed engines to avoid for commercial use**: Surge XT (GPL-3.0, no WASM port, no commercial exception), Vital (GPL-3.0, commercial license available via licensing@vital.audio), Helm (GPL-3.0), Odin2 (GPL-3.0), ZynAddSubFX (GPL-2.0+). None have existing WASM ports and all would require GPL distribution of the entire DAW.

**FunDSP** (Rust, `fundsp` crate v0.19, MIT/Apache-2.0) is the best permissively-licensed alternative for custom synthesis in Rust→WASM. It provides oscillators, SVF/Moog ladder/biquad filters, delays, reverb, granular synthesis, wavetable synthesis, oversampling, and FFT convolution. Compiles to very small WASM (~27 KB for a full FM synth with SIMD). Graph notation: `noise() >> lowpass_hz(1000.0, 1.0)`.

### Samplers

**sfizz** (github.com/sfztools/sfizz) is the **best sampler engine** — **BSD-2-Clause licensed**, with a proven WASM port at github.com/sfztools/sfizz-webaudio. Supports SFZ v1/v2 with ARIA extensions, sinc interpolation for high-quality resampling. The WASM version requires all samples loaded into virtual filesystem memory (no background streaming). For a drum machine, simple Web Audio `AudioBufferSourceNode` triggering is sufficient — no WASM needed.

**FluidSynth** for SF2 SoundFont playback is available as the `js-synthesizer` npm package (BSD-3-Clause wrapper around FluidSynth WASM, FluidSynth itself LGPL-2.1). Supports full SoundFont 2, MIDI event processing, AudioWorklet mode.

### Free sample libraries for bundling

| Library                       | License                 | Size                                   | Content                                                     |
| ----------------------------- | ----------------------- | -------------------------------------- | ----------------------------------------------------------- |
| **VSCO 2 Community Edition**  | **CC0 (Public Domain)** | ~1.9 GB WAV                            | 17 instruments: strings, brass, woodwinds, keys, percussion |
| **Salamander Grand Piano**    | CC-BY 3.0               | 24.5 MB (Light SF2) / 389 MB (Slender) | Yamaha C5, 7–16 velocity layers                             |
| **FreePats Acoustic Piano**   | **CC0 (Public Domain)** | Smaller                                | Yamaha Disklavier, fewer velocity layers                    |
| **Virtual Playing Orchestra** | Free (mixed sources)    | Varies                                 | Full orchestra, built from VSCO2 CE + other free sources    |

VSCO 2 CE's CC0 license means **no restrictions, no attribution, no royalties** — ideal for bundling. The ~1.9 GB size means it must be an optional download, not bundled in the installer. Salamander Light (24.5 MB SF2) is small enough to bundle as a default piano.

---

## Effects: when Web Audio API is enough and when WASM is needed

The Web Audio API provides several built-in processing nodes. Some are adequate for professional use; others have critical limitations that require WASM replacements.

| Effect                  | Web Audio Node                     | Professional Enough? | Limitation                                                                  | WASM Recommendation                               |
| ----------------------- | ---------------------------------- | -------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| **Convolution reverb**  | `ConvolverNode`                    | ✅ Yes               | Cannot change parameters in real-time                                       | Use for IR-based reverb                           |
| **Algorithmic reverb**  | None                               | ❌                   | —                                                                           | Faust `zita_rev1` or `dattorro_rev`               |
| **Simple delay**        | `DelayNode` + `GainNode`           | ✅ Yes               | No filtering/saturation in feedback                                         | Fine for clean echo                               |
| **Tape/granular delay** | None                               | ❌                   | —                                                                           | Faust `delays.lib` + custom                       |
| **Basic EQ**            | `BiquadFilterNode` chain           | ⚠️ Adequate          | **Cramping at high frequencies** (bilinear transform warping near Nyquist)  | Acceptable for most users                         |
| **Pro EQ**              | None                               | ❌                   | No linear-phase, no de-cramping                                             | WASM with matched biquad coefficients             |
| **Basic compression**   | `DynamicsCompressorNode`           | ⚠️ Limited           | **No sidechain, no lookahead, no hold, fixed soft knee, no stereo linking** | Utility-grade only                                |
| **Pro compression**     | None                               | ❌                   | —                                                                           | Faust `compressors.lib` (includes 1176 emulation) |
| **Brick-wall limiter**  | None                               | ❌                   | DynamicsCompressorNode lacks lookahead                                      | Faust limiter with lookahead                      |
| **Basic distortion**    | `WaveShaperNode`                   | ✅ Yes               | Built-in 2x/4x oversampling                                                 | Tanh/sigmoid curves work well                     |
| **Amp simulation**      | None                               | ❌                   | —                                                                           | iPlug2 Neural Amp Modeler or Faust                |
| **Chorus/flanger**      | `DelayNode` + `OscillatorNode`     | ✅ Basic             | Single-voice only                                                           | WASM for multi-voice/dimension chorus             |
| **Phaser**              | `BiquadFilterNode` (allpass) chain | ✅ Basic             | Limited feedback control                                                    | WASM for vintage emulations                       |

### Faust's effects library coverage

Faust's standard libraries provide production-ready implementations of every effect category. Key algorithms available in `reverbs.lib`, `compressors.lib`, `filters.lib`, `misceffects.lib`, `vaeffects.lib`, and `phaflangers.lib`:

- **Reverbs**: Freeverb, Zita-Rev1 (FDN by Fons Adriaensen), Dattorro plate, JPverb (lush/chorused), spring reverb emulation, Keith Barr allpass loop
- **Compressors**: Mono/stereo feed-forward compressor, 1176 limiter emulation, N-channel peak compression, expander/gate with hold
- **Filters**: Hundreds — Butterworth, Chebyshev, elliptic, Moog VCF, Korg35, SVF, TPT (topology-preserving transform), resonant, comb, allpass
- **Modulation**: Chorus, flanger, phaser, tremolo, autopan, vibrato
- **Distortion**: Cubic nonlinearity, virtual analog waveshaping, wah/crybaby
- **Virtual analog**: Full VA filter models (Moog, Korg, etc.) in `vaeffects.lib`

### C++ plugin frameworks with WASM support

**iPlug2** (github.com/iPlug2/iPlug2) has **first-class WASM support** via Emscripten — one of the earliest frameworks to target web. Both DSP and UI compile to browser. The WDL-style license is essentially free for any use. Used in production by Neural Amp Modeler, VirtualCZ, and 30+ Full Bucket Music plugins.

**DPF** (DISTRHO Plugin Framework, github.com/DISTRHO/DPF) has **active WASM support** with ISC license (extremely permissive). Lighter than iPlug2, good for simple effects.

---

## What genuinely requires Rust, not Web/WASM

Three areas demand native Rust code via Tauri IPC commands:

**Audio file decoding** is best handled by the `symphonia` Rust crate (3.2M+ downloads). It supports AAC, FLAC, MP3, MP4, OGG/Vorbis, WAV, AIFF, and more — consistently across all platforms. Web Audio's `decodeAudioData` varies by engine (WKWebView lacks OGG support), loads entire files into memory, and provides no streaming decode or gapless playback. Symphonia delivers **consistent format support**, streaming decode, sample-accurate seeking, and gapless playback.

**Disk streaming for large sample libraries** requires Rust native file I/O. IndexedDB has a practical **~2 GB limit** in many browsers, an async-only API with high overhead for random access, and is fundamentally unsuitable for streaming multi-GB orchestral libraries. Origin Private File System (OPFS) is newer but not universally supported in WebKitGTK. Rust provides direct `std::fs` access, memory-mapped files, random access, and no sandbox limitations — essential when VSCO 2 CE alone is 1.9 GB.

**Certain heavy DSP workloads** may exceed WASM's single-threaded AudioWorklet budget (~2.9 ms at 44.1 kHz). WASM in AudioWorklet runs on a **single audio processing thread** — you cannot spawn additional threads from within an AudioWorkletProcessor. Native Rust can use rayon/threads freely, use AVX2/512 SIMD (WASM is limited to 128-bit SIMD), and avoid WASM heap copy overhead. Specific cases: convolution reverb with very long impulse responses across multiple channels, FFT-heavy spectral processing, and complex physical modeling with many simultaneous bodies.

```
┌─────────────────────────────────────┐
│           Rust Backend              │
│  • symphonia: audio file decoding   │
│  • std::fs: sample library streaming│
│  • Heavy DSP: long convolution, FFT │
└──────────┬──────────────────────────┘
           │ Tauri IPC Commands
┌──────────▼──────────────────────────┐
│         WebView Frontend            │
│  • WAM Host (JS/TS)                │
│  • WAM Plugins (AudioWorklet+WASM) │
│  • Faust-generated DSP in WASM     │
│  • AudioContext + audio graph       │
│  • Plugin GUIs (React components)  │
└─────────────────────────────────────┘
```

---

## Complete plugin suite specification

### Instruments

| Plugin           | Type                   | Implementation                                  | Engine                                  | License                        |
| ---------------- | ---------------------- | ----------------------------------------------- | --------------------------------------- | ------------------------------ |
| **Analog Sub**   | Subtractive synth      | faust2wam                                       | Faust `oscillators.lib` + `filters.lib` | LGPL+exception ✅              |
| **FM Station**   | FM synth (DX7)         | Existing WAM or faust2wam                       | webdx7 / Faust `synths.lib` DX7         | Apache-2.0 / LGPL+exception ✅ |
| **Wave Table**   | Wavetable synth        | faust2wam + JS loader                           | Faust `rdtable` + custom wavetables     | LGPL+exception ✅              |
| **Grain Cloud**  | Granular synth         | faust2wam                                       | Faust custom granular DSP               | LGPL+exception ✅              |
| **String Model** | Physical modeling      | faust2wam or STK→WASM                           | Faust `physmodels.lib` / STK            | LGPL+exception / MIT ✅        |
| **Additive**     | Additive synth         | faust2wam                                       | Faust sine partials + envelopes         | LGPL+exception ✅              |
| **Sample One**   | SFZ sampler            | sfizz→WASM WAM wrapper                          | sfizz                                   | BSD-2-Clause ✅                |
| **Drum Kit**     | Drum machine           | Web Audio `AudioBufferSourceNode` + WAM wrapper | Native Web Audio                        | N/A ✅                         |
| **Keys**         | Piano/organ            | sfizz→WASM + Salamander/FreePats samples        | sfizz + CC0/CC-BY samples               | BSD-2-Clause ✅                |
| **Orchestra**    | Orchestral instruments | sfizz→WASM + VSCO2 CE                           | sfizz + VSCO2 CE                        | BSD-2-Clause + CC0 ✅          |

### Effects — Dynamics

| Plugin             | Implementation | Engine                                | Notes                                               |
| ------------------ | -------------- | ------------------------------------- | --------------------------------------------------- |
| **Compressor**     | faust2wam      | Faust `compressors.lib`               | Feed-forward, sidechain input, hold, stereo linking |
| **Limiter**        | faust2wam      | Faust limiter with lookahead          | Brick-wall, true peak                               |
| **Gate**           | faust2wam      | Faust expander/gate                   | Hold parameter, sidechain                           |
| **Multiband Comp** | faust2wam      | Faust crossover + per-band compressor | 3-4 band                                            |

### Effects — EQ and filters

| Plugin               | Implementation             | Engine                              | Notes                                    |
| -------------------- | -------------------------- | ----------------------------------- | ---------------------------------------- |
| **Parametric EQ**    | faust2wam                  | Faust `filters.lib` matched biquads | 4-8 bands, analyzer display via JS       |
| **Channel Strip EQ** | Web Audio BiquadFilterNode | Native Web Audio                    | Simple 3-band for quick use              |
| **Filter**           | faust2wam                  | Faust `vaeffects.lib`               | Moog/SVF/Korg resonant filter with drive |

### Effects — Time-based

| Plugin                 | Implementation                        | Engine                                | Notes                                       |
| ---------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------------- |
| **Delay**              | faust2wam                             | Faust `delays.lib`                    | Ping-pong, filtered feedback, sync to tempo |
| **Tape Delay**         | faust2wam                             | Faust delay + saturation + modulation | Wow/flutter, tape saturation in loop        |
| **Reverb**             | faust2wam                             | Faust `re.zita_rev1`                  | High-quality FDN algorithmic                |
| **Convolution Reverb** | Web Audio ConvolverNode + WAM wrapper | Native Web Audio                      | IR loading via Rust decode, bundled IRs     |
| **Spring Reverb**      | faust2wam                             | Faust `re.spring_reverb`              | Vintage spring tank emulation               |

### Effects — Modulation

| Plugin       | Implementation | Engine                  | Notes                             |
| ------------ | -------------- | ----------------------- | --------------------------------- |
| **Chorus**   | faust2wam      | Faust `misceffects.lib` | Multi-voice, dimension mode       |
| **Flanger**  | faust2wam      | Faust `phaflangers.lib` | Through-zero capable              |
| **Phaser**   | faust2wam      | Faust `phaflangers.lib` | 4-12 stage, feedback              |
| **Tremolo**  | faust2wam      | Faust `misceffects.lib` | Sync to tempo, multiple waveforms |
| **Auto-pan** | faust2wam      | Faust `misceffects.lib` | LFO-driven stereo panning         |

### Effects — Distortion

| Plugin         | Implementation                         | Engine                                  | Notes                                |
| -------------- | -------------------------------------- | --------------------------------------- | ------------------------------------ |
| **Saturation** | Web Audio WaveShaperNode + WAM wrapper | Native Web Audio                        | Tanh curve, 4x oversampling built in |
| **Overdrive**  | faust2wam                              | Faust asymmetric waveshaping            | Tube-style, tone control             |
| **Bitcrusher** | faust2wam                              | Faust sample rate + bit depth reduction | Simple DSP                           |

### Effects — Utility

| Plugin           | Implementation                                      | Engine             | Notes                                 |
| ---------------- | --------------------------------------------------- | ------------------ | ------------------------------------- |
| **Gain/Utility** | Web Audio GainNode + StereoPannerNode + WAM wrapper | Native Web Audio   | Gain, pan, phase invert, mono/stereo  |
| **Analyzer**     | Web Audio AnalyserNode + Canvas/WebGL               | Native Web Audio   | Spectrum, waveform, loudness metering |
| **Test Tone**    | faust2wam                                           | Faust oscillator   | Sine, white/pink noise, sweep         |
| **Tuner**        | Web Audio AnalyserNode + pitch detection            | JS autocorrelation | Chromatic tuner                       |

### MIDI Effects

All MIDI effects are WAM plugins with `hasMidiInput: true, hasMidiOutput: true, hasAudioInput: false, hasAudioOutput: false`. They process `wam-midi` events and emit transformed events downstream via `connectEvents()`.

| Plugin              | Implementation               | Notes                                     |
| ------------------- | ---------------------------- | ----------------------------------------- |
| **Arpeggiator**     | Pure JS WAM (no WASM needed) | Up/down/random/chord patterns, tempo sync |
| **Chord Generator** | Pure JS WAM                  | Maps single notes to chord voicings       |
| **Scale Filter**    | Pure JS WAM                  | Quantizes notes to selected scale + root  |
| **Velocity Curve**  | Pure JS WAM                  | Remaps velocity with custom curve         |
| **MIDI Delay**      | Pure JS WAM                  | Echoes MIDI notes with configurable delay |
| **Note Quantizer**  | Pure JS WAM                  | Snaps timing to grid divisions            |
| **Transpose**       | Pure JS WAM                  | Chromatic/scale-aware transposition       |
| **CC Map**          | Pure JS WAM                  | Maps CC numbers, scales ranges            |

MIDI effects require no WASM — they process lightweight MIDI byte arrays in JavaScript. Implement as `WamProcessor` subclasses that override `_onMidi()` and emit transformed events.

---

## Monorepo structure and plugin development workflow

### Directory layout

```
daw/
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
│
├── src-tauri/                      # Rust backend
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── audio_decode.rs         # symphonia-based decoding
│       └── sample_stream.rs        # disk streaming for samplers
│
├── apps/
│   ├── daw/                        # Main DAW frontend
│   │   ├── package.json
│   │   └── src/
│   │       ├── engine/             # Audio engine, track management
│   │       ├── host/               # WAM host (WamEnv, PluginLoader, PluginChain)
│   │       ├── transport/          # Playback, MIDI clock
│   │       ├── mixer/              # Mixing console
│   │       └── ui/                 # React UI components
│   │
│   └── plugin-host/                # Standalone minimal WAM host for testing
│       ├── package.json
│       └── src/                    # Loads one plugin, provides audio I/O
│
├── packages/
│   ├── core/                       # "@mydaw/core" — shared types
│   │   └── src/
│   │       ├── types/
│   │       │   ├── audio.ts
│   │       │   ├── midi.ts
│   │       │   └── plugin.ts       # PluginRegistryEntry, WamDescriptor extensions
│   │       └── utils/
│   │           ├── ringbuffer.ts    # SAB ring buffer for host↔plugin
│   │           └── midi.ts
│   │
│   ├── plugin-sdk/                 # "@mydaw/plugin-sdk" — base classes
│   │   └── src/
│   │       ├── BasePlugin.ts       # Extends WebAudioModule
│   │       ├── BaseProcessor.ts    # Extends WamProcessor
│   │       └── FaustPlugin.ts      # Base class for Faust-generated WAMs
│   │
│   └── ui-components/              # "@mydaw/ui" — shared knobs, faders, etc.
│
├── plugins/                        # Each plugin is a separate package
│   ├── synth-analog/
│   │   ├── package.json            # "@mydaw/plugin-synth-analog"
│   │   ├── descriptor.json
│   │   ├── dsp/
│   │   │   └── analog.dsp          # Faust source
│   │   ├── src/
│   │   │   ├── index.ts            # WAM entry point
│   │   │   ├── processor.ts        # Wraps Faust WASM
│   │   │   └── gui.tsx             # React GUI
│   │   └── dist/                   # Built: index.js, dsp-module.wasm, descriptor.json
│   │
│   ├── eq-parametric/
│   ├── compressor/
│   ├── reverb-algo/
│   ├── delay/
│   ├── sampler-sfz/
│   ├── arpeggiator/
│   └── ...
│
├── faust/                          # Shared Faust DSP library
│   ├── lib/                        # Custom .lib files shared across plugins
│   └── scripts/
│       └── build-faust.sh          # faust2wam build script
│
└── tools/
    ├── plugin-template/            # Scaffold for new plugins
    └── tsconfig/                   # Shared TypeScript configs
```

### Workspace configuration

```yaml
# pnpm-workspace.yaml
packages:
    - 'apps/*'
    - 'packages/*'
    - 'plugins/*'
```

```json
// turbo.json
{
    "$schema": "https://turbo.build/schema.json",
    "pipeline": {
        "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
        "build:faust": { "outputs": ["dist/dsp-module.wasm", "dist/dsp-meta.json"] },
        "dev": { "cache": false, "persistent": true },
        "test": { "dependsOn": ["build"] }
    }
}
```

```json
// Root package.json scripts
{
    "scripts": {
        "dev": "turbo dev --filter=daw",
        "dev:plugin": "turbo dev --filter=$PLUGIN --filter=plugin-host",
        "build": "turbo build",
        "build:plugins": "turbo build --filter='./plugins/*'",
        "new-plugin": "node tools/plugin-template/create.js"
    }
}
```

### Plugin development and testing in isolation

Each plugin package has its own `dev` script that launches the standalone `plugin-host` app with only that plugin loaded. This lets developers iterate on a single plugin without running the full DAW:

```bash
# Develop the compressor plugin in isolation
pnpm dev:plugin --filter=@mydaw/plugin-compressor

# This runs: plugin-host (minimal WAM host) + hot-reloads the compressor plugin
```

The `plugin-host` app is a minimal HTML page with an AudioContext, WAM environment, file input (for test audio), and a container for the plugin GUI. It loads a single WAM plugin specified via URL parameter.

### Faust plugin build pipeline

For Faust-based plugins, the build pipeline compiles `.dsp` → WASM → WAM:

```json
// plugins/reverb-algo/package.json
{
    "scripts": {
        "build:faust": "faust2wam dsp/reverb.dsp dist/",
        "build": "pnpm build:faust && vite build",
        "dev": "pnpm build:faust && vite dev"
    }
}
```

For non-Faust plugins (pure JS MIDI effects, Web Audio wrapper plugins), the build is just standard Vite/TypeScript compilation.

---

## Key integration code patterns

### Faust WAM plugin entry point

```typescript
// plugins/synth-analog/src/index.ts
import { WebAudioModule } from '@webaudiomodules/sdk';

export default class AnalogSynth extends WebAudioModule {
    static descriptor = {
        identifier: 'com.mydaw.synth-analog',
        name: 'Analog Sub',
        vendor: 'MyDAW',
        version: '1.0.0',
        apiVersion: '2.0.0',
        isInstrument: true,
        hasAudioInput: false,
        hasAudioOutput: true,
        hasMidiInput: true,
        hasMidiOutput: false,
    };

    async initialize(state?: any) {
        await this.createAudioNode();
        if (state) await this.setState(state);
        return this;
    }

    async createAudioNode() {
        // Load Faust WASM module into AudioWorklet
        await this.audioContext.audioWorklet.addModule(new URL('./processor.js', import.meta.url));
        const node = new AudioWorkletNode(this.audioContext, 'analog-synth-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });
        this._audioNode = node;
        return node;
    }

    async createGui(): Promise<HTMLElement> {
        const { default: createGui } = await import('./gui.js');
        return createGui(this);
    }
}
```

### MIDI effect plugin (pure JS, no WASM)

```typescript
// plugins/arpeggiator/src/processor.ts
import { WamProcessor } from '@webaudiomodules/sdk';

class ArpeggiatorProcessor extends WamProcessor {
    private heldNotes: number[] = [];
    private step = 0;

    _process() {
        return true;
    } // pass audio through

    _onMidi(e: { bytes: [number, number, number] }) {
        const [status, note, vel] = e.bytes;
        if ((status & 0xf0) === 0x90 && vel > 0) {
            this.heldNotes.push(note);
            this.heldNotes.sort((a, b) => a - b);
        } else if ((status & 0xf0) === 0x80) {
            this.heldNotes = this.heldNotes.filter((n) => n !== note);
        }
    }

    _onTransport(data: any) {
        if (!data.playing || this.heldNotes.length === 0) return;
        const note = this.heldNotes[this.step % this.heldNotes.length];
        this.step++;
        this.emitEvents({ type: 'wam-midi', data: { bytes: [0x90, note, 100] }, time: currentTime });
    }
}
```

### Rust audio decoding via Tauri IPC

```rust
// src-tauri/src/audio_decode.rs
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::probe::Hint;

#[tauri::command]
async fn decode_audio_file(path: String) -> Result<Vec<f32>, String> {
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(&path).extension() {
        hint.with_extension(&ext.to_string_lossy());
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &Default::default())
        .map_err(|e| e.to_string())?;
    let mut format = probed.format;
    let track = format.default_track().ok_or("no audio track")?;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;
    let mut samples = Vec::new();
    while let Ok(packet) = format.next_packet() {
        let decoded = decoder.decode(&packet).map_err(|e| e.to_string())?;
        let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        buf.copy_interleaved_ref(decoded);
        samples.extend_from_slice(buf.samples());
    }
    Ok(samples)
}
```

---

## Technology stack summary with confidence levels

| Component                | Technology                              | Status                                 | Confidence                            |
| ------------------------ | --------------------------------------- | -------------------------------------- | ------------------------------------- |
| Plugin standard          | WAM 2.0 (`@webaudiomodules/sdk` 0.0.12) | Stable, MIT                            | ✅ High                               |
| DSP language             | Faust → faust2wam                       | Production, LGPL+exception             | ✅ High                               |
| Synth DSP                | Faust standard libraries                | Production, 20+ years                  | ✅ High                               |
| FM engine (alt)          | webdx7 / Dexed msfa                     | Working WAM / Apache-2.0               | ✅ High                               |
| Physical modeling (alt)  | STK                                     | Production, MIT, needs WASM compile    | ⚠️ Medium — compilation untested      |
| SFZ sampler              | sfizz → WASM                            | Working demo, BSD-2-Clause             | ✅ High                               |
| SF2 player               | FluidSynth WASM (`js-synthesizer`)      | Working, LGPL-2.1                      | ✅ High                               |
| Audio decode             | Rust symphonia via Tauri IPC            | Production, 3.2M+ downloads            | ✅ High                               |
| Disk streaming           | Rust native file I/O via Tauri          | Standard Rust                          | ✅ High                               |
| Custom Rust DSP          | FunDSP crate → WASM                     | Working, MIT/Apache-2.0                | ⚠️ Medium — less ecosystem than Faust |
| Simple effects           | Web Audio API nodes                     | Standard, universal                    | ✅ High                               |
| Orchestral samples       | VSCO 2 CE                               | CC0, proven quality                    | ✅ High                               |
| WebView compat (macOS)   | WKWebView                               | All APIs supported                     | ✅ High                               |
| WebView compat (Windows) | WebView2/Chromium                       | All APIs supported                     | ✅ High                               |
| WebView compat (Linux)   | WebKitGTK                               | SAB requires 2.40+, AudioWorklet 2.36+ | ⚠️ Medium — oldest distros may fail   |

### Explicit flags for what does NOT work

- **SharedArrayBuffer on WebKitGTK < 2.40**: Broken or disabled. WAM degrades to MessagePort (higher latency).
- **OGG/Opus in WKWebView**: Not supported. Use WAV/FLAC/MP3/AAC for all sample content.
- **WASM threads in AudioWorklet**: Cannot spawn pthreads from within AudioWorkletProcessor on any engine. Heavy parallel DSP must use separate Worker threads + SAB ring buffers, or Rust backend.
- **Faust WASM SIMD**: Faust does not generate WASM SIMD instructions. For SIMD-critical paths, use Rust→WASM with explicit intrinsics.
- **sfizz WASM disk streaming**: Background sample loader is disabled in WASM build. All samples must fit in memory.
- **WAM plugins in WebKit browsers**: Most WAM developers test only Chrome. Reports indicate functional issues in WebKit-based browsers. Budget time for compatibility testing and fixes.
- **`console.log` in AudioWorklet on Safari**: Does not work. Use `port.postMessage()` for debugging on macOS.
- **`demos.lib` in Faust**: Licensed GPL-2+ — do not import any `demos.lib` functions in commercial plugins. Use the underlying library functions directly from `filters.lib`, `reverbs.lib`, etc.

## Conclusion

The architecture converges on a clear stack: **Faust→faust2wam for DSP, WAM 2.0 for the plugin API, sfizz for sample playback, Rust for file I/O and decode**. This combination provides commercial-friendly licensing throughout (LGPL+exception, BSD-2-Clause, MIT, Apache-2.0, CC0), avoids GPL contamination, and works across all three Tauri WebView engines with known WebKitGTK caveats.

The most impactful architectural decision is making every built-in plugin a WAM 2.0 plugin. This creates a single code path for built-in and third-party plugins, standardizes parameter automation and state management, and means every plugin developed for the DAW is automatically distributable as a standalone WAM. Faust's library coverage is comprehensive enough that an AI coding agent can implement the entire effects suite (reverb, compression, EQ, delay, chorus, phaser, distortion, limiting) plus multiple synthesizer types (subtractive, FM, wavetable, physical modeling, additive) from existing, well-tested DSP algorithms — each compiling to a compact WASM module in the tens-of-kilobytes range. The only components requiring Rust backend support are audio file decoding (symphonia), large sample library streaming (native file I/O), and potentially convolution reverb with very long impulse responses that exceed the ~2.9 ms AudioWorklet render quantum budget.
