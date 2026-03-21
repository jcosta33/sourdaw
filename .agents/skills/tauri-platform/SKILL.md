---
name: tauri-platform
description: Apply when choosing between Web APIs and Rust for any DAW subsystem, configuring WebKit/COOP/COEP headers, implementing MIDI I/O via midir, voice dictation via whisper-rs, file system access via Tauri plugins, or handling platform differences between WKWebView/WebView2/WebKitGTK. Apply even when the user says "platform", "WebKit", "Linux", "MIDI input", "voice dictation", "file dialog", "cross-platform", "SharedArrayBuffer", "WebGPU Linux", or "WebKitGTK".
---

# Tauri Platform Skill

## The Architectural Split

**Use Web APIs** for: audio graph (Web Audio API + AudioWorklet), all rendering (WebGL2 + Canvas2D + OffscreenCanvas), WASM/WAM plugins, metering (AudioWorklet LUFS), project metadata (IndexedDB), internal caching (OPFS).

**Use Rust + Tauri** for: MIDI I/O, multi-track recording, native plugin hosting, file system access (dialogs), codec encoding, Ableton Link, reliable WebRTC/collaboration.

## Web API Viability by Subsystem

| Subsystem | Verdict | Notes |
|---|---|---|
| Web Audio API core | ✅ Use Web API | Works Safari 14.1+, WebKitGTK 2.34+ |
| AudioWorklet | ✅ Use Web API | Stable: Safari 16+, WebKitGTK 2.38+ |
| SharedArrayBuffer in Worklet | ⚠️ Partial | Requires COOP/COEP + Safari 16+ / WebKitGTK 2.40+ |
| OfflineAudioContext | ⚠️ Partial | WebKit: 44.1kHz min, 10ch max |
| **Web MIDI API** | ❌ Use Rust | Apple explicitly declined; WebKitGTK not implemented |
| Multi-track recording | ❌ Use Rust | All browsers limit to stereo; multiple streams unreliable |
| getUserMedia mic | ⚠️ Partial | Stereo max; WebKitGTK denies by default (needs Rust handler) |
| File System Access pickers | ❌ Use Rust | Not on any WebKit platform; use `tauri-plugin-dialog` |
| OPFS (createSyncAccessHandle) | ⚠️ Partial | Worker-only (no createWritable on WebKit) |
| IndexedDB | ⚠️ Partial | Metadata only; Safari has historical bugs |
| **WebGPU** | ❌ Not cross-platform | WebKitGTK: no implementation exists; macOS requires Safari 26+ |
| WebGL2 | ✅ Use Web API | Cross-platform rendering baseline |
| Canvas2D | ✅ Use Web API | Skia-accelerated on WebKitGTK 2.46+ |
| OffscreenCanvas | ✅ Use Web API | Safari 17+, WebKitGTK |
| WAM 2.0 / WASM plugins | ✅ Use Web API | Works all platforms; SAB optional (graceful fallback) |
| WASM SIMD | ✅ Use Web API | Safari 16.4+, WebKitGTK ~2.40+ |
| Native plugin hosting | ❌ Use Rust | No Web API exists |
| Ableton Link | ❌ Use Rust | Raw UDP multicast — browsers cannot do this |
| WebRTC audio | ⚠️ Avoid for audio | WebKitGTK: 55% test pass rate (FOSDEM 2026); use `webrtc-rs` |
| Codec decoding beyond WAV | ❌ Use Rust | Linux GStreamer fragmentation; use `symphonia` |

## Required Tauri Configuration

```json
// tauri.conf.json — for SharedArrayBuffer (WAM, AudioWorklet SAB)
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src ipc: http://ipc.localhost",
      "headers": {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp"
      }
    }
  },
  "bundle": {
    "linux": {
      "appimage": {
        "includeGstreamer": true   // For codec consistency on Linux
      }
    }
  }
}
```

```typescript
// vite.config.ts — DEV server must mirror production headers
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
},
```

**Note**: Headers are injected at production build time only — dev server manual config is mandatory.

Also, for WebKitGTK: register a custom Rust permission request handler — the default handler **denies all getUserMedia requests automatically**.

## Platform Version Targets

| Platform | Minimum | Notes |
|---|---|---|
| macOS (WKWebView) | Safari 16.4 / macOS Ventura | Stable AudioWorklet + WASM SIMD + SharedArrayBuffer |
| Windows (WebView2) | WebView2 latest | Always up-to-date via Windows Update |
| Linux (WebKitGTK) | WebKitGTK 2.42+ | Ubuntu 24.04+; 2.38+ for AudioWorklet, 2.40+ for SAB |

## MIDI I/O via Rust

Web MIDI API is not available on macOS or Linux. Implement MIDI entirely in Rust for all platforms.

```toml
[dependencies]
midir = "0.10"  # MIT, CoreMIDI/WinMM/ALSA backends
wmidi = "4.0"   # Typed MIDI message parsing
```

```rust
use midir::MidiInput;
use tauri::AppHandle;

#[tauri::command]
pub fn list_midi_ports() -> Result<Vec<String>, String> {
    let midi_in = MidiInput::new("webdaw").map_err(|e| e.to_string())?;
    midi_in.ports().iter()
        .map(|p| midi_in.port_name(p).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub fn connect_midi_port(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<MidiState>>>,
    port_index: usize,
) -> Result<(), String> {
    let midi_in = MidiInput::new("webdaw-input").map_err(|e| e.to_string())?;
    let ports = midi_in.ports();
    let port = ports.get(port_index).ok_or("Port not found")?;
    let port_name = midi_in.port_name(port).unwrap_or_default();
    let app_clone = app.clone();
    let name_clone = port_name.clone();

    let conn = midi_in.connect(port, "webdaw-conn", move |timestamp, raw, _| {
        // Parse typed messages with wmidi if needed:
        // if let Ok(msg) = wmidi::MidiMessage::try_from(raw) { ... }
        let _ = app_clone.emit("midi-message", MidiMessage {
            port: name_clone.clone(),
            timestamp,
            data: raw.to_vec(),
        });
    }, ()).map_err(|e| e.to_string())?;

    state.lock().unwrap().connections.push(conn);
    Ok(())
}
```

