# Building a dual-target DAW with Tauri and WebAssembly

A professional DAW targeting both Tauri desktop and web browser is architecturally viable, but demands a strict separation: **all audio processing lives in Rust**, the webview is a "dumb display" receiving pre-computed visualization data at 60fps, and a shared `audio-core` crate compiles to both native and WASM via conditional compilation. Tauri's IPC measures at **~2ms round-trip** for small payloads — adequate for display-rate updates but far too slow for sample-rate crossing. The key architectural insight is that no audio data should ever traverse the IPC boundary; only pre-aggregated meter levels, playhead positions, and user commands cross between Rust and the webview.

This architecture has no production precedent — no shipping Tauri-based DAW exists. But the individual pieces are battle-tested: `cpal` for audio I/O, `rtrb` for lock-free ring buffers, AudioWorklet + WASM for the browser path, and React refs + Canvas for bypassing React's reconciler on high-frequency visuals.

## Tauri IPC is fast enough for controls, not for audio

Tauri v2 serializes structured data as **JSON via `serde_json`** over a custom `ipc://localhost` protocol. Benchmarked on an M1 Max MacBook Pro (Tauri 2.10.2), invoke round-trips clock at **p50: 2ms, p95: 3ms, p99: 5ms** for small payloads. The bare IPC bridge overhead is approximately **0.5ms per invoke**. For binary data, Tauri offers a serialization-free path via `tauri::ipc::Response` that returns raw `Vec<u8>` as JavaScript `ArrayBuffer` — delivering 10MB in ~5ms on macOS, though Windows performance degrades to ~200ms for the same payload due to WebView2 limitations.

For streaming high-frequency data, Tauri's documentation explicitly warns that the event system "is not designed for low latency or high throughput situations" and directs developers to **Tauri Channels** (`Channel<T>`), which provide ordered, fast delivery optimized for streaming. A Channel can push meter data from Rust at 60fps with ~200-byte payloads comfortably. For the highest throughput binary streaming (continuous waveform data, spectrograms), a **localhost WebSocket server** using `tokio-tungstenite` or `axum` bypasses Tauri IPC entirely, delivering binary frames at ~0.05-0.1ms localhost round-trip.

**SharedArrayBuffer cannot bridge the Rust-webview process boundary.** SharedArrayBuffer is a web API for sharing memory between web workers within the same browser context — it does not cross process boundaries. The Tauri team has confirmed cross-platform shared memory is infeasible: only Windows WebView2 has a SharedBuffer API, and it's reportedly slow. macOS and Linux webviews have no equivalent.

The practical IPC strategy splits by data type and frequency:

| Data category                       | Update rate    | Best IPC method                      | Typical payload |
| ----------------------------------- | -------------- | ------------------------------------ | --------------- |
| User controls (play, stop, volume)  | On interaction | Standard `invoke()`                  | <500 bytes JSON |
| Meter levels (peak/RMS)             | 60fps          | Tauri Channel (binary)               | ~200 bytes      |
| Waveform overviews                  | On load/scroll | `tauri::ipc::Response` → ArrayBuffer | 1–50 KB         |
| Continuous streaming (spectrograms) | 60fps          | Localhost WebSocket                  | Binary frames   |
| Large file transfers                | On demand      | `convertFileSrc()` custom protocol   | Streaming       |

Compared to Electron, Tauri's structural advantage is decisive for audio: Rust's zero-GC runtime enables lock-free, real-time-safe audio processing impossible in Node.js without native addons. Electron idles at **200-300MB** versus Tauri's **30-50MB**, and Electron's IPC through native addons suffers from a known bug where returning Node buffers takes >100ms versus <1ms in plain Node.

## The Rust audio engine needs lock-free pipelines, not DDD

Domain-Driven Design is appropriate for project/session management (tracks, clips, mixer state) but **inappropriate for the real-time audio render path**. The audio thread's golden rule — no allocations, no locks, no syscalls — prohibits the indirection, allocation, and abstraction overhead of domain objects. Research into Meadowlark DAW, Firewheel audio graph engine, and the broader Rust audio ecosystem converges on a **command-driven, lock-free pipeline** architecture where threads communicate via ring buffers, not shared mutable state.

The audio processing graph is a directed acyclic graph (DAG) processed in topological order so every node executes only after its inputs are ready. The critical challenge of modifying the graph during playback uses a **double-buffer + atomic swap** pattern: the non-RT thread builds a new `CompiledSchedule` (a flat `Vec<ProcessTask>` in topological order with pre-resolved buffer assignments), stores it behind an `AtomicPtr`, and the audio thread atomically reads the latest version. The `basedrop` crate handles deferred deallocation — when the old schedule is dropped on the RT thread, items are pushed to a wait-free MPSC queue for a `Collector` on another thread to free.

The complete thread model requires five distinct threads:

**Audio RT Thread** runs the `cpal` callback at real-time OS priority (set via the `audio_thread_priority` crate or cpal's `realtime_priority` feature). It executes the compiled graph, reads commands from an `rtrb` ring buffer consumer, writes meter data to an `rtrb` producer, and reads pre-fetched disk audio from `creek`'s buffers. Zero allocations are enforced during development using the `assert_no_alloc` crate. **Engine/Coordinator Thread** owns the authoritative project state, receives commands from Tauri's async runtime, compiles graph changes, and runs the `basedrop::Collector`. **Disk I/O Thread** is managed by `creek`, which auto-spawns an IO server thread for look-ahead buffered disk streaming with RT-safe consumption. **MIDI Thread** handles device I/O and timestamps events for sample-accurate delivery. **Background Thread Pool** (rayon or tokio) handles offline rendering, waveform mipmap generation, and audio file transcoding.

The **UI Relay** pattern bridges the 44.1kHz→60fps gap. A dedicated loop on the coordinator thread drains the meter ring buffer every ~16ms, keeps only the latest values, converts to display-friendly units (dB, milliseconds), and emits a single Tauri event per frame:

```rust
fn ui_relay_loop(meter_consumer: rtrb::Consumer<AudioToUiData>, app: AppHandle) {
    loop {
        std::thread::sleep(Duration::from_millis(16));
        let mut latest = None;
        while let Ok(data) = meter_consumer.pop() { latest = Some(data); }
        if let Some(data) = latest {
            let _ = app.emit("audio-meters", &to_display_state(data));
        }
    }
}
```

The essential Rust crate stack: **`cpal`** (cross-platform audio I/O, 8.7M downloads, supports WASAPI/ASIO/CoreAudio/ALSA/JACK/PipeWire), **`rtrb`** (wait-free SPSC ring buffer designed specifically for audio — both sides are wait-free), **`dasp`** (zero-allocation DSP primitives), **`basedrop`** (RT-safe deferred deallocation with `Owned<T>`, `Shared<T>`, `SharedCell<T>`), **`creek`** (RT-safe disk streaming from Meadowlark's developer), **`fundsp`** (compile-time optimized DSP graph notation), and **`rubato`** (high-quality sample rate conversion). Avoid `rodio` — it's too high-level for a DAW engine.

## The browser version runs Rust DSP as WASM inside AudioWorklet

AudioWorklet runs custom JavaScript (or WASM) on the browser's dedicated audio render thread, processing **128-frame quanta** (~2.9ms at 44.1kHz). The critical timing budget means all `process()` calls across all processors must complete within this window. Rust audio code compiles to WASM and runs inside AudioWorkletProcessor — this is a proven pattern used by Casey Primozic's web-synth, Glicol, and the `waw-rs` library. The `cpal` crate itself now has an experimental AudioWorklet backend.

Loading WASM into AudioWorklet requires a specific dance: fetch the WASM binary on the main thread (AudioWorkletGlobalScope cannot make network requests), send the compiled `WebAssembly.Module` to the processor via `port.postMessage()`, then instantiate synchronously inside the processor. **WASM SIMD** (128-bit fixed-width) is production-ready in Chrome 91+, Firefox 89+, and Safari, compiled with `-Ctarget-feature=+simd128` in Rust. Casey Primozic confirms WASM SIMD works inside AudioWorklet context, providing substantial speedups for buffer operations.

**SharedArrayBuffer** enables zero-copy communication between AudioWorklet and the main thread. Paul Adenot's `ringbuf.js` (from Mozilla) implements a wait-free SPSC ring buffer over SharedArrayBuffer, delivering **2.5x to 6x load capacity improvement** over `postMessage`. The pattern: pre-allocate a `SharedArrayBuffer` on the main thread, send it to the processor via `port.postMessage()`, then both threads read/write using typed array views with `Atomics` for synchronization. This requires COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`).

For heavy computation, **Web Workers with OffscreenCanvas** move waveform rendering, FFT analysis, and file decoding entirely off the main thread. Casey Primozic's signal analyzer architecture runs spectrogram and oscilloscope in separate Workers with OffscreenCanvas, keeping main thread CPU at <5%. Data flows: AudioWorklet → SharedArrayBuffer → Worker → OffscreenCanvas → displayed canvas.

Storage uses **OPFS (Origin Private File System)** for audio files — **2-4x faster than IndexedDB** with synchronous `FileSystemSyncAccessHandle` in Workers for byte-level random access. Chrome provides ~60% of disk space, Safari 38+ GB on iPhone. IndexedDB handles project metadata. The File System Access API enables import/export but lacks Firefox support.

Latency comparison tells the key story: native audio via CoreAudio achieves **2-5ms**, while Web Audio API achieves **~3ms on macOS** (close to native) but **~10ms on Windows WASAPI** and **30-40ms on Linux PulseAudio**. The Web Audio API's fixed 128-frame quantum cannot be configured by developers, unlike native DAWs where users adjust buffer sizes from 64-4096 samples. Soundtrap (Spotify) reports **~30ms best-case round-trip** in their web DAW, targeting 10ms to compete with native.

## A shared core crate compiles to both native and WASM

The foundational architecture is a Cargo workspace with an `audio-core` crate containing all platform-agnostic logic — DSP algorithms, audio graph topology, state management, MIDI message parsing, scheduling logic — that compiles cleanly to both `x86_64`/`aarch64` native targets and `wasm32-unknown-unknown`. Platform-specific code lives in separate `audio-native` and `audio-wasm` crates behind conditional compilation.

The `audio-core` crate should target `#![no_std]` compatibility (with `alloc`) for maximum portability. `dasp` has zero dependencies and zero allocations. `fundsp` supports `no_std`. The key principle from the Rust WASM book: "Factor I/O out of your library — let callers perform the I/O and pass input slices to your library instead." This means `audio-core` receives sample buffers and produces sample buffers; all I/O is driven by the platform layer.

Platform abstraction uses Rust traits with conditional implementations:

```rust
// audio-platform crate: trait definitions only
pub trait AudioOutput: Send + Sync {
    fn start(&mut self, callback: Box<dyn FnMut(&mut [f32]) + Send>) -> Result<(), Error>;
    fn sample_rate(&self) -> u32;
}

pub trait FileSystem {
    fn read_file(&self, path: &str) -> Pin<Box<dyn Future<Output = Result<Vec<u8>>>>>;
}
```

Native implements via `cpal` and `std::fs`; WASM implements via `web-sys` bindings to Web Audio API and OPFS. Cargo.toml uses target-specific dependencies: `[target.'cfg(not(target_arch = "wasm32"))'.dependencies]` for native crates, `[target.'cfg(target_arch = "wasm32")'.dependencies]` for `wasm-bindgen`, `web-sys`, and `js-sys`.

The **Crux framework** (redbadger/crux) provides the closest production precedent for this pattern — a strict side-effect-free Rust core compiled to both native and WASM, with platform shells handling effects. Its pattern of `#[cfg_attr(target_family = "wasm", wasm_bindgen::prelude::wasm_bindgen)]` for dual-target function export applies directly.

On the React frontend, a `BackendProvider` detects the environment via `'__TAURI__' in window` and creates either a `TauriBackend` (using `@tauri-apps/api` invoke/listen) or a `WasmBackend` (calling WASM functions directly via wasm-bindgen). Both implement a shared `AudioEngineBackend` TypeScript interface. TanStack Query hooks call `backend.listMidiPorts()` or `backend.loadProject()` without knowing which backend is active. The existing DomainEvent/EventBus system bridges backend events by subscribing to either Tauri events or WASM callbacks and routing them through `eventBus.emit()`.

Build tooling: `wasm-pack build crates/audio-wasm --target web` for the WASM build, `tauri build` for native. **You cannot build both targets simultaneously** from the workspace root — use `-p` flag with `--target`. Vite integration uses `vite-plugin-wasm` (237K+ weekly downloads) with `build.target: 'esnext'` for native top-level await. CI/CD runs separate `check-wasm` and `check-native` jobs to catch platform-specific compilation errors.

What **cannot** be shared between platforms: audio I/O (cpal vs Web Audio API), file system access (std::fs vs OPFS), threading (std::thread/rayon vs Web Workers — note that WASM's main thread **cannot block**), and timer primitives (std::time::Instant vs performance.now()). The `midir` crate has an experimental Web MIDI backend, potentially unifying MIDI across both targets, though the Web MIDI API's async nature forces an async-first abstraction.

## DAW UI performance requires bypassing React for all 60fps visuals

The single most important React performance rule for a DAW: **never put audio-rate or display-rate data in React state**. Meter levels, playhead position, and waveform scroll position must live in `useRef` values that drive Canvas rendering via `requestAnimationFrame`, completely bypassing React's reconciler. React state triggers re-renders; at 60fps, that means 60 full reconciliation passes per second — unacceptable. `useSyncExternalStore` is appropriate only for discrete state changes (play/stop, BPM, track selection) where the store snapshot changes infrequently.

React 19's Compiler (stable since October 2025) auto-inserts memoization at the reactive-scope level, delivering up to **2.5x faster interactions** per Meta's Quest Store benchmarks and **20-30% render time reduction** across Sanity Studio's 1,231 components. The compiler de-optimizes on props mutation during render, non-deterministic reads, and mutable external variable closures — so structure components with stable primitive props (string IDs, not object references) and pure render functions.

Rendering technology selection by component: **Canvas 2D** for waveforms (with mipmapped peak data), meters (batched dirty-rect updates), piano rolls, and automation curves. **WebGL** for 100+ simultaneous waveform tracks (O(c) rendering cost via gl-waveform) and spectrum analyzers (shader-based heatmaps). **CSS transforms with `will-change`** for the playhead (GPU-composited, zero main-thread cost). **DOM/React components** for track headers, mixer controls, and transport — anything that changes infrequently.

A **single master `requestAnimationFrame` loop** drives all visual updates — never create multiple independent rAF loops. Register playhead, meters, and waveform scroll callbacks on one scheduler. Each callback reads from refs (or SharedArrayBuffer views) and renders to its Canvas. The dirty-flag pattern prevents unnecessary redraws: the audio data writer sets `dirty = true`, the rAF callback checks and clears it.

**Waveform mipmaps** are essential for zoom performance. Pre-compute min/max peaks at multiple resolutions (256, 512, 1024, 2048, 4096, 8192 samples per pixel) using Rust/WASM. The Meadowlark project provides an `audio-waveform-mipmap` crate for exactly this. On zoom changes, pick the closest mip level ≥ the requested resolution and request new data only if the mip level changed. Lazy-load only the visible timeline region plus one viewport of lookahead.

**TanStack Virtual** (@tanstack/react-virtual) handles track list virtualization — only rendering visible tracks' DOM/Canvas elements with an overscan of ~5 tracks. Audio processing remains fully active for all tracks regardless of virtualization state; the audio graph runs in the RT thread independently of the DOM. For dual-axis virtualization (tracks vertically, timeline horizontally), use two simultaneous virtualizer instances sharing the same scroll container.

CSS containment provides substantial rendering isolation: `contain: strict` on each major panel, `contain: layout style paint` on each track row. `content-visibility: auto` offers a **7x rendering boost** per web.dev benchmarks (732ms → 54ms paint time) for off-screen content. The playhead gets `will-change: transform` for a dedicated compositor layer — its movement costs zero main-thread time.

GC pause mitigation follows game-engine patterns: pre-allocate and reuse TypedArrays (never create `new Float32Array` in the render loop), pool objects for automation points and MIDI events, avoid object literal creation in hot paths, and use SharedArrayBuffer for audio↔UI data. V8's incremental GC typically pauses 5-10ms — within the 16.67ms frame budget but dangerously tight. The solution is to avoid triggering collection entirely during playback.

## Recommended workspace layout and technology decisions

```
daw-project/
├── crates/
│   ├── audio-core/          # 100% shared: DSP, graph, state, MIDI parsing
│   ├── audio-platform/      # Trait definitions only (AudioOutput, FileSystem, MidiInput)
│   ├── audio-native/        # cpal, std::fs, std::thread implementations
│   ├── audio-wasm/          # web-sys, OPFS, Web Worker implementations
│   ├── rt-thread/           # Audio callback, buffer pool, ring buffer wrappers
│   ├── tauri-bridge/        # #[tauri::command] handlers, UI relay thread
│   └── dsp/                 # Oscillators, filters, dynamics — no_std compatible
├── src-tauri/               # Tauri app entry point
└── frontend/                # React 19 + Vite + vite-plugin-wasm
```

The final technology stack for the native path: `cpal` 0.16 for audio I/O, `rtrb` for RT-safe ring buffers, `basedrop` for deferred deallocation, `dasp` + `fundsp` for DSP, `creek` for disk streaming, `rubato` for sample rate conversion, and `audio_thread_priority` for RT thread scheduling. For the web path: AudioWorklet with WASM (compiled from the same `audio-core` + `dsp` crates), SharedArrayBuffer + `ringbuf.js` for zero-copy inter-thread communication, OPFS for file storage, and Web Workers with OffscreenCanvas for visualization rendering.

## Conclusion

Three architectural decisions dominate everything else. First, the audio engine is **Rust-only and platform-agnostic** — pure computation on sample buffers with no I/O, no allocation, no locks. This core compiles identically to native (for Tauri's RT audio thread via cpal) and WASM (for the browser's AudioWorklet). Second, the webview is **display-only** — it receives pre-computed visualization data at 60fps and sends user commands back, with all high-frequency rendering bypassing React entirely via refs + rAF + Canvas. Third, the IPC boundary is **deliberately thin** — batched meter updates via Tauri Channels or localhost WebSocket, not raw audio data.

The web version will have higher latency (~10-30ms vs ~2-5ms native) and lower track capacity (~20-50 vs hundreds), but shares the same DSP algorithms and graph logic. The React frontend is entirely shared, with a single `AudioEngineBackend` interface abstracting the Tauri invoke path from the WASM direct-call path. This dual-target architecture has no production DAW precedent, but each piece — lock-free Rust audio engines, WASM in AudioWorklet, SharedArrayBuffer ring buffers, Canvas-bypassed React UIs — is individually proven in shipping products.
