# Consolidated Implementation Gaps Specification

## Metadata
- **Type:** Implementation Specification
- **Purpose:** To serve as a master checklist and architectural guide for an AI agent to close the remaining gaps between the DAW's ultimate architectural research/specs and the current codebase.
- **Context:** Tauri v2, Rust (Real-Time DSP), React/TypeScript (Frontend).

---

## 1. The Factory Suite (Master Instruments)

The current implementation of the flagship instruments provides a solid foundation but falls short of the advanced DSP and UX detailed in the "Ultimate Guides."

### 1.1 The Master Drum Machine
*   **Current State:** `Grinder` is currently implemented as an Amp Simulator. `Toaster` is a basic pad-based sampler.
*   **Implementation Gap:** We lack the flagship, Ableton/Maschine-tier Drum Machine.
*   **Agent Tasks:**
    *   Implement advanced drum synthesis engines (808/909 physical models, modal synthesis for percussion).
    *   Implement the integrated step sequencer with parameter locks, conditional triggers, and micro-timing.
    *   Add transient shapers and advanced slicing to the pad workflow.
    *   *Note:* Decide architecturally whether to upgrade `Toaster` into this flagship device or create a new dedicated crate/module.

### 1.2 Levain (The Orchestral Suite)
*   **Current State:** Basic multi-sampler.
*   **Implementation Gap:** Missing the performance intelligence required to make samples sound like a living orchestra.
*   **Agent Tasks:**
    *   Build the **True Legato Engine** (interval transitions, crossfade logic).
    *   Implement **Continuous Expression Modeling** (CC1 dynamics crossfading, CC11 volume).
    *   Add **Spatial Mic Mixing** (Close, Tree, Ambient) with phase alignment tools.
    *   Implement **Physical Modeling Augmentation** (synthetic vibrato LFOs, bow noise).

### 1.3 Fermenter (The Master Synth)
*   **Current State:** Highly implemented (LayerStack, MacroStrip, basic wavetable playback).
*   **Implementation Gap:** The wavetable engine relies on a static crossfader rather than a high-end spectral morphing engine.
*   **Agent Tasks:**
    *   Implement the **Vital-style Spectral Morphing Engine** (processing frequency-domain wavetables at runtime).
    *   Add anti-aliasing via mip-map generation and lookup.
    *   Implement true Phase Modulation (PM/FM) routing matrices.
    *   Implement GPU-accelerated additive synthesis (WebGPU/wgpu).

---

## 2. Advanced DSP & Analog Modeling

The current DSP library (`crates/daw-dsp`) relies heavily on standard SVF filters and linear envelopes.

*   **Agent Tasks:**
    *   **ZDF Filters:** Implement Zero-Delay Feedback (ZDF) models for Moog and MS-20 ladder filters using Vectorial Newton-Raphson solvers to prevent high-frequency cramping.
    *   **Envelopes:** Implement capacitor charge curve (exponential/RC) envelopes instead of purely linear ones for true analog snap.
    *   **Oscillators:** Implement MinBLEP or PolyBLEP for hard sync and aliasing-free discontinuous waveforms.

---

## 3. Collaboration & Networking

The foundation (Automerge, WebRTC, mDNS) is solid, but professional collaborative features are missing.

### 3.1 Transport & Playback Sync
*   **Architectural Decision:** **DO NOT** force hard-sync of the audio playback transport across peers (it is highly disruptive to user workflow).
*   **Agent Tasks:** Implement **Ghost Playheads**. Broadcast each peer's playhead position (and loop region) via the presence/CRDT channels so users can see where others are working, without hijacking their local transport.

### 3.2 Media Channels & Discovery
*   **Agent Tasks:**
    *   Implement separate WebRTC Media Channels for **Voice Chat** and **Remote Monitoring** (Opus encoded).
    *   Implement advanced discovery: VPN Direct (Tailscale/ZeroTier integration) and DHT/Rendezvous routing for desktop builds.
    *   Implement Automerge document compaction strategies to prevent memory bloat over long sessions.

---

## 4. Plugin Hosting Architecture

The current native hosting relies on a custom `Vst3Wrapper`.

*   **Agent Tasks:**
    *   Migrate the primary hosting architecture to **CLAP** using `clack-host` for a safer, more robust Rust abstraction.
    *   Implement out-of-process sandboxing using `shmem-ipc` to prevent plugin crashes from taking down the DAW.
    *   Implement native Web Audio node offloading (e.g., using `DynamicsCompressorNode` where applicable to save WASM CPU).
    *   Integrate the `creek` crate for real-time safe disk streaming for large sample libraries.

