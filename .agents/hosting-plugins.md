# Hosting native plugin GUIs in a Tauri v2 DAW

**Floating plugin windows — not embedding — is the only viable path for a WebView-based DAW, and it's exactly what Ableton, FL Studio, Logic, and Bitwig all do with third-party plugins.** The WebView "airspace problem" makes true embedding of native plugin GUIs inside a WebView compositor fundamentally broken on all platforms. Fortunately, Tauri v2 can create bare native windows (no WebView) via the `unstable` feature, extract their HWND/NSView/X11 handles, and pass those to CLAP or VST3 plugins — this is the correct architecture. For plugin format priority, **start with CLAP**: the `clack-host` crate provides the only safe, feature-complete Rust hosting library, including full GUI extension support. VST3 hosting in Rust remains raw and unsafe.

This guide covers every layer of the stack: Rust crate selection, native window handle extraction, the z-ordering problem and its solutions, platform-specific implementation, audio thread safety, process sandboxing, and a concrete implementation plan with code.

---

## 1. The Rust plugin hosting ecosystem in March 2026

### CLAP hosting: clack-host is production-viable

**`clack-host`** (github.com/prokopyl/clack) is the single most important crate for this project. It provides safe Rust wrappers around the entire CLAP host API, including the **GUI extension** needed to display plugin editors.

