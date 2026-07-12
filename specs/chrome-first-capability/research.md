---
type: research
id: RESEARCH-chrome-first-capability
title: Chrome-first capability architecture on Tauri v2
status: open
owner: The Sourdaw team
sources:
  - MDN / Chrome Platform Status, Tauri v2 docs (custom protocol, IPC)
  - WebView2, WKWebView, WebKitGTK capability documentation
---

# Research: Chrome-first capability architecture on Tauri v2

## Question

For a Tauri v2 DAW, which platform capabilities should be served by Chrome-leading
web APIs, which by cross-browser standards, and which must drop to Rust native —
and how should that decision be encoded so it stays consistent across runtimes?

## Findings

### R-001 — Tauri's webview differs by OS, so capability varies by runtime

- **Claim:** The same app runs on WebView2 (Windows, Chromium), WKWebView
  (macOS, Safari engine), and WebKitGTK (Linux); a capability present in Chrome
  may be absent or degraded on WKWebView/WebKitGTK.
- **Evidence:** Tauri bundles the OS webview rather than shipping Chromium;
  WKWebView lacks several Chrome-leading APIs (WebMIDI, WebHID, File System
  Access) that WebView2 has.
- **Confidence:** high
- **Bears on:** the three-layer model (AC-001) and per-domain routing (AC-004).

### R-002 — A three-layer capability model captures the real decision

- **Claim:** Each capability falls into Chrome-leading (use where present),
  cross-browser standard (safe baseline), or Rust-native-required (no web path
  on a target runtime).
- **Evidence:** Capability inventory across filesystem, MIDI, HID, audio,
  storage, fonts, clipboard, observability shows all three tiers populated.
- **Confidence:** high
- **Bears on:** tier resolution (AC-001).

### R-003 — A frozen single registry prevents capability drift

- **Claim:** One registry detected once at startup and frozen is the single
  contract; scattered `userAgent` checks and ad-hoc feature sniffing are the
  anti-pattern that produces inconsistent behavior.
- **Evidence:** Codebases that branch on UA per call site accumulate
  contradictory assumptions; a central registry is the documented fix.
- **Confidence:** high
- **Bears on:** single registry (AC-002), single-shot detection (AC-003).

### R-004 — Pattern-B adapters keep call sites runtime-agnostic

- **Claim:** Each domain exposes an adapter interface with web and native
  implementations selected from the registry; call sites depend only on the
  adapter, never the raw API.
- **Evidence:** Standard ports-and-adapters approach; makes capability injection
  for tests trivial.
- **Confidence:** high
- **Bears on:** domain adapters (AC-004), test injection (AC-006).

### R-005 — SharedArrayBuffer requires cross-origin isolation

- **Claim:** `SharedArrayBuffer` and high-resolution timers — needed for the
  audio worklet shared-memory path — require `COOP: same-origin` and
  `COEP: require-corp`.
- **Evidence:** Browser security model post-Spectre; both the dev server and the
  Tauri custom protocol must emit these headers, and WKWebView's handling needs
  verification.
- **Confidence:** high
- **Bears on:** COOP/COEP config (AC-005) and the blocking header question.

### R-006 — Degradations must be visible, not silent

- **Claim:** When a capability drops a tier, the adapter should return a
  structured degradation notice for the UI, not throw or silently no-op.
- **Evidence:** Silent failures in capability code are the hardest class of bug
  to diagnose in shipped DAWs.
- **Confidence:** medium
- **Bears on:** degradation notice (AC-007).

## Open questions

- [ ] Q-001 — Which domains require a Rust-native floor on every platform
  (low-latency MIDI on WKWebView, raw HID) vs tolerate a web fallback? Sign off
  the D1–D8 routing table before freezing adapters.
- [ ] Q-002 — Where exactly are COOP/COEP headers set for the Tauri custom
  protocol vs the dev server, and does WKWebView honor them identically?
- [ ] Q-003 — Eager vs lazy registry load: does per-domain lazy detection
  meaningfully cut startup time?

## Recommendation

Encode R-002's three-layer model in a frozen registry (R-003) and route all
platform work through Pattern-B adapters (R-004). Treat COOP/COEP (R-005) and
the D1–D8 Rust-floor table (Q-001) as blocking prerequisites — both must be
resolved before adapters are frozen. Make every degradation visible (R-006), and
keep the browser build an explicit subset rather than a parity target.

---

# Restored detail from the original research note

