# crates/daw-io — Agent Guidelines

Audio file decoding, format transcoding, and disk streaming primitives for native Sourdaw pipelines and WASM decoder bridges.

## Domain Ownership

- Owns format decoding and sample unpacking via Symphonia (`WAV`, `FLAC`, `MP3`, `OGG`, `AAC`, `AIFF`).
- Owns audio stream chunking and conversion between interleaved bytes and planar `f32` buffers.
- Does not own browser-specific WebAudio decoding or real-time graph dispatch (`daw-engine`).

## Invariants & Traps

- **Non-RT Execution**: File I/O and codec decoding operate on background thread pools or worker realms; never invoke decoder routines on real-time audio callback threads.
- **WASM Compatibility**: Core decoding routines must maintain strict compatibility with `daw-wasm-decoder` (WASM target without native filesystem bindings).
- **Buffer Safety**: Stream decoders must pre-allocate memory based on reported audio duration/channels with bounded allocation limits against malformed or malicious audio container headers.

## Verification

```bash
cargo test --package daw-io
```
