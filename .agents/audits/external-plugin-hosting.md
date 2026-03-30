# External Plugin Hosting — Full Audit

**Date**: 2026-03-30
**Scope**: All code related to hosting third-party audio plugins (CLAP, VST3, AU)
**Reference**: `.agents/research/hosting-plugins.md`

---

## Executive Summary

CLAP hosting has a **solid foundation** — scanning, loading, parameter control, state save/load, and GUI window management are all implemented in Rust and wired through Tauri IPC to the TypeScript frontend. However, the **audio processing bridge is fundamentally broken** (IPC round-trip in the audio path), VST3 and AudioUnit are **stubs only**, and several critical features from the research doc are missing. The system can scan and display plugins, load CLAP plugin instances, open their GUIs in floating windows, and read/write parameters — but **cannot actually process audio through them in real-time**.

---

## What Exists (File-by-File)

### Rust Backend (`src-tauri/src/`)

| File | Status | What It Does |
|------|--------|-------------|
| `host/mod.rs` | Done | Module declarations |
| `host/traits.rs` | Done | `AudioPlugin` trait: process, set_parameter, get_parameters, get_state, set_state, as_any |
| `host/scanner.rs` | Done | Scans directories for .clap/.vst3/.component files. Extracts CLAP metadata (vendor, ID) by temporarily loading the shared library. VST3/AU get only filename-based metadata. |
| `host/clap_wrapper.rs` | **Mostly done** | Full CLAP lifecycle: dlopen → clap_entry.init → factory.create_plugin → plugin.activate → plugin.process. Supports: params extension (read, write, flush), state extension (save/load via streams), GUI extension (full lifecycle: is_api_supported → create → set_scale → get_size → set_parent → show → hide → destroy). Platform-aware: Cocoa/Win32/X11. |
| `host/clap_host_impl.rs` | **Minimal** | Creates a `clap_host` descriptor with name/vendor/url. Host extension callbacks are **all no-ops** — `get_extension` returns null, `request_restart` logs and ignores, `request_callback` is a no-op. |
| `host/vst3_wrapper.rs` | **Stub** | Passthrough only. Returns errors on load attempts. Zero COM interface code. |
| `commands/plugins.rs` | Done | Tauri commands: scan_plugins, get_default_plugin_paths, load_plugin, unload_plugin, set_plugin_parameter, get_plugin_parameters, get_plugin_state, set_plugin_state |
| `commands/plugin_gui.rs` | Done | Tauri commands: is_plugin_gui_supported, open_plugin_gui, close_plugin_gui. Creates bare native windows (no WebView) via WindowBuilder with `unstable` feature. Extracts NSView/HWND/X11 handle. Tracks open windows in AppState. |
| `state.rs` | Done | `AppState` with Mutex-protected HashMaps: plugins (instance_id → PluginInstanceData), plugin_registry (plugin_id → PluginRegistryEntry), plugin_windows (instance_id → window_label) |
| `lib.rs` | Done | All plugin commands registered in invoke_handler. `audio_ipc` is **commented out** ("TODO: re-add when audio_ipc module is implemented") |

### TypeScript Frontend (`src/modules/`)

| File | Status | What It Does |
|------|--------|-------------|
| `Plugin/repositories/pluginBridge/loadPlugin.ts` | Done | Invokes `load_plugin` via Tauri IPC |
| `Plugin/repositories/pluginBridge/unloadPlugin.ts` | Done | Invokes `unload_plugin` |
| `Plugin/repositories/pluginBridge/openPluginGui.ts` | Done | Invokes `open_plugin_gui` |
| `Plugin/repositories/pluginBridge/closePluginGui.ts` | Done | Invokes `close_plugin_gui` |
| `Plugin/repositories/pluginBridge/processAudioIPC.ts` | **Broken** | Converts Float32Array to byte array, sends via `tauriInvoke('audio_ipc')` — but **the `audio_ipc` Rust command doesn't exist** (commented out in lib.rs) |
| `Plugin/useCases/pluginLifecycle.ts` | Done | Thin wrappers over repository functions |
| `Plugin/useCases/pluginHostHandlers.ts` | Done | Command handlers: scanPlugins, loadExternalPlugin (creates track + device) |
| `Plugin/useCases/pluginScan/scanning.ts` | Done | Triggers scan via Tauri, populates pluginScanStore |
| `Plugin/useCases/pluginScan/queries.ts` | Done | findPluginByName, filtered plugin lists |
| `AudioEngine/models/PluginHostNode.ts` | **Broken design** | Extends AudioWorkletNode, references `native-plugin-host-processor`. Sends audio from worklet → main thread → Tauri IPC → Rust → back. This is **architecturally wrong** — IPC round-trips in the audio path cause unacceptable latency and dropouts. |
| `AudioEngine/stores/pluginScanStore.ts` | Done | Reactive store for scan results |
| `AudioEngine/presentations/views/PluginBrowser.tsx` | Done | UI for browsing scanned plugins, grouped by format (VST3/CLAP/AU), with search, scan button |
| `AudioEngine/presentations/views/PluginScanSettings.tsx` | Done | Settings UI for scan paths |
| `Arrangement/useCases/device/addExternalDevice.ts` | Done | Creates device with type `'external-plugin'`, calls loadPlugin |
| `AudioEngine/engine/TrackNode.ts` (line 229) | Done | Creates PluginHostNode for `'external-plugin'` type devices |
| `public/audio/worklets/native-plugin-host-processor.js` | **Broken design** | Worklet sends audio blocks to main thread via MessagePort, receives processed audio back. Uses `lastProcessedBuffer` pattern — **1 block of latency minimum**, plus IPC overhead. |

