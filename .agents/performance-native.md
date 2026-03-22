# Building a professional DAW with Tauri and Rust

**A Tauri-based DAW should split cleanly: all audio processing in Rust on a dedicated real-time thread, all UI rendering in the webview, with IPC carrying only control messages and visualization data — never audio buffers.** This architecture exploits Tauri's strengths (native Rust performance, small footprint, multi-window support) while avoiding its IPC bottleneck (~0.5ms per invoke, JSON-serialized). The same Rust DSP core can compile to both native (Tauri backend) and WebAssembly (browser AudioWorklet), enabling a single codebase to power desktop and web versions. This report covers the complete technical architecture across engine design, IPC strategy, UI rendering, plugin hosting, and browser deployment.

---

## The Tauri IPC bridge: fast enough for controls, too slow for audio

Tauri v2 provides three IPC primitives between the Rust backend and the webview frontend. **Commands** (`invoke`) use a JSON-RPC-like protocol where arguments serialize via `serde::Serialize`. **Events** are bidirectional fire-and-forget messages — the official docs explicitly warn they are "not designed for low latency or high throughput." **Channels** (`tauri::ipc::Channel`) stream ordered data from Rust to JavaScript and are the fastest option for continuous data flow.

Measured IPC performance tells the story. Small-payload round trips clock at **~0.5ms per invoke**. Binary transfers using `tauri::ipc::Response` (which bypasses JSON serialization and returns raw `ArrayBuffer`) can move 150MB in under 60ms on macOS — a dramatic improvement over Tauri v1's 50-second equivalent. However, Windows WebView2 performance lags significantly: 10MB takes ~200ms, and streaming response bodies aren't fully supported on Windows's custom protocols. There is no cross-platform shared memory — only Windows WebView2 exposes `SharedBuffer`, and even that path is reported as "weirdly slow" by Tauri maintainers.

The architectural implication is unambiguous. At 44.1kHz, each audio sample arrives every **~23 microseconds**. The IPC bridge is three orders of magnitude too slow for audio-rate data. Audio processing must happen entirely in Rust with its own dedicated thread. The IPC carries only control messages (play, stop, seek, load) via commands, and visualization data (meter levels, playback position, waveform peaks) via channels at **30–60fps** — well within IPC capacity at ~480 bytes/sec for position data and ~240 bytes/sec per track for meters.

```
┌─────────────────── RUST BACKEND ───────────────────┐
│  Audio Thread (cpal)     Engine Thread (Tokio)      │
│  ├─ DSP Graph            ├─ Command handlers        │
│  ├─ Lock-free I/O        ├─ Tauri State management  │
│  └─ Speaker output       └─ File I/O, plugin scan   │
│         ↕ rtrb SPSC              ↕ mpsc channels     │
│                  Tauri IPC Bridge                    │
│         Commands (~0.5ms) │ Channels (streaming)     │
└────────────────────────────────────────────────────┘
                          ↕
┌─────── WEBVIEW FRONTEND (SolidJS) ─────────────────┐
│  Timeline/Arrangement │ Piano Roll │ Mixer Window   │
│  Canvas/WebGL         │ Canvas 2D  │ DOM components  │
└────────────────────────────────────────────────────┘
```

Tauri v2 supports **multi-window applications** natively — each window runs in its own WebView process while sharing the Rust backend. This maps directly to DAW workflows: arrangement view, piano roll, mixer, and plugin editors as separate windows. Inter-window communication routes through Rust backend state or targeted events. Tauri also provides file system access via `tauri-plugin-fs`, native file dialogs via `tauri-plugin-dialog`, drag-and-drop events, global keyboard shortcuts, system tray integration, and a rich plugin architecture with permission-based capabilities.

---

## Rust audio engine: signal flow graph with strict thread isolation

The engine architecture should follow a **directed signal flow graph** with message-passing between threads. DAWs are fundamentally signal processing pipelines — audio flows from sources through effects chains to a master bus. A directed acyclic graph naturally models this, with nodes as processors (instruments, effects, mixers) and edges as audio connections. Processing order comes from topological sort, and independent branches can execute in parallel.

The Actor model and ECS (Entity Component System) patterns are poor fits. Actors add unnecessary indirection for tightly-coupled audio processing where deterministic ordering is essential. ECS is designed for heterogeneous game entities, not the homogeneous processor-node structure of audio graphs.

