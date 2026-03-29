# Cross-platform DAW audio export: a complete architecture guide

**The most performant export architecture for a Tauri v2 + WASM DAW uses streaming chunk-based offline rendering—driving the same audio graph without a real-time clock—paired with platform-specific encoding: pure-Rust crates (hound for WAV, flacenc for FLAC) that compile to both native and wasm32-unknown-unknown, C-FFI encoders (LAME, libvorbis, libopus) gated behind `#[cfg(not(target_arch = "wasm32"))]` for native, and lightweight WASM-compiled encoders (wasm-media-encoders, libflacjs) for the browser path.** This dual-target strategy lets you share the DSP core while using the best encoder for each platform. Professional DAWs like Ableton, Logic, and Reaper all follow the same core pattern: call `process()` in a tight loop as fast as the CPU allows, stream output chunks to encoders on separate threads, and never buffer the entire project in memory.

---

## How professional DAWs implement offline bounce

Every major DAW uses the exact same audio processing graph for offline rendering—they simply remove the real-time clock constraint. JUCE framework creator Jules confirmed: "You just call processBlock directly, repeatedly, in a loop. You don't have to wait in between each call." Ableton Live's documentation states that "Live renders audio as quickly as possible. In most cases, this is faster than real-time." Ardour calls this "freewheeling mode." Pro Tools only gained offline bounce capability around 2009, previously requiring real-time bounce due to its DSP hardware architecture.

The universal pattern is straightforward:

1. Set `is_non_realtime = true` on all nodes (signals plugins to use higher-quality algorithms)
2. Call `prepare(sample_rate, block_size)` on the entire graph
3. **Tight loop**: advance transport position → fill MIDI buffers → call `process()` → write output to encoder
4. Report progress as `current_sample / total_samples`

**Typical speedups range from 2–50× real-time** depending on project complexity. Simple projects with few tracks achieve 10–50×; complex projects with heavy reverbs and effects chains typically achieve 2–8×. The bottleneck is always the longest single-threaded signal chain in the DAG—parallelizing independent branches with `rayon` yields an additional **2–4× speedup** on 8-core machines, limited by Amdahl's law since mixing and busing stages remain serial.

For your Rust implementation, the offline render loop bypasses cpal entirely. You call your audio graph's `process()` method directly in a `tokio::spawn_blocking` thread, writing output through a `crossbeam::channel::bounded(8)` channel to encoder threads. The bounded channel provides natural backpressure—if encoders fall behind, the renderer blocks, preventing unbounded memory growth. Use **1024-sample blocks** for offline rendering (larger than typical real-time buffers for better cache and SIMD efficiency).

---

## Native Rust encoding: the crate landscape

The Rust audio encoding ecosystem has clear winners for each format, with a critical divide between pure-Rust crates (WASM-compatible) and C-FFI wrappers (native-only).

### Pure Rust encoders (compile to both native and WASM)

**hound 3.5.1** is the gold standard for WAV encoding—pure Rust, zero dependencies, Apache-2.0 licensed, with **~9.6M total downloads**. It supports 8/16/24-bit integer and 32-bit float samples, arbitrary sample rates, and multi-channel output. Writing WAV is essentially I/O-bound, achieving **50–200× real-time**. It works with any `io::Write + io::Seek` target, including `Vec<u8>` for WASM. The only gap is no BWF (Broadcast Wave Format) metadata or RF64 support for files exceeding 4 GB.

**flacenc 0.5.1** is the only pure-Rust FLAC encoder. Apache-2.0 licensed, it supports 8/16/24-bit PCM encoding with configurable block sizes and compression levels. For WASM compilation, use `default-features = false` to disable the `par` feature (which depends on crossbeam-channel for multi-threading). Encoding speed is **5–20× real-time** depending on compression level. One caveat: flacenc is pre-1.0 and its documentation notes "sometimes the encoded file may contain distortion"—thorough testing before production use is essential.

**rubato ~0.17** handles sample rate conversion. Pure Rust, MIT/Apache-2.0, WASM-compatible. It offers both synchronous FFT-based resampling (faster, fixed ratio) and asynchronous sinc interpolation (higher quality, adjustable ratio). Quality is comparable to libsamplerate's SincBestQuality mode. SIMD auto-vectorization on x86_64 and explicit SSE3/AVX paths provide **20–100% speedup** over baseline on native, though WASM benefits less from SIMD (limited to 128-bit registers).

### C-FFI encoders (native-only, gated behind cfg flags)

