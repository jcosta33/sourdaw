# crates/daw-engine — Agent Guidelines

Real-time audio processing graph, CPAL/WASAPI device drivers, audio thread priority management, and lock-free host communication.

## Domain Ownership

- Owns OS audio device streams (CPAL / Windows IAudioClient3/WASAPI; ADR 0027), audio callback loops, and real-time graph dispatch.
- Owns lock-free SPSC communication rings (`rtrb`, `triple_buffer`) between control and audio threads.
- Does not own plugin binary discovery or scanning (`daw-plugin-host`), file decoding (`daw-io`), or frontend WebAudio graphs (`src/modules/AudioEngine`).

## Real-Time Invariants (Hard)

- **Zero Allocation & Zero Locks**: Audio render callbacks (`audio_thread.rs`) must execute with zero heap allocations, zero mutex locks, and zero blocking syscalls (`assert_no_alloc` in debug tests).
- **Headroom over Latency**: SPSC ring buffers must decouple the audio callback from asynchronous command processing without dropping blocks before native plugins process them.
- **Teardown Order**: Audio streams must stop and drain before dropping downstream DSP nodes or CLAP plugin instances.

## Verification

```bash
cargo test --package daw-engine
```
