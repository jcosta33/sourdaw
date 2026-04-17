# Consolidated Implementation Gaps

## Metadata

- **Type:** Consolidated implementation tracker — a master checklist across multiple research streams.
- **Purpose:** Serve as the high-level backlog and architectural guide for closing the remaining gaps between Sourdaw's ultimate architectural research/specs and the current codebase. Unlike single-feature specs, this tracker is organized by domain chapter (§1–§10) and each chapter cross-references a dedicated spec where one exists.
- **Context:** Tauri v2, Rust (real-time DSP), React/TypeScript (frontend).

## Relationship to other specs

This tracker does **not** replace feature specs. It is an umbrella index:

- When a chapter here has a dedicated spec (e.g., §1.1 Drum Machine → `../factory/drum-machine.md`, §4 Plugin Hosting → forthcoming plugin-hosting spec, §6.5 Notation → `../features/notation.md`), the dedicated spec is the authority and this chapter is a summary + link.
- When no dedicated spec exists yet, this chapter is the working contract — implementing from it is permitted, but graduating to a dedicated spec is strongly preferred when scope grows.
- **Consolidated research (evidence layer):** §7 leans on `../../research/consolidated/architecture-performance.md`; §8 extensions on `../../research/consolidated/plugins-hosting.md`; §9 extensions on `../../research/consolidated/collaboration.md`; §10 on `../../research/consolidated/global-harmonic-awareness.md`. Those files keep tables, citations, and codebase annotations — this tracker keeps acceptance-criterion-shaped tasks only.

## Goal

After the items below are closed, Sourdaw matches or exceeds the feature surface described in the relevant research streams: Factory Suite depth, advanced DSP/analog modeling, collaboration, native plugin hosting, workflow/AI, composition standards, architecture/performance, and global harmonic awareness.

## Scope

**In scope:** every chapter §1–§10 below, tracked at the resolution shown. Each bullet is acceptance-criterion-grade when the chapter does not yet have a dedicated spec.

**Out of scope:**

- Product-level / UX decisions already captured in `../global/full-spec.md`.
- Audits of current code state — those live in `.agents/audits/` (especially `consolidated-issues.md` and `systemic-issues-root-cause.md`).

## Acceptance criteria (tracker-level)

- [ ] Every chapter §1–§10 is either fully implemented or has spawned a dedicated spec that supersedes it.
- [ ] When a chapter graduates, this file is updated with a pointer to the dedicated spec and the chapter body collapses to a summary.
- [ ] `pnpm deps:validate` and `cargo test --workspace` pass after any chapter's work lands.

---

## 1. The Factory Suite (Master Instruments)

The current implementation of the flagship instruments provides a solid foundation but falls short of the advanced DSP and UX detailed in the "Ultimate Guides."

### 1.1 The Master Drum Machine

- **Current State:** `Grinder` is currently implemented as an Amp Simulator. `Toaster` is a basic pad-based sampler.
- **Implementation Gap:** We lack the flagship, Ableton/Maschine-tier Drum Machine.
- **Agent Tasks:**
    - Implement advanced drum synthesis engines (808/909 physical models, modal synthesis for percussion).
    - Implement the integrated step sequencer with parameter locks, conditional triggers, and micro-timing.
    - Add transient shapers and advanced slicing to the pad workflow.
    - _Note:_ Decide architecturally whether to upgrade `Toaster` into this flagship device or create a new dedicated crate/module.

### 1.2 Levain (The Orchestral Suite)

- **Current State:** Basic multi-sampler.
- **Implementation Gap:** Missing the performance intelligence required to make samples sound like a living orchestra.
- **Agent Tasks:**
    - Build the **True Legato Engine** (interval transitions, crossfade logic).
    - Implement **Continuous Expression Modeling** (CC1 dynamics crossfading, CC11 volume).
    - Add **Spatial Mic Mixing** (Close, Tree, Ambient) with phase alignment tools.
    - Implement **Physical Modeling Augmentation** (synthetic vibrato LFOs, bow noise).

### 1.3 Fermenter (The Master Synth)

- **Current State:** Highly implemented (LayerStack, MacroStrip, basic wavetable playback).
- **Implementation Gap:** The wavetable engine relies on a static crossfader rather than a high-end spectral morphing engine.
- **Agent Tasks:**
    - Implement the **Vital-style Spectral Morphing Engine** (processing frequency-domain wavetables at runtime).
    - Add anti-aliasing via mip-map generation and lookup.
    - Implement true Phase Modulation (PM/FM) routing matrices.
    - Implement GPU-accelerated additive synthesis (WebGPU/wgpu).

---

## 2. Advanced DSP & Analog Modeling

The current DSP library (`crates/daw-dsp`) relies heavily on standard SVF filters and linear envelopes.

- **Agent Tasks:**
    - **ZDF Filters:** Implement Zero-Delay Feedback (ZDF) models for Moog and MS-20 ladder filters using Vectorial Newton-Raphson solvers to prevent high-frequency cramping.
    - **Envelopes:** Implement capacitor charge curve (exponential/RC) envelopes instead of purely linear ones for true analog snap.
    - **Oscillators:** Implement MinBLEP or PolyBLEP for hard sync and aliasing-free discontinuous waveforms.

---

## 3. Collaboration & Networking

The foundation (Automerge, WebRTC, mDNS) is solid, but professional collaborative features are missing.

### 3.1 Transport & Playback Sync

- **Architectural Decision:** **DO NOT** force hard-sync of the audio playback transport across peers (it is highly disruptive to user workflow).
- **Agent Tasks:** Implement **Ghost Playheads**. Broadcast each peer's playhead position (and loop region) via the presence/CRDT channels so users can see where others are working, without hijacking their local transport.

### 3.2 Media Channels & Discovery

- **Agent Tasks:**
    - Implement separate WebRTC Media Channels for **Voice Chat** and **Remote Monitoring** (Opus encoded).
    - Implement advanced discovery: VPN Direct (Tailscale/ZeroTier integration) and DHT/Rendezvous routing for desktop builds.
    - Implement Automerge document compaction strategies to prevent memory bloat over long sessions.

---

## 4. Plugin Hosting Architecture

The current native hosting relies on a custom `Vst3Wrapper`.

- **Agent Tasks:**
    - Migrate the primary hosting architecture to **CLAP** using `clack-host` for a safer, more robust Rust abstraction.
    - Implement out-of-process sandboxing using `shmem-ipc` to prevent plugin crashes from taking down the DAW.
    - Implement native Web Audio node offloading (e.g., using `DynamicsCompressorNode` where applicable to save WASM CPU).
    - Integrate the `creek` crate for real-time safe disk streaming for large sample libraries.

---

## 5. Workflow, AI, and Extended Features

These are additive features that have been deeply researched but are missing from the codebase.

### 5.1 Integrated Stem Separation Workflow

- **Current State:** Demucs runs locally.
- **Agent Tasks:** Integrate it deeply into the UI: allow drag-and-split, auto-route separated stems to dedicated mixer lanes, and allow easy re-sampling of stems into the sampler suite.

### 5.2 A Serious Vocal Suite

- **Current State:** `Knead` handles basic pitch correction.
- **Agent Tasks:** Expand into a full vocal bundle: Formant-preserving harmonization, real-time doubler, and a dedicated UI for vocal comping and de-essing.

### 5.3 Clip Aliases & Automation Clips

- **Current State:** Basic "Figma-style" linked clips exist.
- **Agent Tasks:** Elevate automation clips to first-class reusable objects. Implement variation lanes (for choruses/fills) and project-wide groove templates that apply over linked clips.

### 5.4 World-Class Browser & Content System

- **Current State:** Basic local folder scanning and tag models exist.
- **Agent Tasks:** Implement "Sound Similarity Search" (spectral embeddings), AI auto-tagging, contextual drag-auditioning with tempo/key sync, and mix-ready genre starter packs to expand the factory content.

### 5.5 Deep MPE Editing & Hardware Scripting

