# Voice Dictation & MIDI Keyboard Input for Tauri v2 DAW

## Platform reality

|                          | macOS  | Windows             | Linux              |
| ------------------------ | ------ | ------------------- | ------------------ |
| WebView engine           | WebKit | WebView2 (Chromium) | WebKitGTK (WebKit) |
| Web MIDI API             | ❌     | ✅                  | ❌                 |
| Web Speech API (offline) | ❌     | ✅                  | ❌                 |

Since 2/3 platforms need the Rust path, implement both features in Rust for all platforms. One code path, consistent behaviour everywhere.

---

## 1. MIDI Keyboard Input

**Crate:** `midir` v0.10.3 — MIT, 395K+ downloads
**Repo:** https://github.com/Boddlnagg/midir

The standard Rust MIDI I/O library. Backends: CoreMIDI (macOS), WinMM (Windows), ALSA (Linux). Full SysEx, virtual ports on macOS/Linux.

> There is also `tauri-plugin-midi` (https://github.com/specta-rs/tauri-plugin-midi) which wraps `midir` with a WebMIDI-compatible API and TypeScript bindings. Only 12 stars and low traction — fine to evaluate, but `midir` directly gives you more control and stability.

```toml
midir = "0.10"
wmidi = "4.0"  # typed message parsing
```

```rust
// src-tauri/src/midi.rs
use midir::MidiInput;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

pub struct MidiState {
    pub connections: Vec<midir::MidiInputConnection<()>>, // dropping closes the port
}

#[derive(Clone, serde::Serialize)]
pub struct MidiMessage {
    pub port: String,
    pub timestamp: u64,
    pub data: Vec<u8>, // [status, note, velocity]
}

#[tauri::command]
pub fn list_midi_ports() -> Result<Vec<String>, String> {
    let midi_in = MidiInput::new("sourdaw").map_err(|e| e.to_string())?;
    midi_in
        .ports()
        .iter()
        .map(|p| midi_in.port_name(p).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub fn connect_midi_port(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<MidiState>>>,
    port_index: usize,
) -> Result<(), String> {
    let midi_in = MidiInput::new("sourdaw-input").map_err(|e| e.to_string())?;
    let ports = midi_in.ports();
    let port = ports.get(port_index).ok_or("Port not found")?;
    let port_name = midi_in.port_name(port).unwrap_or_default();
    let app_clone = app.clone();
    let name_clone = port_name.clone();

    let conn = midi_in
        .connect(
            port,
            "sourdaw-conn",
            move |timestamp, raw, _| {
                let _ = app_clone.emit("midi-message", MidiMessage {
                    port: name_clone.clone(),
                    timestamp,
                    data: raw.to_vec(),
                });
            },
            (),
        )
        .map_err(|e| e.to_string())?;

    state.lock().unwrap().connections.push(conn);
    Ok(())
}
```

Use `wmidi` for typed parsing on the Rust side if you want to act on messages before emitting:

```rust
use wmidi::MidiMessage;

if let Ok(msg) = MidiMessage::try_from(raw) {
    match msg {
        MidiMessage::NoteOn(ch, note, vel) => { /* feed AI, trigger synth */ }
        MidiMessage::ControlChange(ch, cc, val) => { /* modulation, faders */ }
        MidiMessage::PitchBendChange(ch, bend) => { /* */ }
        _ => {}
    }
}
```

Frontend:

```typescript
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface MidiMessage {
    port: string;
    timestamp: number;
    data: number[]; // [status, note, velocity]
}

const ports = await invoke<string[]>('list_midi_ports');
await invoke('connect_midi_port', { portIndex: 0 });

await listen<MidiMessage>('midi-message', ({ payload }) => {
    const status = payload.data[0] & 0xf0;
    const note = payload.data[1];
    const velocity = payload.data[2];
    const isNoteOn = status === 0x90 && velocity > 0;
    // route to piano roll, AI prompt, etc.
});
```

**Hot-plug:** `midir` has no built-in hot-plug detection. Simplest approach: poll `list_midi_ports` every 2–3s from the frontend, diff against the previous list, emit a `midi-ports-changed` event. On macOS, the `coremidi-hotplug-notification` crate provides system-level callbacks if you need it.

---

## 2. Voice Dictation → Prompt Input

Push-to-talk mic → local Whisper transcription → text into prompt input → auto-send.

**Crate:** `whisper-rs` v0.15.1 — Unlicense, 183K+ downloads
**Repo:** https://codeberg.org/tazz4843/whisper-rs

Safe Rust bindings for whisper.cpp. Metal (Apple Silicon), CUDA (RTX), CoreML, Vulkan via feature flags. Battle-tested — used in production Tauri apps (e.g. Meetily).

```toml
whisper-rs = { version = "0.15", features = ["metal"] }  # macOS
# whisper-rs = { version = "0.15", features = ["cuda"] } # Windows/Linux RTX
cpal = "0.15"    # mic capture
rubato = "0.15"  # resample to 16kHz mono (required by Whisper)
```

**Model:** download `ggml-base.en.bin` (142 MB) from https://huggingface.co/ggerganov/whisper.cpp — best latency/accuracy balance for dictation. Use `ggml-small.en.bin` if accuracy with accents/noise matters more.

```rust
// src-tauri/src/dictation.rs
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

pub struct DictationState {
    pub ctx: Option<Arc<WhisperContext>>,
    pub recording: bool,
}

pub fn load_whisper_model(path: &str) -> Result<WhisperContext, String> {
    WhisperContext::new_with_params(path, WhisperContextParameters::default())
        .map_err(|e| e.to_string())
}

fn transcribe(ctx: &WhisperContext, audio: &[f32]) -> Result<String, String> {
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_progress(false);
    params.set_print_timestamps(false);
    params.set_suppress_non_speech_tokens(true); // avoids hallucinations on silence

    state.full(params, audio).map_err(|e| e.to_string())?;

    let n = state.full_n_segments().map_err(|e| e.to_string())?;
    Ok((0..n)
        .filter_map(|i| state.full_get_segment_text(i).ok())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string())
}

#[tauri::command]
pub async fn start_dictation(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<DictationState>>>,
) -> Result<(), String> {
    let ctx = state.lock().unwrap().ctx.clone().ok_or("Model not loaded")?;
    state.lock().unwrap().recording = true;

    tokio::task::spawn_blocking(move || {
        let host = cpal::default_host();
        let device = host.default_input_device().expect("No mic found");
        let config = device.default_input_config().unwrap();
        let sample_rate = config.sample_rate().0;
        let buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(vec![]));
        let buf_clone = buffer.clone();

        let stream = device.build_input_stream(
            &config.into(),
            move |data: &[f32], _| buf_clone.lock().unwrap().extend_from_slice(data),
            |e| eprintln!("mic error: {e}"),
            None,
        ).unwrap();
        stream.play().unwrap();

        // Record until stop_dictation flips recording flag, or 15s max
        // (wire up a shared stop flag in production)
        std::thread::sleep(std::time::Duration::from_secs(15));
        drop(stream);

        // Resample to 16kHz mono f32 using rubato::SincFixedIn
        let audio = resample_to_16k(buffer.lock().unwrap().clone(), sample_rate);

        if let Ok(text) = transcribe(&ctx, &audio) {
            if !text.is_empty() {
                let _ = app.emit("dictation-result", text);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_dictation(
    state: tauri::State<'_, Arc<Mutex<DictationState>>>,
) -> Result<(), String> {
    state.lock().unwrap().recording = false;
    Ok(())
}
```

Frontend — wire result into the prompt input:

```typescript
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// Hold-to-talk
async function onMicDown() {
    await invoke('start_dictation');
}
async function onMicUp() {
    await invoke('stop_dictation');
}

await listen<string>('dictation-result', ({ payload }) => {
    setPromptValue(payload);
    submitPrompt(); // auto-send
});
```

### ⚠️ macOS entitlements gotcha

`cpal` mic access works in dev mode but **silently fails on a signed build** without the correct entitlements. Add to `src-tauri/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Voice dictation for AI prompts</string>
```

And in `src-tauri/entitlements.plist`:

```xml
<key>com.apple.security.device.audio-input</key>
<true/>
```

This is the most common failure point — easy to miss because dev mode never triggers it.

---

## Dependency summary

```toml
[dependencies]
midir      = "0.10"
wmidi      = "4.0"
whisper-rs = { version = "0.15", features = ["metal"] }
cpal       = "0.15"
rubato     = "0.15"
```