**Current status**: Self-described as "feature-complete" but pre-1.0. Actively developed with commits through February 2026, **197 stars**, 26 forks. Critically, it is **not yet on crates.io** (issue #24 open since August 2024) — you must use it as a git dependency:

```toml
[dependencies]
clack-host = { git = "https://github.com/prokopyl/clack.git" }
clack-extensions = { git = "https://github.com/prokopyl/clack.git", features = [
    "clack-host", "gui", "audio-ports", "note-ports", "params", "state"
] }
```

The `gui` feature exposes `GuiConfiguration`, `GuiApiType`, `GuiSize`, `Window`, `set_parent`, `show`/`hide` — everything needed to host a plugin's native GUI. The `raw-window-handle_05` feature integrates with window handle passing. A working cpal-based host example exists at `host/examples/cpal` in the repo. Open issues to watch: **#56** (soundness issue with simultaneous borrow of audio inputs/outputs), **#68** (plugin scan hangs on Windows with specific plugins), and **#52** (0.1 release milestone tracking).

**`clap-sys`** (v0.5.0, on crates.io) provides the raw unsafe FFI bindings that clack-host wraps. Use clap-sys directly only if clack-host doesn't expose a needed feature. No other CLAP host crates exist in the Rust ecosystem.

### VST3 hosting: raw and unsafe, no safe wrappers

The VST3 hosting story in Rust is significantly less mature. Two competing FFI crates exist:

**`vst3`** (v0.3.0, coupler-rs/vst3-rs) — **MIT/Apache-2.0 licensed**, auto-generated from Steinberg's C++ headers via libclang. As of v0.3.0, bindings are pre-generated (no SDK needed at build time). The author (Micah Johnston, also behind clap-sys) explicitly recommends this over `vst3-sys`. However, it provides zero safe abstractions — all COM interface manipulation is manual and unsafe.

**`vst3-sys`** (RustAudio/vst3-sys) — **GPLv3 licensed**, which is a hard blocker for proprietary DAWs. Used internally by NIH-plug for plugin development. Less actively maintained than the `vst3` crate.

**`rack`** (v0.4.8, sinkingsugar/rack) is the only multi-format hosting library with a clean API: `Scanner::new()?.scan()` → `scanner.load(&plugin)` → `plugin.process()`. AudioUnit support is production-ready with GUI; VST3 is built-in but newer. CLAP support is listed as "coming soon." Worth evaluating as an alternative path to VST3 hosting.

### CLAP vs VST3: prioritize CLAP first

- **`clack-host` is far more mature** than any VST3 hosting option in Rust — safe wrappers vs raw unsafe COM code
- **CLAP's C ABI** is trivially bindable from Rust; VST3's COM/IUnknown architecture requires careful reference counting and GUID-based queries
- **CLAP's threading model** is explicit and formally specified; VST3's is documented but ambiguous at the edges (causing real-world bugs between hosts and plugins)
- **Licensing**: CLAP is MIT. `clap-sys` and `clack` are MIT/Apache-2.0. The best VST3 option (`vst3` crate) is now MIT too, but `vst3-sys` is GPLv3
- **Growing adoption**: Bitwig, FL Studio, REAPER all support CLAP; NIH-plug outputs CLAP by default; many new plugins are CLAP-first
- **Pragmatic path**: Ship CLAP hosting first via clack-host → add VST3 later using `vst3` 0.3.0 or `rack` as the ecosystem matures

### Reference projects and their lessons

**Meadowlark DAW** (github.com/MeadowlarkDAW, 1,458 stars) — **archived as of September 2025**. The sole maintainer burned out from project scope, Rust GUI ecosystem immaturity, and integration complexity. Key lesson: start with a constrained scope (a plugin host testbed, not a full DAW). Meadowlark used a fork of clack for CLAP hosting and attempted custom GUI libraries before considering Flutter.

**NIH-plug** (github.com/robbert-vdh/nih-plug) — the most popular Rust plugin _development_ framework. **Plugin-side only, no host code.** However, its `Editor` trait and `baseview`-based window parenting pattern is directly instructive: the `ParentWindowHandle` wrapping `RawWindowHandle` is the exact bridge between host window system and plugin GUI.

**CLAP reference host** (github.com/free-audio/clap-host) — C++/Qt implementation showing the complete GUI lifecycle: `gui.create()` → `gui.get_size()` → `gui.set_parent(&window)` → `gui.show()`. The `plugin-host.cc` source file is essential reading.

---

## 2. Extracting native window handles from Tauri v2

### Tauri v2 implements raw-window-handle v0.6

Tauri v2 (crate version **2.9.5** as of research date) implements `HasWindowHandle` and `HasDisplayHandle` from `raw-window-handle ^0.6` on both `Window<R>` and `WebviewWindow<R>`. The v0.6 API returns `Result<WindowHandle<'_>, HandleError>` with `NonNull<c_void>` pointers (null-safe), unlike v0.5's unchecked raw pointers.

```rust
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

let window = app.get_webview_window("main").unwrap();
let handle = window.window_handle().unwrap();
match handle.as_raw() {
    RawWindowHandle::Win32(h) => {
        let hwnd = h.hwnd;          // NonNull<c_void> → HWND
    }
    RawWindowHandle::AppKit(h) => {
        let ns_view = h.ns_view;    // NonNull<c_void> → *mut NSView
    }
    RawWindowHandle::Xlib(h) => {
        let x11_window = h.window;  // u64 (X11 Window ID)
    }
    _ => {}
}
```

Platform-specific convenience methods also exist: `window.hwnd()` on Windows, `window.ns_window()` on macOS (returns `*mut c_void` → NSWindow), and `window.gtk_window()` on Linux (returns `gtk::ApplicationWindow`). Note GitHub issue **#13046**: `window.hwnd()` can error on child windows created from JS — prefer the `HasWindowHandle` trait.

### Creating bare native windows for plugin GUIs

**This is the critical capability.** With the `unstable` feature enabled, Tauri v2 can create windows with **no WebView** — ideal for hosting native plugin GUIs with zero overhead:

```toml
[dependencies]
tauri = { version = "2", features = ["unstable"] }
```

```rust
// Creates a window with NO WebView — ideal for plugin GUI hosting
let plugin_window = tauri::window::WindowBuilder::new(&app, "plugin-serum")
    .title("Serum")
    .inner_size(800.0, 600.0)
    .decorations(true)
    .resizable(false)    // Most plugin GUIs are fixed-size
    .build()
    .unwrap();

// Extract native handle to pass to the plugin
let handle = plugin_window.window_handle().unwrap();
```

Parent/owner relationships for keeping plugin windows attached to the main DAW window:

```rust
// Cross-platform parent (child moves with parent)
let child = tauri::window::WindowBuilder::new(&app, "plugin-1")
    .parent(&main_window)
    .build()?;

// Windows-only: owner relationship (floats above, independent positioning)
#[cfg(windows)]
let child = builder.owner(&main_window).build()?;

// Linux: transient_for (similar to owner)
#[cfg(target_os = "linux")]
let child = builder.transient_for(&main_window).build()?;
```

### The `with_webview` escape hatch

For advanced scenarios requiring access to the underlying WebView native handle (e.g., manipulating WKWebView layer hierarchy), Tauri provides `with_webview()`:

```rust
webview_window.with_webview(|webview| {
    #[cfg(target_os = "macos")]
    unsafe {
        let wk_view: &objc2_web_kit::WKWebView = &*webview.inner().cast();
        let ns_window: &objc2_app_kit::NSWindow = &*webview.ns_window().cast();
    }
    #[cfg(windows)]
    unsafe {
        // webview.controller() → ICoreWebView2Controller
    }
});
```

### Known issues and caveats

- **`WindowBuilder` requires `features = ["unstable"]`** — bare windows without WebView are behind this feature flag
- **Windows deadlock**: Creating windows in synchronous Tauri commands deadlocks due to WebView2 — **always use `async` commands**
- **`parent_raw` race condition** (issue #13969): panics when HWND becomes invalid between `parent_raw()` and `build()` — handle carefully
- **No Tauri + DAW projects exist** in the ecosystem — this is novel territory

---

## 3. Why embedding fails and floating windows are the answer

### The WebView airspace problem is unsolvable in Tauri

The WebView compositor renders on top of native child windows on all platforms. This is not a bug — it's a fundamental architectural constraint of how WebView2, WKWebView, and WebKitGTK work.

**Windows (WebView2)**: Uses windowed HWND hosting by default. Any HWND-hosted content renders independently of the composition pipeline. Microsoft's only fix — `WebView2CompositionControl` with visual hosting — requires manually forwarding all mouse/touch/pen input to the WebView, and **Tauri/wry does not support this mode**. The `COREWEBVIEW2_FORCED_HOSTING_MODE` environment variable offers partial improvement but not full compositing control.

**macOS (WKWebView)**: NSView siblings _can_ technically overlay WKWebView via `addSubview:positioned:NSWindowAbove relativeTo:wkWebView`, but Apple explicitly warns: "Cocoa does not enforce clipping among sibling views or guarantee correct invalidation and drawing behavior when sibling views overlap." This is fragile and undocumented.

**The transparent cutout approach does not work.** Even with Tauri's `"transparent": true` config and CSS `background-color: transparent`, the WebView's compositing layer can still occlude native content. A user attempting this with a Bevy game engine + Tauri overlay (issue #12450) found "the webview background is visually pure black" despite transparent CSS settings.

### Every major DAW uses floating windows

| DAW               | Plugin GUI approach                                                         |
| ----------------- | --------------------------------------------------------------------------- |
| **Ableton Live**  | Floating windows; parameter sliders exposed in device chain                 |
| **Bitwig Studio** | Floating windows; native Bitwig devices embedded, third-party plugins float |
| **FL Studio**     | Floating windows, detachable to separate monitors                           |
| **Logic Pro**     | Floating windows                                                            |
| **REAPER**        | Floating windows with optional docking                                      |
| **Cubase/Nuendo** | Floating windows with pin option                                            |

Even Bitwig — which uses a custom native UI framework, not a WebView — does not embed third-party plugin GUIs. A community feature request (#4245) for embedded plugin GUIs remains unimplemented. **Embedding native plugin GUIs is a problem no commercial DAW has solved, even without the WebView constraint.**

### Floating window architecture for Tauri v2

```
┌──────────────────────────────────────────────┐
│  Main Tauri WebviewWindow                    │
│  ┌────────────────────────────────────────┐  │
│  │  WebView (React/TypeScript DAW UI)     │  │
│  │  - Track list, mixer, timeline         │  │
│  │  - "Open Plugin Editor" buttons        │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
              │ Tauri IPC command
    ┌─────────┴──────────┐
    ▼                    ▼
┌──────────────┐  ┌──────────────┐
│ Plugin Win A │  │ Plugin Win B │
│ (bare native │  │ (bare native │
│  no WebView) │  │  no WebView) │
│ ┌──────────┐ │  │ ┌──────────┐ │
│ │ Plugin   │ │  │ │ Plugin   │ │
│ │ GUI      │ │  │ │ GUI      │ │
│ └──────────┘ │  │ └──────────┘ │
└──────────────┘  └──────────────┘
```

Window lifecycle management requirements:

| Requirement                   | Tauri v2 solution                                                         |
| ----------------------------- | ------------------------------------------------------------------------- |
| Keep plugin above main window | `owner(&main_window)` (Windows) / `parent(&main_window)` (cross-platform) |
| Close all plugins on DAW exit | Listen to main window close event, iterate and close plugin windows       |
| Hide on minimize              | Listen to `WindowEvent::Resized` / minimize, hide all plugin windows      |
| Don't steal focus             | Create window, then immediately `main_window.set_focus()`                 |
| Multiple plugins              | Unique labels: `"plugin-{track_id}-{slot_id}"`                            |

---

## 4. Platform-specific implementation with code

### macOS: objc2 + NSView + entitlements

Use the **`objc2`** ecosystem (not the legacy `objc` crate) — it provides type-safe Objective-C bindings generated from Apple SDK headers. Key crates: `objc2`, `objc2-foundation`, `objc2-app-kit`.

**CLAP plugins on macOS** receive a parent NSView via `clap_window_t.cocoa` (a `void*` to NSView). VST3 plugins receive it via `IPlugView::attached(parent, "NSView")`. The plugin calls `[parentView addSubview:pluginView]` internally.

**Critical macOS entitlements for plugin hosting:**

- **`com.apple.security.cs.disable-library-validation`** — **REQUIRED** to load third-party plugin bundles (.vst3, .clap). Without this, macOS blocks loading any dylib not signed by the same team.
- **`com.apple.security.cs.allow-unsigned-executable-memory`** — needed by plugins with JIT compilation
- **`com.apple.security.cs.disable-executable-page-protection`** — needed by some copy-protected plugins (iLok-based)
- **Do NOT use App Sandbox** if loading arbitrary third-party plugins — distribute via direct download with notarization, not the App Store

**HiDPI handling**: The host should not scale the plugin's view — plugins handle their own Retina rendering via `backingScaleFactor`. CLAP's `gui.set_scale()` communicates DPI scale before `set_parent()`.

### Windows: windows-rs + HWND + DPI awareness

Use the **`windows`** crate (v0.62.x) — Microsoft's official Rust Win32 bindings. The host creates a container HWND with `WS_CHILD | WS_CLIPCHILDREN` and passes it to the plugin:

```rust
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::Win32::Foundation::*;

unsafe {
    let host_hwnd = CreateWindowExW(
        WINDOW_EX_STYLE::default(),
        w!("PluginHostWindow"),
        w!("Plugin Host"),
        WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
        0, 0, width, height,
        Some(parent_hwnd),  // From Tauri window
        None, Some(instance), None,
    )?;
}
```

**DPI is a critical landmine on Windows.** Set `DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2` at startup, then use `SetThreadDpiAwarenessContext` to isolate plugin window creation for DPI-unaware plugins:

```rust
use windows::Win32::UI::HiDpi::*;
unsafe {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
}
// For a DPI-unaware plugin:
unsafe {
    let prev = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_UNAWARE);
    // create plugin window here
    SetThreadDpiAwarenessContext(prev);
}
```

**Win32 message loop**: Plugins **require** the host to pump the Win32 message loop on the thread owning the plugin's HWND. Tauri's main thread event loop handles this for windows Tauri owns, but you must ensure plugin windows are created on the same thread.

### Linux: X11 via XWayland, Wayland is years away

**Plugin GUI hosting on native Wayland is NOT a solved problem.** Almost no VST3/CLAP plugins support Wayland natively. Even Bitwig and Ardour run plugin GUIs under XWayland. Ardour's developers explicitly state: "Ardour will likely only support wrapping native Window types: X11 on Linux... and it will stay that way probably forever."

CLAP defines `CLAP_WINDOW_API_WAYLAND` but with the note "embed is currently not supported, use floating windows." VST3 added `kPlatformTypeWaylandSurfaceID` recently, but requires the host to act as a sub-compositor — massive complexity for near-zero plugin support.

**Practical approach**: Target X11 via `x11rb` (pure Rust XCB bindings) or GTK3's `GtkSocket`/`GtkPlug` for XEmbed protocol. On Wayland compositors, rely on XWayland. Note that GTK4 **removed** Socket/Plug entirely, so GTK3 bindings (`gtk` 0.18.x from gtk-rs) are required.

**GTK library conflicts** are a known crash source on Linux — plugins using different GTK versions in the same process crash the host. This is one of the strongest arguments for Bitwig-style process sandboxing on Linux.

---

## 5. Audio thread safety and lock-free patterns

### The real-time audio thread contract

At **48kHz with 128-sample buffers**, the audio thread has **~2.67ms** to process each block. Forbidden operations: memory allocation/deallocation, contended mutex locks, system calls, file I/O, network operations, Objective-C message passing (macOS autorelease pools), and panicking (stack unwinding allocates).

**Setting real-time thread priority — use `audio_thread_priority`** (v0.34.0, by Mozilla's Paul Adenot, used in Firefox):

```rust
use audio_thread_priority::promote_current_thread_to_real_time;
// On the audio thread:
let handle = promote_current_thread_to_real_time(buffer_size, sample_rate).unwrap();
```

This handles platform differences: macOS uses `thread_policy_set` with `THREAD_TIME_CONSTRAINT_POLICY` (the proper Core Audio approach), Windows uses MMCSS (`AvSetMmThreadCharacteristicsW("Audio")`), Linux uses rtkit D-Bus or `SCHED_FIFO`. The `cpal` crate (v0.17+) now sets RT priority automatically on its audio callback threads.

### Lock-free communication crates

**`rtrb`** (real-time ring buffer) — the top recommendation for GUI→audio parameter messages. **Wait-free** SPSC ring buffer, no allocation after creation, no locks, no syscalls. Widely used across the Rust audio ecosystem:

```rust
let (mut producer, mut consumer) = rtrb::RingBuffer::<ParamChange>::new(256);
// GUI thread:
let _ = producer.push(ParamChange { id: 0, value: 0.75 });
// Audio thread (wait-free):
while let Ok(change) = consumer.pop() {
    params[change.id] = change.value;
}
```

**`triple_buffer`** — excellent for passing an entire parameter state snapshot from GUI to audio thread. Consumer always reads the most recent version with at most one atomic operation:

```rust
let (mut input, mut output) = triple_buffer::triple_buffer(&PluginState::default());
// GUI thread: input.write(new_state);
// Audio thread: let state = output.read(); // always latest, never blocks
```

**`crossbeam-channel`** — bounded channels are mostly lock-free but **not wait-free**; `try_send`/`try_recv` are acceptable for soft real-time but `rtrb` is strictly better for SPSC audio use. **`basedrop`** — a garbage collector for RT threads that defers deallocation to a collector thread, preventing `free()` on the audio thread.

### CLAP's threading model is significantly cleaner than VST3's

CLAP defines two symbolic threads — **`[main-thread]`** and **`[audio-thread]`** — with explicit annotations on every function. Critical guarantees: a single plugin instance is never on two audio-threads simultaneously; functions marked `[audio-thread]` are not concurrent with each other; `[thread-safe]` functions can be called from anywhere. The host provides `clap_host_thread_check` with `is_main_thread()` and `is_audio_thread()` for runtime verification.

CLAP's **thread pool extension** lets the host manage real-time threads for plugins, yielding up to **2× more plugin instances** before dropouts and 20-25% fewer CPU spikes. Parameters flow through a **unified event queue** in `process()` with sample-accurate timing — no need for custom synchronization.

VST3 splits the plugin into separate `IAudioProcessor` (audio thread) and `IEditController` (UI thread) components. Threading requirements are documented but less formally specified, leading to real-world bugs between hosts and plugins. The host must mediate all processor↔controller communication.

### cpal integration pattern

```rust
let stream = device.build_output_stream(
    &config.into(),
    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
        // 1. Drain parameter changes from GUI thread
        while let Ok(change) = param_consumer.pop() {
            apply_param(change);
        }
        // 2. Call plugin process() — CLAP or VST3
        let buffer_size = data.len() / num_channels;
        plugin.process(&mut process_data);
        // 3. Interleave plugin output to cpal buffer
        for (i, sample) in data.iter_mut().enumerate() {
            *sample = plugin_output[i % num_channels][i / num_channels];
        }
    },
    |err| eprintln!("Audio error: {}", err),
    None,
)?;
```

**Buffer size caveat**: cpal's callback buffer size may vary between calls on some platforms. Either process whatever size is given, or use an intermediate ring buffer to deliver fixed-size blocks to the plugin.

---

## 6. Bitwig's sandbox architecture and how to replicate it

Bitwig runs plugins in separate processes with **five configurable isolation modes**: Within Bitwig (no isolation), Together (one sandbox for all plugins), By Manufacturer, By Plugin, and Individually (maximum isolation). Even in "Together" mode, plugins are separate from the audio engine — a crash never kills the DAW.

The most probable IPC architecture (Bitwig hasn't published details): **shared memory** for zero-copy audio buffer transfer between engine and plugin processes, **Unix domain sockets/named pipes** for control messages (instantiation, parameter changes, state, GUI events), and **lightweight signaling** (semaphores, eventfd, atomic flags in shared memory) for buffer-ready notifications without syscall overhead.

**Plugin GUIs in sandboxed processes**: The plugin creates its own window within its sandbox process, and the host reparents it (via `XReparentWindow` on X11, `SetParent` on Windows, or NSView embedding on macOS) so it appears visually inside or adjacent to the DAW UI.

**Performance reality**: Ardour's Paul Davis calculated **~30µs per context switch** (realistic average). With 384 plugins at 48kHz/64 samples (1.3ms budget), per-plugin invocation costs 7.7–23ms — impossible at low buffer sizes. But Bitwig users report acceptable performance for typical sessions (10-50 plugins), and "Individually" mode can actually perform _better_ on multi-core systems by distributing work across cores.

**Replicating in Rust**: `shared_memory` crate for cross-platform shared memory, `shmem-ipc` for Linux-specific lock-free SPSC ring buffers over shared memory (ideal for audio streaming), `nix` for Unix domain sockets and process management, `std::process::Command` for subprocess spawning. **Recommendation: start without sandboxing, but design the plugin interface behind a trait that can be implemented as in-process (direct calls) or out-of-process (IPC).** Add sandboxing in a later phase.

---

## 7. CLAP plugin GUI lifecycle — the exact sequence

The complete CLAP GUI lifecycle from the host's perspective, using clack-host:

```
1.  gui.is_api_supported("win32"|"cocoa"|"x11", is_floating)  // Check support
2.  gui.get_preferred_api()                                      // Platform preference
3.  gui.create(api, is_floating)                                 // Create GUI instance
4.  gui.set_scale(scale_factor)                                  // DPI scale
5.  gui.get_size(&width, &height)                                // Preferred dimensions
6.  // Host creates/resizes its container window to (width, height)
7.  gui.set_parent(clap_window)                                  // Parent into host window
8.  gui.show()                                                   // Make visible
9.  // ... user interacts, plugin sends request_resize() ...
10. gui.hide()                                                   // Hide (keep alive)
11. gui.destroy()                                                // Destroy GUI
```

Window API constants: `CLAP_WINDOW_API_WIN32` = `"win32"` (HWND), `CLAP_WINDOW_API_COCOA` = `"cocoa"` (NSView*), `CLAP_WINDOW_API_X11` = `"x11"` (X11 Window ID), `CLAP_WINDOW_API_WAYLAND` = `"wayland"` (wl_surface*).

For **plugin-initiated resize**: the plugin calls `host_gui.request_resize(width, height)`, the host returns true/false. For **user drag resize**: check `plugin_gui.can_resize()`, then `plugin_gui.adjust_size(new_size)` → `plugin_gui.set_size(working_size)`.

---

## 8. Concrete implementation plan for an AI coding agent

### Recommended stack

| Layer                  | Crate                     | Version       | Notes                                                           |
| ---------------------- | ------------------------- | ------------- | --------------------------------------------------------------- |
| App framework          | `tauri`                   | 2.x           | Features: `["unstable"]`                                        |
| CLAP hosting           | `clack-host`              | git (pre-1.0) | Pin to specific commit                                          |
| CLAP extensions        | `clack-extensions`        | git           | Features: `gui`, `audio-ports`, `note-ports`, `params`, `state` |
| VST3 hosting (Phase 2) | `vst3`                    | 0.3.0         | MIT licensed, raw bindings                                      |
| Audio I/O              | `cpal`                    | 0.15.x        | Cross-platform audio                                            |
| RT thread priority     | `audio_thread_priority`   | 0.34.0        | Mozilla's RT thread crate                                       |
| Lock-free comms        | `rtrb`                    | latest        | Wait-free SPSC ring buffer                                      |
| State snapshots        | `triple_buffer`           | latest        | For parameter state                                             |
| Window handles         | `raw-window-handle`       | 0.6.x         | Tauri v2 already depends on this                                |
| macOS interop          | `objc2` + `objc2-app-kit` | latest        | NSView, NSWindow creation                                       |
| Windows interop        | `windows`                 | 0.62.x        | Win32 API calls                                                 |
| Linux X11              | `x11rb`                   | latest        | Pure Rust XCB bindings                                          |
| Audio graph (Phase 3)  | `dasp_graph`              | 0.11.0        | Dynamic audio routing                                           |
| Audio decoding         | `symphonia`               | 0.5.x         | File format support                                             |

### Step-by-step implementation order

**Phase 1 — Minimal audio pipeline (no GUI, no plugins)**

1. Set up Tauri v2 project with React/TypeScript frontend
2. Integrate `cpal` for audio output in Rust backend
3. Generate a test tone from the audio callback to verify real-time thread works
4. Set RT thread priority via `audio_thread_priority`
5. Establish `rtrb` channel between Tauri command thread and audio thread

**Phase 2 — Load and process a CLAP plugin (headless)** 6. Implement plugin discovery: scan standard CLAP paths for `.clap` files 7. Load a plugin via `clack-host`'s `PluginEntry::load()` 8. Create plugin instance, activate with audio config, start processing 9. Route cpal audio callback through the plugin's `process()` 10. Implement parameter enumeration via params extension

**Phase 3 — Plugin GUI in floating window** 11. Create a bare `Window` (no WebView) via `tauri::window::WindowBuilder` with `unstable` feature 12. Set `owner`/`parent` relationship to main window 13. Extract native handle via `window.window_handle()` 14. Query plugin GUI support: `gui.is_api_supported()` 15. Create GUI: `gui.create()` → `gui.get_size()` → resize window → `gui.set_parent()` → `gui.show()` 16. Handle plugin resize requests via `host_gui.request_resize()` 17. Implement window lifecycle: hide on minimize, close on DAW exit

**Phase 4 — Production features** 18. Multiple simultaneous plugin instances with independent windows 19. Plugin state save/load via state extension 20. Parameter automation from the timeline 21. VST3 hosting via `vst3` crate (build safe wrapper layer) 22. Audio processing graph for multi-plugin routing 23. (Optional) Process sandboxing behind a trait abstraction

### Minimal working example: load CLAP plugin with GUI

```rust
// src-tauri/src/main.rs
use tauri::Manager;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use clack_host::prelude::*;

struct MyHostShared;
impl<'a> SharedHandler<'a> for MyHostShared {
    fn request_restart(&self) {}
    fn request_process(&self) {}
    fn request_callback(&self) {}
}

struct MyHost;
impl HostHandlers for MyHost {
    type Shared<'a> = MyHostShared;
    type MainThread<'a> = ();
    type AudioProcessor<'a> = ();
}

#[tauri::command]
async fn open_plugin(app: tauri::AppHandle, path: String) -> Result<(), String> {
    // 1. Load plugin
    let host_info = HostInfo::new("MyDAW", "MyCo", "https://example.com", "0.1.0")
        .map_err(|e| e.to_string())?;
    let entry = unsafe { PluginEntry::load(&path) }.map_err(|e| e.to_string())?;
    let factory = entry.get_plugin_factory().ok_or("No factory")?;
    let desc = factory.plugin_descriptors().next().ok_or("No plugins")?;

    // 2. Create bare native window (no WebView)
    let plugin_window = tauri::window::WindowBuilder::new(&app, "plugin-editor")
        .title(desc.name().unwrap_or("Plugin"))
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;

    // 3. Extract native handle
    let handle = plugin_window.window_handle().map_err(|e| e.to_string())?;

    // 4. Create plugin instance, query GUI, set parent, show
    // (Actual clack-host GUI extension calls here — see Phase 3 above)

    Ok(())
}
```

### Known gotchas and landmines

- **clack-host is not on crates.io** — you must use a git dependency and pin to a specific commit for reproducible builds. Monitor issue #24 for crates.io publication.
- **Windows async commands are mandatory** — creating Tauri windows in synchronous commands deadlocks due to WebView2. Always use `async fn`.
- **DPI mismatch on Windows** silently produces wrong-size plugin windows. Use `SetThreadDpiAwarenessContext` to match the plugin's expectations. Many older plugins are DPI-unaware; professional DAWs offer per-plugin DPI toggles.
- **macOS `disable-library-validation` entitlement is required** — without it, loading any third-party .clap/.vst3 fails silently. Don't use App Sandbox for plugin hosts.
- **Linux GTK version conflicts** crash the host — two plugins using different GTK versions in the same process will segfault. Process sandboxing is the only real fix.
- **cpal buffer size varies** between callbacks on some platforms — the plugin host must handle variable-size blocks or use an intermediate ring buffer.
- **Plugin GUI must be created and destroyed on the main thread** — both CLAP and VST3 require this. Tauri's async runtime may dispatch commands on worker threads; use `app.run_on_main_thread()` to ensure correct thread affinity.
- **`rtrb` producer/consumer must never be dropped on the audio thread** — dropping deallocates. Use `basedrop` or ensure lifecycle management happens on the main thread.
- **Wayland on Linux is a dead end for plugin GUIs** — target X11 and rely on XWayland. Don't waste time on native Wayland plugin embedding.
- **The clack-host soundness issue (#56)** allows simultaneous mutable borrows of audio inputs/outputs — be aware this may cause UB in edge cases until fixed.

### Essential reference repos to study

- **github.com/prokopyl/clack** — CLAP hosting in Rust (THE primary reference)
- **github.com/free-audio/clap-host** — C++/Qt reference CLAP host (plugin-host.cc is essential reading for GUI lifecycle)
- **github.com/robbert-vdh/nih-plug** — Plugin development patterns, baseview window parenting
- **github.com/RustAudio/baseview** — Cross-platform window creation for audio GUIs
- **github.com/MeadowlarkDAW** — Archived, but Dropseed engine and creek disk-streaming are instructive
- **github.com/coupler-rs/vst3-rs** — MIT-licensed VST3 bindings (for Phase 2)
- **nakst.gitlab.io/tutorial/clap-part-1.html** through part 4 — Best CLAP tutorial for understanding the full lifecycle

## Conclusion

Building plugin GUI hosting in a Tauri v2 DAW is architecturally feasible today, with one non-negotiable constraint: **use floating native windows, not embedded views**. The Rust ecosystem provides `clack-host` as a genuinely viable CLAP hosting foundation — it's the only safe abstraction available, and CLAP's clean C ABI and explicit threading model make it the right format to target first. VST3 hosting requires building unsafe wrappers from scratch and should wait.

The critical insight that simplifies everything: Tauri v2's `unstable` feature enables bare native windows without WebView, giving you direct access to HWND/NSView/X11 handles. This sidesteps the airspace problem entirely. The plugin gets a real native window, the WebView UI stays in its own window, and IPC between them flows through Tauri's command system and `rtrb` ring buffers.

The biggest risks are not in the plugin hosting itself but in the platform edge cases: Windows DPI scaling, macOS entitlements, Linux GTK conflicts, and the immaturity of the Rust VST3 ecosystem. Design the plugin interface behind a trait from day one — `trait PluginHost { fn process(); fn show_gui(); fn hide_gui(); }` — to allow swapping between in-process and sandboxed implementations later. Start with CLAP in-process, ship that, and iterate.