> The sections below are restored verbatim from the original
> `research/platform/chrome-first.md` (git `bb84b0e`), which was the source for
> this co-located research file. They carry the evidence tables, quantitative
> findings, case studies, decision framework, security best-practices, the
> phased roadmap, and the risk register that the condensed `R-001…R-006`
> findings above reference but do not re-embed. This is the canonical home for
> that material; the spec references it rather than duplicating it.

## R-007 — Cross-runtime support matrix (restored: original §3)

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

## R-008 — Platform web-API coverage percentages (restored: original §1, §6)

The fallthrough logic is deterministic, not optimistic. Capability detection happens once at startup. The app commits to a concrete adapter per domain and never silently switches mid-session. On Windows (WebView2), roughly 70% of capabilities can use web APIs. On macOS (WKWebView), that drops to approximately 45%. On Linux (WebKitGTK), it falls to roughly 40%. The delta is covered by Tauri plugins and custom Rust commands.

For a DAW of professional ambition, Rust native code handles approximately **40% of all capability domains** — and this percentage grows when targeting macOS and Linux. The governing-principle summary: roughly **40% of critical capabilities must go directly to Rust**.

## R-009 — Quantitative findings: audio latency, throughput, memory, IPC (restored: original §§2.9–2.10, 11, 9)

### Audio render quantum and round-trip latency

AudioWorklet runs on a dedicated high-priority audio rendering thread with a fixed **128-sample render quantum** (~2.9 ms at 44.1 kHz). The AudioWorklet `process()` callback is called ~344 times/second at 44.1 kHz. Round-trip latency in browser contexts is **30 ms best-case** (per Soundtrap/Spotify measurements), versus **sub-10 ms** via native ASIO/CoreAudio/ALSA through `cpal`.

The Rust native path via `cpal` achieves **3–6 ms output latency with ASIO** (Windows), **5–8 ms via CoreAudio** (macOS), and **5–15 ms via ALSA/PipeWire** (Linux). The Web Audio path via AudioWorklet achieves **~30 ms round-trip** best-case, with the 128-sample render quantum consuming ~2.9 ms of the processing budget at 44.1 kHz. WKWebView historically ran audio processing on the main thread (pre-Safari 14.1), causing crackles during DOM interaction; modern versions use a separate thread but remain less optimized than Chromium. For monitoring during tracking, native latency is essential. For playback and mixing, web audio latency is acceptable.

### Filesystem throughput and consistency

OPFS `createSyncAccessHandle` achieves **3–4× IndexedDB throughput**, adequate for project metadata and small audio clips. Native filesystem via `cpal` and direct Rust I/O achieves memory-mapped performance for large sample libraries. The critical difference is **persistence semantics**: OPFS data is origin-scoped and subject to storage pressure eviction, while native filesystem writes go to user-chosen locations with standard OS persistence. For project files that users expect to find in their file manager, native filesystem is the only option.

### Memory pressure

WebAssembly on Safari has practical memory ceilings (~350 MB on iOS; higher but still constrained on macOS). Chrome is more generous. The Rust native audio engine has no WebView memory limitations — it can map multi-gigabyte sample libraries. OPFS storage on WKWebView is limited to **15% of disk** for non-browser apps versus 60% in Chrome.

### Tauri V2 IPC for audio data

Tauri's IPC serializes to JSON by default, but v2 supports raw `ArrayBuffer` transfer via `tauri::ipc::Response` (Rust → JS) and `InvokeBody::Raw` (JS → Rust). Performance benchmarks show ~5 ms for 10 MB on macOS and ~200 ms for 10 MB on Windows via binary IPC. **No cross-platform SharedMemory/mmap exists** between Rust and WebView. The implication: real-time audio data should never traverse the IPC boundary. The Rust audio engine writes directly to system audio output via `cpal`; the frontend receives only decimated waveform data and metering values via Tauri Channels at 30–60 fps.

## R-010 — The five-pattern architecture analysis (restored: original §7)

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

## R-011 — Decision framework (restored: original §§8 and 14)

### Five mandatory-native-fallthrough categories plus one justified promotion (original §8)

The "Rust threshold" framework defines five categories of mandatory native fallthrough and one category of justified native promotion.

**Functional necessity: the capability does not exist in the renderer.** This is the clearest trigger. If the API is absent from the target WebView engine, Rust handles it. On **WKWebView (macOS)**: File System Access pickers, Web MIDI, WebHID, WebUSB, Web Serial, Web Bluetooth, FileSystemObserver, scheduler.postTask(). On **WebKitGTK (Linux)**: all of the above plus WebGPU. **Rule**: If a capability is absent on any target platform, implement the Rust native path as the primary and treat the web API (when available) as the Windows/browser-mode optimization.