---

## 5. Workflow, AI, and Extended Features

These are additive features that have been deeply researched but are missing from the codebase.

### 5.1 Integrated Stem Separation Workflow
*   **Current State:** Demucs runs locally.
*   **Agent Tasks:** Integrate it deeply into the UI: allow drag-and-split, auto-route separated stems to dedicated mixer lanes, and allow easy re-sampling of stems into the sampler suite.

### 5.2 A Serious Vocal Suite
*   **Current State:** `Knead` handles basic pitch correction.
*   **Agent Tasks:** Expand into a full vocal bundle: Formant-preserving harmonization, real-time doubler, and a dedicated UI for vocal comping and de-essing.

### 5.3 Clip Aliases & Automation Clips
*   **Current State:** Basic "Figma-style" linked clips exist.
*   **Agent Tasks:** Elevate automation clips to first-class reusable objects. Implement variation lanes (for choruses/fills) and project-wide groove templates that apply over linked clips.

### 5.4 World-Class Browser & Content System
*   **Current State:** Basic local folder scanning and tag models exist.
*   **Agent Tasks:** Implement "Sound Similarity Search" (spectral embeddings), AI auto-tagging, contextual drag-auditioning with tempo/key sync, and mix-ready genre starter packs to expand the factory content.

### 5.5 Deep MPE Editing & Hardware Scripting
*   **Current State:** DSP supports MPE; basic MIDI learn exists.
*   **Agent Tasks:** Build per-note expression lanes (timbre/pressure/pitch) in the Piano Roll. Expand the scripting API to support auto-mapped hardware controller profiles (e.g., Push, Launchpad) with community sharing.

### 5.6 Mastering Translation Workflow
*   **Current State:** `Proof` mastering suite and `Crust` limiter handle LUFS targets.
*   **Agent Tasks:** Implement a Mastering Assistant (smart chain generation), monitor translation curves (Car, Phone, Mono), and an A/B/C reference track comparison workflow.

---

## 6. Advanced Composition, Media & Standards

These features represent massive architectural additions that require deep, separate research before implementation, but they constitute the final gaps to rival tier-1 DAWs.

### 6.1 Articulation Maps & Keyswitch Management
*   **Current State:** Basic SFZ keyswitching is supported conceptually, but there is no DAW-level mapping system or UI.
*   **Agent Tasks:** Build an Articulation Map schema in the TypeScript project state. Implement a MIDI interception layer in Rust that translates UI articulation labels into hidden keyswitch/CC events immediately before the plugin node. Implement articulation chasing for playback jumps.

### 6.2 Project-Wide Key, Scale & Microtuning (Scala)
*   **Current State:** Basic scale quantization exists in MIDI effects, but no global harmonic awareness or microtuning.
*   **Agent Tasks:** Implement global pitch tables in the Rust engine for lock-free oscillator tuning via `.scl`/`.kbm` files. Implement MTS-ESP support for tuning third-party plugins. Add project-wide key signatures that automatically fold/transpose MIDI clips non-destructively.

### 6.3 ARA-Style Editing & Clip-Native Deep Correction
*   **Current State:** No native clip editor or ARA support.
*   **Agent Tasks:** Architect and implement either ARA 2 host interfaces via the `clack-host` / `vst3_wrapper` or build a custom first-party React/Rust pitch editor using the `Knead` module. Implement background offline-commit bouncing for corrected regions.

### 6.4 Video, Spotting, and Scoring-to-Picture
*   **Current State:** A basic video track exists in the UI, but synchronization is rudimentary.
*   **Agent Tasks:** Solve the HTML5-to-CPAL clock drift problem to slave the video's `currentTime` to the sample-accurate Rust playhead. Implement drop-frame SMPTE math, hit-points, and Rust-native video demuxing/muxing for export.

### 6.5 Usable Notation & Lead-Sheet Layer
*   **Current State:** Strictly piano-roll MIDI editing.
*   **Agent Tasks:** Implement a React-based notation rendering engine (e.g., VexFlow or OSMD). Implement "display quantization" heuristic algorithms so unquantized MIDI is readable on a staff. Build a MusicXML export pipeline.

### 6.6 Spatial / Immersive / Dolby Atmos Mixing
*   **Current State:** The mixer is stereo with basic 2D surround panning via Canvas.
*   **Agent Tasks:** Implement Vector Base Amplitude Panning (VBAP) for arbitrary 3D speaker layouts (7.1.4) in Rust. Implement a binaural HRTF renderer for headphone mixing. Build an ADM BWF export pipeline for Dolby Atmos deliveries.