### Configuration

| File | Status | Notes |
|------|--------|-------|
| `src-tauri/Cargo.toml` | Done | Has `clap-sys = "0.3"`, `vst3 = "0.3"`, `libloading`, `raw-window-handle = "0.6"`, `tauri` with `"unstable"` feature |
| `src-tauri/Entitlements.plist` | Done | Correct entitlements: `disable-library-validation`, `allow-unsigned-executable-memory`, `allow-dyld-environment-variables`, sandbox disabled |
| `src-tauri/tauri.conf.json` | Done | References Entitlements.plist |

---

## Critical Issues

### 1. AUDIO PROCESSING IS BROKEN (Showstopper)

The `audio_ipc` Rust command is **commented out** and doesn't exist. The entire audio path is:

```
AudioWorklet → MessagePort → Main Thread → tauriInvoke('audio_ipc') → ??? → back
```

This has **three fatal problems**:
- The Rust `audio_ipc` command doesn't exist — `processAudioIPC` will throw
- Even if it existed, Tauri IPC goes through JSON serialization (converting Float32Array → number[] → JSON → parse → back) — **orders of magnitude too slow** for real-time audio
- AudioWorklet → main thread → IPC → Rust adds **at minimum 3-5ms per block** — at 128 samples/48kHz (2.67ms budget), this is guaranteed dropout