**Cross-platform necessity: exists only in Chromium.** When an API works in Chrome/WebView2 but not in WKWebView or WebKitGTK, using it as the default creates a two-tier product. Web MIDI is the canonical example. **Rule**: If using the web API would require a separate Rust fallback on two of three desktop platforms, make Rust the primary implementation on all platforms to reduce testing surface and ensure behavioral consistency.

**Performance necessity: the web path is not fast enough for DAW-grade behavior.** Web Audio's 30 ms best-case round-trip latency is acceptable for monitoring but inadequate for tracking with live performers. **Rule**: When latency requirements are below 10 ms, when throughput must sustain sustained 100+ MB/s reads, or when GC-induced jitter cannot be tolerated, use Rust native.

**Security necessity: the web API creates unnecessarily broad permission surface.** WebUSB grants broad device access; WebHID exposes raw HID reports. **Rule**: When Rust native access through Tauri's capability system provides narrower, more auditable permissions than the equivalent web API, prefer Rust.

**Product consistency necessity: the web path creates different UX across platforms.** File dialogs are the prime example. **Rule**: When the web API produces visible UI (permission prompts, device pickers, file dialogs) that differs from native equivalents, prefer the native path for desktop mode.

**Determinism and lifecycle necessity: stronger guarantees for long-running operations.** File watching via FileSystemObserver can silently transition to an `errored` state. **Rule**: For capabilities that must remain stable across hours-long sessions (file watching, device connections, audio engine), prefer native implementations even when web equivalents exist.

### Capability scorecard template (original §14)

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

### Routing algorithm as decision tree (original §14)

1. **Is the capability absent from WKWebView and WebKitGTK?** → If yes, implement in Rust; optionally use web API on Windows/browser as enhancement.
2. **Does the capability require sub-10 ms latency or deterministic timing?** → If yes, implement in Rust native.
3. **Does the web API create visible platform-specific UI (permission prompts, device pickers)?** → If yes, prefer Rust native for desktop; use web API for browser mode.
4. **Is there a cross-browser standard (Layer 2) that works on all three WebViews?** → If yes, use it as the default with Rust fallback for edge cases.
5. **Does a Chrome-only API (Layer 1) provide measurable product advantage on Windows?** → If yes, use as Windows enhancement; ensure Rust fallback exists.
6. **None of the above?** → Use the simplest available web standard; implement Rust only if the web path is unreliable.

### Build-now priorities (original §14)

1. **Rust audio engine with `cpal`** — compile same DSP core to native and WASM targets. This is the foundation.
2. **COOP/COEP headers** in Tauri config and Vite dev server. Unlocks SharedArrayBuffer everywhere.
3. **Capability registry and adapter interfaces** for filesystem, MIDI, and audio engine domains.
4. **`tauri-plugin-midi`** wrapping `midir` with WebMIDI-compatible JS API.
5. **Tauri dialog + scoped fs** for all file operations, with OPFS for autosave cache.
6. **File watcher** via `notify` crate with Tauri event forwarding.
7. **WebGPU visualization** with WebGL2 fallback path.
8. **HID/serial/USB/BLE Rust plugins** as needed for hardware integration.

## R-012 — Mapping the three layers onto Tauri V2 concepts (restored: original §9)

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

## R-013 — Security model and best practices (restored: original §12)

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

## R-014 — Domain case studies with Layer 1/2/3 routing (restored: original §13)

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

## R-015 — Prioritized implementation roadmap (restored: original §15)

**Phase 1: Foundation.** Configure COOP/COEP headers. Build the `CapabilityRegistry` singleton and adapter interface definitions. Implement the Rust audio engine with `cpal` backend and WASM compilation target. Set up AudioWorklet + SharedArrayBuffer ring buffer for browser-mode audio. Implement `tauri-plugin-fs` scoping and `tauri-plugin-dialog` for file operations. This phase delivers audio playback on all platforms.

**Phase 2: Core DAW capabilities.** Build `tauri-plugin-midi` wrapping `midir`. Implement the MIDI adapter (Rust native + Web MIDI browser fallback). Add file watching via `notify` crate. Build OPFS-based autosave with 10 MB awareness. Implement project file format serialization in Rust. Wire up `tauri-plugin-global-shortcut` for transport controls. This phase delivers a functional multi-track DAW.

