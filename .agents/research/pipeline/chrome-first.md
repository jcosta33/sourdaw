# Chrome-first capability architecture for Sourdaw on Tauri V2

**Sourdaw's three-layer architecture should route capabilities through Chrome-leading web APIs first, cross-browser standards second, and Rust native code third — but the research reveals that for a serious DAW, roughly 40% of critical capabilities must go directly to Rust.** The governing principle — "use Chrome APIs when they offer real advantage" — holds for filesystem interactions and some device APIs on Windows, but collapses on macOS and Linux where WKWebView and WebKitGTK lack Web MIDI, WebHID, Web Serial, WebUSB, Web Bluetooth, File System Access API, and FileSystemObserver entirely. The audio engine itself must be Rust-native (with a WASM compilation target for browser mode) because JavaScript's garbage collector cannot meet real-time audio deadlines. SharedArrayBuffer ring buffers, enabled by COOP/COEP headers across all three platforms, form the critical bridge between the web UI layer and real-time audio processing. The recommended software architecture is a **Capability Adapter Layer** (Pattern B) with a lightweight capability registry, where domain-specific interfaces abstract away platform detection and each adapter is independently testable, lazy-loaded, and code-split so browser users never download Tauri-specific code.

---

## 1. The three-layer capability model in summary

The architecture comprises three distinct layers with clear routing rules. **Layer 1 (Chrome-leading)** uses Project Fugu and Chrome-specific APIs when they provide meaningful product advantage — primarily File System Access API pickers and FileSystemObserver on Windows via WebView2. **Layer 2 (cross-browser standards)** uses OPFS, Web Audio API, AudioWorklet, SharedArrayBuffer, WebCodecs, IndexedDB, Cache API, Clipboard API, and WebGPU where available — these work across Chrome, Safari/WKWebView, and WebKitGTK with varying degrees of reliability. **Layer 3 (Rust native)** handles everything that is functionally absent from WebKit (MIDI, HID, serial, USB, Bluetooth, file watching), performance-critical (real-time audio engine, DSP processing), security-sensitive (path-scoped filesystem access, device enumeration), or product-consistency-critical (file dialogs, window management, global shortcuts).

The fallthrough logic is deterministic, not optimistic. Capability detection happens once at startup. The app commits to a concrete adapter per domain and never silently switches mid-session. On Windows (WebView2), roughly 70% of capabilities can use web APIs. On macOS (WKWebView), that drops to approximately 45%. On Linux (WebKitGTK), it falls to roughly 40%. The delta is covered by Tauri plugins and custom Rust commands.

---

## 2. Capability inventory by domain

Each capability below is classified by its recommended default layer. The classification reflects actual cross-platform viability, not theoretical spec compliance.

### Filesystem and project storage

**Classification: Hybrid/situational.** File System Access API (showOpenFilePicker, showSaveFilePicker, showDirectoryPicker) shipped in Chrome 86 and works in WebView2, but is completely absent from WKWebView and WebKitGTK — Apple and Mozilla have formally opposed the API. OPFS provides cross-browser private storage with `createSyncAccessHandle()` for synchronous byte-level read/write in dedicated workers, achieving **3–4× IndexedDB throughput**. However, WKWebView enforces a **10 MB per-file limit** in embedded (non-browser) contexts, making it unsuitable for audio file caching on macOS. Tauri's `tauri-plugin-fs` with path scoping and `tauri-plugin-dialog` for native file pickers provide the reliable cross-platform foundation. On Windows, Chrome's File System Access API can supplement Tauri for in-session file handle persistence; on macOS and Linux, Rust filesystem operations handle everything.

### Directory access and persistence

**Classification: Native-first.** Chrome's `showDirectoryPicker()` returns a `FileSystemDirectoryHandle` that can be cached in IndexedDB for re-access, but permissions do not persist across sessions — the user must re-grant on each launch. This behavior is the same in WebView2. WKWebView and WebKitGTK have no equivalent. Tauri's scoped filesystem with path variables (`$HOME`, `$AUDIO`, `$APPDATA`) provides persistent, permissioned directory access on all platforms without user re-prompting.

### File watching and change observation

**Classification: Native-first.** FileSystemObserver shipped in Chrome 133 (February 2025) and observes both user-visible files and OPFS entries, supporting recursive directory watching with change types including `appeared`, `disappeared`, `modified`, and `moved`. It should be available in WebView2 133+ since it's implemented at the Blink level. However, it is completely absent from WKWebView and WebKitGTK, it remains experimental and non-standard (spec PR still pending at whatwg/fs#165), and it may fire `unknown` type events when the observation queue overflows. The Rust `notify` crate provides cross-platform file system watching via FSEvents (macOS), inotify (Linux), and ReadDirectoryChangesW (Windows) with much stronger guarantees. FileSystemObserver can serve as an optimization on Windows but should never be the sole path.

### MIDI device I/O

**Classification: Native-first.** This is one of the most consequential findings for a DAW. **Safari/WebKit has never shipped Web MIDI API** — Apple explicitly declined implementation in 2020 citing fingerprinting concerns. WebKit bug #107250 remains unresolved through Safari 26.2 (current stable, March 2026). WebKitGTK likewise lacks Web MIDI entirely. The API works in Chrome 43+ and WebView2 with sysex support, device enumeration, and hot-plug detection via `statechange` events. The `midir` Rust crate (used by `tauri-plugin-midi`) provides cross-platform MIDI access through CoreMIDI, ALSA, and WinMM/WinRT. For Sourdaw, **MIDI must be Rust-native on all desktop platforms** with Web MIDI used only as a supplemental path in browser-only deployment mode.

### HID and control surfaces

**Classification: Native-first.** WebHID shipped in Chrome 89 as a WICG specification. Both the Gecko and WebKit teams **formally oppose the API**. It is completely absent from WKWebView and WebKitGTK. In WebView2, the standard Chrome device chooser popup may not render correctly, requiring custom native device selection UI. The `hidapi` Rust crate provides cross-platform HID access suitable for motorized faders, rotary encoders, and LED button matrices. Protected HID usages (keyboards, mice, FIDO keys) are correctly blocked by both WebHID and hidapi.

### Serial-connected hardware

**Classification: Native-first.** Web Serial shipped in Chrome 89. Firefox's standards position was originally "harmful" (softened to "neutral"). Safari does not implement it. Available in dedicated workers. The `serialport` Rust crate provides full cross-platform serial port access.

### USB-connected hardware

**Classification: Native-first.** WebUSB shipped in Chrome 61 but blocks access to audio, video, HID, and mass storage USB device classes — precisely the classes a DAW would need. On Windows, devices often require WinUSB driver installation. Firefox and Safari have stated opposition. The `rusb` or `nusb` Rust crates (libusb bindings) provide unrestricted cross-platform USB access.

### Bluetooth and BLE hardware

