# AudioEngine module — Agent Guidelines

WebAudio graph runtime: hosts every release-admitted built-in device as a WASM engine node, plus the buffer cache
(`stores/audioBufferCache.ts`), recording, and metering.

Device id "Dutch Oven" is the ProofChamber reverb — there is no separate Dutch Oven module.

## WASM device pipeline

- Device DSP lives in Rust crates and compiles to WASM: `pnpm wasm:all` runs
  `wasm-pack --target web` for `crates/{daw-dsp,proof-chamber,scoring,daw-wasm-decoder}` into
  `public/wasm/`. The `scripts/gen-*-worklet.ts` post-processors rewrite the wasm-pack JS glue into
  `src/modules/AudioEngine/wasm/`, prepending AudioWorklet-scope polyfills and replacing
  `new URL(..., import.meta.url)` with a static path so Vite does not bundle the `.wasm`. Re-run
  the `wasm:*` script after changing a crate; never hand-edit files under `AudioEngine/wasm/`.
- Grand Boule remains complete native Rust and TypeScript host source, but the complete Rust module
  is absent from the `wasm32` crate graph. The host stack imports a local structural interface and an
  inert production construction seam; focused tests inject in-memory instances at that seam.
- The main thread revalidates, fetches and asynchronously compiles each WASM URL once. A
  short-lived module lease is released on abort or host-construction failure; successful host
  construction commits one URL per bundle to the `AudioContext`, because wasm-bindgen glue is a
  realm singleton. Loading another version after that requires a fresh context and is rejected
  instead of silently retaining the old binary.
- AudioWorklet processors receive the structured-cloned `WebAssembly.Module` through
  `processorOptions`; the retained Grand Boule host follows the same transport shape in focused
  tests. A separate port init message starts caught instantiation and the ready/error handshake.
  Processors call `initSync` and compile nothing on their real-time-adjacent threads. Shared module
  caching and handshake logic live in `src/infra/audioWorklet/workletInitShared.ts`.
- Crumbs disk streaming is native-only ([daw-dsp](../../../crates/daw-dsp/AGENTS.md)). Browser
  playback and offline rendering run the same Crumbs engine in WASM, with decoded PCM preloaded
  into its in-memory sample pool.

## Runtime boundaries

- Worklets import nothing from app modules, helpers, or desktop IPC. The depcruise `worklets-no-*`
  rules are **error** but match `src/modules/<M>/worklets/**` only, so they do not reach the raw
  processors in `public/audio/worklets/` — there the isolation is yours to hold, unchecked.
  `worker.format: 'iife'` in `vite.config.ts` is what lets worklet blob URLs load bundles — don't
  change it casually.
- One live `AudioContext` app-wide.
- Faust is wired here and in PluginHost. Change one, check the other.
- Native-plugin bridge worklets are raw JS in `public/audio/worklets/`, separate from the WASM
  glue.
