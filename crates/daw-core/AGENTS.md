# crates/daw-core — Agent Guidelines

Core audio domain primitives, numeric identifiers (TrackId, ClipId, PluginInstanceId), musical timing (Beats, SampleRate, Samples), and pitch tuning models (A4Reference, TuningSystem).

## Domain Ownership

- Owns foundational value types and IDs shared across native Rust crates.
- Pure Rust crate with minimal dependencies (serde).
- Does not own DSP rendering (daw-dsp), engine execution (daw-engine), or audio file I/O (daw-io).

## Invariants & Traps

- Pure Data & Arithmetic: No heap allocations during ID conversions; all types implement Copy or Clone and remain zero-cost abstractions.
- Identifier Stability: String and numeric identifier serialization must preserve deterministic formatting across FFI, CRDT, and JSON bridges.
- Dependency Isolation: Must remain completely free of platform, audio driver, or WebAudio dependencies.

## Verification

```bash
cargo test --package daw-core
```