**Classification: Native-first.** Web Bluetooth is available in Chrome 56+ on desktop but absent from Safari and WebKitGTK entirely. BLE MIDI devices typically present as system-level MIDI devices once OS-paired, making them visible to `midir` without direct BLE access. The `btleplug` Rust crate provides cross-platform BLE for cases requiring direct GATT service interaction.

### Audio playback and processing

**Classification: Hybrid.** Web Audio API with AudioWorklet is the **strongest cross-platform web standard available** — supported in Chrome, WebView2, WKWebView (Safari 14.1+), and WebKitGTK (2.38+). AudioWorklet runs on a dedicated high-priority audio rendering thread with a fixed **128-sample render quantum** (~2.9 ms at 44.1 kHz). WASM modules can be instantiated inside AudioWorkletProcessor, enabling Rust DSP code compiled to WASM to run with deterministic, GC-free performance in the browser. However, round-trip latency in browser contexts is **30 ms best-case** (per Soundtrap/Spotify measurements), versus **sub-10 ms** via native ASIO/CoreAudio/ALSA through `cpal`. For Sourdaw's desktop mode, the audio engine must run natively in Rust; Web Audio API with WASM serves the browser deployment target.

### Low-latency scheduling

**Classification: Standards-first with caveats.** `scheduler.postTask()` (Chrome 115+) and `scheduler.yield()` (Chrome 129+) provide priority-based scheduling but are Chromium-only. `requestAnimationFrame` is universally available for UI updates. `requestIdleCallback` works in Chrome 47+ and Safari 16.4+. For audio scheduling, **AudioContext.currentTime** and the AudioWorklet `process()` callback (called ~344 times/second at 44.1 kHz) provide the most precise timing available on the web — far more reliable than setTimeout or rAF. Native scheduling via Rust threads with real-time priority is available for desktop mode.

### Worker communication and shared memory

**Classification: Standards-first.** SharedArrayBuffer is **achievable cross-platform** when COOP (`same-origin`) and COEP (`require-corp`) headers are configured. Tauri v2.1+ supports these headers in `tauri.conf.json` under `app.security.headers`. Chrome, WebView2, WKWebView (Safari 15.2+ / macOS Ventura 13.3+), and WebKitGTK (2.42+ with proper headers) all support SAB. On Linux, the environment variable `JSC_useSharedArrayBuffer=1` may still be needed as belt-and-suspenders. Atomics.waitAsync is available in Safari 16.4+. This enables the critical lock-free ring buffer pattern between AudioWorklet and worker threads.

### GPU compute

**Classification: Standards-first with native fallback.** WebGPU shipped in Chrome 113, Safari 26+ (September 2025, macOS Tahoe only), and Firefox 141+ (Windows only). It is **not available in WebKitGTK** — Safari's WebGPU implementation maps to Metal, which has no Linux equivalent, and WebKitGTK has not shipped an alternative backend. WebGPU compute shaders are available in dedicated workers. For Linux, Rust's `wgpu` crate (which targets Vulkan/OpenGL) provides GPU compute. For macOS users on pre-Tahoe systems, WebGL2 fallback or Rust `wgpu` is needed.

### Media decode and encode

**Classification: Standards-first.** WebCodecs shipped in Chrome 94 and reached full support in Safari 26.1 and Firefox 133. AudioDecoder produces `AudioData` with `f32` interleaved format — conversion to Web Audio's `f32-planar` format is needed. No built-in container demuxing exists (MP4/WebM parsing requires libraries). WebKitGTK support depends on GStreamer plugins; FDK AAC via gst-plugins-bad is recommended over gst-libav's AAC which is disabled due to bugs. For production audio file I/O (WAV, FLAC, MP3), Rust crates like `symphonia` provide more reliable, format-complete decoding.

### Windowing, titlebar, and shell integration

**Classification: Native-first.** Window Controls Overlay is a Chromium/PWA-only feature irrelevant to Tauri apps. Tauri provides native window management: `decorations: false` for custom titlebars, `data-tauri-drag-region` for drag support, `titleBarStyle: "overlay"` or `"transparent"` on macOS for traffic lights, `alwaysOnTop` for floating mixer/transport windows, `windowEffects` for platform-specific vibrancy/mica, and multi-webview windows for complex layouts. Different windows receive different capability sets through Tauri's per-window security model.

### Launch, open-with, and file association behavior

**Classification: Native-first.** Chrome's Launch Handler and File Handling APIs are PWA-specific manifest features irrelevant to Tauri apps. File associations are handled through Windows registry entries, macOS Info.plist UTI declarations, and Linux .desktop file MIME type associations — all configured in Tauri's bundler config. Tauri apps receive file paths via command-line arguments or deep links.

### Keyboard capture for immersive editing

**Classification: Native-first.** Chrome's Keyboard Lock API (Chrome 68+) requires fullscreen mode to capture system shortcuts. It's unsupported in WKWebView and WebKitGTK. Tauri's `tauri-plugin-global-shortcut` registers system-wide hotkeys that work even when the app is not focused — essential for DAW transport controls. Standard `keydown`/`keyup` events handle in-app keyboard shortcuts on all platforms.

### Clipboard, drag-drop, and import

