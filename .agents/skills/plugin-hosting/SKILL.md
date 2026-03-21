---
name: plugin-hosting
description: Apply when implementing CLAP or VST3 plugin hosting in Rust/Tauri, managing plugin GUI windows, audio thread safety, or plugin sandboxing. Covers clack-host, vst3 crate, Tauri bare native windows, lock-free RT communication patterns, and platform-specific gotchas (macOS entitlements, Windows DPI, Linux GTK). Apply even when the user says "load a plugin", "plugin GUI", "CLAP host", "VST3 host", "plugin window", "audio thread", or "lock-free".
---

# Plugin Hosting Skill

## Core Architecture Decision: Floating Windows Only

**Do not embed plugin GUIs inside the WebView.** The WebView compositor renders on top of native child windows on all platforms — this is not a bug, it is fundamental to how WebView2, WKWebView, and WebKitGTK work. Every major DAW (Ableton, Bitwig, FL Studio, Logic, REAPER, Cubase) uses floating native windows for third-party plugin GUIs.

The correct architecture:
1. Main Tauri `WebviewWindow` hosts the React/TypeScript DAW UI
2. Each plugin opens a **separate bare native window** (no WebView) created via `tauri::window::WindowBuilder` with `features = ["unstable"]`
3. Native window handle is extracted and passed to the plugin's GUI
4. IPC between DAW UI and plugin management flows through Tauri commands + `rtrb` ring buffers on the audio thread

## Crate Selection

### CLAP Hosting — Start Here

```toml
[dependencies]
clack-host = { git = "https://github.com/prokopyl/clack.git" }
clack-extensions = { git = "https://github.com/prokopyl/clack.git", features = [
    "clack-host", "gui", "audio-ports", "note-ports", "params", "state"
] }
clap-sys = "0.5.0"
```