- **Current State:** DSP supports MPE; basic MIDI learn exists.
- **Agent Tasks:** Build per-note expression lanes (timbre/pressure/pitch) in the Piano Roll. Expand the scripting API to support auto-mapped hardware controller profiles (e.g., Push, Launchpad) with community sharing.

### 5.6 Mastering Translation Workflow

- **Current State:** `Proof` mastering suite and `Crust` limiter handle LUFS targets.
- **Agent Tasks:** Implement a Mastering Assistant (smart chain generation), monitor translation curves (Car, Phone, Mono), and an A/B/C reference track comparison workflow.

---

## 6. Advanced Composition, Media & Standards

These features represent massive architectural additions that require deep, separate research before implementation, but they constitute the final gaps to rival tier-1 DAWs.

### 6.1 Articulation Maps & Keyswitch Management

- **Current State:** Basic SFZ keyswitching is supported conceptually, but there is no DAW-level mapping system or UI.
- **Agent Tasks:** Build an Articulation Map schema in the TypeScript project state. Implement a MIDI interception layer in Rust that translates UI articulation labels into hidden keyswitch/CC events immediately before the plugin node. Implement articulation chasing for playback jumps.

### 6.2 Project-Wide Key, Scale & Microtuning (Scala)

- **Current State:** Basic scale quantization exists in MIDI effects, but no global harmonic awareness or microtuning.
- **Agent Tasks:** Implement global pitch tables in the Rust engine for lock-free oscillator tuning via `.scl`/`.kbm` files. Implement MTS-ESP support for tuning third-party plugins. Add project-wide key signatures that automatically fold/transpose MIDI clips non-destructively.

### 6.3 ARA-Style Editing & Clip-Native Deep Correction

- **Current State:** No native clip editor or ARA support.
- **Agent Tasks:** Architect and implement either ARA 2 host interfaces via the `clack-host` / `vst3_wrapper` or build a custom first-party React/Rust pitch editor using the `Knead` module. Implement background offline-commit bouncing for corrected regions.

### 6.4 Video, Spotting, and Scoring-to-Picture

- **Current State:** A basic video track exists in the UI, but synchronization is rudimentary.
- **Agent Tasks:** Solve the HTML5-to-CPAL clock drift problem to slave the video's `currentTime` to the sample-accurate Rust playhead. Implement drop-frame SMPTE math, hit-points, and Rust-native video demuxing/muxing for export.

### 6.5 Usable Notation & Lead-Sheet Layer

- **Current State:** Strictly piano-roll MIDI editing.
- **Agent Tasks:** Implement a React-based notation rendering engine (e.g., VexFlow or OSMD). Implement "display quantization" heuristic algorithms so unquantized MIDI is readable on a staff. Build a MusicXML export pipeline.

### 6.6 Spatial / Immersive / Dolby Atmos Mixing

- **Current State:** The mixer is stereo with basic 2D surround panning via Canvas.
- **Agent Tasks:** Implement Vector Base Amplitude Panning (VBAP) for arbitrary 3D speaker layouts (7.1.4) in Rust. Implement a binaural HRTF renderer for headphone mixing. Build an ADM BWF export pipeline for Dolby Atmos deliveries.

---

## 7. Architecture & Performance

Sourdaw already uses Tauri v2, `rtrb` SPSC ring buffers, `cpal` for native audio, and `wasm-bindgen` for the web, with WebWorker audio isolation and standard lock-free patterns in place. The items below formalize the performance contract, profiling discipline, and the remaining platform-integration gaps surfaced in `.agents/research/consolidated/architecture-performance.md`.

### 7.1 Performance Budgets Per Platform

- **Current State:** The codebase has no documented CPU, latency, or frame-time budgets. There are no enforcement mechanisms (runtime asserts, benchmark thresholds, CI perf gates).
- **Agent Tasks:**
    - Add a `docs/architecture/performance-budgets.md` document defining the hard and soft budgets below, and link it from `AGENTS.md` and `.agents/skills/web-audio-engine/SKILL.md`.
    - Surface budget violations in the Rust engine by using `assert_no_alloc` in debug builds on every audio-thread entry point and by recording per-block processing time into a lock-free ring for UI-side reporting.
    - Add a Vitest benchmark harness (or `pnpm test:perf`) that exercises the web audio graph and the UI render loop under representative load; failures must break CI.
- **Acceptance Criteria:**
    - **Native RT audio thread — per-callback budget:** At a 48 kHz sample rate with a 128-sample buffer (2.67 ms period), the Rust audio callback completes in **≤ 1.33 ms (50 % of the period)** on the reference machine (Apple M2, 8-core). Measured via per-block timestamps exported from the RT thread; CI benchmark asserts the 95th-percentile duration.
    - **Native RT audio thread — allocation budget:** The audio callback allocates **zero bytes** on the heap per block. Enforced by `assert_no_alloc` panicking in debug builds during the full CI test suite.
    - **Native RT audio thread — lock budget:** The audio callback acquires **zero mutexes/rwlocks**. Enforced by Clippy lint denying `std::sync::Mutex` / `parking_lot::Mutex` usage inside `daw-engine::process*` modules.
    - **Web audio-thread frame budget:** On Chromium with a 128-sample AudioWorklet quantum at 48 kHz (2.67 ms), worklet `process()` returns in **≤ 1.8 ms** at the 95th percentile while rendering a 32-track stereo project with 8 plugin instances. Measured via `performance.now()` inside the worklet and reported through a `MessagePort` to a dev HUD.
    - **UI main-thread long-task budget:** No long task exceeds **50 ms** during normal editing (scrolling the arrangement, dragging clips, opening mixer views). Verified via the `PerformanceObserver` `longtask` entry type in an automated Playwright session; CI fails if any `longtask` > 50 ms fires during a scripted scenario.
    - **Initial interaction latency:** Time from input event to first paint **≤ 100 ms** on Chromium for the top 10 user gestures listed in the performance doc (play/stop, arm, solo, mute, nudge clip, zoom, open plugin GUI, open mixer, add track, rename track). Measured via the Event Timing API (`first-input`, `event`).
    - The budgets document is the single source of truth; any spec or SKILL that states a different number is a bug and fails `pnpm deps:validate`'s docs-consistency check (added as part of this work).

### 7.2 Profiling Methodology

- **Current State:** There is no documented workflow for profiling either the RT audio thread or the UI main thread; no reference traces are checked in.
- **Agent Tasks:**
    - Document the profiling workflow in `docs/architecture/profiling.md`, covering native RT capture (`cargo-flamegraph`, `perf record` on Linux, `Instruments.app` on macOS with the _Time Profiler_ and _System Trace_ templates) and web capture (Chromium DevTools Performance panel, the AudioWorklet-internal timer HUD from §7.1, and `chrome://tracing` for cross-thread views).
    - Check in at least one reference trace per platform (macOS `.trace` bundle and a Chromium `profile.json`) under `docs/architecture/traces/reference/` captured on the reference hardware running a canonical 32-track session. These are baselines, not regression gates.
    - Add a `pnpm perf:capture` script that runs the Playwright scenario with `--enable-features=AudioWorklet*` and saves a `profile.json` for triage.
- **Acceptance Criteria:**
    - `docs/architecture/profiling.md` exists and describes: (a) how to profile the Rust audio thread on macOS, Linux, and Windows; (b) how to profile the browser audio thread and main thread; (c) where reference traces live; (d) what "acceptable" looks like on the reference machine (tied to the §7.1 budgets).
    - At least one reference trace per platform (macOS, Linux, Chromium) is checked in under `docs/architecture/traces/reference/` with a `README.md` describing capture conditions (hardware, OS build, project file, sample rate, buffer size).
    - `pnpm perf:capture` runs non-interactively and emits a single JSON artifact that opens in Chromium's Performance panel.
    - The profiling doc is linked from `AGENTS.md` under a new "Performance" subsection and from the web-audio-engine and tauri-platform SKILLs.

### 7.3 EBU R 128 Loudness Metering (ebur128)

