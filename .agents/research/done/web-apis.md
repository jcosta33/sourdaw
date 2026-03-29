# Web API cross-platform viability for a Tauri v2 DAW

**The Web Audio API core is viable across all three WebView engines, but roughly half of DAW-critical APIs are missing or broken on WebKit — requiring a hybrid architecture where Rust handles MIDI, multi-track recording, file I/O, and plugin hosting while the WebView handles UI, metering, lightweight audio, and WASM-based DSP.** This research covers every relevant Web API across WKWebView (macOS), WebView2 (Windows/Chromium), and WebKitGTK (Linux), with explicit verdicts on whether each API meets the bar of "nothing lost compared to native." The minimum recommended targets are **Safari 16.4+** (macOS Ventura+), **WebKitGTK 2.42+**, and **WebView2 latest** — though several features require Safari 18.4+ (macOS Sequoia 15.4).

---

## Audio engine: the core graph works, but edges are rough

The Web Audio API underwent a complete spec-compliant rewrite in WebKit, shipping in **Safari 14.1** (April 2021) and **WebKitGTK 2.34+**. AudioContext, the node graph, and sample-accurate scheduling all function correctly on every platform. The built-in nodes — OscillatorNode, BiquadFilterNode, ConvolverNode, DynamicsCompressorNode, WaveShaperNode — are **spec-compliant and equivalent across engines** after the rewrite fixed longstanding bugs in lowpass/highpass filters and AudioParam automation processing.

**AudioWorklet** shipped in Safari 14.1 but had significant early bugs: `Float32Array.buffer` transfers returned empty arrays, `console.log` didn't work inside processors, and `postMessage` was unreliable. These issues are resolved in **Safari 16+** and **WebKitGTK 2.38+**, making AudioWorklet production-ready for custom DSP. The 128-sample render quantum (~2.9ms at 44.1kHz) and dedicated audio thread architecture match Chromium's behavior.

**OfflineAudioContext** works but with WebKit-specific constraints: minimum sample rate of **44,100 Hz** (cannot render at lower rates) and a maximum of **10 channels**. Standard stereo 44.1/48kHz bouncing works fine; unusual sample rates or surround configurations will fail.

| Feature              | WKWebView                 | WebKitGTK      | WebView2 | Verdict                                 |
| -------------------- | ------------------------- | -------------- | -------- | --------------------------------------- |
| Web Audio API core   | ✅ Safari 14.1+           | ✅ 2.34+       | ✅       | ✅ Use Web API                          |
| AudioWorklet         | ✅ Safari 16+ recommended | ✅ 2.38+       | ✅       | ✅ Use Web API                          |
| OfflineAudioContext  | ⚠️ 44.1kHz min, 10ch max  | ⚠️ Same limits | ✅       | ⚠️ Partial — fine for standard bouncing |
| Built-in audio nodes | ✅ Safari 14.1+           | ✅ 2.34+       | ✅       | ✅ Use Web API                          |
| AnalyserNode (FFT)   | ✅ Safari 14.1+           | ✅ 2.34+       | ✅       | ✅ Use Web API                          |

### SharedArrayBuffer in AudioWorklet requires careful version targeting