`clack-host` is the **only safe Rust CLAP hosting library**. It is not on crates.io yet (issue #24) — pin to a specific git commit for reproducible builds. CLAP is preferred over VST3 because:
- Safe Rust wrappers vs raw unsafe COM code
- Explicit threading model (`[main-thread]` / `[audio-thread]` annotations on every function)
- MIT license, C ABI (trivially bindable from Rust)
- Growing adoption: Bitwig, FL Studio, REAPER, DAWVERT all support CLAP

### VST3 Hosting — Phase 2

```toml
[dependencies]
# MIT license since VST 3.8 (October 2025)
vst3 = "0.3.0"  # coupler-rs/vst3-rs — MIT/Apache-2.0
# DO NOT USE: vst3-sys (RustAudio) — GPL-3.0
```

VST3 requires manual COM/IUnknown reference counting and GUID-based queries — no safe abstractions exist. Build a safe wrapper trait over `vst3` before exposing to the rest of the codebase.

### Audio Units — macOS Only

```toml
[dependencies]
rack = "0.3.0"          # AU hosting is production-ready (phases 1–8 complete)
coreaudio-rs = "0.14.0" # Lower-level AUv2 wrapper
```

### Lock-Free Audio Thread Communication

```toml
[dependencies]
rtrb = "0.3"          # Wait-free SPSC ring buffer — PRIMARY choice for GUI→audio
triple_buffer = "0.2" # For full state snapshots from GUI to audio thread
basedrop = "0.1"      # Deferred deallocation on RT thread (never free() on audio thread)
audio_thread_priority = "0.34.0"  # Set SCHED_FIFO / MMCSS / Core Audio RT priority
```

```rust
// GUI thread → audio thread parameter changes
let (mut producer, mut consumer) = rtrb::RingBuffer::<ParamChange>::new(256);

// GUI thread:
let _ = producer.push(ParamChange { id: 0, value: 0.75 });

// Audio thread (wait-free, no syscalls, no allocation):
while let Ok(change) = consumer.pop() {
    params[change.id] = change.value;
}
```

## Creating Bare Native Windows for Plugin GUIs

```toml
[dependencies]
tauri = { version = "2", features = ["unstable"] }
raw-window-handle = "0.6"
```

```rust
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

#[tauri::command]
async fn open_plugin(app: tauri::AppHandle, plugin_id: String) -> Result<(), String> {
    // MUST be async — creating windows in sync commands deadlocks on Windows
    let plugin_window = tauri::window::WindowBuilder::new(&app, format!("plugin-{}", plugin_id))
        .title("Plugin Editor")
        .inner_size(800.0, 600.0)
        .decorations(true)
        .resizable(false)        // Most plugin GUIs are fixed-size
        .parent(&main_window)?   // Cross-platform: child moves with parent
        .build()
        .map_err(|e| e.to_string())?;

    let handle = plugin_window.window_handle().map_err(|e| e.to_string())?;

    match handle.as_raw() {
        RawWindowHandle::AppKit(h) => {
            // h.ns_view: NonNull<c_void> → pass to plugin via clap_window_t.cocoa
        }
        RawWindowHandle::Win32(h) => {
            // h.hwnd: NonNull<c_void> → pass to plugin via clap_window_t.win32
        }
        RawWindowHandle::Xlib(h) => {
            // h.window: u64 → pass to plugin via clap_window_t.x11
        }
        _ => {}
    }
    Ok(())
}
```

**Window relationship options:**
- `.parent(&main_window)` — cross-platform, child moves with parent
- `.owner(&main_window)` — Windows only, floats above, independent positioning
- `.transient_for(&main_window)` — Linux only

## CLAP GUI Lifecycle (Exact Order)

```
1.  gui.is_api_supported("win32"|"cocoa"|"x11", is_floating)  // Check support
2.  gui.get_preferred_api()                                      // OS preference
3.  gui.create(api, is_floating)                                 // Create GUI instance
4.  gui.set_scale(scale_factor)                                  // DPI scale (before sizing)
5.  gui.get_size(&width, &height)                                // Plugin's preferred size
6.  // Host resizes its container window to (width, height)
7.  gui.set_parent(clap_window)                                  // Parent into host window
8.  gui.show()                                                   // Make visible
9.  // ... user interacts, plugin may call host.request_resize() ...
10. gui.hide()                                                   // Hide (keep alive)
11. gui.destroy()                                                // Destroy GUI instance
```

For plugin-initiated resize: plugin calls `host_gui.request_resize(w, h)`, host returns true/false, then resizes its window, then calls `plugin_gui.set_size(w, h)`.

## Audio Thread Contract

At 48kHz with 128-sample buffers, the audio thread has **~2.67ms** per block. Forbidden operations:
- Memory allocation or deallocation (`malloc`, `free`, `Box::new`, `Vec::push` when growing)
- Contended mutex locks — use `rtrb` or atomics instead
- System calls, file I/O, network
- `println!` / logging macros (they allocate)
- Objective-C message passing on macOS (autorelease pools allocate)
- Panicking (stack unwinding allocates)

```rust
use audio_thread_priority::promote_current_thread_to_real_time;

// Call on the audio callback thread before processing:
let _handle = promote_current_thread_to_real_time(buffer_size, sample_rate).unwrap();
// Handles platform differences: THREAD_TIME_CONSTRAINT_POLICY (macOS), MMCSS "Audio" (Windows), rtkit SCHED_FIFO (Linux)
```

CLAP's threading model provides `is_main_thread()` and `is_audio_thread()` checks on the host for runtime verification. The `[main-thread]` and `[audio-thread]` annotations on CLAP functions are enforced at the API level.

## Platform-Specific Gotchas

### macOS
- **`com.apple.security.cs.disable-library-validation` is REQUIRED** in entitlements — without it, loading any third-party `.clap` or `.vst3` bundle silently fails
- Do NOT use App Sandbox for plugin hosts — you cannot load unsigned plugin code in a sandboxed process
- **Use `objc2` ecosystem** (not legacy `objc` crate) for NSView, NSWindow manipulation:
  ```toml
  objc2 = "latest"
  objc2-app-kit = "latest"
  ```
- Plugins handle their own Retina rendering — do NOT scale their view; communicate DPI scale via `gui.set_scale()` before `set_parent()`

### Windows
- **Async commands are mandatory** — creating Tauri windows in sync Tauri commands deadlocks due to WebView2
- **DPI is a landmine**: set `DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2` at startup; use `SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_UNAWARE)` around DPI-unaware plugin window creation
- Use `windows` crate (v0.62.x, Microsoft's official Rust Win32 bindings) for container HWND creation with `WS_CHILD | WS_CLIPCHILDREN`
- The Win32 message loop must be pumped on the thread owning plugin HWNDs

### Linux
- **Native Wayland plugin GUI hosting is not viable** — no plugins support it. Target X11 via XWayland
- Use `x11rb` (pure Rust XCB bindings) or GTK3's `GtkSocket`/`GtkPlug` for XEmbed
- GTK4 removed Socket/Plug entirely — use `gtk` 0.18.x bindings (GTK3) if needed
- **GTK library version conflicts crash the host** — two plugins using different GTK versions in the same process will segfault. Process sandboxing is the only real fix

## Sandboxing (Design for it from Day 1)

Design the plugin interface behind a trait so you can swap between in-process and out-of-process later:

```rust
pub trait PluginHost: Send + Sync {
    fn process(&mut self, input: &[f32], output: &mut [f32]);
    fn show_gui(&self) -> Result<(), PluginError>;
    fn hide_gui(&self);
    fn get_parameter(&self, id: u32) -> f32;
    fn set_parameter(&mut self, id: u32, value: f32);
}

// InProcessPlugin: direct calls to clack-host
// SandboxedPlugin: IPC via shared memory + sockets to child process
```

For sandboxing: `shared_memory` crate for cross-process audio buffer exchange, `shmem-ipc` for Linux lock-free SPSC over shared memory, `nix` for Unix domain sockets and process management. Out-of-process adds at minimum one buffer of latency.

## Implementation Order

1. **Phase 1** — Headless CLAP: plugin discovery, instantiation, bypass audio through `cpal` callback
2. **Phase 2** — GUI: bare Tauri window + GUI lifecycle (steps 1–11 above)
3. **Phase 3** — State, automation, multiple simultaneous plugins
4. **Phase 4** — VST3 via `vst3` 0.3.0, Audio Units via `rack`
5. **Phase 5** — Out-of-process sandboxing behind the `PluginHost` trait

## Key References

- `github.com/prokopyl/clack` — CLAP hosting in Rust (THE primary reference)
- `github.com/free-audio/clap-host` — C++/Qt reference CLAP host (plugin-host.cc essential reading)
- `github.com/robbert-vdh/nih-plug` — Plugin development patterns, baseview window parenting
- `github.com/coupler-rs/vst3-rs` — MIT-licensed VST3 bindings
- `nakst.gitlab.io/tutorial/clap-part-1.html` — Best CLAP lifecycle tutorial

## See Also

- `.agents/hosting-plugins.md` — full deep-dive with platform code examples
- `.agents/native-apis.md` — Web vs Rust verdict table for all DAW subsystems