- **Current State:** `AnalyserNode`-based metering exists for RMS and peak; there is no integrated-loudness, short-term-loudness, or true-peak measurement path. The `ebur128` crate is absent from `Cargo.toml`.
- **Agent Tasks:**
    - Add the `ebur128` crate to `daw-dsp` (or a new `daw-metering` module inside `daw-dsp`) and expose `EbuR128State::new(channels, sample_rate, Mode::I | Mode::S | Mode::M | Mode::TRUE_PEAK)`.
    - Feed the master bus and every armed export stem through the analyser without copying (slice views only).
    - Stream measurements to the UI at **30 fps** via a Tauri `Channel<LoudnessFrame>` (not IPC command per frame).
- **Acceptance Criteria:**
    - Loading a reference sine-wave file (`1 kHz @ -23 LUFS`, EBU R 128 test signal) into the master and pressing Play yields a short-term LUFS reading within **±0.1 LU** of `-23.0` on the metering UI.
    - True-peak measurement flags inter-sample peaks above `-1.0 dBTP` on the provided test file `docs/architecture/traces/ebu-tp-test.wav` within one block of the peak sample.
    - The metering channel delivers frames at **30 ± 3 Hz** measured over a 60-second window while Play is active; the audio thread performs **zero allocations** while feeding the analyser.
    - Offline export writes an `loudness_report.json` next to the rendered audio containing `integrated_lufs`, `short_term_max`, `momentary_max`, and `true_peak_db` for each delivered stem.

### 7.4 Peak Mipmap Pre-computation

- **Current State:** Waveform rendering recomputes min/max peaks on the main thread per zoom level; there is no persisted cache and no Rust-side pre-computation.
- **Agent Tasks:**
    - Add a `PeakPair { min: f32, max: f32 }` mipmap generator in Rust that emits pyramids at standard zoom powers of two (1×, 2×, 4×, 8×, …, 16384× samples-per-pixel).
    - Persist mipmaps next to source audio (`<asset>.peaks.v1`) keyed by BLAKE3 of the source file.
    - Ship peak payloads to the frontend via `tauri::ipc::Response` returning raw `ArrayBuffer` — not JSON.
- **Acceptance Criteria:**
    - Generating mipmaps for a 60-minute 48 kHz stereo file completes in **≤ 3 s** on the reference machine; the resulting `.peaks.v1` file is **≤ 2 %** of the source WAV size.
    - Zooming from waveform-level to arrangement-level on a 32-track project does not block the main thread for more than **16 ms** per frame (verified by `longtask` observer) because peak data is served from the cached mipmap.
    - The peak payload delivered to the frontend is a binary `ArrayBuffer` (content-type `application/octet-stream`), not a JSON-encoded number array. Verified by a unit test on the IPC handler.
    - Mutating the source file causes the cache to be invalidated on next read (BLAKE3 mismatch) and regenerated.

### 7.5 DAWproject Import / Export

- **Current State:** Projects are stored as Automerge documents; there is no Bitwig `DAWproject` (XML-in-ZIP) interchange format and no single-file `.sourdaw` bundle that embeds assets.
- **Agent Tasks:**
    - Implement `DAWproject` import and export in a new `daw-interchange` crate (or inside `daw-io`) mapping Sourdaw's project model to the DAWproject 1.0 schema (tracks, clips, automation lanes, tempo, markers, mixer routing).
    - Implement `.sourdaw` bundle export (ZIP of `project.automerge` + `assets/` + `manifest.json`) that opens cross-machine without relying on external asset paths.
    - Surface both in the `File → Export` menu and a matching `File → Import` entry.
- **Acceptance Criteria:**
    - A project exported to DAWproject imports into Bitwig Studio 5 with all tracks, clip positions, clip lengths, tempo events, and mixer sends preserved within **±1 sample** of position accuracy. Verified manually against a reference project `docs/architecture/traces/dawproject-fixture/`.
    - Round-tripping the reference project through export → import into a fresh Sourdaw instance yields an Automerge document whose user-visible fields (track names, clip IDs, note events, automation points) are byte-for-byte identical to the original (diff test in CI).
    - `.sourdaw` bundle export produces a single ZIP whose uncompressed manifest lists every referenced asset by BLAKE3 hash; opening the bundle on a machine with an empty asset cache reconstructs the project without any missing-asset warnings.
    - Importing a DAWproject file that references unsupported constructs emits a structured warning list (one entry per dropped element) instead of failing silently.

### 7.6 Neural Amp Modeler (NAM) Integration

- **Current State:** `Grinder` is a static amp simulator. There is no NAM capture loader and no inference engine integration.
- **Agent Tasks:**
    - Add a NAM loader that parses `.nam` profile JSON (WaveNet and LSTM variants) in Rust.
    - Integrate inference via `tract` (or `wonnx` on web) such that the same profile runs natively (CPU SIMD) and in the browser (WASM).
    - Expose NAM as a DSP block usable from `Grinder` and as a standalone effect node.
- **Acceptance Criteria:**
    - Loading the `Fender_Twin_clean.nam` reference profile and processing a reference DI guitar file produces an output whose spectrum matches the reference render within **≤ 1 dB RMS error** in the 80 Hz – 8 kHz band (measured via a Vitest + `fft-js` check against a golden WAV).
    - A single NAM instance at 48 kHz / 128-sample buffer consumes **≤ 15 %** of one core on the reference machine (native) and **≤ 35 %** in Chromium (WASM). Benchmarked in `daw-engine`'s criterion suite.
    - Unsupported NAM profile versions are rejected with a user-visible error naming the unsupported field; they do not crash the host.
    - NAM inference on the audio thread performs **zero allocations** per block (`assert_no_alloc` passes).

### 7.7 Ableton Link Clock Sync

- **Current State:** Completely absent. The transport has no external-clock peering beyond MIDI clock stubs.
- **Agent Tasks:**
    - Integrate `rusty_link` in a Tauri-bridged module, explicitly isolating it behind a crate-feature flag `link` so the GPL-2.0+ dependency chain does not leak into builds that cannot accept it. Document the licensing implications in `docs/licensing/third-party.md`.
    - Expose Link state (peer count, tempo, beat phase, quantum) to the WebView via a Tauri `Channel<LinkState>` at 30 fps.
    - Wire Link tempo into the transport as a synchronised source, selectable via `Transport → Sync Source → Ableton Link`.
- **Acceptance Criteria:**
    - With Link enabled and one Ableton Live peer on the same subnet, Sourdaw's transport tempo tracks the peer's tempo within **≤ 0.5 BPM** of drift within **2 seconds** of a remote tempo change.
    - Starting playback on a peer while Sourdaw is armed to Link causes Sourdaw's transport to start on the next quantum boundary with **≤ 1 ms** timing error versus the Link-provided beat clock, measured via MIDI-clock output tick alignment.
    - Disabling Link returns the transport to internal clock within **≤ 1 block** without glitching audio.
    - Building without the `link` feature does not pull `rusty_link` into the dependency tree (verified by `cargo tree --no-default-features`); the UI hides the Link option when the feature is absent.

### 7.8a Rust-Native Stem Export & Offline Bounce

- **Current State:** Offline bounce and stem export lean on browser `OfflineAudioContext` (WebKit: 44.1 kHz min, 10 ch max) plus IPC back to the frontend (`ExportDialog.tsx`, `handleAiDenoiseClip.ts`). Nothing parallelises stem bouncing in Rust, and format coverage on WebKit is limited.
- **Agent Tasks:**
    - Route offline bounce and stem export through a Rust-side pipeline in `daw-io` using `symphonia` for decode, `hound` for WAV, and `rayon` for parallel per-stem rendering (research `architecture-performance.md` §2).
    - Keep browser-only builds functional by falling back to the existing Web Audio path, but mark Tauri desktop as the authoritative pipeline.
    - Emit per-stem progress over a single Tauri `Channel<ExportProgress>`; do not per-frame IPC.