**Phase 3: Hardware and visualization.** Build `tauri-plugin-hid` for control surfaces. Implement WebGPU waveform renderer with WebGL2 fallback. Add WebCodecs-based audio decode with `symphonia` Rust fallback. Build the native storage manager for sample libraries and model caches. Implement sidecar-based plugin hosting for VST3/CLAP. This phase delivers hardware integration and professional visualization.

**Phase 4: Polish and browser mode.** Complete browser-only mode with graceful degradation messaging. Build the capabilities panel in settings. Add File System Access API enhancement for Windows. Implement `tauri-plugin-persisted-scope` for directory access persistence. Performance-profile each adapter path. Implement cache eviction and storage management. This phase delivers a polished, dual-mode product.

## R-016 — Risk register (restored: original §16)

**WebKitGTK version fragmentation is the highest-severity risk.** Ubuntu 22.04 LTS ships WebKitGTK ~2.36–2.42, missing features available in 2.52 (Keyboard Lock, Skia renderer, WebCodecs improvements). Mitigation: document minimum WebKitGTK 2.44+ requirement; consider Flatpak or AppImage distribution to bundle a known WebKitGTK version; test on the oldest supported distro. Likelihood: high. Impact: users on older distros experience degraded features.

**SharedArrayBuffer reliability on WebKitGTK** remains a medium-severity risk. Historical reports required the `JSC_useSharedArrayBuffer=1` environment variable; modern versions should work with COOP/COEP headers alone. Mitigation: set both headers and the environment variable; include a runtime check (`self.crossOriginIsolated`) with a user-visible warning if SAB is unavailable. Likelihood: medium. Impact: browser-mode audio engine loses its most performant data path on Linux.

**WKWebView OPFS 10 MB per-file limit** restricts macOS web-layer storage for audio. Confirmed by dedicated testing but may change in future macOS versions. Mitigation: use native filesystem for all audio files; restrict OPFS to metadata and small caches. Likelihood: confirmed. Impact: architectural constraint, not a blocker.

**WKWebView audio backgrounding bug** where AudioContext stops after app backgrounding is documented and requires explicit suspend/resume lifecycle management. Mitigation: implement AudioContext lifecycle hooks tied to Tauri's window focus/blur events. Likelihood: confirmed on current macOS. Impact: audio interruption during window switching if unhandled.

**Tauri IPC throughput on Windows (~200 ms for 10 MB)** is significantly worse than macOS (~5 ms). This rules out IPC for real-time audio on Windows. Mitigation: audio engine runs in-process via `cpal`; IPC is restricted to metadata, metering, and decimated waveform data. Likelihood: confirmed. Impact: architectural constraint reinforcing the Rust-native audio engine design.

**COOP/COEP header restrictions block cross-origin resources.** Enabling COEP (`require-corp`) means CDN-hosted fonts, images, and scripts must include `Cross-Origin-Resource-Policy` headers, or the alternative `credentialless` COEP value must be used (supported in Chrome 96+ and Safari 15.2+). Mitigation: self-host all assets; use `credentialless` instead of `require-corp` if third-party resources are needed. Likelihood: certain. Impact: asset pipeline must be designed with this constraint from day one.

**macOS code signing and audio entitlements** present a deployment risk. Accessing microphone from Rust (`cpal`) in signed macOS apps requires correct entitlements and `NSMicrophoneUsageDescription` in Info.plist (documented in tauri-apps/tauri#9928). Mitigation: configure entitlements and Info.plist correctly in Tauri's bundler config; test with both development and distribution signing. Likelihood: certain to encounter. Impact: audio input non-functional without correct setup.

**Web MIDI will likely never ship in Safari.** Apple's 2020 explicit refusal and zero subsequent progress on WebKit bug #107250 through Safari 26.2 indicates this is a permanent gap, not a temporary one. Mitigation: the Rust-native MIDI architecture is non-optional, not a temporary workaround. Likelihood: near-certain. Impact: fully mitigated by the architecture.

**WebGPU on Linux has no foreseeable path in WebKitGTK.** Safari's WebGPU maps to Metal; WebKitGTK has no alternative GPU backend and release notes through 2.52 show no WebGPU work. Mitigation: WebGL2 fallback for visualization; Rust `wgpu` crate for GPU compute. Likelihood: near-certain for 2026–2027. Impact: Linux users get functional but less performant visualization unless Rust `wgpu` is used.
