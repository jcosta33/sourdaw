# External Plugin Hosting (VST3/CLAP) Audit Report

Based on a code-level audit of the external plugin hosting implementation (`crates/daw-plugin-host` and `src/modules/Plugin`), here is the comprehensive audit report regarding how VST3/CLAP plugins are bridged into the browser environment:

### 🚨 Critical Performance Bugs (Complete Audio Failure)

The current implementation for passing real-time audio between the browser's Web Audio API and the native Rust VST3 host is fundamentally broken. It guarantees extreme latency, CPU max-outs, and permanent audio dropouts. 

1. **The "JSON-over-IPC" Audio Bridge (`processAudioIPC.ts`)**:
   *   **Issue:** The function that ferries audio data to Rust manually converts the `Float32Array` into a standard JavaScript array (`Array.from(bodyArray)`) and sends it across the Tauri IPC boundary via `tauriInvoke('audio_ipc', { ...body })`.
   *   **Impact:** Tauri's default IPC serializes arbitrary objects into JSON strings. For a standard audio block, this means converting thousands of floating-point numbers into text characters, sending them over a socket/bridge, parsing them in Rust, processing the audio, and serializing them *back* to JSON on every single block (every 2.6 milliseconds). This will instantly consume 100% of the main thread's CPU in Garbage Collection and serialization overhead, making the DAW completely unusable.

2. **Asynchronous Audio Processing (`PluginHostNode.ts`)**:
   *   **Issue:** The Web Audio API operates on a strict synchronous clock. However, the `PluginHostNode` ferries audio out of the worklet via `postMessage`, awaits an asynchronous IPC call (`await processAudioIPC`), and then posts the result *back* to the worklet.
   *   **Impact:** Because IPC is asynchronous and the main thread is shared with the UI, the audio block will almost never return in time for the current Web Audio render quantum. To hide this, the code implements a naive `if (this.isProcessing) return;` check, which silently drops incoming audio blocks if the previous IPC call hasn't finished. The result is garbled, stuttering audio that drops out constantly whenever you move the mouse or render the UI.

### 🐛 Logical Bugs

1. **Unparented Native GUI Windows (`openPluginGui.ts`)**:
   *   **Issue:** The `open_plugin_gui` Tauri command is invoked with just the `instanceId`. There is no mechanism in place to pass the browser window's OS handle (HWND on Windows, NSView on macOS) to the Rust backend.
   *   **Impact:** When a user opens a VST3 plugin, the plugin's UI window will float independently of the DAW. It won't stay on top of the DAW window, won't minimize when the DAW minimizes, and will feel like a completely disconnected application rather than an integrated plugin panel.

### 🛠️ Required Architectural Fixes

1. **SharedArrayBuffer Audio Ring Queue**:
   *   **Fix:** Audio data must absolutely never cross the Tauri IPC boundary as JSON, and it must never touch the JavaScript main thread. You must instantiate a `SharedArrayBuffer` during plugin initialization. The `AudioWorkletProcessor` writes `Float32Array` blocks directly into this shared memory, and a dedicated Rust audio thread reads from it, processes the VST3 DSP, and writes the output back to the shared memory. 
   *   **Synchronization:** Use `Atomics.wait` and `Atomics.notify` (or lock-free ring-buffer pointers) to synchronize the Worklet thread with the Rust DSP thread without any asynchronous promises or JSON serialization.

2. **Native Window Parenting**:
   *   **Fix:** The Tauri Rust backend needs to extract the native window handle from the Tauri Webview and pass it down to the VST3 host library so that the plugin GUI is correctly parented as a child window of the DAW.