- **Acceptance Criteria:**
    - Exporting N stems from a 32-track project completes in **≤ (single-stem time × max(1, N/cores))** on the reference machine — linear wall-clock speed-up up to the core count.
    - Offline bounces are deterministic bit-for-bit across repeat runs of the same project state (verified by BLAKE3 hash of the rendered WAV).
    - WebKit-only runtimes still produce correct output (via the Web Audio fallback) but do not advertise the >2-channel / >96 kHz configurations that only the Rust path supports.
    - Exported WAV files carry a BWF `bext` chunk with project name, render timestamp, and source project BLAKE3; verified by `ffprobe`.

### 7.8b Native Multi-Track Recording + Step / Count-in Workflow

- **Current State:** Audio capture is routed through a JS `RecordingWorkletProcessor`; `getUserMedia` on WebKit caps at stereo. There is no step-recording workflow and no count-in primitive.
- **Agent Tasks:**
    - Add a Rust-side recording path that captures from `cpal` input streams directly into `hound`-backed on-disk WAV via `rtrb` SPSC ring buffers (research `architecture-performance.md` §3). Used automatically when running under Tauri; the Web Audio worklet remains the browser fallback.
    - Implement **step recording**: notes entered one at a time from a MIDI input without real-time performance, with a visible "step cursor" in the piano roll.
    - Implement **count-in**: 1–8 bars of metronome before transport start on arm, configurable per project and per record pass.
