# AudioEngine module — Agent Guidelines

WebAudio graph runtime: hosts every built-in device as a WASM engine node, plus buffer cache (`stores/audioBufferCache.ts`), recording, and metering. Contract barrels follow the root module rules.

## WASM device pipeline

- Device DSP lives in Rust crates and is compiled to WASM: `pnpm wasm:all` runs `wasm-pack --target web` for `crates/{daw-dsp,proof-chamber,scoring,daw-wasm-decoder}` into `public/wasm/`.
- Post-processors `scripts/gen-*-worklet.ts` rewrite the wasm-pack JS glue into `src/modules/AudioEngine/wasm/` — they prepend AudioWorklet-scope polyfills and replace `new URL(..., import.meta.url)` with a static path so Vite doesn't bundle the `.wasm`. Re-run the `wasm:*` script after changing a crate; never hand-edit files under `AudioEngine/wasm/`.
- The main thread fetches and asynchronously compiles each WASM URL once. AudioWorklet processors receive the structured-cloned `WebAssembly.Module` through `processorOptions`; the GrandBoule worker receives it in its init message. A separate port init message starts caught instantiation and the ready/error handshake, and both processor kinds call `initSync` without compiling on their real-time-adjacent threads. Shared module caching and handshake logic live in `src/infra/audioWorklet/workletInitShared.ts`.
- Device id "Dutch Oven" = the ProofChamber reverb — there is no separate Dutch Oven module.
- Crumbs (sampler) is **native-only** — its engine runs in the Rust backend via `crumbs_*` Tauri commands, not WASM.

## Traps

- `public/wasm/dutch-oven/` and `public/wasm/gluten/` (and `scripts/gen-dutch-oven-worklet.ts`) are **legacy outputs with no build script** — superseded by `proof-chamber` / `daw-dsp`. Don't wire new code against them.
- Worklets stay isolated: no imports from app/helpers/Tauri (deps **error** rule). `worker.format: 'iife'` in `vite.config.ts` exists so worklet blob URLs can load bundles — don't change it casually.
- One live `AudioContext` app-wide (root always-on rules). Audio-thread code must not allocate, lock, or block.
- App composition selects one boot-time latency profile before importing AudioEngine: `low-latency` requests Chrome's `interactive` hint and `high-capacity` requests `playback`. Chrome owns the actual buffering; report `baseLatency`, `outputLatency`, and sample rate instead of inventing buffer sizes. Profile changes apply only after reload.
- Faust has **two** integration points: this module and PluginHost — check both before changing Faust wiring.
- Native-plugin bridge worklets are raw JS in `public/audio/worklets/` (3 processors), separate from the WASM glue.