SharedArrayBuffer re-enabled in **Safari 15.2** (December 2021) with COOP/COEP headers. However, a critical WebKit bug (#237144) meant SABs posted to AudioWorkletProcessor were **copied instead of shared** until Safari ~15.4. The `postMessage` path had a separate bug (#220038) fixed later. **Safari 16+ is the safe minimum** for SharedArrayBuffer inside AudioWorklet.

Tauri v2.1.0+ supports the required headers in `tauri.conf.json`:

```json
{
    "app": {
        "security": {
            "headers": {
                "Cross-Origin-Opener-Policy": "same-origin",
                "Cross-Origin-Embedder-Policy": "require-corp"
            }
        }
    }
}
```

These headers are injected only in production builds — your dev server (Vite, etc.) must set them separately. Prefer passing SharedArrayBuffers via `processorOptions` over `postMessage` for maximum compatibility.

### Latency measurement and timing precision

No published side-by-side benchmarks compare WKWebView vs Chrome audio latency. `baseLatency` is available since Safari 14.1, but **`outputLatency` only shipped in Safari 18.4** (March 2025) — a significant gap for latency compensation in older Safari versions. WebKit Bug #221334 (still open) reports ~1 second delay specifically with MediaElementAudioSourceNode + Bluetooth + microphone; avoid `MediaElementAudioSourceNode` for critical audio paths.

`AudioContext.currentTime` is **sample-accurate and driven by the hardware clock** — unaffected by Spectre mitigations. `performance.now()` is throttled to **~1ms on WebKit** (vs ~100μs on Chromium) due to Spectre, but this doesn't affect audio scheduling. **Always use `currentTime`-based scheduling** (`start(when)`, `setValueAtTime`) rather than `performance.now()`.

| Feature                          | WKWebView            | WebKitGTK      | WebView2       | Verdict                              |
| -------------------------------- | -------------------- | -------------- | -------------- | ------------------------------------ |
| SharedArrayBuffer + AudioWorklet | ⚠️ Safari 16+        | ⚠️ 2.38+       | ✅             | ⚠️ Partial — version-sensitive       |
| baseLatency                      | ✅ Safari 14.1+      | ✅ 2.34+       | ✅             | ✅ Use Web API                       |
| outputLatency                    | ⚠️ Safari 18.4+ only | ⚠️ Very recent | ✅ Chrome 102+ | ⚠️ Partial — needs Safari 18.4+      |
| currentTime precision            | ✅ Sample-accurate   | ✅             | ✅             | ✅ Use Web API                       |
| performance.now()                | ⚠️ ~1ms (Spectre)    | ⚠️ ~1ms        | ~5–100μs       | ⚠️ Partial — use currentTime instead |

---

## MIDI is a hard no on WebKit — native bridge required

**Web MIDI API is not supported on any WebKit platform and Apple has explicitly declined to implement it.** The WebKit Feature Status page lists it as "Not Considering," citing fingerprinting and security concerns. Bug #107250 has been open since 2013 with no activity. WebKitGTK follows upstream WebKit's decision.

**WebSerial API** is also unsupported on both WebKit engines (same fingerprinting rationale) and is not a viable alternative for USB MIDI.

The only cross-platform solution is **Tauri's Rust backend** accessing CoreMIDI (macOS), ALSA/JACK/PipeWire MIDI (Linux), and WinMM/WinRT MIDI (Windows) via crates like `midir`, bridging events to the frontend via IPC commands. A community project (MIDIWebView) demonstrates injecting a Web MIDI polyfill into WKWebView that bridges to CoreMIDI, which could be adapted for Tauri.

| Feature       | WKWebView            | WebKitGTK          | WebView2 | Verdict                     |
| ------------- | -------------------- | ------------------ | -------- | --------------------------- |
| Web MIDI API  | ❌ Declined by Apple | ❌ Not implemented | ✅       | ❌ Use Rust — `midir` crate |
| WebSerial API | ❌ Declined by Apple | ❌ Not implemented | ✅       | ❌ Not a MIDI alternative   |

---

## Recording works for basic capture but fails at DAW-grade multi-track

**getUserMedia** works on WKWebView (Safari 14+) and WebKitGTK (with GStreamer), but is **limited to mono/stereo** capture on all browsers. Multi-channel interfaces (>2 inputs) are not fully exposed — the browser downmixes to stereo. On Linux, Tauri's default WebKitGTK permission handler **automatically denies all requests** — you must register a custom Rust signal handler to allow microphone access.

**MediaRecorder** received a landmark update in **Safari 18.4**: PCM (uncompressed), ALAC (lossless), Opus, and WebM container support were all added. Before 18.4, only AAC in MP4 was available. On WebKitGTK, MediaRecorder depends entirely on installed GStreamer plugins — codec availability varies dramatically between Linux distributions. Tauri's AppImage config (`"includeGstreamer": true`) can bundle plugins for consistency.

**Multi-track simultaneous recording is not viable via Web APIs.** On WebKit, calling `getUserMedia()` again can kill existing streams (Bug #179363). Device IDs are randomized per session. No browser supports >2 channel capture from a single device via getUserMedia. A DAW must use **CoreAudio/JACK/PipeWire via Rust** for professional multi-track recording.

| Feature               | WKWebView                      | WebKitGTK                      | WebView2      | Verdict                                              |
| --------------------- | ------------------------------ | ------------------------------ | ------------- | ---------------------------------------------------- |
| getUserMedia (mic)    | ✅ Safari 14+ (stereo max)     | ✅ With GStreamer (stereo max) | ✅            | ⚠️ Partial — stereo only, use Rust for multi-channel |
| MediaRecorder         | ✅ Safari 18.4+ (PCM/ALAC)     | ⚠️ GStreamer-dependent         | ✅            | ⚠️ Partial — basic recording only                    |
| Multi-track recording | ❌ Unreliable multiple streams | ❌ Unreliable                  | ⚠️ Stereo max | ❌ Use Rust native audio backend                     |

---

## File system access must go through Tauri's native layer

**File System Access API** (showOpenFilePicker, showSaveFilePicker) is **not supported on any WebKit platform** — Apple and Mozilla both oppose it. Use `tauri-plugin-dialog` for native OS file dialogs and `tauri-plugin-fs` for all file operations. This is the single most clear-cut "use Rust" decision.

**Origin Private File System (OPFS)** is available since Safari 15.2 / WebKitGTK 2.36 with a critical caveat: `createWritable()` / `FileSystemWritableFileStream` is **not implemented on WebKit**. The only write path is `createSyncAccessHandle()` in a dedicated Web Worker. This Worker-based pattern works well for internal caching but adds architectural complexity. Storage quotas for WKWebView-based apps are **15% of total disk** (~75 GB on a 500 GB drive) — generous for audio work.

**IndexedDB** on Safari has a notorious bug history (iOS 8 "bafflingly incompetent" implementation, iOS 14 index corruption, iOS 17.4 "Connection lost" errors). Safari 16+ with Dexie 4 is much improved but still not bulletproof. **Use IndexedDB only for metadata and project state, never for large audio files.** OPFS via `createSyncAccessHandle()` is **3–4x faster** than IndexedDB for read/write operations.

| Feature                           | WKWebView                       | WebKitGTK              | WebView2 | Verdict                                          |
| --------------------------------- | ------------------------------- | ---------------------- | -------- | ------------------------------------------------ |
| File System Access (pickers)      | ❌ Not supported                | ❌ Not supported       | ✅       | ❌ Use `tauri-plugin-dialog`                     |
| OPFS (via createSyncAccessHandle) | ✅ Safari 15.2+ (Worker only)   | ✅ 2.36+ (Worker only) | ✅       | ⚠️ Partial — good for caching, no createWritable |
| IndexedDB                         | ⚠️ Safari 16+ (historical bugs) | ✅ 2.10+               | ✅       | ⚠️ Partial — metadata only, not audio files      |
| navigator.storage.persist()       | ✅ Safari 17+                   | ✅ ~2.42+              | ✅       | ✅ Use Web API for eviction protection           |
| **Tauri native FS**               | ✅                              | ✅                     | ✅       | **✅✅ Primary storage strategy**                |

---

## Rendering: WebGL2 is the cross-platform baseline, not WebGPU

**WebGPU shipped in Safari 26.0** (September 2025) using Metal as backend, but it is **not available on WebKitGTK at all** — no implementation exists and no public roadmap has been announced. Safari's WebGPU requires macOS Tahoe (26), excluding users on Sequoia (15) or Sonoma (14). This makes WebGPU unsuitable as a cross-platform rendering baseline.

**WebGL2 is fully supported everywhere**: Safari 15+ (via ANGLE-on-Metal), WebKitGTK (via ANGLE), and WebView2. It provides more than enough capability for DAW visualization — waveforms, spectrograms, level meters, and even transform-feedback-based compute. This is the correct cross-platform choice.

**OffscreenCanvas** with WebGL contexts works on Safari 17+ and WebKitGTK, enabling off-main-thread waveform rendering. A critical gotcha: WebGL in Web Workers was **OS-dependent** on older macOS versions (worked on Sonoma, failed on Ventura with Safari 17.1). Always feature-detect WebGL support **inside the Worker**, not on the main thread.

**Canvas 2D** received a massive performance boost on WebKitGTK 2.46+ when **Skia replaced Cairo** as the renderer — MotionMark scores improved up to **4x** with a discrete GPU. For simple UI elements (transport controls, labels, basic meters), Canvas 2D is sufficient; use WebGL2 for intensive visualization.

| Feature               | WKWebView                   | WebKitGTK        | WebView2       | Verdict                                              |
| --------------------- | --------------------------- | ---------------- | -------------- | ---------------------------------------------------- |
| WebGPU                | ✅ Safari 26+ (macOS 26)    | ❌ Not available | ✅ Chrome 113+ | ❌ Not cross-platform — progressive enhancement only |
| WebGL2                | ✅ Safari 15+               | ✅ Supported     | ✅             | ✅ Use Web API — **primary rendering**               |
| OffscreenCanvas       | ✅ Safari 17+               | ✅ Supported     | ✅             | ✅ Use Web API — off-thread rendering                |
| SharedArrayBuffer     | ✅ Safari 15.2+ (COOP/COEP) | ✅ (COOP/COEP)   | ✅             | ✅ Use Web API — configure headers                   |
| Canvas 2D             | ✅ HW-accelerated           | ✅ Skia, 2.46+   | ✅             | ✅ Use Web API — simple UI elements                  |
| requestAnimationFrame | ✅                          | ✅               | ✅             | ✅ Use Web API                                       |

---

## Plugins, WASM DSP, and SIMD are the bright spot

**No Web API exists for hosting native audio plugins** (VST3/AU/CLAP). This is a firm "must do in Rust" requirement. Use crates like `vst3-sys`, `clap-sys`, or `clack` in Tauri's backend.

**WAM (Web Audio Modules) 2.0** is the mature open standard for web-based audio plugins — effectively "VST for the Web." Published in 2022, it defines a WamNode/WamProcessor architecture built on AudioWorklet, supports SharedArrayBuffer ring buffers for efficient host↔plugin communication, MIDI event scheduling, state save/restore, and WebComponent GUIs. Over **40 community plugins** exist, and it's used in production by Amped Studio. WASM plugins compiled from C/C++ (via Emscripten, Faust, Csound) run inside AudioWorklet on all three platforms.

**WASM SIMD** is available since **Safari 16.4** (March 2023) and equivalent WebKitGTK versions, providing **2–4x speedup** for vectorized DSP operations. Safari 18.4 added relaxed SIMD for further optimization. SIMD works inside AudioWorklet with no restrictions. **WASM threads** (SharedArrayBuffer-based) are also available on all platforms with COOP/COEP headers, enabling true multi-threaded DSP in the browser.

WASM in AudioWorklet typically achieves **60–80% of native performance** for DSP. This is sufficient for many effects and instruments but heavyweight processing (large convolution reverbs, complex physical modeling) will benefit from native Rust code.

| Feature                             | WKWebView                   | WebKitGTK      | WebView2      | Verdict                          |
| ----------------------------------- | --------------------------- | -------------- | ------------- | -------------------------------- |
| Native plugin hosting (VST/AU/CLAP) | ❌ No Web API               | ❌ No Web API  | ❌ No Web API | ❌ Use Rust backend              |
| WAM 2.0 / WASM plugins              | ✅ Safari 14.1+             | ✅ 2.38+       | ✅            | ✅ Use Web API — mature standard |
| WASM SIMD in AudioWorklet           | ✅ Safari 16.4+             | ✅ ~2.40+      | ✅ Chrome 91+ | ✅ Use Web API                   |
| WASM threads                        | ✅ Safari 15.2+ (COOP/COEP) | ✅ (COOP/COEP) | ✅            | ✅ Use Web API                   |

---

## Codec support varies significantly — WAV is the only safe universal format

| Format             | WKWebView                   | WebKitGTK                 | WebView2                  | Notes                        |
| ------------------ | --------------------------- | ------------------------- | ------------------------- | ---------------------------- |
| **WAV (PCM)**      | ✅                          | ✅ (gst-plugins-base)     | ✅                        | **Only universal format**    |
| **MP3**            | ✅                          | ⚠️ Needs gst-plugins-ugly | ✅                        | Linux requires extra plugins |
| **AAC (in MP4)**   | ✅                          | ⚠️ Needs gst-plugins-bad  | ✅                        | Linux requires extra plugins |
| **FLAC**           | ✅                          | ✅ (gst-plugins-good)     | ✅                        | Good cross-platform support  |
| **AIFF**           | ✅                          | ⚠️ Needs gst-plugins-bad  | ❌ Chrome doesn't support | Apple-specific               |
| **OGG Vorbis**     | ⚠️ Safari 18.4+ only        | ✅ (gst-plugins-base)     | ✅                        | Requires recent macOS        |
| **Opus (in Ogg)**  | ⚠️ Safari 18.4+ only        | ⚠️ Needs gst-plugins-bad  | ✅                        | Requires recent macOS        |
| **Opus (in WebM)** | ✅ Safari 17+ (mono/stereo) | ⚠️ Needs gst-plugins-bad  | ✅                        | Container matters on WebKit  |

Use **WAV as the internal working format** for guaranteed cross-platform `decodeAudioData` support. Bundle GStreamer plugins in Linux AppImage builds (`"includeGstreamer": true` in Tauri config). For compressed export formats, implement encoding in Rust for guaranteed codec availability.

---

## Metering, networking, and collaboration need native implementations

**LUFS/EBU R128 metering** has no built-in Web API. Implement via AudioWorklet applying K-weighting filters and gated loudness measurement. The `@nicklasoverworlds/loudness-meter` npm package (v1.6.0, March 2026) implements ITU-R BS.1770-5 in AudioWorklet. Alternatively, compile `libebur128` to WASM for maximum accuracy.

**Ableton Link** requires raw UDP multicast, which browsers cannot access. Implement in Rust by wrapping the C++ Link SDK via FFI and expose beat/tempo/phase data to the WebView via Tauri events.

**WebRTC** works on WKWebView (Safari 11+) with higher latency than Chrome (~360ms vs ~200ms one-way reported). On WebKitGTK, WebRTC is **experimental and not enabled by default** — the GStreamer-based implementation has only a **55% test pass rate** (FOSDEM 2026). For reliable cross-platform audio collaboration, use a native WebRTC library (`webrtc-rs`) in the Rust backend.

| Feature       | WKWebView                     | WebKitGTK                      | WebView2      | Verdict                                    |
| ------------- | ----------------------------- | ------------------------------ | ------------- | ------------------------------------------ |
| LUFS/EBU R128 | No API (use AudioWorklet)     | No API                         | No API        | ✅ Implement in AudioWorklet               |
| Ableton Link  | ❌ No Web API                 | ❌ No Web API                  | ❌ No Web API | ❌ Use Rust backend                        |
| WebRTC audio  | ⚠️ Higher latency than Chrome | ❌ Experimental, 55% pass rate | ✅            | ❌ Use Rust for cross-platform reliability |

---

## Critical WebKit bugs and WebKitGTK configuration for Tauri v2

Several open WebKit bugs directly impact DAW workloads:

- **Bug #221334** — Audio through Web Audio is delayed and glitchy (especially with Bluetooth + microphone). Avoid `MediaElementAudioSourceNode` for critical paths.
- **Bug #227199** — Progressively worsening crackling under high CPU load. Relevant for complex audio graphs.
- **Bug #154538** — Audio distortion after sample rate changes. DAW users frequently switch sample rates.
- **Bug #237144** (fixed) — SharedArrayBuffer in AudioWorklet was copied, not shared. Fixed in Safari ~15.4.

**Tauri v2 requires `webkit2gtk-4.1`** (libsoup3). Minimum practical distro is Ubuntu 22.04. Feature availability depends on the WebKitGTK version shipped by the user's distribution — a real fragmentation risk. Key version milestones: 2.38+ for stable AudioWorklet, 2.42+ for Storage API, 2.46+ for Skia-accelerated Canvas 2D, 2.48+ for WebM MediaRecorder. A Tauri maintainer has stated "webkitgtk is unusable" in some contexts, and the team is exploring CEF and Servo as Linux alternatives.

Essential Tauri v2 configuration for audio:

- **COOP/COEP headers**: Enable in `tauri.conf.json` under `app.security.headers` (production) and dev server config (development)
- **Autoplay**: Use `with_autoplay(true)` in Wry configuration; on Windows add `--autoplay-policy=no-user-gesture-required` to `additionalBrowserArgs`
- **GStreamer bundling**: Set `bundle.linux.appimage.includeGstreamer: true` for codec consistency
- **Linux permissions**: Register a custom WebKitGTK permission request handler in Rust — the default handler denies all getUserMedia requests
- **IPC performance**: ~5ms for 10MB binary on macOS, ~200ms on Windows. Keep audio processing in AudioWorklet; use IPC only for control messages. Use `convertFileSrc()` to load audio files directly without IPC overhead.

---

## Conclusion: the architectural split is clear

The research reveals a clean division. **Use Web APIs** for the audio graph (Web Audio API + AudioWorklet), all rendering (WebGL2 + OffscreenCanvas + Canvas 2D), WASM-based DSP and plugins (WAM 2.0 + SIMD), metering (AudioWorklet-based LUFS), project metadata (IndexedDB via Dexie), and internal caching (OPFS). **Use Rust** for MIDI I/O, multi-track recording, native plugin hosting (VST3/AU/CLAP), file system access, codec encoding/decoding beyond WAV, Ableton Link, and reliable WebRTC.

Three APIs are the most surprising gaps: **Web MIDI** (explicitly declined by Apple), **File System Access pickers** (opposed by both Apple and Mozilla), and **WebGPU on Linux** (no WebKitGTK implementation exists). These are not temporary omissions — they reflect deliberate platform decisions unlikely to change.

The minimum viable platform targets for this architecture are **Safari 16.4 / macOS Ventura** (stable AudioWorklet + WASM SIMD + SharedArrayBuffer), **WebKitGTK 2.42+** (matching feature set), and **WebView2 latest**. Targeting Safari 18.4+ unlocks `outputLatency`, PCM/ALAC MediaRecorder, and Ogg container support — a worthwhile upgrade target. The single biggest risk is **WebKitGTK version fragmentation on Linux**, which makes minimizing Web API dependencies and maximizing Tauri's native layer on that platform the safest strategy.

---

## See Also

- **[tauri-platform SKILL.md](./.agents/skills/tauri-platform/SKILL.md)** — Authoritative implementation rules: MIDI via `midir`, voice dictation via `whisper-rs`, file access patterns, COOP/COEP config
- **[native-apis.md](./native-apis.md)** — Per-subsystem "Web vs Rust" verdict with crate recommendations