### The four-thread minimum

**Thread 1 — Audio Thread (highest priority, real-time).** Runs the cpal audio callback. Traverses the pre-computed topological order and calls `process()` on each graph node. This thread obeys iron rules: **no heap allocation** (`Vec::push`, `Box::new` forbidden), **no mutex locks** (priority inversion risk), **no syscalls** (no file I/O, no `println!`), and **no unbounded computation**. Use the `assert_no_alloc` crate in debug builds to catch violations automatically.

**Thread 2 — Engine/Control Thread.** Mediates between UI and audio. Handles parameter changes, graph topology modifications, transport control. Pre-processes data before sending to the audio thread. Manages plugin instantiation and destruction.

**Thread 3 — UI Thread (main thread).** Handles all GUI rendering and user interaction. Sends commands to the engine thread via channels. Receives state updates for display.

**Thread 4+ — Worker/I/O Threads.** Disk streaming (loading audio during playback), plugin scanning, audio file import/export, waveform peak generation, sample rate conversion.

### Lock-free communication patterns

The audio thread communicates exclusively through lock-free structures. **rtrb** (a wait-free SPSC ring buffer derived from crossbeam) is the primary channel — the producer pushes commands or data, the consumer reads on the audio thread. For sharing immutable data, **basedrop** provides `Shared<T>` (an Arc replacement) and `SharedCell<T>` for atomically publishing new data, with deferred deallocation via a collector thread that ensures `drop()` never runs on the audio thread. Simple shared state — transport position, play/stop flags, parameter values — uses atomics (`AtomicU64`, `AtomicBool`, `AtomicF32`).

Graph updates follow a swap pattern: the non-RT thread builds new graph state, serializes changes into a command, sends via SPSC ring buffer, the audio thread applies the command between buffer callbacks, and old data routes back via another SPSC channel for deallocation on a non-RT thread. All buffers are pre-allocated at initialization or graph modification time — the audio thread never allocates.

### Rust's ownership model: mostly an advantage

Rust's `Send`/`Sync` traits prevent accidental sharing of non-thread-safe data at compile time. The audio thread's exclusive ownership of the processing graph eliminates synchronization overhead during processing entirely. No garbage collector means no unpredictable pauses — deterministic memory management is the default. Move semantics make buffer ownership transfer explicit and enforced.

The friction points are real but manageable. The borrow checker struggles with audio graph patterns where nodes read each other's buffers. Solutions include `dasp_graph`'s approach of using indices into a graph structure rather than references, or split borrowing with separate buffer arrays. Interior mutability (filter coefficients, oscillator phase) requires `UnsafeCell` patterns or careful architecture. Dynamic dispatch via `dyn Node` trait objects incurs vtable lookup cost — for extreme performance, use larger processing nodes to amortize this overhead.

---

## The recommended Rust crate stack

The Rust audio ecosystem has matured enough to build a professional DAW engine. Here is the evaluated crate stack:

| Layer                  | Crate                                   | Status                         | Notes                                                                   |
| ---------------------- | --------------------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| Audio I/O              | **cpal**                                | Mature, de facto standard      | ALSA, WASAPI, CoreAudio, JACK backends                                  |
| Audio decoding         | **symphonia**                           | Mature, 3.2M+ downloads        | MP3, AAC, FLAC, Vorbis, WAV, OGG — pure Rust                            |
| Sample rate conversion | **rubato**                              | Production-ready               | SIMD-accelerated, real-time safe with pre-allocation                    |
| DSP primitives         | **dasp**                                | Stable                         | Sample/frame types, signal iterators, `no_std` support                  |
| Audio graph            | **pp-audiograph** or custom on petgraph | Moderate                       | Runtime graph modification, pre-allocated buffers, up to 64 channels    |
| DSP synthesis          | **FunDSP**                              | Active (v0.19+)                | Composable operator notation, monomorphized — good for built-in effects |
| MIDI I/O               | **midir**                               | Mature                         | Cross-platform real-time MIDI                                           |
| MIDI parsing           | **midi-msg**                            | Stable                         | Complete MIDI 1.0 serde                                                 |
| Plugin hosting (CLAP)  | **clack-host**                          | Feature-complete, evolving API | Only Rust CLAP hosting library available                                |
| Plugin hosting (VST3)  | **vst3-sys** / **plugin_host**          | Usable                         | GPLv3 licensing constraints on vst3-sys                                 |
| Lock-free SPSC         | **rtrb**                                | Production-ready               | Wait-free, designed for real-time audio                                 |
| RT-safe memory         | **basedrop**                            | Specialized                    | Deferred deallocation, `Shared<T>` replaces `Arc`                       |
| Allocation detection   | **assert_no_alloc**                     | Essential for debugging        | Catches RT violations at runtime in debug builds                        |