| Crate                     | Format     | License                 | Wraps                          | Key notes                                                  |
| ------------------------- | ---------- | ----------------------- | ------------------------------ | ---------------------------------------------------------- |
| **mp3lame-encoder 0.2.2** | MP3        | **LGPL-3.0**            | LAME 3.100                     | Built-in ID3v1 tags, VBR/CBR/ABR, 10–30× real-time         |
| **fdk-aac 0.8.0**         | AAC        | MIT (wrapper) + bespoke | Fraunhofer FDK AAC             | AAC-LC/HE-AAC/HE-AACv2, **no patent grant**                |
| **vorbis_rs**             | OGG Vorbis | BSD-3                   | aoTuV/Lancer-patched libvorbis | Best Vorbis quality available, 8–20× real-time             |
| **opus 0.3.0**            | Opus       | MIT/Apache-2.0          | libopus                        | **Royalty-free**, 20–50× real-time, designed for real-time |

**No pure-Rust MP3, Vorbis, Opus, or AAC encoder exists in production-ready form.** The vorbis_rs README explicitly states "rewriting the patched Vorbis encoder in Rust was deemed unfeasible." An opus-native crate exists but warns "most functionality is not working." This means lossy encoding on the WASM target must use pre-compiled WASM builds of C encoders (covered in the browser section).

### Licensing implications for commercial use

**LAME's LGPL-3.0** requires users can re-link with a modified LAME. Compliance options: dynamically link to LAME as a shared library, provide object files for re-linking, or use a process boundary (separate MP3 encoding executable). Many commercial DAWs use the process-boundary approach. **AAC patents** (Via Licensing pool) make fdk-aac legally complex for commercial distribution—the FDK AAC license explicitly excludes patent rights. Consider using platform OS APIs (CoreAudio on macOS provides AAC encoding) instead. **MP3 patents expired entirely by April 2017**—encoding is patent-free. **Opus and Vorbis are fully royalty-free.**

---

## Browser encoding: WASM libraries and Web APIs

The browser path requires a fundamentally different encoding strategy since C-FFI crates cannot compile to wasm32-unknown-unknown. The practical approach combines purpose-built WASM encoder libraries with native Web APIs.

### Recommended browser encoder stack

**wasm-media-encoders** (npm, v0.7.0, MIT license) is the standout choice for MP3 and OGG Vorbis encoding. It compiles reference LAME and libvorbis to minimal WebAssembly with a **~150–200 KB** bundle. Crucially, it accepts `Float32Array` input directly (unlike lamejs which requires Int16Array conversion), supports streaming/chunked encoding, and is tree-shakeable so unused encoders are excluded by bundlers. Encoding speed benchmarks suggest **>50× real-time** for MP3 via WASM LAME.

**libflacjs** (npm, v5.4.0, BSD-like license) provides FLAC encoding via libFLAC compiled to WASM. Bundle size is **~300–500 KB** for the WASM variant. It supports configurable compression levels, multi-channel encoding, and Web Worker usage.

**WAV encoding in the browser is trivial**—roughly 50 lines of TypeScript to write RIFF/WAVE headers plus raw PCM data. The `wav-file-encoder` npm package (v1.0.4, MIT) provides a clean TypeScript API supporting both Int16 and Float32 WAV types, though hand-rolling the header gives full control over 24-bit packing.

**WebCodecs AudioEncoder** supports **Opus** encoding in Chrome/Edge and **AAC** encoding on Chrome/Windows/macOS/Android (but not Firefox or Linux). It does **not** support MP3 or FLAC encoding in any browser. For Opus where available, WebCodecs is the most efficient path since it uses the browser's native encoder. For AAC, the spotty browser support makes it unreliable as a primary path.

**Avoid ffmpeg.wasm** for audio-only encoding—its **~22 MB** WASM binary is prohibitively large for a web app. A custom stripped build can reduce this to ~4.8 MB, but purpose-built encoders are smaller, faster, and simpler. The LGPL licensing of the FFmpeg WASM binary also complicates commercial distribution.

All major web DAWs (Soundtrap, BandLab, Amped Studio, Soundation) perform **server-side encoding**. Your architecture of client-side WASM rendering and encoding is more modern, avoids server costs, and provides better privacy.

### Running encoders in Web Workers

All WASM encoding should run in a dedicated Web Worker to avoid blocking the main thread and React rendering. The pattern uses **Transferable ArrayBuffers** for zero-copy transfer of PCM chunks from the rendering worker to the encoding worker:

```
Render Worker → postMessage(chunk, [chunk.buffer]) → Encode Worker → collect output → Blob
```

**Comlink** (npm, v4.4.2, Google Chrome Labs, **1.1 KB** gzipped) abstracts away `postMessage` complexity, providing an RPC-style API with TypeScript support and `Comlink.transfer()` for transferable objects. Highly recommended for your worker communication layer.

---

## OfflineAudioContext with WASM AudioWorklet: capabilities and gotchas

