# Deep analysis of openDAW: features your competing DAW is missing

**openDAW ships 18+ production-ready audio devices, a DAWproject interoperability pipeline, neural amp modeling via WebAssembly, probability-based sequencing, and a MIDI effects pipeline — none of which exist in the competing Tauri/React project.** Built by André Michelle (creator of Audiotool, 25+ years in browser audio), the project demonstrates that a zero-framework, TypeScript-only architecture can deliver a fully functional DAW with ~2,535 commits. The most valuable takeaways for the competing project fall into three categories: implemented DSP devices that took years to build, novel creative features rare even in commercial DAWs, and architectural patterns for separating a headless audio SDK from the UI layer.

---

## The 18 built-in devices represent years of DSP work

The single biggest gap between openDAW and the competing project is a complete library of **18 production-ready instruments and effects**, all running as AudioWorklet processors in TypeScript. The competing project has a Rust/cpal audio engine and CLAP/VST3 hosting but lacks built-in devices that work out of the box.

**Instruments (6):**

- **Vaporisateur** — a full subtractive synthesizer with classical waveforms (saw, square, sine, triangle, pulse), filter, and amplifier envelopes. This is the canonical oscillator→filter→amp architecture. _Complexity: significant (4–6 weeks for a Rust-native equivalent)_
- **Playfield** — a sample drum computer where **each pad has its own independent effect chain**. This per-pad routing is a feature normally found only in Bitwig, Ableton, or FL Studio. _Complexity: significant_
- **Nano** — a single-file sampler with volume, release time, and C3 root note. Simple but immediately useful for melodic sampling. _Complexity: moderate_
- **Tape** — the audio region/clip playback engine that handles timeline-based audio with regions. This is the core audio playback device. _Complexity: moderate_
- **Soundfont** — a .sf2 SoundFont player using the `soundfont2` parsing library. Provides instant access to hundreds of GM instruments. _Complexity: moderate_
- **MIDI Output** — sends MIDI messages to external hardware via Web MIDI API. _Complexity: trivial_

**Audio Effects (9):**

- **Dattorro Reverb** — a dense algorithmic reverb based on Jon Dattorro's 1997 plate reverb design (inspired by Lexicon 224/480 hardware). Uses interconnected allpass filters in a ring/tank structure with pre-delay, input diffusion, decay diffusion, and damping. _Complexity: significant_
- **Cheap Reverb** — a FreeVerb variation using Jezar's algorithm: 8 parallel Schroeder-Moorer filtered-feedback comb filters + 4 series allpass filters per channel. _Complexity: moderate_
- **Revamp** — a graphical parametric EQ with **real-time FFT spectrum analyzer** overlay. Uses biquad-based peaking filters. _Complexity: moderate_
- **Delay** — stereo delay with cross-feedback (ping-pong) and filter in the feedback path. _Complexity: moderate_
- **Fold** — a waveform folding distortion with **oversampling** for anti-aliasing. The oversampling is key — without it, wavefolder distortion produces severe aliasing artifacts. _Complexity: moderate_
- **Crusher** — bit-depth and sample-rate reduction (bitcrusher). _Complexity: trivial_
- **Stereo Tool** — volume, panning, stereo inversion, plus an **autogain normalizer** that analyzes the waveform and sets peak to 0dB. The autogain feature is uncommon. _Complexity: trivial_
- **Tidal** — shapes rhythm and space through automated volume and pan modulation. Essentially a rhythmic auto-panner/tremolo. _Complexity: moderate_
- **Compressor** — ported from the CTAG Dynamic Range Compressor (p-hlp/CTAGDRC), demonstrating the pattern of bringing C++/native DSP algorithms into the web/TS environment. _Complexity: moderate (already have CLAP/VST3 hosting, but a built-in compressor is still valuable)_

**Adaptation for Tauri/Rust:** These devices run as AudioWorklet processors in TypeScript. In the competing project's architecture, equivalent devices would run as Rust DSP processors on the cpal audio thread, connected via the lock-free ring buffer architecture. The DSP algorithms themselves (Dattorro reverb topology, FreeVerb comb/allpass structure, biquad EQ) are well-documented and would port cleanly to Rust. The per-pad effect chain routing in Playfield requires the Routing module to support nested effect chains within a single device.

---

## MIDI effects pipeline is a distinct missing layer