**Classification: Standards-first.** The Async Clipboard API is broadly supported: `writeText`/`readText` in Chrome 66+, Safari 13.1+, Firefox 63+. Image clipboard support varies (Chrome 76+, Firefox 127+, Safari 13.1+). Web Share API is **broken in WebView2** (GitHub MicrosoftEdge/WebView2Feedback#1038, confirmed). Safari requires user gestures for all clipboard reads. Drag-drop via standard HTML5 DragEvent works everywhere. For custom audio data transfer, use Tauri's clipboard plugin with extended format support.

### Offline storage, cache, and large binary storage

**Classification: Hybrid.** IndexedDB and Cache API have universal support. OPFS provides high-performance binary storage in workers. Critical differences exist in **storage quotas**: Chrome/WebView2 allows up to **60% of total disk per origin**; Safari browser allows the same; but **WKWebView in non-browser apps (i.e., Tauri on macOS) is limited to 15%**. `navigator.storage.persist()` prevents eviction under storage pressure. Safari's 7-day eviction policy for script-writable storage may apply to WKWebView depending on how the origin is treated, though `persist()` mitigates this. For large sample libraries and project files exceeding the 10 MB OPFS per-file limit on macOS, Tauri's native filesystem is required.

---

## 3. Support matrix across runtimes

The table below captures actual support status for every DAW-relevant capability. "Supported" means tested and reliable in production contexts; "Partial" means functional but with meaningful limitations; "Absent" means not implemented.

| Capability                  | Chrome Desktop      | WebView2 (Win)                 | WKWebView (macOS)                        | WebKitGTK (Linux)    |
| --------------------------- | ------------------- | ------------------------------ | ---------------------------------------- | -------------------- |
| File System Access pickers  | Stable (86+)        | Supported (permission caveats) | Absent                                   | Absent               |
| OPFS async                  | Stable (86+)        | Supported                      | Supported                                | Supported            |
| OPFS createSyncAccessHandle | Stable (102+)       | Supported (workers only)       | Supported (10 MB limit)                  | Supported            |
| FileSystemObserver          | Shipping (133+)     | Likely supported               | Absent                                   | Absent               |
| Web Audio API               | Stable (35+)        | Supported                      | Supported (14.1+)                        | Supported (2.38+)    |
| AudioWorklet                | Stable (66+)        | Supported                      | Supported (14.1+)                        | Supported (2.38+)    |
| Web MIDI                    | Stable (43+)        | Supported                      | **Absent (never shipped)**               | **Absent**           |
| WebHID                      | Stable (89+)        | Partial (picker issues)        | Absent                                   | Absent               |
| Web Serial                  | Stable (89+)        | Partial (picker issues)        | Absent                                   | Absent               |
| WebUSB                      | Stable (61+)        | Partial (picker issues)        | Absent                                   | Absent               |
| Web Bluetooth               | Stable (56+)        | Partial                        | Absent                                   | Absent               |
| WebGPU                      | Stable (113+)       | Supported                      | Supported (Tahoe 26+)                    | **Absent**           |
| SharedArrayBuffer           | Stable (COOP/COEP)  | Supported                      | Supported (13.3+)                        | Supported (fragile)  |
| WebCodecs                   | Stable (94+)        | Supported                      | Full (26.1+)                             | Partial (GStreamer)  |
| WebAssembly SIMD            | Stable              | Supported                      | Supported (16.4+)                        | Supported            |
| Wasm Threads                | Stable              | Supported                      | Supported (COOP/COEP)                    | Partial (COOP/COEP)  |
| Async Clipboard             | Stable (66+)        | Supported                      | Supported                                | Supported            |
| IndexedDB                   | Universal           | Supported                      | Supported                                | Supported            |
| Cache API                   | Universal           | Supported                      | Supported                                | Supported            |
| navigator.storage.persist() | Stable (auto-grant) | Supported                      | Supported                                | Supported            |
| Keyboard Lock               | Stable (fullscreen) | Uncertain                      | Absent                                   | Supported (2.52+)    |
| scheduler.postTask()        | Stable (115+)       | Supported                      | Absent                                   | Absent               |
| getUserMedia (audio)        | Universal           | Supported                      | Supported (NSMicrophoneUsageDescription) | Supported (PipeWire) |
| Media Session               | Stable (73+)        | Supported                      | Partial (15+)                            | Varies               |
| Web Share                   | Stable (89+)        | **Broken**                     | Supported                                | Unknown              |
| requestIdleCallback         | Stable (47+)        | Supported                      | Supported (16.4+)                        | Varies               |

### Permission model differences across runtimes

File System Access API permissions in WebView2 bypass the `PermissionRequested` event — Chrome's native permission UI renders directly and cannot be intercepted or styled by the host application. MIDI permissions in Chrome show a standard permission prompt that persists per-origin. getUserMedia on macOS WKWebView requires the `NSMicrophoneUsageDescription` Info.plist key and proper code signing entitlements. WebView2 handles most permissions through its `PermissionRequested` event, enabling programmatic auto-granting for trusted scenarios.

### Persistence across sessions

File System Access handles can be cached in IndexedDB but require `requestPermission()` on each app launch to reactivate. OPFS data persists until user action or storage pressure eviction. IndexedDB on WKWebView follows Safari's persistence rules — potentially subject to 7-day eviction without `navigator.storage.persist()`. WebView2 storage persists in the user data folder configured for the WebView2 environment.

---

## 4. Chrome-first opportunities are real but narrow

The genuine Chrome-first opportunities for Sourdaw are confined to **Windows desktop mode via WebView2**, where Chromium's engine runs natively. On macOS and Linux, Chrome-leading APIs provide zero value because the WebView engines don't support them.

**File System Access API** provides the strongest Chrome-first opportunity. On Windows, `showOpenFilePicker()` and `showDirectoryPicker()` surface native OS file dialogs directly from the web layer. The key advantage over Tauri's dialog plugin is that File System Access returns `FileSystemFileHandle` objects that can be used for subsequent reads/writes without additional IPC round-trips — the web layer maintains direct handle access. This matters for save-in-place workflows where a project file is repeatedly written. The limitation is that permission persistence requires caching handles in IndexedDB and re-requesting permission per session.

**FileSystemObserver** provides a secondary Chrome-first opportunity for watching project directories for external changes (e.g., a user dragging new samples into a project folder from Finder/Explorer). On Windows, this avoids the need for a separate Rust file-watching process for this specific use case. However, its experimental status and potential for `unknown` events when the queue overflows make it unsuitable as the sole file watching mechanism.

**scheduler.postTask()** enables priority-based task scheduling that could benefit UI responsiveness during heavy audio rendering, but the performance gain over `requestAnimationFrame` and `queueMicrotask` is marginal for a DAW's specific workload patterns.

Project Fugu device APIs (WebHID, Web Serial, WebUSB, Web Bluetooth) are technically available on WebView2 but suffer from device picker UI integration issues and provide no benefit over Rust native access. They create a worse UX (browser-style permission prompts in a desktop app) for no performance gain. These should be **skipped entirely** in favor of Rust native device access.

---

## 5. Cross-browser standard opportunities form the reliable middle layer

The standards-first tier provides the backbone for Sourdaw's web-facing architecture — these APIs work across all three WebView engines with acceptable reliability.

**Web Audio API with AudioWorklet** is the single most important cross-browser standard. AudioWorklet runs DSP code on a dedicated high-priority audio rendering thread at a fixed 128-sample render quantum. WASM modules instantiated inside `AudioWorkletProcessor` provide GC-free, deterministic processing suitable for synthesizers, effects, and mixing — this is the architecture used by Soundtrap, BandLab, and every serious web audio application. The critical performance pattern uses **SharedArrayBuffer ring buffers with Atomics** for lock-free communication between the AudioWorklet thread and parameter-feeding workers. Paul Adenot's `ringbuf.js` library is the reference implementation for this pattern.

**OPFS with createSyncAccessHandle** provides high-throughput binary file I/O suitable for project caching, undo history, and temporary audio buffer storage. The synchronous API (workers only) achieves 3–4× IndexedDB performance. The critical limitation is WKWebView's **10 MB per-file cap** in embedded contexts, which makes OPFS unsuitable for caching full audio files on macOS. OPFS is best used for structured project data, settings, and small audio clips under 10 MB.

**WebGPU** enables GPU-accelerated visualization — waveform rendering, spectrograms, meters — across Chrome and Safari 26+. Its compute shader capability via WGSL opens possibilities for GPU-accelerated audio analysis. The gap on WebKitGTK (Linux) means a WebGL2 or Canvas2D fallback path is required, or direct Rust `wgpu` usage through Tauri commands.

**WebCodecs** enables hardware-accelerated media decode/encode suitable for audio bounce/export workflows and sample format conversion. Full cross-browser support exists as of Safari 26.1 and Firefox 133, though container demuxing must be handled separately.

**SharedArrayBuffer** is the essential plumbing API. Properly configured COOP/COEP headers in both `tauri.conf.json` (production) and Vite's dev server (development) unlock SAB across all platforms. This enables WASM threads, AudioWorklet shared memory, and efficient inter-worker communication. Without SAB, the browser-mode audio engine loses its most performant data-sharing mechanism.

---

## 6. Where Rust remains the real solution

For a DAW of professional ambition, Rust native code handles approximately **40% of all capability domains** — and this percentage grows when targeting macOS and Linux.

**The audio engine must be Rust-native.** JavaScript cannot guarantee real-time deadlines due to garbage collection pauses. Web Audio API's AudioWorklet with WASM provides the browser-mode path (same Rust DSP code compiled to `wasm32-unknown-unknown`), but desktop mode should use `cpal` for direct ASIO (Windows), CoreAudio (macOS), and ALSA/PipeWire (Linux) access. Native audio achieves **sub-10 ms round-trip latency** versus the web path's 30 ms best-case. Plugin hosting (VST3/CLAP/AU) is exclusively native.

**MIDI is Rust-native on all desktop platforms.** The `midir` crate provides CoreMIDI, ALSA, and WinMM/WinRT backends. This is non-negotiable — Web MIDI has never shipped in Safari and will not ship in any foreseeable WebKit version. The same crate handles BLE MIDI devices that are OS-paired, since they appear as standard MIDI devices to the system.

**All device I/O (HID, USB, serial, Bluetooth) is Rust-native.** These Project Fugu APIs are Chrome-only, opposed by both Mozilla and Apple, and provide no path to cross-platform support. The `hidapi`, `serialport`, `rusb`/`nusb`, and `btleplug` crates provide full cross-platform device access with stronger lifecycle management than their web counterparts.

**File watching is Rust-native.** The `notify` crate (using FSEvents, inotify, ReadDirectoryChangesW) provides reliable, battle-tested, cross-platform file watching with no experimental API dependency. FileSystemObserver can supplement this on Windows but should not replace it.

**File dialogs and directory access are Rust-native.** Tauri's dialog and fs plugins provide consistent, permission-scoped file access across all platforms. This avoids the fractured experience of Chrome file pickers on Windows, absent pickers on macOS/Linux, and the permission-persistence gap of the File System Access API.

**Window management, global shortcuts, and file associations are Rust-native.** These are shell-integration concerns that web APIs were never designed to handle in desktop application contexts. Tauri's window configuration, `tauri-plugin-global-shortcut`, and bundler-configured file associations provide the correct abstraction.

---

## 7. The recommended software pattern is a capability adapter layer

After analyzing five architectural patterns, the recommended approach for Sourdaw is **Pattern B (Capability Adapter Layer) combined with a lightweight Pattern C (Capability Registry) for complex domains and Pattern D (Native Shadow) for the audio engine**. Pattern A (scattered feature detection) is an anti-pattern at scale. Pattern E (optimistic try/catch) creates unacceptable UX inconsistency for a DAW.

### How the adapter layer works

Each capability domain defines a TypeScript interface expressing the domain's operations without platform assumptions. Concrete adapter classes implement the interface for each platform path. A factory function, informed by a singleton `CapabilityRegistry` that performs detection once at startup, returns the appropriate adapter. Components consume only the interface, never the adapter directly.

```
React Components → Domain Services → Adapter Interfaces → Concrete Adapters
                                                            ├── ChromeFSAdapter
                                                            ├── OPFSAdapter
                                                            └── TauriFSAdapter
```

The registry detects `window.__TAURI_INTERNALS__`, checks `self.crossOriginIsolated`, probes `'showOpenFilePicker' in window`, and caches results. Adapters are lazy-loaded via dynamic imports so browser users never download Tauri adapter code, and Tauri users skip Chrome-specific adapter code. Branded types (`TauriFileHandle`, `ChromeFileHandle`, `OPFSFileHandle`) prevent accidental cross-adapter handle usage at compile time.

### Why Pattern B wins

The adapter pattern provides the best balance of **testability** (each adapter is independently unit-testable), **extensibility** (adding a new platform = adding a new class), **maintainability** (platform code is isolated, not scattered), and **code-splitting** (tree-shaking eliminates unused platform paths). Pattern C's full capability graph is reserved for the audio engine routing, where the interaction between WASM, native, and Web Audio paths requires a more sophisticated resolution mechanism. Pattern D applies exclusively to the audio engine, MIDI, and device I/O where Rust is the primary implementation regardless of runtime.

### Key adapter domains

The system needs adapters for approximately eight domains: project storage (filesystem), MIDI device access, HID device access, audio engine (native vs WASM+WebAudio), GPU compute/rendering, media encode/decode, clipboard operations, and offline storage. Domains with only one real implementation (e.g., window management — always Tauri native) do not need an adapter and should use direct Tauri APIs.

---

## 8. Decision rules for when to fall through to Rust

The "Rust threshold" framework defines five categories of mandatory native fallthrough and one category of justified native promotion.

### Functional necessity: the capability does not exist in the renderer

This is the clearest trigger. If the API is absent from the target WebView engine, Rust handles it. The complete list of functionally absent capabilities by platform:

On **WKWebView (macOS)**: File System Access pickers, Web MIDI, WebHID, WebUSB, Web Serial, Web Bluetooth, FileSystemObserver, scheduler.postTask(). On **WebKitGTK (Linux)**: all of the above plus WebGPU. These gaps are not temporary — Apple and Mozilla have formally opposed several of these APIs, and WebKit shows no intent to implement them.

**Rule**: If a capability is absent on any target platform, implement the Rust native path as the primary and treat the web API (when available) as the Windows/browser-mode optimization.

### Cross-platform necessity: exists only in Chromium

When an API works in Chrome/WebView2 but not in WKWebView or WebKitGTK, using it as the default creates a two-tier product. Web MIDI is the canonical example — it works well on Windows but creates a completely non-functional MIDI experience on macOS and Linux. The Rust native path must be the default, with the web path as an optional supplement.

**Rule**: If using the web API would require a separate Rust fallback on two of three desktop platforms, make Rust the primary implementation on all platforms to reduce testing surface and ensure behavioral consistency.

### Performance necessity: the web path is not fast enough for DAW-grade behavior

Web Audio's 30 ms best-case round-trip latency is acceptable for monitoring but inadequate for tracking with live performers. OPFS throughput, while good, cannot match memory-mapped native file I/O for loading large sample libraries. JavaScript's GC pauses (even with WASM mitigation) create occasional audio glitches that are unacceptable in professional use.

**Rule**: When latency requirements are below 10 ms, when throughput must sustain sustained 100+ MB/s reads, or when GC-induced jitter cannot be tolerated, use Rust native.

### Security necessity: the web API creates unnecessarily broad permission surface

WebUSB grants broad device access that can theoretically interact with firmware update interfaces. WebHID, while blocking protected usages, still exposes raw HID reports that could be misused. In a desktop app context, Rust native device access with Tauri's permission scoping provides more precise access control than browser-style permission prompts.

**Rule**: When Rust native access through Tauri's capability system provides narrower, more auditable permissions than the equivalent web API, prefer Rust.

### Product consistency necessity: the web path creates different UX across platforms

File dialogs are the prime example. Chrome's `showOpenFilePicker()` renders a Chrome-styled file picker on Windows. On macOS, Tauri's dialog plugin renders the native macOS file picker. If both are used inconsistently, users see different picker experiences depending on which code path was active. Using Tauri's dialog plugin consistently on all desktop platforms ensures identical UX.

**Rule**: When the web API produces visible UI (permission prompts, device pickers, file dialogs) that differs from native equivalents, prefer the native path for desktop mode.

### Determinism and lifecycle necessity: stronger guarantees for long-running operations

File watching via FileSystemObserver can silently transition to an `errored` state, requiring polling fallback. Web Bluetooth connections lack the lifecycle management of native BLE stacks. MIDI device hot-plug detection via Web MIDI is adequate but provides less metadata than native MIDI APIs. For operations that run continuously during a multi-hour recording session, native implementations provide stronger lifecycle guarantees.

**Rule**: For capabilities that must remain stable across hours-long sessions (file watching, device connections, audio engine), prefer native implementations even when web equivalents exist.

---

## 9. Mapping the three layers onto Tauri V2 concepts

### What belongs in a custom Tauri plugin

Custom plugins are appropriate when the capability is **reusable across multiple Tauri applications**, needs its own **permission namespace**, or requires **mobile platform support**. For Sourdaw:

A **tauri-plugin-midi** (wrapping `midir`) should be a standalone plugin with permissions like `allow-enumerate-devices`, `allow-open-input`, `allow-send-message`, and `deny-sysex` as a restrictable scope. Similarly, a **tauri-plugin-audio-engine** wrapping `cpal` and the DSP pipeline benefits from plugin isolation, enabling crash-isolated audio processing and clean permission boundaries. A **tauri-plugin-hid-device** wrapping `hidapi` follows the same pattern.

Plugins get their own permission files auto-generated via `tauri_plugin::Builder` in `build.rs`. Each command generates `allow-{command-name}` and `deny-{command-name}` permissions. Different windows receive different plugin permissions — the main DAW window gets full MIDI and audio access while a floating mixer popup gets only window controls and metering event subscriptions.

### What belongs in app-local Rust commands

App-specific logic that doesn't warrant plugin extraction: project file format serialization/deserialization, waveform decimation for display, undo/redo state management, project-specific asset management, and DSP graph configuration. These use Tauri's `#[tauri::command]` macro with app-scoped permissions defined in `src-tauri/permissions/`.

### What belongs in a sidecar

**VST/AU/CLAP plugin hosting** is the strongest sidecar candidate. Plugin hosts benefit from crash isolation — a misbehaving third-party plugin crashing the sidecar doesn't take down the main application. Communication via structured binary protocol over stdin/stdout or a local socket provides adequate throughput for parameter changes and audio buffer exchange. The sidecar model also enables sandboxing plugin processes with restricted filesystem access.

### What should never be exposed raw to frontend

Raw filesystem paths outside scoped directories. Unrestricted shell command execution. Generic device passthrough (e.g., a `send_raw_usb(bytes)` command). Direct SQL execution against application databases. Any command that accepts arbitrary paths or arbitrary byte sequences without validation. Tauri's scope system with deny rules should constrain every filesystem command to project directories, audio library paths, and application data folders.

### Tauri V2 IPC for audio data

Tauri's IPC serializes to JSON by default, but v2 supports raw `ArrayBuffer` transfer via `tauri::ipc::Response` (Rust → JS) and `InvokeBody::Raw` (JS → Rust). Performance benchmarks show ~5 ms for 10 MB on macOS and ~200 ms for 10 MB on Windows via binary IPC. **No cross-platform SharedMemory/mmap exists** between Rust and WebView. The implication: real-time audio data should never traverse the IPC boundary. The Rust audio engine writes directly to system audio output via `cpal`; the frontend receives only decimated waveform data and metering values via Tauri Channels at 30–60 fps.

### COOP/COEP header configuration

SharedArrayBuffer requires cross-origin isolation. In Tauri v2.1+:

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

These headers only apply to production builds. The Vite dev server must be configured separately with identical headers. Enabling COEP blocks loading cross-origin resources (CDN fonts, images) without CORP headers — plan the asset pipeline accordingly.

---

## 10. UX and product behavior implications

### Permission prompts differ dramatically across runtimes

In Chrome/WebView2, Web MIDI shows a browser-style permission dialog. On macOS, `getUserMedia` triggers a system-level permission dialog with the `NSMicrophoneUsageDescription` text. File System Access on WebView2 shows Chrome's permission UI that cannot be intercepted or styled. These disparate experiences confuse users who expect a consistent desktop application. The solution is to **route all permission-requiring operations through Tauri's native capabilities**, where the application controls the permission experience. For browser-only mode, web permission prompts are acceptable because users expect browser behavior.

### Browser mode versus native mode should be explicit

Sourdaw should detect its runtime at startup and expose a "mode" indicator (not prominently, but accessible in settings or about). Features unavailable in browser mode (e.g., native MIDI on Safari, VST hosting, low-latency audio) should show clear explanatory states rather than silently degrading. A "capabilities" panel in settings can show which features are active and which are limited by the current runtime.

### Fallback visibility prevents user confusion

When OPFS hits the 10 MB per-file limit on macOS, the application should not silently fail — it should inform the user that large files will be managed through the native filesystem. When WebGPU is unavailable on Linux, the visualizer should note it's running in compatibility mode. The principle is: **never let a user wonder why behavior differs between platforms.** All degradation should produce visible, actionable feedback.

### Consistent abstraction is preferred over capability-aware UI

For most features, the adapter layer should present identical UI regardless of which backend is active. File open/save should look the same whether Chrome's File System Access, Tauri's dialog, or OPFS backs it. MIDI device selection should present the same list whether sourced from Web MIDI or `midir`. The adapter boundary prevents platform-specific UX from leaking into component code.

---

## 11. Performance and reliability by domain

### Audio processing latency

The Rust native path via `cpal` achieves **3–6 ms output latency with ASIO** (Windows), **5–8 ms via CoreAudio** (macOS), and **5–15 ms via ALSA/PipeWire** (Linux). The Web Audio path via AudioWorklet achieves **~30 ms round-trip** best-case, with the 128-sample render quantum consuming ~2.9 ms of the processing budget at 44.1 kHz. WKWebView historically ran audio processing on the main thread (pre-Safari 14.1), causing crackles during DOM interaction; modern versions use a separate thread but remain less optimized than Chromium. For monitoring during tracking, native latency is essential. For playback and mixing, web audio latency is acceptable.

### Filesystem throughput and consistency

OPFS `createSyncAccessHandle` achieves 3–4× IndexedDB throughput, adequate for project metadata and small audio clips. Native filesystem via `cpal` and direct Rust I/O achieves memory-mapped performance for large sample libraries. The critical difference is **persistence semantics**: OPFS data is origin-scoped and subject to storage pressure eviction, while native filesystem writes go to user-chosen locations with standard OS persistence. For project files that users expect to find in their file manager, native filesystem is the only option.

### Device lifecycle and hot-plug stability

Web MIDI's `statechange` event provides adequate hot-plug detection in Chrome but doesn't exist on WebKit. Native MIDI via `midir` provides equivalent hot-plug on all platforms. WebHID `connect`/`disconnect` events work in Chrome but the device picker UI integration in WebView2 is problematic. Native `hidapi` provides reliable cross-platform device lifecycle. For long recording sessions where MIDI controllers may sleep and wake, native device management provides stronger reconnection guarantees.

### Background and crash behavior

WKWebView has a documented issue where **audio stops after app backgrounding** — the AudioContext must be suspended and resumed as a workaround. WebView crashes (which happen out-of-process in WKWebView) interrupt audio but don't crash the host Tauri app. Rust audio engines running in the main process continue operating during WebView issues. Sidecar audio engines provide the ultimate crash isolation — a plugin crash kills only the sidecar process.

### Memory pressure

WebAssembly on Safari has practical memory ceilings (~350 MB on iOS; higher but still constrained on macOS). Chrome is more generous. The Rust native audio engine has no WebView memory limitations — it can map multi-gigabyte sample libraries. OPFS storage on WKWebView is limited to **15% of disk** for non-browser apps versus 60% in Chrome.

---

## 12. Security model and best practices

### Least-privilege API exposure through Tauri capabilities

Every Rust command exposed to the frontend should be gated by explicit capability permissions. The Sourdaw capability structure should define separate capability files for distinct functional areas: `audio-engine.json` (MIDI access, audio device control), `project-storage.json` (scoped filesystem read/write), `device-access.json` (HID, serial), and `ui-controls.json` (window management, shortcuts). Deny rules override allow rules in Tauri's ACL system, providing defense in depth.

### Permission prompt timing

Request permissions lazily, at the moment of need rather than at launch. When a user first connects a MIDI controller, prompt for MIDI access. When they first open a project, trigger the file dialog. Never request microphone, MIDI, file access, and device permissions simultaneously at startup — this creates permission fatigue and trains users to click "allow" reflexively.

### Filesystem path scoping

Tauri's scope system should constrain filesystem commands to:

- `$APPDATA/sourdaw/**` for application configuration and caches
- `$AUDIO/**` for default audio library browsing
- User-selected project directories (granted dynamically via dialog plugin, persisted via `tauri-plugin-persisted-scope`)
- Explicit deny for `$HOME/.ssh/**`, `$HOME/.gnupg/**`, system directories

### Frontend-to-Rust command design

Commands should accept validated domain objects, not raw filesystem paths or byte arrays. Instead of `readFile(path: string)`, expose `loadProjectFile(projectId: string)` where the Rust backend resolves the path from its own project registry. This prevents the frontend from constructing arbitrary filesystem paths that bypass scope validation.

### Sidecar supervision

Plugin-hosting sidecars should run with restricted filesystem access (only the plugin directory and temporary working space). Communication should use a structured binary protocol with message validation, not raw pipe forwarding. The main process should monitor sidecar health via heartbeat and restart crashed sidecars automatically, notifying the user that a plugin was unloaded.

---

## 13. Case studies

### Case 1: Project and sample-library filesystem

A DAW project involves a `.sourdaw` project file (JSON/binary metadata, ~1–50 MB), associated audio stems (WAV/FLAC, 10 MB–2 GB each), and a sample library browser that indexes thousands of files across multiple directories.

**Layer 1 (Chrome-first on Windows):** File System Access API for `showDirectoryPicker()` to let users select project and sample library directories. `FileSystemDirectoryHandle` enables iterating directory contents without IPC. Handles cached in IndexedDB for session persistence.

**Layer 2 (Standards):** OPFS for the project autosave cache — store a rolling snapshot of the project state that persists across crashes. IndexedDB for project metadata index and sample library catalog. Limit OPFS usage to files under 10 MB to stay within WKWebView's per-file cap.

**Layer 3 (Rust native):** `tauri-plugin-dialog` for file/directory picker on macOS and Linux. `tauri-plugin-fs` with scoped access for reading/writing project files and audio stems. Rust-side project format serialization using `serde` and custom binary format. `tauri-plugin-persisted-scope` to remember granted directory access across sessions. Sample library indexing runs as a background Rust task with progress reported via Tauri Channels.

**Recommended routing rule:** On all desktop platforms, use Tauri's dialog and fs plugins for user-visible file operations. Use OPFS for autosave and small caches. File System Access API is an optional enhancement on Windows for in-session handle reuse. Browser-only mode uses OPFS for everything under 10 MB and File System Access (Chrome) or `<input type="file">` (Safari/Firefox) for user-initiated operations.

### Case 2: MIDI keyboards and control surfaces

A DAW must enumerate MIDI devices, receive note-on/note-off/CC messages, send MIDI output (for LED feedback on controllers), and detect device hot-plug/removal.

**Layer 1 (Chrome-first):** Web MIDI API provides complete MIDI access in Chrome and WebView2, including sysex with permission. Permission persists per-origin. Hot-plug via `statechange` event.

**Layer 2 (Standards):** No standards-based MIDI exists outside Chrome. The web standards tier is empty for MIDI.

**Layer 3 (Rust native):** `midir` crate via custom `tauri-plugin-midi` on all desktop platforms. The plugin exposes commands: `enumerate_midi_inputs`, `enumerate_midi_outputs`, `open_input`, `open_output`, `send_message`. MIDI messages from devices are streamed to the frontend via Tauri events. The plugin also handles HID-based control surfaces (Mackie Control, HUI protocol) via `hidapi` for devices that use HID transport rather than MIDI.

**Recommended routing rule:** **Always use Rust native MIDI on desktop.** Web MIDI is used only in browser-only deployment mode as the sole option. The `tauri-plugin-midi` exposes a WebMIDI-compatible JavaScript API so the frontend code is identical regardless of backend. The adapter interface abstracts both paths.

### Case 3: File watching and live asset refresh

When a user modifies audio files externally (re-rendering a stem in another application, updating samples in a shared library), the DAW should detect the change and offer to reload.

**Layer 1 (Chrome-first on Windows):** FileSystemObserver watches project directories and OPFS for changes. Provides change types (`modified`, `appeared`, `disappeared`) with recursive directory support.

**Layer 2 (Standards):** No cross-browser file watching standard exists. OPFS can be polled but provides no change notification.

**Layer 3 (Rust native):** The `notify` crate watches filesystem events via FSEvents (macOS), inotify (Linux), and ReadDirectoryChangesW (Windows). Events are forwarded to the frontend via Tauri events. Debouncing is applied Rust-side to coalesce rapid successive writes (common with save-in-place editors). Recursive watching with configurable depth.

**Recommended routing rule:** **Use the `notify` crate on all desktop platforms.** FileSystemObserver is too new, too experimental, and absent on two of three platforms. The Rust watcher is the mature, reliable path. The frontend receives normalized `FileChanged` events regardless of the underlying watcher mechanism.

### Case 4: Model cache and large local assets

A DAW may use ML models for audio separation, intelligent mastering, or sample recommendation. These models are 100 MB–2 GB. Sample libraries can exceed 50 GB.

**Layer 1 (Chrome-first):** File System Access API handles can reference large files without loading them into memory. On Windows, this enables efficient streaming reads of large sample libraries from user-selected directories.

**Layer 2 (Standards):** Cache API stores HTTP responses up to the origin's storage quota (60% of disk on Chrome, 15% on WKWebView non-browser). OPFS stores binary blobs but the 10 MB per-file WKWebView limit makes it unsuitable for models. IndexedDB has no per-record size limit but performance degrades severely above ~100 MB.

**Layer 3 (Rust native):** Native filesystem for all large asset storage. Tauri's scoped fs provides access to a dedicated cache directory (`$APPDATA/sourdaw/models/`, `$APPDATA/sourdaw/cache/`). Rust manages cache eviction (LRU by last-access time), integrity verification (SHA-256 checksums), and background download of model updates via `reqwest`.

**Recommended routing rule:** **Rust native for all assets exceeding 50 MB.** OPFS + Cache API for small cached data (UI state, recent project snapshots, decoded waveform thumbnails). The 15% storage quota on macOS WKWebView and 10 MB per-file limit make web storage impractical for large assets. Browser-only mode uses Cache API for models with clear messaging about storage limitations.

### Case 5: Hardware utility and companion-device connection

A DAW might communicate with hardware synthesizers via USB, receive control data from custom BLE controllers, or interface with an Arduino-based foot pedal via serial.

**Layer 1 (Chrome-first):** WebUSB (Chrome 61+), Web Serial (Chrome 89+), and Web Bluetooth (Chrome 56+) provide direct hardware access in Chrome and (partially) WebView2. Permission per device via chooser dialogs.

**Layer 2 (Standards):** No cross-browser standards for direct hardware communication. These APIs are Chrome-only.

**Layer 3 (Rust native):** `rusb`/`nusb` for USB, `serialport` for serial, `btleplug` for BLE. All accessed via custom Tauri plugins with scoped permissions. Device access commands validate device identifiers against an allowlist of known companion devices rather than exposing generic hardware passthrough.

**Recommended routing rule:** **Rust native on all platforms, no exceptions.** Web device APIs are Chrome-only, create browser-style permission UX in a desktop app, and WebUSB blocks audio USB device classes. The Rust implementations are more capable, more secure (with Tauri permission scoping), and cross-platform. Browser-only mode can use Chrome device APIs as a limited subset experience with appropriate user messaging.

---

## 14. Decision framework

### Capability scorecard template

For each capability under evaluation, score on a 1–5 scale:

| Factor                    | Score Meaning                                                    |
| ------------------------- | ---------------------------------------------------------------- |
| Chrome advantage          | 5 = major product advantage from Chrome API; 1 = negligible      |
| Standards viability       | 5 = works identically across all WebViews; 1 = Chrome-only       |
| Native necessity          | 5 = Rust required for functionality/performance; 1 = unnecessary |
| Implementation complexity | 5 = trivial web API; 1 = complex native implementation           |
| UX consistency impact     | 5 = identical UX everywhere; 1 = platform-specific behavior      |
| Security impact           | 5 = web API well-scoped; 1 = web API creates risk                |

**Routing rule**: If Standards viability ≤ 2 and Native necessity ≥ 3, route to Rust. If Chrome advantage ≥ 4 and Standards viability ≥ 3, use Chrome-first with standards fallback. If Standards viability ≥ 4, use standards-first. In case of ties, weight UX consistency and security highest.

### Routing algorithm as decision tree

1. **Is the capability absent from WKWebView and WebKitGTK?** → If yes, implement in Rust; optionally use web API on Windows/browser as enhancement.
2. **Does the capability require sub-10 ms latency or deterministic timing?** → If yes, implement in Rust native.
3. **Does the web API create visible platform-specific UI (permission prompts, device pickers)?** → If yes, prefer Rust native for desktop; use web API for browser mode.
4. **Is there a cross-browser standard (Layer 2) that works on all three WebViews?** → If yes, use it as the default with Rust fallback for edge cases.
5. **Does a Chrome-only API (Layer 1) provide measurable product advantage on Windows?** → If yes, use as Windows enhancement; ensure Rust fallback exists.
6. **None of the above?** → Use the simplest available web standard; implement Rust only if the web path is unreliable.

### Build-now priorities

1. **Rust audio engine with `cpal`** — compile same DSP core to native and WASM targets. This is the foundation.
2. **COOP/COEP headers** in Tauri config and Vite dev server. Unlocks SharedArrayBuffer everywhere.
3. **Capability registry and adapter interfaces** for filesystem, MIDI, and audio engine domains.
4. **`tauri-plugin-midi`** wrapping `midir` with WebMIDI-compatible JS API.
5. **Tauri dialog + scoped fs** for all file operations, with OPFS for autosave cache.
6. **File watcher** via `notify` crate with Tauri event forwarding.
7. **WebGPU visualization** with WebGL2 fallback path.
8. **HID/serial/USB/BLE Rust plugins** as needed for hardware integration.

### Anti-patterns to avoid

**Scattering feature detection**: Platform checks sprinkled across 50 files become unmaintainable. Centralize all detection in a `CapabilityRegistry` singleton resolved once at startup. Every component consumes adapters, never raw APIs.

**Exposing raw native device APIs**: A `send_raw_hid_report(deviceId, bytes)` command gives the frontend unrestricted hardware access. Instead, expose domain-specific commands: `set_fader_position(channelId, value)`, `set_led_state(buttonId, color)`.

**Separate product logic per platform**: If the macOS code path and Windows code path diverge in business logic (not just adapter implementation), the application becomes two products. The adapter layer must present identical behavior; only the mechanism differs.

**Silent fallback**: When a capability degrades, the user must know. A toast saying "MIDI not available in this browser — use the desktop app for MIDI support" is vastly better than a MIDI panel that simply doesn't show devices.

**Over-abstracting simple capabilities**: The Clipboard API works identically across platforms. It doesn't need an adapter layer. Reserve the adapter pattern for capabilities with genuinely different implementations.

---

## 15. Prioritized implementation roadmap

**Phase 1: Foundation.** Configure COOP/COEP headers. Build the `CapabilityRegistry` singleton and adapter interface definitions. Implement the Rust audio engine with `cpal` backend and WASM compilation target. Set up AudioWorklet + SharedArrayBuffer ring buffer for browser-mode audio. Implement `tauri-plugin-fs` scoping and `tauri-plugin-dialog` for file operations. This phase delivers audio playback on all platforms.

**Phase 2: Core DAW capabilities.** Build `tauri-plugin-midi` wrapping `midir`. Implement the MIDI adapter (Rust native + Web MIDI browser fallback). Add file watching via `notify` crate. Build OPFS-based autosave with 10 MB awareness. Implement project file format serialization in Rust. Wire up `tauri-plugin-global-shortcut` for transport controls. This phase delivers a functional multi-track DAW.

**Phase 3: Hardware and visualization.** Build `tauri-plugin-hid` for control surfaces. Implement WebGPU waveform renderer with WebGL2 fallback. Add WebCodecs-based audio decode with `symphonia` Rust fallback. Build the native storage manager for sample libraries and model caches. Implement sidecar-based plugin hosting for VST3/CLAP. This phase delivers hardware integration and professional visualization.

**Phase 4: Polish and browser mode.** Complete browser-only mode with graceful degradation messaging. Build the capabilities panel in settings. Add File System Access API enhancement for Windows. Implement `tauri-plugin-persisted-scope` for directory access persistence. Performance-profile each adapter path. Implement cache eviction and storage management. This phase delivers a polished, dual-mode product.

---

## 16. Risk register

**WebKitGTK version fragmentation is the highest-severity risk.** Ubuntu 22.04 LTS ships WebKitGTK ~2.36–2.42, missing features available in 2.52 (Keyboard Lock, Skia renderer, WebCodecs improvements). Mitigation: document minimum WebKitGTK 2.44+ requirement; consider Flatpak or AppImage distribution to bundle a known WebKitGTK version; test on the oldest supported distro. Likelihood: high. Impact: users on older distros experience degraded features.

**SharedArrayBuffer reliability on WebKitGTK** remains a medium-severity risk. Historical reports required the `JSC_useSharedArrayBuffer=1` environment variable; modern versions should work with COOP/COEP headers alone. Mitigation: set both headers and the environment variable; include a runtime check (`self.crossOriginIsolated`) with a user-visible warning if SAB is unavailable. Likelihood: medium. Impact: browser-mode audio engine loses its most performant data path on Linux.

**WKWebView OPFS 10 MB per-file limit** restricts macOS web-layer storage for audio. Confirmed by dedicated testing but may change in future macOS versions. Mitigation: use native filesystem for all audio files; restrict OPFS to metadata and small caches. Likelihood: confirmed. Impact: architectural constraint, not a blocker.

**WKWebView audio backgrounding bug** where AudioContext stops after app backgrounding is documented and requires explicit suspend/resume lifecycle management. Mitigation: implement AudioContext lifecycle hooks tied to Tauri's window focus/blur events. Likelihood: confirmed on current macOS. Impact: audio interruption during window switching if unhandled.

**Tauri IPC throughput on Windows (~200 ms for 10 MB)** is significantly worse than macOS (~5 ms). This rules out IPC for real-time audio on Windows. Mitigation: audio engine runs in-process via `cpal`; IPC is restricted to metadata, metering, and decimated waveform data. Likelihood: confirmed. Impact: architectural constraint reinforcing the Rust-native audio engine design.

**COOP/COEP header restrictions block cross-origin resources.** Enabling COEP (`require-corp`) means CDN-hosted fonts, images, and scripts must include `Cross-Origin-Resource-Policy` headers, or the alternative `credentialless` COEP value must be used (supported in Chrome 96+ and Safari 15.2+). Mitigation: self-host all assets; use `credentialless` instead of `require-corp` if third-party resources are needed. Likelihood: certain. Impact: asset pipeline must be designed with this constraint from day one.

**macOS code signing and audio entitlements** present a deployment risk. Accessing microphone from Rust (`cpal`) in signed macOS apps requires correct entitlements and `NSMicrophoneUsageDescription` in Info.plist (documented in tauri-apps/tauri#9928). Mitigation: configure entitlements and Info.plist correctly in Tauri's bundler config; test with both development and distribution signing. Likelihood: certain to encounter. Impact: audio input non-functional without correct setup.

**Web MIDI will likely never ship in Safari.** Apple's 2020 explicit refusal and zero subsequent progress on WebKit bug #107250 through Safari 26.2 indicates this is a permanent gap, not a temporary one. Mitigation: the Rust-native MIDI architecture is non-optional, not a temporary workaround. Likelihood: near-certain. Impact: fully mitigated by the architecture.

**WebGPU on Linux has no foreseeable path in WebKitGTK.** Safari's WebGPU maps to Metal; WebKitGTK has no alternative GPU backend and release notes through 2.52 show no WebGPU work. Mitigation: WebGL2 fallback for visualization; Rust `wgpu` crate for GPU compute. Likelihood: near-certain for 2026–2027. Impact: Linux users get functional but less performant visualization unless Rust `wgpu` is used.

### Conclusion: what this architecture actually means

The Chrome-first principle is sound but its applicability is narrower than it first appears. For a DAW on Tauri V2, the web platform provides an excellent **UI rendering layer** (React + Tailwind), a strong **audio processing foundation** (AudioWorklet + WASM + SharedArrayBuffer), and reliable **data storage primitives** (OPFS + IndexedDB + Cache API). But the moment you need MIDI, hardware devices, low-latency audio I/O, file watching, or consistent filesystem UX, Rust takes over — not as a fallback but as the primary implementation. The adapter pattern ensures this boundary is clean, testable, and invisible to both users and UI component developers. The dual-target Rust codebase (native binary + WASM module) means the same DSP algorithms run everywhere; only the I/O substrate changes. This is not a compromise — it is the optimal architecture for a DAW that must be both a web application and a desktop application without being half-good at either.
