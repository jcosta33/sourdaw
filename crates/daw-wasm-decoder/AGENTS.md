# crates/daw-wasm-decoder — Agent Guidelines

WebAssembly-compiled audio decoder wrapping `daw-io` Symphonia codecs for browser environments (`public/wasm/daw-wasm-decoder`).

## Domain Ownership

- Owns in-browser decoding of compressed and uncompressed audio containers (`WAV`, `FLAC`, `MP3`, `OGG`, `AAC`, `AIFF`) into planar `f32` sample buffers.
- Compiles via `wasm-pack` (`pnpm wasm:decoder`).
- Does not own browser audio buffer caching (`AudioEngine/stores/audioBufferCache`) or native disk streaming.

## Invariants & Traps

- **Panic Hooks**: Uses `console_error_panic_hook` in WASM targets to surface readable diagnostic traces rather than opaque unreachable traps.
- **Memory Management**: Decoded output buffers passed across the WASM boundary to JavaScript must release heap memory cleanly to prevent browser tab leaks during heavy sample importing.
- **WASM Freshness**: Any change to `daw-wasm-decoder` or its `daw-io` dependency requires running `pnpm wasm:decoder` and updating `scripts/gen-wasm-manifest.ts`.

## Verification

```bash
pnpm wasm:decoder
pnpm wasm:verify
```