For plugin hosting, adopt a **CLAP-first strategy** using `clack-host`. CLAP is open, modern, well-designed, and avoids VST3's licensing complexities. Use `vst3-sys` or the `plugin_host` crate for VST3 support. Run plugins out-of-process where possible — plugin crashes should never take down the DAW. The `plugin_host` crate already provides sandboxing with auto-restart for crashed out-of-process plugins.

---

## Browser deployment: shared Rust core compiled to WebAssembly

The same Rust DSP code powers both platforms through conditional compilation. Pure DSP algorithms (filters, effects, synthesis), audio graph logic, MIDI processing, project serialization, and parameter automation compile to both native and `wasm32-unknown-unknown`. Platform-specific code — audio I/O (cpal vs AudioWorklet), file system (std::fs vs OPFS), threading (std::thread vs Web Workers), and plugin loading (dynamic libraries vs WAM modules) — uses `#[cfg(target_family = "wasm")]` guards.

```
workspace/
├── core/           # Shared Rust DSP (compiles to native + WASM)
│   └── src/dsp/    # Filters, effects, graph engine
├── src-tauri/      # Native audio I/O (cpal), file system, plugin hosting
├── src-web/        # AudioWorklet WASM glue, Web Audio API bridge
└── frontend/       # SolidJS UI (shared between both targets)
```

### AudioWorklet architecture for the browser

The Web Audio API processes audio in fixed **128-sample-frame quanta** (~2.9ms at 44.1kHz). An `AudioWorkletProcessor` runs on a dedicated audio rendering thread separate from the main thread. The recommended pipeline loads compiled WASM into the AudioWorklet: the main thread fetches and compiles the WASM module, sends the `WebAssembly.Module` to the AudioWorkletProcessor via `postMessage`, the processor instantiates it synchronously, and the `process()` callback invokes WASM functions to process each 128-frame block.

WASM performance is **within 1.5–2.5× of native** for numerical DSP computation, and WASM SIMD (128-bit `v128` type with `f32x4` operations) delivers **2–4× speedups** for batch audio operations. WASM eliminates JavaScript's GC pause problem — the primary motivation for using it in the audio path. Casey Primozic's production FM synthesizers confirm: "The excellent performance characteristics of Rust+Wasm are perfect for this use case."

A critical tooling caveat: `wasm-pack` does not support AudioWorklet targets, and `wasm-bindgen`'s generated JS glue depends on `TextEncoder`/`TextDecoder`, which are unavailable in `AudioWorkletGlobalScope`. The solution is compiling worklet-side DSP code with raw `#[no_mangle]` C-style exports and `cargo build --target wasm32-unknown-unknown` without wasm-bindgen. Use `web-sys`/`wasm-bindgen` only on the main thread for Web Audio graph construction.

### Browser latency and the honest performance gap

Browser DAWs face inherent latency constraints. Chrome achieves **~19ms optimized round-trip** (down from 67ms default) with `latencyHint: 0` and disabled audio processing (`echoCancellation`, `noiseSuppression`, `autoGainControl`). Firefox reaches **~14ms optimized**. Native audio via ASIO or CoreAudio achieves **3–5ms**. Soundtrap (Spotify) engineers describe 30ms best-case as "passable but not great" and target 10ms for native-competitive performance.

The 128-frame fixed render quantum cannot be changed — unlike native APIs where buffer size is configurable. There is no built-in audio encoder (export requires WASM-based solutions like ffmpeg.wasm). And browsers cannot access ASIO drivers due to licensing restrictions. These gaps are narrowing but remain meaningful for professional monitoring-while-recording workflows.

For heavy processing that exceeds the 2.9ms AudioWorklet budget, Google Chrome Labs recommends an **AudioWorklet + Worker + SharedArrayBuffer** pattern. The AudioWorklet handles low-latency 128-frame I/O and pushes frames into a SharedArrayBuffer ring buffer. A dedicated Worker running WASM processes larger blocks (512+ frames) from this buffer, writes results to an output ring buffer, and the AudioWorklet pulls processed frames back. This "loose synchronization" approach avoids blocking the audio thread while enabling complex DSP.

