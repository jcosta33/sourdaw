---
type: research
id: RESEARCH-performance-budgets-profiling
title: Architecture and performance gaps vs native-DAW expectations
status: open
owner: The Sourdaw team
sources:
  - Consolidated architecture & performance research vs current codebase
---

# Research: Architecture and performance gaps vs native-DAW expectations

## Question

Which architecture and performance capabilities expected of a professional native
DAW are missing, incomplete, or implemented differently in Sourdaw — and where
does keeping work in Rust (vs Web APIs) materially change reliability or
performance?

## Findings

### R-001 — Plugin hosting must live entirely in Rust

- **Claim:** No browser API can load native audio plugins; the full hosting stack
  (CLAP via `clack`, VST3 via the MIT/Apache `vst3`/coupler-rs, out-of-process
  sandboxing via shared memory) belongs in Rust.
- **Evidence:** `crates/daw-plugin-host/` is empty; `crates/daw-engine/src/scheduler.rs`
  has stubs/placeholders for `NativePlugin` processing, with no real
  instantiation, native-window GUI hosting, or sandboxing.
- **Confidence:** medium
- **Bears on:** the plugin-hosting feature and where its boundary sits.

### R-002 — Audio file I/O and offline bounce should be Rust, not Web APIs

- **Claim:** Rust-side decode (`symphonia`) / encode (`hound`, etc.) and parallel
  stem bounce (`rayon`) give deterministic, bit-perfect output and avoid WebKit
  `OfflineAudioContext` limits (44.1 kHz min, 10-channel max).
- **Evidence:** The frontend relies on `OfflineAudioContext` for bouncing/export
  (`ExportDialog.tsx`, `handleAiDenoiseClip.ts`); Rust-native decode/encode and
  parallel stem export are missing.
- **Confidence:** medium
- **Bears on:** export determinism budget and the offline-render path.

### R-003 — Multi-track / step / count-in recording gaps

- **Claim:** `getUserMedia` on WebKit caps capture at stereo; professional
  multi-channel recording needs CoreAudio/JACK/PipeWire via Rust writing to disk
  through lock-free rings (`rtrb` + `hound`). Step recording and count-in are
  also expected.
- **Evidence:** Capture is routed through a JS `RecordingWorkletProcessor`; native
  multi-track-to-disk recording, step recording, and count-in are unimplemented.
- **Confidence:** medium
- **Bears on:** the recording workflow and its latency/jitter profile.

### R-004 — MIDI effects pipeline, MPE, and clock

- **Claim:** A pre-instrument MIDI effects pipeline (arpeggiator, velocity
  scaling, groove quantize), per-note probability, an MPE channel allocator, and
  sample-accurate MIDI clock (`0xF8`) driven by the audio callback are expected.
- **Evidence:** `midir` handles basic I/O; none of the advanced features exist —
  no MIDI FX pipeline, no probability triggering, no MPE allocator, no clock
  generator on the audio thread.
- **Confidence:** medium
- **Bears on:** MIDI-engine scope and its audio-thread budget.

### R-005 — Waveform peak data belongs in Rust

- **Claim:** O(n) peak/RMS computation should be pre-computed as multi-resolution
  `PeakPair { min, max }` mipmaps in Rust and streamed as a raw `ArrayBuffer` via
  `tauri::ipc::Response`.
- **Evidence:** Multi-resolution peak caching and binary IPC transfer are missing.
- **Confidence:** medium
- **Bears on:** waveform-rendering performance and the peak-cache feature.

### R-006 — Broadcast metering needs `ebur128`

- **Claim:** `AnalyserNode` lacks true-peak and LUFS measurement; broadcast-grade
  metering needs the pure-Rust `ebur128`, streamed ~30 fps via Tauri Channel.
- **Evidence:** `ebur128` and native true-peak/LUFS metering are missing from the
  Rust backend.
- **Confidence:** medium
- **Bears on:** loudness-metering requirements and the metering data path.

### R-007 — DAWproject interchange and single-file bundles

- **Claim:** Cross-DAW `DAWproject` (XML/ZIP) interoperability and single-file
  `.odaw`-style ZIP bundles (project + audio assets) are expected.
- **Evidence:** `daw-collab` provides a document store, but bundle export and
  DAWproject interop are missing.
- **Confidence:** medium
- **Bears on:** the interchange/export-provenance features.

### R-008 — Neural Amp Modeling inference

- **Claim:** Real-time NAM capture inference (WASM) is a flagship guitarist
  feature.
- **Evidence:** `Grinder` (amp simulator in `daw-dsp`) exists, but NAM network
  inference integration is missing.
- **Confidence:** medium
- **Bears on:** the Grinder neural-model track.

### R-009 — Controller learning and routing visualization

- **Claim:** Hardware MIDI CC → automatable-parameter mapping, and a
  force-directed node graph (`d3-force`) for track/bus/device routing, are
  expected.
- **Evidence:** Both are missing.
- **Confidence:** medium
- **Bears on:** controller-ecosystem and node-view features.

### R-010 — Ableton Link tempo sync

- **Claim:** Beat/tempo/phase sync needs UDP multicast via `rusty_link` (GPL-2.0+
  license constraint to weigh).
- **Evidence:** Completely missing.
- **Confidence:** medium
- **Bears on:** transport-sync interop and its licensing decision.

### R-011 — Already-present performance foundations and likely gaps

- **Claim:** Tauri v2, `rtrb` rings, `cpal` native audio, `wasm-bindgen`, and
  WebWorker audio isolation are in place; advanced optimizations
  (`std::simd`, strict `audio_thread_priority`, `mimalloc`, hardware-accelerated
  FFT) are likely missing and need auditing. SoundFont `.sf2` playback (e.g.
  `rustysynth`) is also missing.
- **Evidence:** Codebase annotation; SIMD/allocator/FFT items flagged as
  unverified-but-likely-missing; no `.sf2` path.
- **Confidence:** low
- **Bears on:** which performance optimizations are worth a profiled budget.

## Open questions

- [ ] Q-001 — Which of R-011's "likely missing" optimizations (SIMD, mimalloc,
  hardware FFT) are actually absent? Each needs a code/dependency check before it
  enters a performance budget.
- [ ] Q-002 — For each Web-API-backed path (export, recording), is the WebKit
  limit a real release blocker, or acceptable for the web build with the Rust path
  reserved for native? This decides how much moves to Rust.
- [ ] Q-003 — What are the numeric performance targets (latency, peak-cache
  render time, metering fps) the budgets should gate against?

## Recommendation

A performance spec needs measured baselines before targets: Q-003 must be
answered first. The Rust-vs-Web boundary (R-001–R-006) is the dominant
architectural lever — keeping audio I/O, peak computation, metering, and plugin
hosting in Rust is the recurring recommendation, justified by determinism and
WebKit limits rather than by raw speed alone. The optimization items in R-011 are
low-confidence until verified (Q-001) and should not be budgeted on assumption.