**OfflineAudioContext does support AudioWorklet with WASM processors.** The `audioWorklet` property is defined on `BaseAudioContext`, which both `AudioContext` and `OfflineAudioContext` inherit from. Chrome and Firefox have full support. **Safari is the exception**—the `standardized-audio-context` library notes that Safari internally uses `ScriptProcessorNode` to emulate AudioWorklet, meaning OfflineAudioContext + AudioWorklet on Safari may not achieve faster-than-real-time processing.

However, OfflineAudioContext has significant limitations for your use case. There is **no progress callback** in the Web Audio spec—you must use `suspend()` at regular intervals to yield control and report progress, which adds complexity. The entire output must fit in an `AudioBuffer` in memory (5 minutes of stereo 44.1 kHz = ~100 MB of float data). And `startRendering()` runs on the main thread's rendering pipeline, which can block the UI for long renders.

**The better web architecture**: skip OfflineAudioContext entirely for offline export. Instead, run your WASM audio-core directly in a Web Worker (not an AudioWorklet), calling `process()` in a tight loop just like the native path. This gives you full control over progress reporting, memory management, and cancel support. Reserve OfflineAudioContext for short preview renders or when you need native Web Audio nodes in the graph. For the export path, the shared audio-core WASM module running in a Worker provides a more predictable and controllable experience.

---

## Streaming architecture: never buffer the entire project

For a 1-hour project at 48 kHz/32-bit stereo, raw PCM occupies **~1.32 GB**—marginal on desktop, dangerous in browsers where WASM memory typically caps at 2–4 GB. Professional DAWs universally use streaming/chunked processing, and your architecture should too.

### Native streaming pipeline

The renderer thread walks the audio graph block-by-block (1024 samples), producing `Arc<AudioChunk>` values fanned out to multiple encoder threads via `crossbeam::channel::bounded` channels. Using `Arc` avoids cloning audio data when writing to multiple formats simultaneously. Each encoder thread independently consumes chunks and writes to its output file. Peak memory stays under **~100 MB** regardless of project length.

For **multi-format export from a single render pass**, the fan-out pattern renders once and distributes to WAV, FLAC, and MP3 encoder threads concurrently. This is strictly better than rendering N times since graph processing is the expensive part while encoding is relatively cheap. Logic Pro and Ableton both support this—selecting multiple bounce destinations from a single render.

### Web streaming pipeline

Render in blocks within a Web Worker, transfer each encoded chunk to the main thread, and accumulate as `Uint8Array` fragments. On completion, create a `Blob` for download. For very long projects, use the **File System Access API** (`showSaveFilePicker` → `createWritable()`) to stream directly to disk, avoiding in-memory accumulation entirely. File System Access API is supported in Chrome/Edge (~33% global coverage as of 2026); fall back to blob download for Firefox and Safari.

### Stem export strategy

Most DAWs use the **solo/mute approach**: for each stem, solo one track, render the full graph. This is correct, simple, and what users expect. For a 10-track project, rendering 10 times is acceptable. An optimized single-pass approach using "tap points" (capturing audio at multiple graph nodes simultaneously) reduces rendering to O(1) passes but complicates the architecture—shared effects like reverb sends and bus compression make subgraph isolation difficult. Start with solo/mute; optimize later if profiling shows rendering dominates export time.

All stems should have **identical length** (including leading silence) so they align when imported into other DAWs. This is standard across Ableton, Ardour, and all professional workflows.

---

## Dithering, latency compensation, and signal integrity

**TPDF dithering** is the industry standard and requires only ~20 lines of Rust. Generate two independent uniform random values, subtract them to create a triangular distribution with ±1 LSB amplitude, add to the signal before quantization. Use `rand::rngs::SmallRng` for the RNG to avoid cryptographic overhead. Apply dithering **only** when reducing bit depth (32-bit float → 16-bit or 24-bit) and **only as the last processing step** before file writing. For 16-bit output, optional noise shaping pushes quantization noise into less audible frequencies; at 24-bit, flat TPDF is sufficient. Never apply noise-shaped dither before lossy encoding—MP3/AAC/Opus handle quantization internally. No dedicated Rust audio dithering crate exists; implement manually using the Airwindows source (MIT-licensed C++) as a reference.

**Plugin delay compensation** during offline render follows the same algorithm as real-time playback. Calculate the maximum cumulative latency across all graph paths, insert compensating delays on shorter paths, then **pre-roll** the graph by `max_graph_latency` samples before the export start position. Pre-roll output is discarded—it only fills plugin latency buffers (lookahead compressors, linear-phase EQs). For selected-range rendering, add additional pre-roll (2–5 seconds) beyond PDC compensation to warm up reverb and delay effects, and configurable **post-roll** to capture effect tails. A silence detection threshold (-90 dBFS) can automatically determine when tails have decayed.