**Frontend:**
```typescript
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

const ports = await invoke<string[]>('list_midi_ports');
await invoke('connect_midi_port', { portIndex: 0 });

await listen<{ port: string; timestamp: number; data: number[] }>('midi-message', ({ payload }) => {
    const status = payload.data[0] & 0xf0;
    const isNoteOn = status === 0x90 && payload.data[2] > 0;
    // route to piano roll, AI prompt, synth engine, etc.
});
```

**Hot-plug detection:** `midir` has no built-in hot-plug. Poll `list_midi_ports` every 2–3s from the frontend, diff against previous list.

## Voice Dictation via Rust (whisper-rs)

Push-to-talk mic → local Whisper → text into AI prompt → auto-send.

```toml
[dependencies]
whisper-rs = { version = "0.15", features = ["metal"] }  # macOS; use "cuda" on Windows/Linux RTX
cpal = "0.15"    # Mic capture
rubato = "0.15"  # Resample to 16kHz mono (required by Whisper)
```

Model: `ggml-base.en.bin` (142 MB) from HuggingFace `ggerganov/whisper.cpp`. Use `ggml-small.en.bin` for better accuracy with accents/noise.

```rust
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

fn transcribe(ctx: &WhisperContext, audio: &[f32]) -> Result<String, String> {
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_progress(false);
    params.set_suppress_non_speech_tokens(true); // prevents hallucinations on silence

    state.full(params, audio).map_err(|e| e.to_string())?;
    let n = state.full_n_segments().map_err(|e| e.to_string())?;
    Ok((0..n)
        .filter_map(|i| state.full_get_segment_text(i).ok())
        .collect::<Vec<_>>().join(" ")
        .trim().to_string())
}
```

**Frontend:**
```typescript
await listen<string>('dictation-result', ({ payload }) => {
    setPromptValue(payload);
    submitPrompt(); // auto-send to AI
});

// Hold-to-talk
onMicDown:  () => invoke('start_dictation')
onMicUp:    () => invoke('stop_dictation')
```

### ⚠️ macOS Entitlement Gotcha

`cpal` mic access works in dev but **silently fails on signed builds** without entitlements:

```xml
<!-- src-tauri/Info.plist -->
<key>NSMicrophoneUsageDescription</key>
<string>Voice dictation for AI prompts</string>
```

```xml
<!-- src-tauri/entitlements.plist -->
<key>com.apple.security.device.audio-input</key>
<true/>
```

This is the most common failure point — dev mode never triggers it.

## File System Access

Never use the File System Access API (`showOpenFilePicker`) — it is not supported on any WebKit platform. Apple and Mozilla both oppose it.

```toml
[dependencies]
tauri-plugin-dialog = "2"  # Native OS file dialogs
tauri-plugin-fs = "2"      # File read/write
```

**Binary audio data IPC:**
```rust
#[tauri::command]
fn get_audio_buffer(track_id: String) -> tauri::ipc::Response {
    let audio_data: Vec<u8> = load_audio_bytes(&track_id);
    tauri::ipc::Response::new(audio_data) // arrives as ArrayBuffer in JS
}
```

```typescript
const buffer: ArrayBuffer = await invoke('get_audio_buffer', { trackId: '1' });
const float32 = new Float32Array(buffer);
```

Use `convertFileSrc()` to load audio files directly in the WebView without IPC copy overhead for read-only access.

**OPFS** is suitable for internal model caching (3–4× faster than IndexedDB for reads). Use only via `createSyncAccessHandle()` in a dedicated Web Worker — `createWritable()` is not available on WebKit.

## Audio Codec Strategy

- **WAV (PCM)**: Only universal format — always works everywhere
- **FLAC**: Good cross-platform support (use for download compression)
- **OGG/Opus**: Only Safari 18.4+; WebKitGTK needs gst-plugins-bad
- **AAC**: Needs gst-plugins-bad on Linux
- **AIFF**: Apple-only; Chrome does not support it

**Rule**: Use WAV as the internal working format. Encode to other formats in Rust (`symphonia` + encoder crates) to guarantee availability regardless of GStreamer plugins installed on Linux.

## Additional Critical Notes

- **`AudioContext.currentTime`** is sample-accurate and hardware-clock-driven — always use it for audio scheduling, never `performance.now()` (throttled to ~1ms on WebKit due to Spectre mitigations)
- **WebGPU on Linux does not exist** in WebKitGTK — use WebGL2 as the cross-platform rendering baseline; add WebGPU as progressive enhancement for macOS/Windows only
- **`outputLatency`** only shipped in Safari 18.4 — rely on `baseLatency` for latency compensation on older targets
- **OGG/Opus in AudioWorklet samples**: Don't use OGG format in sample content — only WAV, FLAC, MP3, or AAC are safe cross-platform

## See Also

- `.agents/web-apis.md` — per-API WebKit compatibility tables with bug references
- `.agents/native-apis.md` — full per-subsystem Rust vs Web verdict with crate recommendations
- `.agents/voice-midi.md` — MIDI + Whisper Rust implementation reference