openDAW implements **MIDI effects as a separate device category** that processes MIDI events before they reach instruments — a pattern found in Ableton Live and Bitwig but absent from the competing project's architecture.

**Four MIDI effect devices:**

- **Arpeggio** — plays chord notes one after another in configurable patterns (up, down, random, etc.)
- **Pitch** — offsets all incoming MIDI note pitches by a fixed semitone amount
- **Velocity** — remaps or scales velocity curves of incoming MIDI notes
- **Zeitgeist** — a groove manipulation tool with just **two knobs** (eighth-note duration and groove amount). At 50% amount = no swing; adjusting shifts events between eighth-note positions. Particularly effective for hip-hop grooves. Per Polarity's review: "Very fun... you get nice grooves out of it"

**Why this matters:** The competing project's DDD architecture has separate MIDI and AudioEngine modules but no explicit MIDI effects pipeline. MIDI events flow from input to instruments without transformation. Adding a MIDI effects chain between the MIDI module and the instrument input would enable arpeggiators, humanizers, chord generators, and groove quantization — features expected in any serious DAW.

**Adaptation:** Create a `MIDIEffects` sub-module within the MIDI domain. Each MIDI effect implements a `processMidiEvent(event, context) → MidiEvent[]` interface. Chain them in the track's signal path before the instrument. The groove tool (Zeitgeist) is particularly interesting — it's a lightweight timing offset table indexed by beat subdivision position. _Complexity: moderate for the pipeline, trivial-to-moderate per effect_

---

## Probability sequencing and microtonal pitch are rare creative features

The openDAW note editor includes two features uncommon even in commercial DAWs:

**Probability-based note triggering** allows each note in a MIDI sequence to have a percentage chance of playing. This is a feature found in Ableton Live 11+ and Bitwig Studio but extremely rare in open-source or web DAWs. Each note carries a probability value (0–100%); the sequencer rolls a random number at playback time and skips the note if the roll exceeds the probability. This adds controlled randomness to patterns without requiring complex generative systems.

**Microtonal pitch adjustment** per note enables pitch values finer than semitones. This goes beyond standard MIDI pitch-bend — each note can have a fractional pitch offset, enabling quarter-tones, just intonation, or any custom tuning system.

**Adaptation for the competing project:** Probability requires adding a `probability: number` field to the MIDI note data model and a check in the sequencer playback loop. Microtonal pitch requires a `finePitch: number` (in cents) field per note and corresponding pitch-bend generation on the audio engine side. Both are _trivial to moderate_ in implementation complexity but significantly enhance the piano roll's creative power — and would differentiate it from FL Studio's piano roll approach.

---

## DAWproject format enables cross-DAW interoperability