---

## Tauri v2 integration: progress, cancel, and file I/O

### Progress reporting via Channels

Tauri v2 **Channels** are the recommended mechanism for streaming progress data from Rust to the React frontend—they are faster and more ordered than the Events system (which uses JSON serialization and `eval()` injection). Define a tagged enum for export events:

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum ExportEvent {
    Progress { percent: f64, current_frame: u64, total_frames: u64 },
    Complete { path: String, duration_ms: u64 },
    Error { message: String },
}
```

Pass a `Channel<ExportEvent>` parameter to the Tauri command; on the frontend, instantiate `new Channel<ExportEvent>()` from `@tauri-apps/api/core` and set `onmessage`. **Throttle progress updates** to every ~50 ms of wall-clock time to avoid flooding the IPC channel.

### Cancel support

Use an **`AtomicBool`** stored in Tauri managed state. The render loop checks `cancelled.load(Ordering::SeqCst)` at each block boundary. A separate `cancel_export` command sets the flag. Write output to a **temporary file** (e.g., `export.wav.tmp`), rename atomically on completion, and delete on cancellation. This prevents leaving corrupt partial files on disk.

### File dialogs

The `tauri-plugin-dialog` (npm: `@tauri-apps/plugin-dialog`) provides native save dialogs with format filters. Add `"dialog:allow-save"` and `"fs:default"` to your capabilities configuration.

### COOP/COEP headers

For SharedArrayBuffer (required by multi-threaded WASM and the AudioWorklet + SharedArrayBuffer ring buffer pattern), configure headers in `tauri.conf.json` under `app.security.headers`. These headers are **only injected in production builds**—configure your Vite dev server separately with matching headers. For standalone web deployment, your server must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.

---

## Recommended format-by-format encoder matrix

| Format         | Desktop (Tauri/Rust)      | Web (Browser)                        | Shared code?       | License concern     |
| -------------- | ------------------------- | ------------------------------------ | ------------------ | ------------------- |
| **WAV**        | `hound` 3.5.1             | `hound` via WASM or manual TS header | ✅ Full sharing    | None (Apache-2.0)   |
| **FLAC**       | `flacenc` 0.5.1           | `flacenc` via WASM or `libflacjs`    | ✅ Possible        | None (Apache-2.0)   |
| **MP3**        | `mp3lame-encoder` 0.2.2   | `wasm-media-encoders` 0.7.0          | ❌ Different impls | **LGPL** (LAME)     |
| **OGG Vorbis** | `vorbis_rs`               | `wasm-media-encoders` 0.7.0          | ❌ Different impls | None (BSD-3/MIT)    |
| **Opus**       | `opus` 0.3.0              | WebCodecs `AudioEncoder`             | ❌ Different impls | None (royalty-free) |
| **AAC**        | `fdk-aac` 0.8.0 or OS API | WebCodecs (Chrome only)              | ❌ Different impls | **Patent risk**     |
| **SRC**        | `rubato` ~0.17            | `rubato` via WASM                    | ✅ Full sharing    | None (MIT)          |

The cleanest architecture defines a `trait AudioEncoder` in the shared audio-core crate with `write_chunk()` and `finalize()` methods. Pure-Rust implementations (WAV, FLAC, SRC) live in audio-core and compile everywhere. C-FFI encoders are in a separate `audio-encoders-native` crate gated behind `#[cfg(not(target_arch = "wasm32"))]`. Browser-specific WASM encoders are accessed through JavaScript/TypeScript wrappers in the frontend, called from Web Workers.

## Conclusion

The key architectural insight is that **offline rendering and encoding are entirely separate concerns** that should be decoupled via a streaming chunk interface. Your shared audio-core crate handles rendering identically on both platforms—a tight loop calling `process()` on the topologically-sorted DAG. The output stream fans out to platform-appropriate encoders. On native, rayon parallelizes independent graph branches within each block while crossbeam channels stream to encoder threads. On web, the same WASM DSP core runs in a Worker, posting encoded chunks via Transferable ArrayBuffers.

The most surprising finding is that **OfflineAudioContext is not the best web export path** despite seeming purpose-built for it. Running your WASM audio-core directly in a Worker gives superior control over progress, memory, and cancellation. Reserve OfflineAudioContext for quick preview renders.

The pure-Rust ecosystem covers WAV and FLAC encoding with WASM compatibility, but lossy codecs remain a gap—making the dual-implementation approach (native C-FFI + browser WASM libraries) unavoidable for MP3, Vorbis, and Opus. For a commercial product, the LGPL implications of LAME and the patent complications of AAC deserve early legal review. Opus—royalty-free, fast, high-quality—is the strongest candidate for a default lossy format if your user base can accept it.