- **Acceptance Criteria:**
    - A 32-channel multitrack record pass on a Tauri desktop build writes 32 individual WAV files to disk with **zero xruns** at 48 kHz / 128-sample buffer on the reference machine (verified by CPAL's underrun counter).
    - Step recording inserts notes at the step cursor's position without advancing the transport; arrow keys move the cursor; `pnpm typecheck` passes with the UI wired end-to-end.
    - Count-in preroll is sample-accurate: the first recorded sample lines up with the first beat of the count-in-free region within **≤ 1 sample** at the project sample rate.
    - Browser-only builds continue to record via the existing `RecordingWorkletProcessor` and are capped at the browser's channel limit; the UI surfaces the limit as a non-blocking note, not an error.

### 7.8c MIDI Effects Pipeline, Probability, MPE Allocator, MIDI Clock

- **Current State:** `midir` handles basic I/O but there is no pre-instrument MIDI FX pipeline, no probabilistic note triggering, no MPE channel allocator, and no `0xF8`-tick clock generator on the audio thread.
- **Agent Tasks:**
    - Define a **MIDI FX chain** slot list on every MIDI track, evaluated before the instrument. v1 modules: Arpeggiator, Velocity Scaler, Groove Quantizer (Zeitgeist-style — research `architecture-performance.md` §4).
    - Add per-note `probability: f32 (0.0..=1.0)` to the sequencer event model. The RT scheduler skips notes whose roll exceeds probability; determinism is preserved when the RNG seed is saved in the arrangement.
    - Add a ~200-line `MpeAllocator` that assigns per-note channels 2–16 with an LRU policy, supports the MPE "lower zone" convention, and is RT-safe (no allocation, no locks).
    - Add a sample-accurate **MIDI clock output** generator driven by the audio callback: `0xF8` at 24 PPQN, `0xFA` / `0xFC` / `0xFB` on transport start/stop/continue, routed to the enabled MIDI output ports via `midir`.
- **Acceptance Criteria:**
    - A MIDI track with an Arpeggiator + Velocity Scaler + Groove Quantizer in series produces deterministic output for a fixed input MIDI sequence (bit-for-bit across runs with the same seed and parameters).
    - Notes with `probability = 0.5` fire approximately 50 % of the time over 1 000 runs with different seeds; binomial variance is within **±3σ**. The identical sequence with the seed pinned is bit-for-bit reproducible.
    - The MPE allocator correctly rotates channels for a fast-played chromatic run at 200 BPM, 1/16 notes, with channel reuse stalls **≤ 1** across 10 000 events.
    - A downstream MIDI-clock slave (`MidiMonitor`-style capture) measures the emitted `0xF8` tick jitter at **≤ 0.5 ms** stddev over 60 seconds at 120 BPM.

### 7.8d Controller Learning, Routing Visualization

- **Current State:** Neither a DAW-level MIDI-learn registry nor a routing visualisation graph exists.
- **Agent Tasks:**
    - **Controller learning**: a global MIDI-learn registry that maps hardware MIDI CC (and MPE per-note) to any automatable parameter surfaced by the parameter registry. UI: right-click "MIDI Learn" on any control, then move a hardware controller; mapping is persisted per-project and per-user template.
    - **Routing visualization**: a force-directed node graph (d3-force or equivalent) visualising track → bus → device routing, plus sends and sidechain wiring. Read-only in v1; editing is a follow-up.
- **Acceptance Criteria:**
    - Learning CC 74 to a filter cutoff causes the cutoff to track the hardware knob within **≤ 1 audio block** latency at 48 kHz / 128-sample buffer.
    - Clearing a learned mapping removes it from both the project save and the user template; verified by JSON diff.
    - The routing graph renders a 64-track project with 8 busses and 16 sends at **≥ 30 fps** interactive (pan / zoom) on the reference machine, verified via a Playwright perf capture.
    - Routing panel is keyboard-navigable (tab through nodes, enter to focus) with screen-reader labels matching each node's track / bus / device name.

### 7.8 SoundFonts (.sf2) Playback

- **Current State:** No SoundFont playback; `.sf2` files cannot be auditioned or used as an instrument source.
- **Agent Tasks:**
    - Add `rustysynth` to `daw-dsp` behind a `SoundFontInstrument` node.
    - Extend the browser content system to index `.sf2` files and list their presets (bank/program) in the instrument picker.
    - Provide drag-and-drop from the browser onto a MIDI track to instantiate a `SoundFontInstrument` pre-configured with the dragged preset.
- **Acceptance Criteria:**
    - Playing a C-major scale through the `GeneralUser GS` reference SoundFont produces per-note audio whose fundamental frequency is within **±1 cent** of the expected pitch for each MIDI note in the scale.
    - Bank/program change messages received on the MIDI input of a `SoundFontInstrument` switch presets within **≤ 1 block** without audible glitches on the currently held voices.
    - A single `SoundFontInstrument` with 32 voices active consumes **≤ 8 %** of one core at 48 kHz / 128-sample buffer (native reference machine).
    - `.sf2` files larger than **available RAM / 4** stream from disk instead of being fully loaded; verified with a synthetic 6 GB `.sf2` test fixture that loads in **≤ 500 ms**.

---

## 8. Plugin Hosting — Extensions

This section extends §4 with items surfaced in `.agents/research/consolidated/plugins-hosting.md` that were not previously covered.

### 8.1 Audio Unit (AU) Hosting — Scope Decision

- **Current State:** There is no AU host in the codebase. The existing native plugin path is the `Vst3Wrapper`; §4 mandates migration to CLAP via `clack-host`. AU has not been specced one way or the other.
- **Decision for v1:** **Out of scope for v1.** Rationale: AU is a macOS-only format; the two flagship cross-platform ecosystems Sourdaw commits to (CLAP and VST3) already cover the vast majority of professional plugin inventories, and AU hosting imposes Objective-C runtime glue, Component Manager lifecycle handling, and AUv3 sandbox plumbing that do not share implementation with the CLAP/VST3 paths. Deferring AU keeps the v1 plugin-host surface minimal.
- **Agent Tasks (v1):**
    - Do **not** ship AU hosting code in v1.
    - Document the decision in `docs/licensing/third-party.md` and in the plugin-hosting SKILL as an explicit non-goal with this rationale.
    - Keep the plugin-host trait abstraction (the one CLAP sandbox and VST3 implement) flexible enough that an AU backend can be added later without changing the cross-module contract.
- **Acceptance Criteria:**
    - `docs/licensing/third-party.md` and `.agents/skills/plugin-hosting/SKILL.md` both state that AU hosting is out of scope for v1 and give the rationale above verbatim.
    - `cargo tree` for `daw-plugin-host` contains **zero** AU-related crates (`coreaudio-sys`, `auv3`, etc.) in v1 builds.
    - The plugin-host trait in `daw-plugin-host` is not parameterized by a plugin-format enum that hard-codes only CLAP and VST3; adding a third variant in the future is a one-file change (verified by a structural test on the trait module).
    - The plugin picker UI does not surface "AU" as a filterable plugin type in v1.

### 8.2 Real-Time Audio Thread Priority

- **Current State:** The `audio_thread_priority` crate is not a dependency; the CPAL-spawned audio thread runs at whatever priority the OS assigns by default.
- **Agent Tasks:**
    - Add `audio_thread_priority` to `daw-engine` and call `promote_current_thread_to_real_time()` (or its crate-native equivalent) inside the audio callback startup path on macOS, Linux, and Windows.
    - On failure to elevate (no RT permission, no threading entitlement), fall back to the default priority and surface a single-shot warning to the UI via the existing notification channel.
    - Document platform prerequisites (macOS entitlement, Linux `rtkit`/`rtprio`, Windows MMCSS) in `docs/architecture/profiling.md`.
- **Acceptance Criteria:**
    - On macOS, the audio thread's `thread_policy_get(THREAD_TIME_CONSTRAINT_POLICY)` returns an enabled policy within **≤ 100 ms** of engine startup (verified by a macOS-gated integration test).
    - On Linux with `rtkit` available, `sched_getscheduler()` reports `SCHED_RR` or `SCHED_FIFO` for the audio thread.
    - On Windows, the audio thread is registered with MMCSS under the `Pro Audio` task (verified via a diagnostic log line).
    - When elevation fails, the engine continues to run at default priority, logs one warning, and the UI displays a non-blocking toast. The engine never crashes on elevation failure.

### 8.3 FAUST → Rust DSP Pipeline

- **Current State:** No FAUST integration. DSP primitives are hand-written in `daw-dsp`.
- **Agent Tasks:**
    - Add a build-time FAUST pipeline that compiles `.dsp` sources to Rust via `faust2rust` (or the `faust` crate's Rust backend) and emits `no_std`-compatible output suitable for the audio thread.
    - Commit at least three reference `.dsp` files (a reverb, a compressor, a linear-phase EQ) under `crates/daw-dsp/faust/` with generated Rust checked in and a `cargo xtask faust:regen` script.
    - Expose each compiled module as a standard DSP node registerable with the audio graph.
- **Acceptance Criteria:**
    - Running `cargo xtask faust:regen` from a clean checkout regenerates the three reference Rust sources and leaves `git diff` empty on a fresh machine with FAUST installed.
    - Each generated DSP node produces output within **≤ 0.5 dB RMS error** of a reference render made by the FAUST reference interpreter on the same input.
    - Generated modules perform **zero allocations** per block (`assert_no_alloc` passes).
    - The pipeline does not require FAUST to be installed to **use** Sourdaw — only to regenerate sources. Verified by a CI job that builds Sourdaw in a container without FAUST.

### 8.3a DSP Library Completions (research `plugins-hosting.md` §2)

- **Current State:** `fundsp` and `rustfft` are present, but several recommended DSP primitives are not.
- **Agent Tasks:**
    - Add **`mi-plaits-dsp-rs`** (pure-Rust port of Mutable Instruments Plaits, 24 engines) as the recommended backbone for flagship hybrid-synth voices.
    - Add a **time-stretch engine** with permissive licensing — options: `signalsmith-stretch` (if license-compatible), `tdpsola`, or a clean-room WSOLA/Phase-Vocoder — surfaced through a single `TimeStretch` trait and consumed by the clip launcher (`.agents/specs/factory/active/non-linear-clip-launcher.md`), warp operations, and offline bounce.
    - Add a **pitch-detection** primitive via `pitch-detection` or `pyin-rs` so Knead, legato heuristics, and tuning tools share one implementation.
    - Add **linear-phase EQ** (FFT-based), **non-uniform partitioned-convolution reverb**, and **look-ahead limiter** primitives to `daw-dsp`.
- **Acceptance Criteria:**
    - A synth preset built on `mi-plaits-dsp-rs` renders deterministic output for a fixed MIDI fixture — byte-for-byte identical across runs at the same sample rate and buffer size.
    - The `TimeStretch` trait is the sole entry point for warp / stretch across the codebase; `rg "use rubberband"` or direct GPL stretch imports return **zero** hits (Rubber Band is only referenced as a benchmark).
    - Pitch detection on a known reference vocal (`docs/architecture/traces/pitch-fixture.wav`) produces a median absolute error **≤ 3 cents** against the hand-labelled ground truth over voiced frames.
    - Linear-phase EQ, partitioned convolution, and look-ahead limiter each pass `assert_no_alloc` on the audio thread and include a criterion benchmark in `daw-dsp`.

### 8.3b Browser DSP Offloading & Shared-Memory Config (research `plugins-hosting.md` §3)

- **Current State:** Standard effects run entirely in WASM; Tauri COOP/COEP headers are not set; no shared-memory audio↔UI path.
- **Agent Tasks:**
    - Route standard effects through native Web Audio nodes (`ConvolverNode`, `BiquadFilterNode`, `DynamicsCompressorNode`) when the dependency graph allows, keeping WASM for effects that require custom DSP.
    - Set `Cross-Origin-Embedder-Policy` and `Cross-Origin-Opener-Policy` headers in `tauri.conf.json` and the dev server so `SharedArrayBuffer` is available; confirm via `crossOriginIsolated` on startup.
    - Stand up a SAB-backed ring buffer (`rtrb`-equivalent in JS) for UI-metering / control-surface updates that do not need to round-trip through Tauri IPC.
- **Acceptance Criteria:**
    - On the reference project, routing standard effects to native Web Audio nodes reduces main-thread CPU usage by **≥ 10 %** measured via `performance.now()` frame timing during playback — verified in a Playwright perf run.
    - `self.crossOriginIsolated === true` on app startup in both dev and production builds (asserted by a startup self-test).
    - SAB meter updates from the audio worklet reach the React UI at **≥ 30 Hz** without blocking the main thread for more than **≤ 2 ms** per frame.

### 8.3c Offline Export Encoders and Signal Integrity (research `plugins-hosting.md` §4)

- **Current State:** WAV export + SRC via `hound` / `rubato` works. No FLAC, MP3, Opus, Vorbis; no TPDF dithering; no Plugin Delay Compensation during offline render.
- **Agent Tasks:**
    - Add **FLAC** encode via `flacenc` (native + WASM); **MP3** via `mp3lame-encoder`; **Vorbis** via `vorbis_rs`; **Opus** via the `opus` crate; browser lossy via `wasm-media-encoders` or `libflacjs` only where the native path is not applicable.
    - Stream output chunks during export — never buffer the whole project in memory.
    - Preserve **stem export** via a solo/mute export pass (identical math to the live path; no special-case mix logic).
    - Apply **TPDF dithering** whenever bit depth is reduced (float → 16- or 24-bit PCM); sample-accurate **Plugin Delay Compensation** during offline render so delay-bearing plugins do not shift against the master timeline.
- **Acceptance Criteria:**
    - Round-tripping a reference 24-bit / 48 kHz master through export → decode yields samples whose spectrum matches the source within **≤ 0.5 dB RMS error** for every supported lossy format at nominal bitrate (MP3 320 kbps, Opus 256 kbps, Vorbis q8, FLAC lossless — lossless must be bit-exact).
    - Exporting a 64-track project uses peak working memory **≤ 2 ×** the largest single-track render buffer, not the whole-project buffer.
    - A stem export of a project containing a look-ahead limiter and a 4-band linear-phase EQ lines up with the master bounce within **≤ 1 sample** on every stem (PDC verified).
    - Bit-depth reduction always applies TPDF dither unless explicitly disabled by the user; the default is on.

### 8.4 SFZ Loader

- **Current State:** No Rust SFZ parser exists in the codebase; §1.1 and §1.2 of this spec presume sample-based workflows but do not nail down the SFZ ingestion layer.
- **Agent Tasks:**
    - Implement an SFZ parser in a new `daw-sfz` crate (or inside `daw-dsp`) covering the SFZ 1.0 opcode subset plus the SFZ 2 opcodes actually used by the flagship sampler presets shipped with Sourdaw.
    - Wire the parser to `creek`-backed disk streaming (once §4's `creek` integration lands) and to the in-browser OPFS-backed streaming path for the web build.
    - Add a compatibility report generator that, given an SFZ file, lists every opcode used and marks each as `supported` / `partial` / `unsupported`.
- **Acceptance Criteria:**
    - Loading the reference SFZ pack `docs/architecture/traces/sfz-fixture/` (a multi-velocity piano) triggers playback whose samples match the referenced WAVs by **byte-identical** PCM output for a given MIDI sequence.
    - The parser rejects malformed SFZ with a structured error naming the offending line and opcode; it never panics (verified by a `cargo fuzz` target running for at least 5 minutes in CI).
    - The compatibility report for the reference pack lists 100 % of its opcodes and marks none of them `unsupported`.
    - Loading a 2 GB SFZ pack on the web build completes interactive auditioning within **≤ 500 ms** from drop to first playable note (streaming from OPFS, not full load).

---

## 9. Collaboration — Transport Sync, Trust, and Asset Transfer

This section extends §3 with items surfaced in `.agents/research/consolidated/collaboration.md` that were not previously covered. It does not contradict §3.1's "DO NOT force hard-sync of the transport" rule: the leader model here is opt-in per session and is intended for jam/rehearsal modes, not default editing.

### 9.1 Transport Leader Model

- **Current State:** Transport state is synchronised via plain Automerge CRDT scalars; there is no explicit leader, no epoch, and no authority handoff protocol.
- **Agent Tasks:**
    - Add a `TransportLeader { peer_id, epoch, assigned_at }` structure to the session document. Exactly one peer holds the leader role at any instant.
    - Implement an explicit `requestLeadership(peerId)` / `releaseLeadership()` / `forceTakeLeadership(peerId)` use-case surface in `#/modules/Collaboration`.
    - Only the leader's transport commands (play, stop, seek, loop-change, record-arm authority) are honoured; followers' local UI shows a "follow leader" affordance instead of a local transport button.
    - Provide an opt-out "Independent Transport" mode per peer, consistent with §3.1's ghost-playhead philosophy for normal editing.
- **Acceptance Criteria:**
    - At any point in a session document, at most **one** `TransportLeader` record has `released_at == null`. Enforced by a CRDT merge invariant test.
    - A peer that is not the leader cannot cause `transport.play()` to advance the remote transports; its `requestLeadership` call must be acknowledged by the prior leader (or by epoch-based preemption, §9.3) before its transport commands take effect.
    - Leadership handoff (prior leader releases, new leader takes over) completes within **≤ 500 ms** on a LAN, measured end-to-end.
    - The transport mode toggle "Follow Leader / Independent" is persisted per peer in local (non-CRDT) storage and survives session reload.

### 9.2 Peer-to-Peer Monotonic Time Synchronisation

- **Current State:** No clock-sync protocol exists; local transports are started from Automerge scalar updates with no offset compensation.
- **Agent Tasks:**
    - Implement a ping/pong RTT measurement using `performance.now()` (web) and `std::time::Instant` (native) on the existing WebRTC data channels.
    - Compute per-peer clock offset and one-way delay using the standard NTP-style four-timestamp exchange (`t1, t2, t3, t4`), filtered with a rolling median over the last 16 samples to reject outliers.
    - Define a `PlayCommand { target_monotonic_ns, tempo_revision, leader_epoch, sequence }` payload. Followers convert `target_monotonic_ns` to their local monotonic clock using the measured offset and schedule the local audio-thread start accordingly.
- **Acceptance Criteria:**
    - After **≤ 5 seconds** of exchanging pings, the computed peer-to-peer offset is stable within **±200 µs** on a LAN (measured in a Vitest integration harness that stubs WebRTC with a loopback transport).
    - When the leader issues `play` with a target 200 ms in the future, all followers start audio playback within **≤ 2 ms** of the leader's sample-accurate start on a LAN (verified by correlating recorded metronome ticks from both sides).
    - A simulated 50 ms one-way network delay does not cause followers to start late relative to the leader's intended start time — the protocol compensates via the offset, not by "play now".
    - The offset estimator rejects single-sample outliers of **> 5 × rolling median** without destabilising the running estimate.

### 9.3 Split-Brain Detection and Guard

- **Current State:** No detection. Two peers could both assume leadership after a network partition.
- **Agent Tasks:**
    - Every transport packet carries `(leader_id, epoch, sequence)`. The epoch is incremented on every leadership handoff or forced takeover.
    - Followers reject any transport command whose `epoch` is lower than the highest epoch they have seen.
    - When a follower sees two distinct `(leader_id, epoch)` pairs with the same epoch within a sliding 5-second window, it enters "split" state and pauses honouring transport commands until the session resolves (deterministic tiebreak: higher `peer_id` by byte order wins).
- **Acceptance Criteria:**
    - A unit test simulates a partition: peers A and B both claim leader at epoch 7. Upon rejoin, all peers converge on the deterministic winner within **≤ 1 second**; the loser's local transport state is marked `desynced` in the UI until manually accepted.
    - A replayed stale packet (`epoch < current`) is dropped silently and logged once per epoch gap.
    - During split state, followers' local audio does not glitch — their transport continues its last-known trajectory at the last-known tempo.
    - The split-state UI affordance is reachable in **≤ 1 click** and returns the user to the winning leader's state.

### 9.4 Host Approval UX for Role Changes

- **Current State:** `src/modules/Collaboration/useCases/permissions.ts` handles basic role storage; there is no host-facing approval modal and no prompt flow for promote/demote actions.
- **Agent Tasks:**
    - When a peer requests promotion (observer → co-writer) or demotion, the host sees a modal with: requesting peer's identity (name, short-hash peer ID, verified presence on this session), requested role, and Accept / Deny / Accept for 60 min buttons.
    - Denied requests surface in the requester's UI with a non-blocking toast; accepted requests take effect on the next Automerge change.
    - Maintain an audit log of every accept/deny/timeout decision, stored in the session document.
- **Acceptance Criteria:**
    - A requesting peer whose role is changed via the host's modal sees the new role applied in the UI within **≤ 2 seconds** of the host clicking Accept.
    - A denied request never mutates the permissions document (verified by diffing pre/post Automerge heads).
    - "Accept for 60 min" automatically reverts the role change after 60 minutes of session wall-clock time; the reversion is logged in the audit trail.
    - The audit log is append-only (no delete path exists in the use-case surface) and exports as JSON via an `exportSessionAuditLog` use-case.

### 9.5 Session-Signed Role Tokens

- **Current State:** Roles are stored in the Automerge `__permissions__` document with no cryptographic proof; a malicious peer could in principle write any role into its local copy.
- **Agent Tasks:**
    - On session creation, the host generates an Ed25519 session keypair (`tweetnacl` or `ed25519-dalek`). The public key is embedded in the session invite.
    - Every role grant (including the host's own) is signed by the session private key, producing a token `{ peer_id, role, issued_at, expires_at, nonce, signature }`.
    - Tokens carry an expiry (default **24 hours**) and a revocation list (revoked nonces, stored in the session document).
    - Receiving peers verify the signature against the embedded public key on **every** merge of `__permissions__`; tokens with invalid signatures, expired `expires_at`, or matching the revocation list are ignored.
- **Acceptance Criteria:**
    - Tampering with a role record locally (editing the Automerge document to upgrade the peer's own role) is detected on the next merge: the tampered record is rejected and the peer's effective role falls back to the last-valid signed token. Verified by a Vitest fixture.
    - Host-initiated revocation (`revokeRoleToken(nonce)`) propagates to all peers within **≤ 5 seconds** on a LAN; after propagation, the revoked peer's effective role is `observer` (the minimum role).
    - Expired tokens (`expires_at < now`) are treated as absent; the UI shows "role expired — request renewal" and offers a one-click renewal request.
    - The session keypair never leaves the host's device; peers only ever see the public key and signed tokens (verified by a code-audit test that the use-case surface exposes no private-key export).

### 9.6 Library Reference Policies for Missing Assets

- **Current State:** `assetTransfer.ts` handles chunked transfers but does not offer a "don't transfer, map to local library" policy. A peer opening a project with large commercial sample libraries would trigger full transfers.
- **Agent Tasks:**
    - Add a per-peer `LibraryRootMapping { hash_prefix_or_manifest_id → local_path }` stored in app settings (not in the shared session document).
    - On encountering an asset hash that is not locally present, consult the mapping. If a matching library root resolves the hash locally, skip network transfer and record the mapping in the session-local cache.
    - If no mapping resolves and the asset is marked `library: commercial` by the originating peer, prompt the user before beginning transfer (rather than starting it silently).
- **Acceptance Criteria:**
    - Opening a project whose `assets/` references 10 GB of Spitfire library content on a peer that has the library installed and mapped triggers **zero bytes** of WebRTC transfer for those assets.
    - On a peer that has neither the library nor a mapping, the UI surfaces a modal listing the missing library, its expected on-disk size, and three options: _Transfer anyway_, _Substitute placeholder silence_, _Resolve manually_.
    - Selecting _Substitute placeholder silence_ produces silent playback for the missing assets and marks each affected clip with a non-blocking indicator — project editing continues without blocking on transfer.
    - Library-root mappings are per-peer and never written to the shared Automerge document (verified by a schema test that rejects the mapping shape at the session-doc boundary).

### 9.6a Advanced Discovery Modes (DHT / Rendezvous / VPN Direct)

- **Current State:** `src/modules/Collaboration` supports manual/QR invites and mDNS local discovery. Nothing else.
- **Agent Tasks (desktop Tauri only):**
    - **DHT / Rendezvous**: optional discovery via libp2p Kademlia and/or libp2p Rendezvous, keyed by the session secret. Bootstrap nodes are user-configurable in Settings → Collaboration (research `consolidated/collaboration.md` §1).
    - **VPN Direct**: treat Tailscale / ZeroTier / WireGuard peers as first-class and skip WebRTC signalling entirely when peers can already reach each other on the VPN network; fall back to STUN/TURN otherwise.
    - **Advanced networking profiles**: user-configurable STUN servers, self-hosted coturn TURN relays, custom rendezvous bootstrap list.
    - All three modes MUST remain optional — mDNS + manual invite stay the defaults.
- **Acceptance Criteria:**
    - Enabling DHT discovery with a valid bootstrap list causes two peers on disjoint LANs to discover and pair without manual invite exchange within **≤ 10 seconds** on a typical home network.
    - With both peers reachable over a Tailscale `100.64.0.0/10` address, audio-assets and CRDT channels negotiate directly without traversing STUN/TURN (verified by packet capture showing no traffic to the STUN server).
    - Custom STUN / TURN / rendezvous values are validated at save time; malformed entries surface a structured error and do not brick the Collaboration module.
    - A session that was configured with DHT discovery loads back correctly on a machine that has DHT disabled — the feature degrades gracefully to the other enabled modes.

### 9.7 Bitmap-Chunked Asset Transfer with Resume

- **Current State:** `assetTransfer.ts` supports chunked transfer but does not persist a per-asset bitmap of received chunks across disconnects.
- **Agent Tasks:**
    - For each in-progress transfer, maintain a receiver-side `ChunkBitmap` (one bit per chunk) persisted to the app's cache directory keyed by `(asset_hash, chunk_size)`.
    - On reconnect, the receiver sends the bitmap to the sender; the sender ships only the missing chunks.
    - Each chunk carries a BLAKE3 hash; mismatches cause the chunk's bit to be cleared and the chunk re-requested (rather than the whole asset restarting).
- **Acceptance Criteria:**
    - Starting a 1 GB asset transfer, disconnecting at **50 %** progress, and reconnecting resumes the transfer from **≤ 50 % + one chunk** (no full restart). Verified in an integration test with a simulated transport.
    - A corrupted chunk (manually flipped byte in transit) is detected via the BLAKE3 check and re-requested without aborting the whole transfer.
    - Bitmaps older than **30 days** or whose asset hashes are no longer referenced by any local project are garbage-collected by a background job.
    - Completed transfers remove the bitmap file; a resumed-then-completed transfer leaves no bitmap residue.

---

## 10. Global Harmonic Awareness & Microtuning

This section extends §6.2 with the full-lifecycle requirements surfaced in `.agents/research/consolidated/global-harmonic-awareness.md`. It does not replace §6.2; it operationalises it.

### 10.1 MTS-ESP Host Lifecycle

- **Current State:** No MTS-ESP integration. Third-party plugins cannot be retuned from Sourdaw.
- **Agent Tasks:**
    - Bundle or discover `libMTS` (`libMTS.dll` / `libMTS.dylib` / `libMTS.so`) at the platform-standard path; provide a first-run installer step for macOS and Windows that drops the library in place with user consent.
    - Implement the full master-side lifecycle in a `MtsEspMaster` service in `daw-engine`: `MTS_RegisterMaster()` on engine start, `MTS_SetNoteTunings(double*)` on every tuning change, `MTS_SetScaleName(const char*)` with the active scale's display name, `MTS_FilterNote(bool, char)` for unmapped keys, and `MTS_DeregisterMaster()` on engine shutdown.
    - Support 16-channel mode via `MTS_SetMultiChannelNoteTunings()` when a per-channel tuning table is active.
    - Surface `MTS_HasIPC()` / client count in a diagnostics panel so users can confirm which plugins have latched onto the host.
    - Deliver tuning updates **independently of the audio sample rate** — updates flow from the UI thread to `libMTS` directly and do not ride on an audio-rate queue.
- **Acceptance Criteria:**
    - Launching Sourdaw with Surge XT loaded as a plugin causes Surge's "MTS-ESP: connected" indicator to light up within **≤ 2 seconds** of plugin instantiation.
    - Changing the project tuning from 12-TET to 31-EDO causes Surge XT, Serum 2, and Pianoteq to report the new scale within **≤ 50 ms** of the UI commit, independent of buffer size or sample rate. Verified manually on the reference session.
    - Closing Sourdaw calls `MTS_DeregisterMaster()` exactly once; no "master still registered" warning appears in subsequent launches of a second instance.
    - The diagnostics panel lists each connected client with its reported name and updates live as plugins are inserted or removed.
    - Only **one** process on the machine is registered as MTS master at a time; a second Sourdaw launch detects the prior master (`MTS_HasMaster()`) and surfaces a "another master is active — running in client mode" indicator instead of forcibly registering.

### 10.2 Lock-Free Tuning Table and Triple-Buffer Delivery

- **Current State:** Oscillator pitch comes from hard-coded 12-TET math (`freq = 440 * 2^((note - 69) / 12)`). No lock-free table, no triple buffer.
- **Agent Tasks:**
    - Define `TuningTable { frequencies: [f64; 128], log2_frequencies: [f64; 128], reference_freq: f64, reference_note: u8 }` in `daw-core` and pre-compute both arrays on every tuning change.
    - Use the `triple_buffer` crate (v9.x) to deliver updates from the UI thread to the audio thread. The `Input` half is owned by the UI side and wrapped in a `Mutex` to serialize Tauri command invocations only — never on the audio thread. The `Output` half is owned by the audio engine and read once per block.
    - Replace all oscillator pitch computations inside `daw-engine` and `daw-dsp` with table lookups (`freq = table.frequencies[note as usize]`), using log2 interpolation for fractional MIDI notes (pitch bend, portamento).
    - Provide a feature-flagged `assert_no_alloc` gate on the audio callback to prove table reads never allocate.
- **Acceptance Criteria:**
    - `TuningTable` is exactly **2 KB** per instance (`128 * 8 * 2 + 16` bytes ≈ 2064 bytes); verified by a `size_of::<TuningTable>()` unit test.
    - The audio callback's tuning-table read path contains **zero atomic operations when no update is pending** (verified by inspecting the generated assembly for a release build of the read path — checked in as a golden `.S` excerpt under `docs/architecture/traces/`).
    - Pushing 1000 tuning updates in 1 second from the UI thread never causes the audio thread to see a torn table (verified via a stress test with a CRC-checked table shape).
    - Fractional MIDI note `60.5` returns a frequency equal to `2^((log2(table[60]) + log2(table[61])) / 2)` within **1e-9 Hz** (log2-space interpolation, not linear).
    - Replacing the 12-TET formula in the codebase is complete: `rg "2.0_f64.powf.*/\s*12"` returns **zero** hits inside `daw-engine` and `daw-dsp`.

### 10.3 Surge-Style Microtonal Math — Public API

- **Current State:** No public API surfaces microtonal primitives; DSP code hardcodes 12-TET math.
- **Agent Tasks:**
    - Expose a `microtuning` public module from `daw-core` that mirrors Surge XT's `Tuning` / `Scale` / `KeyboardMapping` types with Rust-native idioms: `Tone { cents: f64, ratio: Option<Ratio>, float_value: f64 }`, `Scale { tones: Vec<Tone> }`, `KeyboardMapping { count, first_midi, last_midi, middle_note, tuning_constant_note, tuning_frequency, octave_degrees, mapping: Vec<Option<u32>> }`.
    - Implement two pitch-bend modes (Surge-parity): **cents-space** (default, `base_freq * 2^(bend_semitones / 12.0)`) and **scale-degree space** (interpolating within the active tuning table). The choice is persisted per-patch.
    - Implement portamento as log2-space interpolation between the source and destination table entries (constant-perception glide regardless of interval size).
    - Provide `cents ↔ ratio` conversion helpers (`cents = 1200 * log2(ratio)`, `ratio = 2^(cents / 1200)`) with `f64` precision.
- **Acceptance Criteria:**
    - Converting `5/4` → cents yields `386.3137138648348` within **1e-12**.
    - Converting `386.3137138648348` cents → ratio yields `1.25` within **1e-12**.
    - Loading a 31-EDO Scala file through the `microtuning` module produces 31 `Tone` entries whose `cents` values are `1200 * k / 31` for `k in 1..=31` within **1e-9**.
    - A patch saved with `pitch_bend_mode = ScaleDegree` round-trips through project save/load with the bit-identical mode value.
    - Portamento from MIDI 60 to MIDI 72 at a 1-second glide produces a monotonically increasing log2 frequency with **≤ 1e-9** deviation from linear-in-log2 at every sampled timestep.

### 10.4 Adaptive Piano Roll for Arbitrary N-TET

- **Current State:** The piano roll renders 12 rows per octave unconditionally.
- **Agent Tasks:**
    - Parameterise the piano-roll renderer on `steps_per_octave: u32` read from the active `TuningTable`'s associated `KeyboardMapping.octave_degrees` (or the scale's degree count for octave-repeating scales).
    - For each row, display the custom note name from `.ascl` metadata when available; otherwise fall back to scale-degree index with cents offset (e.g. `"2 (+76¢)"`).
    - Maintain the existing keyboard-shortcut workflow (arrow keys, shift-select, etc.) agnostic of `steps_per_octave`.
    - Support five controller-layout modes mirroring Ableton Live 12: **All Keys**, **Black Only**, **White Only**, **Closest in Pitch**, **Custom**.
- **Acceptance Criteria:**
    - Loading a 19-EDO tuning renders **19 rows per octave**; loading 31-EDO renders **31 rows**; loading standard 12-TET renders **12 rows**. Verified via a snapshot test of the piano-roll DOM for each tuning.
    - Note names loaded from an `.ascl` file appear on the rows without truncation at the default zoom level; zoom-out collapses labels to scale-degree numbers.
    - Drag-drawing a note in a 31-EDO view places the MIDI event on the correct row such that the played frequency matches the row's `frequencies[index]` within **1e-9 Hz**.
    - Switching controller-layout mode from **All Keys** to **Closest in Pitch** remaps the physical keyboard shortcuts without relaunching or rebuilding the roll; verified by an integration test.
    - The renderer does not regress the §7.1 UI-main-thread long-task budget when switching between 12-row and 53-row layouts.

### 10.4a Non-Destructive Scale Folding for Key Changes

- **Current State:** Changing a project key does not remap existing MIDI clips; users must manually retune.
- **Agent Tasks (research `consolidated/global-harmonic-awareness.md` §Scale folding):**
    - Implement the three-phase **decompose → map → reconstruct** fold: decompose each note into `(scaleDegree, octave, chromaticOffset)` in the source scale; map the degree to the destination scale (1:1 when degree counts match, nearest-chromatic-PC otherwise); reconstruct the MIDI note against the destination root.
    - Proportional remapping for out-of-scale chromatic notes: `newChromaticOffset = round(chromaticOffset × dstGap / srcGap)`.
    - Generalise `mod 12` to `mod stepsPerOctave` so the same fold works for non-12-TET scales.
    - Store every clip's `sourceScale` at creation; the fold is a **pure function** evaluated at display and playback. A "Bake" operation commits the fold permanently.
- **Acceptance Criteria:**
    - C Major → D Dorian fold on the reference fixture (`docs/architecture/traces/scale-fold-fixture.mid`) produces output MIDI identical to the documented expected mapping (C→D, E-F gap → A-B gap, G# passing tone → B♭).
    - Changing the project scale and then changing it back produces **byte-identical** original MIDI (pure-function property verified by fixture test).
    - Baking the fold replaces the stored MIDI in-place and clears `sourceScale`; subsequent scale changes no longer re-fold the baked clip.
    - A 31-EDO source scale folds to a 19-EDO destination scale without crashing; out-of-scale degrees round to the nearest destination degree with a logged warning (not an error).

### 10.5 Scala Format Support Matrix (.scl / .kbm / .ascl)

- **Current State:** No Scala format parsing exists in the repository.
- **Agent Tasks:**
    - Integrate the `tune` crate (or write a small parser if `tune` is insufficient) to load `.scl`, `.kbm`, and Ableton `.ascl` files into the `microtuning` types from §10.3.
    - Support the full `.scl` grammar: comment lines starting with `!`, description line, count line, per-tone lines that are either **ratios** (no period — e.g. `5/4` or bare `3` meaning `3/1`) or **cents** (containing a period — e.g. `386.3137`). Degree 0 is implicit `1/1`. The final entry is the period (usually `2/1`).
    - Support the `.kbm` format's seven header values (map size, first MIDI, last MIDI, middle note, reference note, reference frequency, octave degree) plus the cyclic mapping table with `x` denoting unmapped keys.
    - Support the `.ascl` superset (reference pitch, named degrees, category metadata) sufficient to round-trip Ableton Live 12's bundled tunings.
- **Acceptance Criteria:**

| Format | Read | Write | Notes |
| --- | --- | --- | --- |
| `.scl` | Required | Required | Both ratios and cents, octave-repeating and non-octave periods. |
| `.kbm` | Required | Required | Full seven-header plus mapping; `x` unmapped. |
| `.ascl` | Required | Required | Round-trip with Ableton Live 12 reference set. |

    - Loading every tuning in `docs/architecture/traces/scala-fixture/` (a curated set of 50 files covering EDO, meantone, historical, JI, and non-octave scales) succeeds with zero parser errors and produces tuning tables whose frequencies match a reference CSV within **1e-9 Hz** per entry.
    - Writing a `.scl` file back and re-reading it produces a byte-identical file for the ratio-form tunings and a file whose parsed frequencies match within **1e-12** for cents-form tunings.
    - Writing a `.kbm` file back and re-reading it reproduces the original keyboard mapping exactly (including `x` markers at the same positions).
    - An `.ascl` file loaded from Ableton Live 12's bundled tuning set round-trips through save/load in Sourdaw with identical named-degree metadata and reference pitch.
    - A malformed file (missing count line, non-numeric ratio, reference-note out of range) produces a structured `TuningParseError` naming the line number; the parser never panics (verified by a `cargo fuzz` target running for ≥ 5 minutes in CI).