openDAW implements a full **DAWproject import/export pipeline** — the open format created by Bitwig (https://github.com/bitwig/dawproject) for exchanging projects between DAWs. The pipeline handles audio, MIDI, devices, sends, routing, and metadata, and has been tested with Bitwig Studio imports.

The format is XML/ZIP-based: a `project.xml` file describing the session structure alongside audio assets. openDAW built a dedicated `lib-xml` library for XML processing and a `DawProject` schema with parsing, validation, and tests.

**Why this matters:** No other open-source DAW implements DAWproject. Supporting it would allow users to move projects between the competing project and Bitwig Studio, PreSonus Studio One, or Steinberg Cubase. For a new DAW trying to gain adoption, this removes a major barrier — users aren't locked in.

**Adaptation:** Build a DAWproject module in the competing project's DDD architecture that serializes/deserializes the Project domain model to/from the DAWproject XML/ZIP format. The `quick-xml` crate in Rust handles XML parsing efficiently. _Complexity: significant (2–4 weeks) but high strategic value._

---

## Neural amp modeling runs directly in the browser via WASM

The **TONE3000 integration** gives openDAW access to **275,000+ Neural Amp Modeler (NAM) captures** running in real-time via a WebAssembly runtime. Users sign in with a one-time email passcode and can browse/load NAM captures of real amplifiers, then record audio through them with live monitoring.

This is a standout feature — running neural network inference for guitar/bass amp simulation in the browser at audio rates. The WebAssembly runtime executes the NAM model (~1M parameter neural networks) within the AudioWorklet thread.

**Adaptation for Tauri/Rust:** The competing project could implement NAM natively in Rust (the `nam-rs` or similar crates exist) running on the cpal audio thread, which would actually perform _better_ than the WASM approach. Alternatively, integrate with the NAM ecosystem's model format directly. The key insight is that amp modeling via neural networks is a killer feature for guitarists and could be implemented as a built-in CLAP plugin. _Complexity: significant but leverages the Rust advantage._

---

## Headless SDK separation creates a reusable audio engine

openDAW's most architecturally elegant pattern is the **separation of the audio engine into a headless SDK** (`@opendaw/studio-sdk` on npm). The SDK contains the audio graph, worklets, workers, controller learning, MIDI handling, and project management — without any UI code. The full DAW (`packages/app/studio`) consumes this SDK, and there's a separate `opendaw-headless` template for building custom audio applications on the same engine.

The monorepo structure under `packages/` includes:

- **`lib-core`** — Observable/reactive primitives, lifecycle management (`Terminable` pattern), utility types (`Maybe<T>`, `Optional<T>`)
- **`lib-midi`** — MIDI message parsing and handling
- **`lib-xml`** — XML parsing (for DAWproject)
- **`lib-dsp`** — DSP primitives
- **`studio-sdk`** — High-level DAW orchestration (aggregates the above)
- **`app/studio`** — The web UI that consumes the SDK

**Key reactive primitives:**

- **`ObservableOption<T>`** — Observable wrapper for optional values
- **`Terminable`** — Deterministic cleanup interface (like IDisposable) for managing subscription lifecycles
- **`ConstrainDOM`** — DOM constraint utility for layout

**Adaptation:** The competing project's DDD modular architecture already separates concerns across modules (Arrangement, AudioEngine, Transport, etc.). The additional insight from openDAW is to publish the engine as a standalone library — enabling headless rendering, CI/CD audio pipelines, and third-party applications built on the same engine. This is a strategic differentiator for ecosystem building. _Complexity: moderate (mostly packaging/API design rather than new code)_

---

## Project bundles and OPFS storage solve offline persistence elegantly

openDAW stores projects as **`.odaw` ZIP bundles** (using jszip) containing JSON metadata and audio assets. Samples are cached in the browser's **OPFS (Origin Private File System)** — a high-performance, sandboxed file system API that persists across sessions without requiring a server.

The **`ProjectBundle`** class provides isolated asset management, and the system supports:

- Export entire projects as shareable single files
- Stem export as ZIP archives
- Dynamic imports for ZIP handling (lazy loading to reduce initial bundle size)
- **Cloud sync via OAuth** with Google Drive and Dropbox — data never touches openDAW's servers

**Adaptation for Tauri:** The competing project already has native file system access via Tauri v2, making OPFS unnecessary. However, the `.odaw` ZIP bundle format and the DAWproject export both represent portable project formats worth considering. A single-file project export (ZIP with embedded audio) is essential for sharing. The OAuth-based cloud sync pattern could be adapted for Tauri using `tauri-plugin-oauth`. _Complexity: moderate_

---

## Recording infrastructure includes step recording and count-in

openDAW's "First Take" release added comprehensive recording:

- **Audio recording** from browser microphone/line input via getUserMedia
- **MIDI recording** from external controllers
- **Step recording** — enter notes one at a time without real-time performance, a workflow beloved by hardware sequencer users
- **Count-in** before recording starts (suppressible with Shift+Record)
- **Track arming** with visual recording state indicators
- **Input monitoring with effects** — hear yourself through the effect chain while recording
- **Loop recording with multiple takes**

**What the competing project likely lacks:** Step recording and count-in are commonly overlooked in early DAW implementations. Step recording in particular requires a different sequencer mode where the playhead advances only when a note is entered, not in real-time. This is a _moderate_ implementation that significantly improves the MIDI editing workflow.

---

## GraphPage visualizes the audio routing as a node graph

openDAW includes a **GraphPage** component that renders the project's audio/MIDI routing as a force-directed node graph using **d3-force**. This debug/visualization tool shows how devices, tracks, sends, and busses are connected.

While primarily a debugging tool, this concept could evolve into a modular routing view similar to Bitwig's device chain visualization or a Max/MSP-style patcher. The competing project's Routing module could benefit from a similar visual representation, especially as routing complexity grows with sends, busses, and sidechains.

**Adaptation:** Build a RoutingGraph component using a force-directed layout library (e.g., `d3-force` or `force-graph` for React). Each node represents a track/device/bus, edges represent audio connections. _Complexity: moderate_

---

## Controller learning maps hardware knobs to parameters

openDAW's SDK includes **controller learning** infrastructure — the ability to enter a "learn" mode, wiggle a hardware MIDI controller knob, and map it to any automatable parameter. This was important enough to be refactored from the app layer into the SDK/core in the major restructuring.

**Adaptation:** The competing project has MIDI input via `midir` in Rust. Controller learning requires: (1) a "learn mode" that listens for incoming CC messages, (2) a mapping table persisted per project (CC number + channel → parameter path), (3) routing incoming CC values to the mapped parameters on the audio thread. _Complexity: moderate_

---

## What openDAW does NOT have that the competing project already does or plans

The comparison cuts both ways. openDAW explicitly lacks several things the competing project already ships or plans:

- **No VST/CLAP plugin hosting** — the #1 criticism from users. The competing project's clack-host integration is a major advantage
- **No Ableton-style Session View** — only linear timeline
- **No modulation system** (Bitwig-style halos) — openDAW's modulation is limited to manual automation drawing; modular system is "Future" roadmap
- **No AI features** — stem separation, audio-to-MIDI, NL commands are all on the wish list but not implemented
- **No voice dictation**
- **No native performance** — browser-based with inherent latency limitations; Tauri/Rust is fundamentally faster
- **No WebGPU rendering** — openDAW uses Canvas 2D only
- **No offline desktop app** (yet) — Tauri wrapping is on their wish list, which the competing project already has
- **Safari incompatibility** — the competing project's Tauri approach avoids browser compatibility issues entirely
- **No delta-based undo** — the competing project's coalescing undo/redo system is likely more sophisticated

---

## Consolidated gap analysis with implementation priorities

Below are the features from openDAW that the competing project should prioritize, ranked by **impact vs. effort**:

| Feature                                                    | Impact | Effort      | Priority |
| ---------------------------------------------------------- | ------ | ----------- | -------- |
| MIDI effects pipeline (arpeggiator, groove tool, velocity) | High   | Moderate    | **P1**   |
| Built-in synth (subtractive, à la Vaporisateur)            | High   | Significant | **P1**   |
| Probability-based note triggering                          | High   | Trivial     | **P1**   |
| DAWproject import/export                                   | High   | Significant | **P1**   |
| Step recording for MIDI                                    | Medium | Moderate    | **P2**   |
| Controller learning (MIDI CC mapping)                      | Medium | Moderate    | **P2**   |
| Per-pad effect chains in drum machine                      | Medium | Significant | **P2**   |
| Microtonal pitch per note                                  | Medium | Trivial     | **P2**   |
| Built-in reverbs (Dattorro + FreeVerb)                     | Medium | Moderate    | **P2**   |
| Graphical EQ with spectrum analyzer (Revamp)               | Medium | Moderate    | **P2**   |
| SoundFont player                                           | Low    | Moderate    | **P3**   |
| Neural amp modeling (NAM)                                  | Medium | Significant | **P3**   |
| Single-file project export (ZIP bundle)                    | Low    | Moderate    | **P3**   |
| Recording count-in                                         | Low    | Trivial     | **P3**   |
| Piano Tutorial Mode                                        | Low    | Trivial     | **P3**   |
| Routing visualization (GraphPage)                          | Low    | Moderate    | **P3**   |
| Stereo Tool autogain normalizer                            | Low    | Trivial     | **P3**   |

## Conclusion

openDAW's greatest strength is **completeness** — it ships a working DAW with 18 devices, recording, MIDI editing, automation, and project management. The competing project's greatest strengths are **native performance** (Rust/Tauri), **plugin hosting** (CLAP/VST3), and **AI integration** — areas where openDAW has nothing. The highest-value items to borrow from openDAW are the **MIDI effects pipeline with groove manipulation**, **probability-based sequencing** (trivial to implement, disproportionate creative value), the **DAWproject format** for cross-DAW interoperability, and the general pattern of having a **library of built-in devices** that work without external plugins. The Dattorro reverb algorithm and the waveform folder with oversampling are particularly well-chosen DSP implementations worth porting to Rust for the built-in effects library.