**SharedArrayBuffer requires cross-origin isolation** — the top-level document must serve `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. This breaks some third-party integrations (OAuth popups, payment flows). The `COEP: credentialless` alternative (Chrome 96+) is lighter. For local development, the `coi-serviceworker` package injects headers via service worker.

---

## UI architecture: SolidJS with hybrid Canvas/WebGL rendering

### Why SolidJS over React

**SolidJS is the strongest choice for a DAW frontend.** Its fine-grained reactivity compiles templates to real DOM nodes and wraps updates in precise reactions — components render once, and only the specific JSX expressions that depend on changed state re-execute. JS Framework Benchmark data shows SolidJS is **~5% slower than vanilla JS** while React is **~100% slower**, with SolidJS using **30–40% less memory**. For a DAW with hundreds of continuously-updating UI elements (meters, knobs, waveforms, cursor), React's Virtual DOM diffing overhead is prohibitive. Svelte is the viable alternative — it also compiles away the framework — and the open-source `supersaw` web DAW demonstrates its suitability.

### Rendering strategy by component

Each DAW component demands a different rendering approach. Waveforms should use **WebGL or WebGPU** — GPU compute shaders process sample data in parallel, and the `webgpu-waveform` library demonstrates this approach. The piano roll and arrangement timeline work well with **Canvas 2D** using batch drawing and texture caching for clip contents. The mixer, transport bar, and settings panels belong in the **DOM** via SolidJS components where standard CSS layout, accessibility, and interactive widgets are strengths. Spectrograms and spectrum analyzers benefit from **WebGL fragment shaders** that map FFT bin data to color per pixel.

For the arrangement timeline — the most rendering-intensive view — use **multiple stacked canvases**: background (grid lines), content (waveforms and clips), and overlay (playback cursor and selection). Only the changing layer redraws. Clip contents should be cached as `ImageBitmap` textures and invalidated only on zoom change, with LRU eviction for off-screen clips. Use **OffscreenCanvas in Web Workers** to compute waveform peak data and render without blocking the main thread. The BBC's Peaks.js library and `audiowaveform` tool implement the essential LOD (level-of-detail) approach: pre-compute min/max peak pairs at multiple resolutions (1 peak per 256, 1024, 4096, 16384 samples) and select the appropriate resolution based on current zoom level.

### Three-tier state management

DAW state naturally splits into three tiers. **Source state** is the canonical project truth in musical time (beats, bars) — serializable, undo/redo operates here via the command pattern. **UI state** derives from source state in pixel coordinates, including transient state (drag positions, hover, selection) managed by SolidJS signals. **Engine state** lives in the Rust backend in sample/frame units, communicated via lock-free channels. This separation, identified as essential by the Meadowlark DAW developer, keeps each layer focused and prevents entanglement between UI responsiveness and audio processing correctness.

### Update rate differentiation

Not everything needs 60fps. The playback cursor reads an atomic float every `requestAnimationFrame` call. Audio meters pull from a ring buffer every other frame (~30fps). Waveform displays redraw only on zoom or scroll changes. Static UI elements (labels, buttons) update only on user interaction. A single `requestAnimationFrame` loop serves as the render heartbeat, with frame counters throttling lower-priority updates. CSS `contain: strict` on independently-updating panels isolates layout recalculations.

---

## Tauri versus Electron: why Tauri wins for audio

| Metric                  | Tauri v2                | Electron   |
| ----------------------- | ----------------------- | ---------- |
| Bundle size             | **3–10 MB**             | 80–244 MB  |
| Memory (idle, 1 window) | **30–50 MB**            | 200–300 MB |
| Memory (6 windows)      | **~172 MB**             | ~409 MB    |
| CPU at idle             | **0–1%**                | 2–5%       |
| Startup time            | **0.5–1s**              | 1–4s       |
| Initial build time      | ~81s (Rust compilation) | **~16s**   |

The resource overhead difference is decisive for a DAW where CPU and memory budgets should go to audio processing, not the framework. Tauri's Rust backend provides native code with zero-cost abstractions ideal for DSP, direct access to audio APIs (cpal, JACK, CoreAudio via FFI), and safe multi-threading via ownership — unlike Electron's Node.js event loop. The Hopp team chose Tauri specifically because "Rust's performance suits this intensive task exceptionally well. Implementing this in Electron would require managing a separate process." With Electron, the audio engine would need to run as a separate native process communicating via Unix sockets, adding architectural complexity that Tauri eliminates.

Tauri's disadvantages are real but manageable. WebView inconsistencies between Safari/WebKit (macOS) and Edge/Chromium (Windows) require CSS prefixes. Initial Rust compilation is slow (~81s vs 16s). The ecosystem is smaller than Electron's mature npm universe. And the IPC, while adequate for control messages, is slower than Electron's direct Node.js API access for large data transfers. None of these outweigh the performance advantages for an audio application.

---

## Existing projects and lessons from Meadowlark

Several Tauri audio projects validate this architecture. A detailed March 2026 tutorial by Ryosuke Hana documents building a DAW with Tauri + React, using cpal for audio I/O and ringbuf for lock-free communication. The zero-latency soundboard project (Tauri v2 + Vue 3) demonstrates precise audio routing. The Pluely voice app shows cross-platform audio capture with streaming to the frontend. Musicat (Tauri + Svelte) handles music playback and metadata editing.

**Meadowlark DAW**, the most ambitious Rust DAW project, provides cautionary lessons despite being on hiatus since April 2023. Developer Billy Messenger's architecture — a modular engine (Dropseed) with cpal I/O, CLAP-first plugin hosting via clack, custom GUI framework (Yarrow), and many split crates — revealed critical insights. The Rust GUI ecosystem was not mature enough for complex DAW UI with damage tracking, custom widgets, and performance at scale. Managing many modular crates became unmanageable for a small team. Translating C++ DSP code to Rust consumed enormous time — FFI bindings to existing C++ libraries would have been faster. The code "began to get really messy with a lot of interconnected parts" without upfront design documents.

Yet Messenger's conclusion is instructive: **"I still think Rust is the future. Especially when you have a team of developers, Rust's strictness and safety guarantees are invaluable."** The lesson is not to avoid Rust but to manage scope aggressively, start with a minimal engine before adding DAW features, consider FFI for existing DSP code rather than rewriting, and — critically — use web technologies for the UI rather than building a custom GUI framework.

---

## Browser audio storage and file handling

For the standalone web version, **OPFS (Origin Private File System) is the recommended storage** for audio files. It delivers **2–4× faster** file operations than IndexedDB and supports synchronous read/write via `createSyncAccessHandle()` in Web Workers — enabling random-access reads essential for streaming audio from disk during playback. Chrome allows up to **60% of total disk space** (e.g., 307GB on a 512GB drive). OPFS powers Photoshop on the Web, proving it works at scale. IndexedDB remains useful for structured metadata (project files, track lists, plugin settings) but is too slow for audio file streaming.

For the web plugin ecosystem, the **Web Audio Modules (WAM) 2.0** standard provides the equivalent of VST/AU for browsers. WAM plugins run JavaScript or WebAssembly code in AudioWorklets, support their own UI via Web Components, and communicate on the audio thread. Amped Studio is the first major DAW to natively support WAM plugins, demonstrating a viable web plugin ecosystem.

---

## Conclusion

The architecture divides cleanly along a performance boundary. Rust owns everything time-critical: the audio graph (topologically sorted, processed on a dedicated real-time thread), lock-free communication via rtrb and basedrop, plugin hosting via clack-host, and file I/O via symphonia and cpal. The webview owns everything visual: SolidJS for reactive UI, Canvas/WebGL for waveforms and meters, and DOM for standard controls. Tauri's IPC bridge connects them at control-message rates, never audio rates.

The shared-codebase strategy — Rust DSP compiling to both native and WASM via conditional compilation — makes the browser version architecturally viable rather than a separate product. The web version trades ~2× performance and ~15ms additional latency for universal accessibility, zero installation, and real-time collaboration potential. For teams building this, three priorities emerge: start with the Rust audio engine as a standalone library (testable without any UI), treat the web frontend as a replaceable view layer consuming an engine API, and resist the temptation to build custom GUI frameworks when web technologies already solve the UI problem well enough. The Meadowlark project proved that Rust audio engines work; it also proved that scope management and pragmatic technology choices matter more than architectural purity.
