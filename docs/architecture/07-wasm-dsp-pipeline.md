# WASM DSP Pipeline

Sourdaw's built-in device DSP is written in Rust and compiled twice: natively (linked into the Tauri backend) and to WebAssembly (for AudioWorklet processors in the browser engine). This document describes the WASM half of that pipeline — build, codegen, loading — and its traps.

It complements:

- `Rust Backend Architecture` — crate topology and the native side
- `src/modules/AudioEngine/AGENTS.md` — the engine's operational rules
- `crates/daw-dsp/AGENTS.md` — DSP crate conventions

---

## 1. Build pipeline

```text
crates/daw-dsp, proof-chamber, scoring, daw-wasm-decoder
        │  pnpm wasm:all  (wasm-pack build --target web)
        ▼
public/wasm/<crate>/            wasm-bindgen JS glue + *_bg.wasm
        │  scripts/gen-*-worklet.ts
        ▼
src/modules/AudioEngine/wasm/   worklet-loadable glue (committed)
        │  initSync({ module }) with a precompiled module
        ▼
AudioWorklet processors         services/*Processor.ts, workers/*EngineWorker.ts
```

The `wasm:*` scripts (`package.json`) run `wasm-pack` per crate into `public/wasm/`, then a generator script rewrites the glue for the worklet environment:

- Prepends AudioWorklet-scope polyfills (`TextDecoder`/`TextEncoder`/`FinalizationRegistry` — absent in worklet scope).
- Replaces `new URL('*_bg.wasm', import.meta.url)` with a static path so Vite does not try to bundle the `.wasm` out of `src/`.

Never hand-edit files under `src/modules/AudioEngine/wasm/` — regenerate via the matching `wasm:*` script. `wasm:all` builds all four crates.

## 2. Loading at runtime

Worklets cannot fetch asynchronously at construction time, so the main thread fetches and asynchronously compiles each URL once through `fetchWasmModule`. Public WASM assets currently have stable filenames, so the first request revalidates the HTTP cache (`cache: 'no-cache'`) to prevent fresh generated glue from loading a stale binary; the in-memory promise still performs only one request and compilation per runtime URL. Each acquisition holds a short-lived version lease: aborting the request or failing host construction releases it, while a successful handoff to an `AudioWorkletNode` or Worker commits one URL for each generated-glue bundle (`daw-dsp`, `proof-chamber`, `scoring`) to the `AudioContext`. wasm-bindgen initialization is a realm singleton, so attempting to mix bundle versions after that fails explicitly and a version change requires a fresh context. A failed fetch or compilation also releases the claim so recovery can use the same or a replacement URL. Each `AudioWorkletNode` supplies the resulting structured-cloneable `WebAssembly.Module` in `processorOptions`; GrandBoule supplies it in the worker's init message. A separate port init message starts caught instantiation and the ready/error handshake. Both processor kinds call `initSync({ module: wasmModule })` without synchronous compilation on their real-time-adjacent threads. Sourdaw targets current Chrome, where compiled modules cross these same-agent-cluster boundaries; there is deliberately no byte-transfer fallback that would restore per-instance compilation. The shared handshake — per-context worklet registration and bundle-version ownership, URL-keyed module cache, and ready/error/timeout protocol — lives in `src/infra/audioWorklet/workletInitShared.ts` and is used by every WASM-backed `create*Node` factory in AudioEngine (the native-plugin bridge excepted).

Each DSP crate exports `#[wasm_bindgen]` instance structs (`FermenterInstance`, `ToasterInstance`, `GrinderInstance`, `GrandBouleInstance`, `KneadInstance`, `LevainInstance`, `BacteriaInstance`, `GlutenInstance`, `CrumbsInstance`, `ProofInstance` from daw-dsp; `ProofChamberInstance` from proof-chamber; `ScoringInstance` from scoring). The engine instantiates them per device through `wasmDeviceRegistry.ts`.

## 3. What runs where

| Crate                  | WASM | Native | Notes                                                                                         |
| ---------------------- | ---- | ------ | --------------------------------------------------------------------------------------------- |
| daw-dsp (10 engines)   | ✓    | ✓      | Crumbs disk streaming is native-only; WASM uses a preloaded in-memory sample pool             |
| proof-chamber (reverb) | ✓    | —      | WASM-only crate; "Dutch Oven" device id                                                       |
| scoring (tuner)        | ✓    | —      | WASM-only crate; passthrough audio + telemetry                                                |
| daw-wasm-decoder       | ✓    | —      | main-thread decode for codecs `decodeAudioData` can't handle (ALAC, m4a, FLAC/OGG edge cases) |

`daw-wasm-decoder` has no worklet generator — it is used on the main thread where async fetch is fine.

## 4. Traps

- **Worklet isolation.** Worklet code may not import app/helpers/Tauri (`worklets-no-*` depcruise rules — currently forward-looking: they match `src/modules/<M>/worklets/**` only; the 3 raw JS processors in `public/audio/worklets/` sit outside those paths).
- **`worker.format: 'iife'`** in `vite.config.ts` exists so worklet blob URLs can load bundles. Changing it breaks worklet loading in non-obvious ways.
- **Two Faust integration points** — AudioEngine and PluginHost both use `@grame/faustwasm` (`public/faust/`). Check both before touching Faust wiring.
- **Allocation.** The Rust side of this pipeline is held to an alloc-free audio path, test-proven via `assert_no_alloc` in daw-dsp. The WASM target is not an exemption.

## References

- `src/modules/AudioEngine/AGENTS.md` — operational rules and node wiring
- `crates/daw-dsp/AGENTS.md` — engine authoring rules
- `.agents/skills/web-audio-engine/SKILL.md` — RT safety and graph discipline
