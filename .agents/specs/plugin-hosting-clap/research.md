---
type: research
id: RESEARCH-plugin-hosting-clap
title: Native plugin hosting, DSP, web platform, and export
status: open
owner: The Sourdaw team
sources:
  - Consolidated plugins & hosting research vs current codebase
---

# Research: Native plugin hosting, DSP, web platform, and export

## Question

How should Sourdaw host native audio plugins (CLAP vs VST3, sandboxing,
thread priority), and which DSP-engine, web-platform, and offline-export pieces
are present vs missing relative to a professional native DAW?

## Findings

### R-001 — CLAP via `clack-host` as the primary integration path

- **Claim:** CLAP hosted through `clack-host` is the better primary path because
  it is feature-complete and offers a safe Rust abstraction; raw VST3 FFI/COM is
  brittle and unsafe and fits a later phase.
- **Evidence:** `clack-host` and `clap-sys` are listed in `Cargo.toml`, but the
  implemented path leans on a custom `Vst3Wrapper` using `libloading` at
  `src/host/vst3_wrapper.rs` to load `.vst3` bundles directly.
- **Confidence:** medium
- **Bears on:** whether the spec adopts CLAP-first hosting and what becomes of the
  hand-rolled VST3 wrapper.

### R-002 — Out-of-process sandboxing as an isolation option

- **Claim:** Professional hosts (e.g. Bitwig) run plugins in separate processes
  with configurable isolation; a host can start in-process and place the plugin
  interface behind a trait implementable as in- or out-of-process IPC
  (`shared_memory`, `shmem-ipc`, `nix`).
- **Evidence:** External research; no out-of-process plugin path observed in the
  codebase.
- **Confidence:** medium
- **Bears on:** crash-isolation requirements and the plugin-interface trait shape.

### R-003 — Real-time audio thread priority

- **Claim:** The audio thread should request real-time priority via the
  `audio_thread_priority` crate.
- **Evidence:** `audio_thread_priority` is absent from project dependencies.
- **Confidence:** medium
- **Bears on:** scheduling reliability of the native audio callback.

### R-004 — Missing DSP engines, samplers, and disk streaming

- **Claim:** Several DSP/synthesis building blocks are missing: `mi-plaits-dsp-rs`
  (24-engine Plaits port), the FAUST→Rust pipeline, `creek` (realtime-safe disk
  streaming), a Rust SFZ parser (none exists standalone), and time-stretching
  (`signalsmith-stretch` / `tdpsola`).
- **Evidence:** `fundsp` and `rustfft` are in `Cargo.toml`; the crates above are
  not.
- **Confidence:** medium
- **Bears on:** sampler, synthesis, and effect coverage planning.

### R-005 — Web Audio node offloading for standard effects

- **Claim:** Standard effects (`ConvolverNode`, `BiquadFilterNode`,
  `DynamicsCompressorNode`) can run in optimized browser C++ at zero WASM cost.
- **Evidence:** The codebase uses Canvas 2D / OffscreenCanvas rendering
  (`usePianoRollRenderer.ts`) but lacks extensive Web Audio node usage for DSP.
- **Confidence:** medium
- **Bears on:** web-side DSP budget and which effects bypass WASM.

### R-006 — SharedArrayBuffer cross-thread comms not yet enabled

- **Claim:** SharedArrayBuffer is the recommended audio↔UI transport; it requires
  COOP/COEP headers.
- **Evidence:** Tauri COOP/COEP headers are missing in `tauri.conf.json`; SAB
  cross-thread comms not configured.
- **Confidence:** high
- **Bears on:** the web transport story and any SAB-based metering/latency path.

### R-007 — Plugin UI knob components

- **Claim:** `react-knob-headless` or `webaudio-controls` are recommended for
  plugin UI knobs.
- **Evidence:** Neither is present in the React UI stack.
- **Confidence:** low
- **Bears on:** plugin/device UI component choices.

### R-008 — Offline export encoder coverage

- **Claim:** Several encoders are missing: FLAC (`flacenc`), web lossy
  (`wasm-media-encoders`, `libflacjs`), and native lossy (`mp3lame-encoder`,
  `vorbis_rs`, `opus`). Export should stream output chunks (never buffer the whole
  project), use a solo/mute approach for stems, and apply TPDF dithering plus
  plugin-delay compensation on offline render.
- **Evidence:** WAV export and sample-rate conversion are handled natively via
  `hound` and `rubato` (`src/commands/ai_audio.rs`); the listed encoders are not
  present.
- **Confidence:** medium
- **Bears on:** the export-targets and signal-integrity requirements.

### R-009 — Already-present hosting primitives

- **Claim:** Tauri v2 bare windows without WebView and wait-free SPSC ring buffers
  are already in place.
- **Evidence:** `src/commands/plugin_gui.rs` (bare windows); `rtrb` used for
  lock-free SPSC in `daw-engine`.
- **Confidence:** high
- **Bears on:** what the spec can build on rather than introduce.

## Open questions

- [ ] Q-001 — Should the hand-rolled `Vst3Wrapper` be retired in favor of a
  CLAP-first stack, or kept for VST3-only plugins? Resolving it sets the hosting
  architecture.
- [ ] Q-002 — Is out-of-process sandboxing in scope for the first release, or a
  later isolation phase? Answering it shapes the plugin-interface trait.
- [ ] Q-003 — Which standard effects move to native Web Audio nodes vs stay in
  WASM, given the SAB/header work R-006 requires?

## Recommendation

A spec author could lift a CLAP-first hosting direction via `clack-host` (R-001),
designed behind a trait that leaves room for out-of-process isolation later
(R-002), with real-time thread priority (R-003). The web transport work (SAB +
COOP/COEP headers, R-006) and the export encoder gaps (R-008) are independent
tracks that can proceed in parallel. The already-present primitives (R-009) are
the foundation; the DSP/sampler gaps (R-004) are larger and warrant their own
scoping.