**What the research doc recommends**: Process plugins on the Rust audio thread directly. The audio callback (cpal or Tauri's audio backend) should call `plugin.process()` inline, never crossing the IPC boundary per-block. The TypeScript side should only handle parameter changes and GUI events.

### 2. NO REAL-TIME AUDIO THREAD

There is **no Rust-side audio processing thread**. The `ClapWrapper.process()` method exists but is **never called from an audio callback**. There is:
- No `cpal` audio stream setup
- No `audio_thread_priority` for RT scheduling
- No `rtrb` ring buffer for lock-free GUI↔audio communication
- No audio graph connecting plugin chains

The research doc's Phase 1 (cpal integration) and Phase 2 (headless plugin processing) are **not implemented**.

### 3. HOST EXTENSIONS ARE ALL NO-OPS

`clap_host_impl.rs` returns null for every `get_extension` call. This means:
- Plugins can't query `clap_host_params` — they can't tell the host about parameter changes
- Plugins can't query `clap_host_gui` — they can't request resize
- Plugins can't query `clap_host_state` — they can't request state save
- `request_restart` logs and ignores — plugin can't trigger reactivation after config change
- `request_callback` is a no-op — plugin's main-thread callbacks never fire

Many plugins will **crash or misbehave** when the host provides no extensions, since they expect at minimum `clap_host_params` and `clap_host_gui`.

### 4. VST3 IS A PASSTHROUGH STUB

`vst3_wrapper.rs` has zero real code. Despite `vst3 = "0.3"` in Cargo.toml, no COM interfaces are implemented. VST3 plugins can be scanned (filename detected) but cannot be loaded, processed, or display GUIs.

### 5. AUDIO UNIT IS COMPLETELY ABSENT

No AudioUnit code exists anywhere. `.component` files are detected during scanning but there's no loader, no AU hosting library in Cargo.toml, and no macOS-specific AU bridge.

### 6. SCANNER METADATA IS INCOMPLETE

- **VST3 plugins**: Only get filename-based name. No vendor, no category, no parameter count, no GUI support flag. The scanner doesn't load VST3 bundles to extract metadata.
- **AU plugins**: Same — filename only.
- **CLAP plugins**: Get vendor and plugin ID from the factory, but `category` is hardcoded to `"effect"` for all plugins, `num_parameters` is always 0, `has_custom_ui` is always false.
- **Multi-plugin bundles**: Only the first CLAP descriptor is read. Bundles containing multiple plugins (common with Surge, Vital) lose all but the first.

### 7. SAMPLE RATE IS HARDCODED

`ClapWrapper::new()` activates the plugin at **44100 Hz** hardcoded (line 253). It should match the DAW's audio engine sample rate. If the user runs at 48kHz or 96kHz, all CLAP plugins will process at the wrong rate.

### 8. NO MIDI/NOTE EVENTS TO PLUGINS

The CLAP wrapper uses `EMPTY_INPUT_EVENTS` for processing — **no MIDI note events are ever sent**. Instrument plugins (synths, samplers) will produce silence. The CLAP note-ports extension is not imported or used.

### 9. NO PLUGIN LATENCY COMPENSATION

`PluginInstance.latency_samples` is always 0. The CLAP latency extension is not queried. Plugins that report latency (lookahead compressors, linear-phase EQs) will be out of sync with the rest of the audio graph.

### 10. NO TRANSPORT INFO

`clap_process.transport` is always null. Plugins that need tempo, time signature, or playback position (delay plugins synced to BPM, arpeggiators) will not function correctly.

### 11. `Mutex` IN THE AUDIO PATH

`AppState.plugins` uses `Arc<Mutex<HashMap>>`. Parameter changes (`set_plugin_parameter`) lock this mutex. If the audio thread ever calls `process()` through the same mutex, this is a **priority inversion crash waiting to happen**. The research doc recommends `rtrb` for lock-free communication.

### 12. NO PLUGIN WINDOW LIFECYCLE MANAGEMENT

- Plugin windows are not parented/owned by the main window — they float independently
- No hide-on-minimize behavior (plugins stay visible when DAW is minimized)
- No close-all-on-exit handling
- No window z-ordering management
- The research doc specifies `owner(&main_window)` for Windows and `parent(&main_window)` for cross-platform

### 13. NO PROCESS SANDBOXING

All plugins load in-process. A crashing plugin (common with VST3) kills the entire DAW. The research doc recommends designing behind a trait abstraction from day one to enable future sandboxing.

---

## What's Correct and Well-Built

1. **CLAP wrapper lifecycle** — The dlopen → init → factory → create → activate → process flow is correct and follows the CLAP spec
2. **CLAP GUI lifecycle** — The full is_api_supported → create → set_scale → get_size → set_parent → show sequence matches the spec exactly
3. **Platform-aware window handles** — Correct NSView/HWND/X11 extraction and CLAP window struct construction
4. **macOS entitlements** — Correct: disable-library-validation, allow-unsigned-executable-memory, sandbox disabled
5. **Tauri `unstable` feature** — Correctly enables bare native windows without WebView
6. **Plugin scan paths** — Correct standard paths for macOS, Windows, Linux
7. **Plugin browser UI** — Clean, functional, grouped by format with search
8. **State save/load** — CLAP state extension properly implemented with stream helpers
9. **Parameter read/write** — CLAP params extension with proper event-based flush
10. **Async GUI commands** — Correctly uses `async fn` for window creation (avoids Windows deadlock)
11. **AudioPlugin trait** — Clean abstraction that VST3/AU can implement later

---

## Gap Analysis vs Research Doc

| Research Doc Section | Status | Gap |
|---------------------|--------|-----|
| 1. Ecosystem: clack-host | **Not used** | Uses raw `clap-sys` instead. clack-host would provide safe wrappers and GUI extension support with less unsafe code |
| 1. Ecosystem: vst3 crate | **Dep exists, unused** | `vst3 = "0.3"` in Cargo.toml but no code uses it |
| 2. Window handles | **Done** | Correct raw-window-handle extraction |
| 2. Bare native windows | **Done** | WindowBuilder with `unstable` feature |
| 2. Parent/owner relationship | **Missing** | Windows float independently |
| 3. Floating windows | **Done** | Correct architecture choice |
| 4. macOS NSView | **Done** | Correct CLAP window construction |
| 4. Windows HWND + DPI | **Partial** | HWND extraction done, DPI handling missing |
| 4. Linux X11 | **Done** | X11 window ID extraction |
| 5. RT audio thread | **Missing** | No cpal stream, no RT priority, no lock-free comms |
| 5. Lock-free comms | **Missing** | Uses Mutex, no rtrb/triple_buffer |
| 5. CLAP threading model | **Partial** | Process/params/state work, but no thread_check, no main-thread callbacks |
| 6. Sandboxing | **Missing** | All in-process, no trait abstraction for future IPC |
| 7. CLAP GUI lifecycle | **Done** | Complete and correct |
| 8. Phase 1 (audio pipeline) | **Missing** | No cpal, no RT thread |
| 8. Phase 2 (headless plugin) | **Partial** | Can load + activate, but no audio routing |
| 8. Phase 3 (plugin GUI) | **Done** | Floating windows work |
| 8. Phase 4 (production) | **Missing** | No automation, no multi-instance management, no VST3 |

---

## Priority Fixes (Ordered by Impact)

### P0 — Without these, external plugins don't work at all

1. **Build a Rust-side audio processing pipeline** — cpal audio stream with RT thread priority, lock-free param communication via rtrb, plugin.process() called directly from audio callback
2. **Implement the audio_ipc command** OR (better) bypass IPC entirely by processing audio in Rust
3. **Send MIDI note events to CLAP plugins** — import note-ports extension, translate MIDI from WebMidi to CLAP note events
4. **Fix sample rate** — read from audio device config instead of hardcoding 44100

### P1 — Required for reliable operation

5. **Implement host extensions** — at minimum clap_host_params (so plugins can notify host of changes), clap_host_gui (request_resize), clap_host_state
6. **Fix scanner to extract full metadata** — read all CLAP descriptors (multi-plugin bundles), detect instrument vs effect category, parameter count, GUI support
7. **Add plugin window parenting** — owner/parent relationship to main window, hide on minimize, close on exit
8. **Query and report plugin latency** — CLAP latency extension, feed into DAW's PDC
9. **Pass transport info** — tempo, time signature, playback state, song position

### P2 — Required for third-party plugin coverage

10. **Implement VST3 hosting** — using `vst3` 0.3.0 crate: IPluginFactory → IComponent → IAudioProcessor → IEditController
11. **Implement AudioUnit hosting** — macOS only, via `rack` crate or direct AudioToolbox/CoreAudio FFI
12. **Windows DPI handling** — SetThreadDpiAwarenessContext per-plugin
13. **Handle `request_restart`** — deactivate → reactivate on config changes
14. **Handle `request_callback`** — schedule main-thread callbacks for plugins

### P3 — Production hardening

15. **Replace Mutex with lock-free structures** — rtrb for param changes, triple_buffer for state snapshots
16. **Add process sandboxing trait** — AudioPlugin trait already exists, wrap it for in-process vs out-of-process
17. **Plugin validation/crash protection** — timeout on load, catch panics around process()
18. **Multi-plugin bundle support** — scan all descriptors, not just the first

---

## Dependency Assessment

| Crate | In Cargo.toml | Actually Used | Notes |
|-------|--------------|---------------|-------|
| `clap-sys` 0.3 | Yes | Yes | Raw FFI bindings, fully utilized |
| `vst3` 0.3 | Yes | **No** | Listed but zero code references it |
| `libloading` 0.8 | Yes | Yes | For dlopen of .clap files |
| `raw-window-handle` 0.6 | Yes | Yes | Window handle extraction |
| `cpal` 0.15 | Yes | **No** | Listed but no audio stream code |
| `clack-host` | **No** | No | Research doc's top recommendation, not added |
| `rtrb` | **No** | No | Lock-free ring buffer, not added |
| `triple_buffer` | **No** | No | State snapshots, not added |
| `audio_thread_priority` | **No** | No | RT scheduling, not added |
| `baseview` | **No** | No | Not needed (using Tauri windows instead) |

---

## Architecture Recommendation

The current architecture of bouncing audio through IPC (WorkletNode → MessagePort → Main Thread → Tauri → Rust → back) must be replaced. The correct architecture:

```
┌─ Rust Audio Thread (cpal callback, RT priority) ─────────────┐
│                                                                │
│   for each track:                                              │
│     for each plugin in chain:                                  │
│       plugin.process(audio_in, audio_out, events)              │
│                                                                │
│   Mix all tracks → master output → cpal output buffer          │
│                                                                │
│   Parameter changes arrive via rtrb (lock-free from UI thread) │
└────────────────────────────────────────────────────────────────┘

┌─ TypeScript UI Thread ────────────────────────────────────────┐
│   Knob turn → Tauri invoke → Rust writes to rtrb producer     │
│   Plugin scan → Tauri invoke → Rust scans directories         │
│   Open GUI → Tauri invoke → Rust creates window + CLAP GUI    │
│   Web Audio engine handles WASM plugins (Fermenter, etc.)     │
└────────────────────────────────────────────────────────────────┘
```

This means **native plugins process in Rust** and **WASM plugins process in Web Audio**. The two worlds connect at the track output level, where Rust-processed audio feeds into Web Audio nodes (or vice versa via SharedArrayBuffer).
