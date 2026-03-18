# Building a cross-platform DAW with Tauri v2: Web API vs Rust for every subsystem

**The web platform covers less ground than you'd hope on WebKit.** Of the 14 DAW subsystems analyzed, only 2 can rely entirely on cross-platform Web APIs. WebKit's incomplete AudioWorklet support on Linux, absent Web MIDI, and missing File System Access picker APIs mean **Rust handles the heavy lifting for 12 of 14 systems**. The good news: Rust's audio ecosystem has matured significantly — cpal, symphonia, fundsp, and midir form a battle-tested foundation. The critical architectural insight is that WebKitGTK on Linux is the weakest link across nearly every Web API, while WKWebView on macOS sits closer to parity with Chromium.

This report covers every subsystem with a clear verdict (✅ Web API works cross-platform, ⚠️ partial/WebView2-only, ❌ Rust required), specific crate versions, and Tauri v2 integration patterns.

---

## 1. Real-time audio engine

**Verdict: ❌ Rust required — Web Audio API latency and WebKitGTK reliability are unsuitable for DAW-grade playback**

Web Audio API's `AudioContext` works on WKWebView (Safari 6+), but WebKitGTK's implementation remains incomplete — the official webkitgtk.org site states they are "working to finish support for WebAudio." WebKit bug #221334 documents audible glitches and higher latency (**20–40 ms above Chromium**) even on macOS Safari. For a DAW requiring sub-10 ms round-trip latency, this rules out the Web Audio path.

**Rust approach with cpal:**

| Crate   | Version    | License        | GitHub                                 |
| ------- | ---------- | -------------- | -------------------------------------- |
| `cpal`  | **0.17.3** | Apache-2.0     | https://github.com/RustAudio/cpal      |
| `dasp`  | 0.11.0     | MIT/Apache-2.0 | https://github.com/RustAudio/dasp      |
| `creek` | 0.2.3      | MIT/Apache-2.0 | https://github.com/MeadowlarkDAW/creek |

cpal provides direct access to **CoreAudio** (macOS), **WASAPI + ASIO** (Windows, via `asio` feature flag), and **ALSA/JACK/PulseAudio** (Linux). ASIO support requires `CPAL_ASIO_DIR` pointing to the Steinberg SDK. On Linux, the JACK backend delivers professional latency at **~1–5 ms** with 64-sample buffers.

**Audio graph architecture**: Build a block-based processing graph where each node (track, plugin, bus) processes fixed-size buffers (typically 64–512 samples). Use `dasp` for sample format conversion and `creek` for disk streaming with cache buffers. The audio callback thread must be **allocation-free** — pre-allocate all buffers and use lock-free ring buffers (`rtrb` crate) for inter-thread communication.

```rust
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

fn build_output_stream(engine: Arc<AudioEngine>) -> cpal::Stream {
    let host = cpal::default_host();
    let device = host.default_output_device().unwrap();
    let config = device.default_output_config().unwrap();

    device.build_output_stream(
        &config.into(),
        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
            engine.process_block(data); // Fill buffer from audio graph
        },
        |err| eprintln!("Audio error: {}", err),
        None,
    ).unwrap()
}
```

**Gotcha**: cpal does not synchronize multiple device clocks — multi-device recording requires manual drift compensation. creek's disk streaming is functional but its parent project (Meadowlark DAW) has sporadic maintenance; treat it as a reference implementation rather than a production dependency.

---

## 2. Plugin hosting (VST3 / CLAP / AU)

**Verdict: ❌ No Web API exists — Rust only**

No browser API can load native audio plugins. The entire plugin hosting stack must live in Rust.

### CLAP hosting

| Crate                | Version  | License        | GitHub                            |
| -------------------- | -------- | -------------- | --------------------------------- |
| `clack` (clack-host) | git-only | MIT/Apache-2.0 | https://github.com/prokopyl/clack |
| `clap-sys`           | 0.5.0    | MIT/Apache-2.0 | https://crates.io/crates/clap-sys |

`clack` is the **only Rust CLAP hosting library** (195 stars, active development). It provides safe wrappers for plugin scanning, instantiation, audio processing, and the GUI extension. The repo includes a working cpal-based host example at `host/examples/cpal/`. Not yet on crates.io — use as a git dependency.

### VST3 hosting

| Crate                  | Version   | License        | GitHub                                |
| ---------------------- | --------- | -------------- | ------------------------------------- |
| `vst3` (coupler-rs)    | **0.3.0** | MIT/Apache-2.0 | https://github.com/coupler-rs/vst3-rs |
| `vst3-sys` (RustAudio) | git-only  | GPL-3.0        | https://github.com/RustAudio/vst3-sys |

**Critical licensing update**: The VST3 SDK switched to **MIT license in late 2025**. The newer `vst3` crate from coupler-rs aligns with this (MIT/Apache-2.0), while the older `vst3-sys` remains GPL-3.0. For a commercial DAW, **prefer `vst3` (coupler-rs)**. It requires setting `VST3_SDK_DIR` to the SDK headers and uses COM smart pointers (`ComWrapper`, `ComPtr`) for safe interop.

### Audio Units on macOS

| Crate          | Version | License        | Notes                                                    |
| -------------- | ------- | -------------- | -------------------------------------------------------- |
| `rack`         | 0.3.0   | Check crate    | **AU hosting is production-ready** (phases 1–8 complete) |
| `coreaudio-rs` | 0.14.0  | MIT/Apache-2.0 | Lower-level AUv2 wrapper                                 |

The `rack` crate is the most complete AU hosting solution in Rust — it handles scanning, loading, processing, parameters, MIDI, presets, and GUI (AUv3, AUv2, generic fallback). For AUv3 hosting via manual FFI, use `objc2` for Objective-C runtime bindings.

### Sandboxing and crash isolation

Professional DAWs like Bitwig use **out-of-process plugin hosting**: each plugin (or group) runs in a child process communicating via shared memory for audio buffers and sockets for control messages. The architecture:

```
Tauri App (GUI) ←IPC→ Audio Engine (main) ←shared memory→ Plugin Host (child process)
```

Use `std::process::Command` to spawn plugin hosts, `memmap2` or the `shared_memory` crate for zero-copy audio buffer exchange, and `rtrb` ring buffers for lock-free data flow. Start with **in-process hosting** for simplicity; add out-of-process later. Note that out-of-process adds **at minimum one buffer of latency**.

### Plugin GUI hosting in Tauri v2

Tauri v2's `Window` implements `raw_window_handle::HasWindowHandle` (confirmed in v2.0.0-beta.13+). Create a **separate native window** for each plugin editor, extract its `RawWindowHandle`, and pass it to the plugin's `createEditor` method. Do not attempt to embed plugin GUIs inside the webview.

```rust
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

#[tauri::command]
async fn open_plugin_gui(app: tauri::AppHandle, plugin_id: String) {
    let window = tauri::WebviewWindowBuilder::new(
        &app, &format!("plugin-{}", plugin_id),
        tauri::WebviewUrl::App("plugin-host.html".into()),
    ).inner_size(800.0, 600.0).build().unwrap();

    match window.window_handle().unwrap().as_raw() {
        RawWindowHandle::AppKit(h) => { /* pass h.ns_view to plugin */ },
        RawWindowHandle::Win32(h) => { /* pass h.hwnd to plugin */ },
        RawWindowHandle::Xlib(h) => { /* pass h.window to plugin */ },
        _ => {}
    }
}
```

---

## 3. Built-in synthesis

**Verdict: ⚠️ Web Audio OscillatorNode works cross-platform but is too limited for DAW-grade synths → Rust recommended**

WebKit's `OscillatorNode` and basic synthesis nodes work on all platforms and are fine for simple sound generation. However, a DAW's built-in synth needs polyphonic voice management, complex modulation routing, wavetable synthesis, and deterministic CPU behavior — none of which the Web Audio API provides. **Use Rust.**

| Crate        | Version    | License         | GitHub                                 |
| ------------ | ---------- | --------------- | -------------------------------------- |
| `fundsp`     | **0.23.0** | MIT/Apache-2.0  | https://github.com/SamiPerttu/fundsp   |
| `rustysynth` | latest     | MIT             | https://github.com/sinshu/rustysynth   |
| `oxisynth`   | 0.1.0      | **LGPL-2.1** ⚠️ | https://github.com/PolyMeilex/OxiSynth |

**fundsp** provides a composable DSP graph notation with zero-cost abstractions. Its `AudioNode` system is stack-allocated and inlined — well-suited for real-time synthesis. It includes bandlimited oscillators (`saw`, `square`, `triangle`), Moog ladder filters, SVF filters, delay lines, reverb, and envelope followers.

```rust
use fundsp::prelude::*;

// Subtractive synth voice: sawtooth → Moog ladder filter → gain
fn synth_voice(freq: f32, cutoff: f32, resonance: f32) -> Box<dyn AudioUnit> {
    Box::new(saw_hz(freq) >> moog_hz(cutoff, resonance) >> mul(0.3))
}

// Polyphony: maintain a pool of 16 voices, LRU voice stealing
struct PolySynth {
    voices: Vec<Option<(u8, Box<dyn AudioUnit>)>>, // (note, dsp)
    max_voices: usize,
}
```

**For SoundFont playback**, use `rustysynth` (MIT, zero dependencies, pure Rust). It handles SF2 loading, note on/off, program changes, and MIDI file sequencing. Avoid `oxisynth` in a commercial DAW due to **LGPL-2.1 licensing** concerns.

**Gotcha**: fundsp's docs.rs build failed for v0.23.0 — use the GitHub README and examples as documentation. The library has a single maintainer (bus factor = 1).

---

## 4. DSP and effects

**Verdict: ⚠️ Web Audio built-in effects work cross-platform but lack DAW-grade quality and flexibility → Rust recommended for production effects**

WebKit's `BiquadFilterNode`, `ConvolverNode`, and `DynamicsCompressorNode` all function correctly across platforms — Safari's Web Audio 1.0 compliance is rated "excellent." However, the built-in compressor uses fixed-topology dynamics with no sidechain input, the EQ nodes offer only single-band biquads with no linear-phase option, and there's no parametric multi-band EQ node. For a DAW, **build effects in Rust**.

**AudioWorklet on WebKit**: Shipped in Safari 14.1+ and should work in recent WebKitGTK builds. However, WebKitGTK's "still finishing WebAudio" status means **AudioWorklet reliability on Linux is uncertain**. If you do use AudioWorklet, include a `ScriptProcessorNode` fallback.

| Crate     | Version   | License        | Purpose                                         |
| --------- | --------- | -------------- | ----------------------------------------------- |
| `fundsp`  | 0.23.0    | MIT/Apache-2.0 | Filters, dynamics, reverb, delay                |
| `rustfft` | **6.4.1** | MIT/Apache-2.0 | FFT for convolution reverb, spectral processing |

fundsp covers the complete effects chain: biquad EQ (lowpass, highpass, bandpass, notch, peaking, shelf), Butterworth filters, SVF filters, compressor/limiter, delay, chorus, flanger, waveshaping distortion, and convolution reverb (via rustfft). For a parametric EQ, chain multiple `bell_hz` or `peak_hz` nodes. For convolution reverb, use fundsp's built-in `convolver` or implement STFT-based partitioned convolution with rustfft for low latency.

---

## 5. MIDI clock output and MPE

**Verdict: ❌ Web MIDI API is not supported on any WebKit platform — Rust required**

Apple has **explicitly declined** to implement Web MIDI due to fingerprinting and privacy concerns. Caniuse confirms: Safari 3.1 through 26.4 — not supported. This is a permanent gap, not a temporary omission.

| Crate   | Version    | License | GitHub                             |
| ------- | ---------- | ------- | ---------------------------------- |
| `midir` | **0.10.3** | MIT     | https://github.com/Boddlnagg/midir |

midir provides cross-platform MIDI I/O via CoreMIDI (macOS), ALSA (Linux), JACK (optional), and WinRT (Windows). It supports virtual ports on all platforms except Windows.

**MIDI clock output** sends `0xF8` (timing clock) **24 times per quarter note**, plus `0xFA` (start) and `0xFC` (stop). In a DAW, drive clock from the audio callback — not from a sleep-based timer — for sample-accurate timing:

```rust
// In audio callback: accumulate fractional ticks per sample
let ticks_per_sample = (tempo_bpm * 24.0) / (60.0 * sample_rate as f64);
tick_accumulator += ticks_per_sample * buffer_size as f64;
while tick_accumulator >= 1.0 {
    midi_conn.send(&[0xF8]).ok();
    tick_accumulator -= 1.0;
}
```

### MPE handling

MPE assigns each sounding note to its own MIDI channel, enabling **per-note pitch bend, pressure (aftertouch), and slide (CC74)**. The spec defines two zones: Lower (master=Ch1, members=Ch2–Ch16) and Upper (master=Ch16, members descending). A DAW must implement:

- **Channel allocator**: LRU pool of member channels per zone, round-robin assignment on note-on, return on note-off
- **Per-note state**: Track pitch bend (14-bit), pressure, CC74 independently per channel
- **Zone configuration**: Parse RPN 6 (MCM) messages on master channels

No permissively-licensed Rust MPE crate exists (`surge-mpe` and `aloe-mpe` are GPL). **Build a custom ~200-line module** using `midi-msg` (MIT) for message parsing and `midir` for I/O.

---

## 6. Project and session persistence

**Verdict: ✅ IndexedDB works cross-platform | ⚠️ File System Access API pickers are WebView2-only → use Tauri's native dialogs**

**IndexedDB** works reliably on all three platforms in Tauri v2. WKWebView allows ~15% of total disk per origin (~150 GB on a 1 TB Mac). However, for a DAW project file, IndexedDB is the wrong tool — project files should be user-visible files on disk.

**File System Access API**: Only OPFS (Origin Private File System) works on WebKit (Safari 15.2+). The picker APIs (`showOpenFilePicker`, `showSaveFilePicker`) are **Chromium-only** — Safari has declined to implement them. Use **Tauri's dialog plugin** instead:

```typescript
import { open, save } from '@tauri-apps/plugin-dialog';
const path = await open({ filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac'] }] });
```

**Persistence architecture**: Use a dual-format approach with `serde`:

| Crate                  | Version    | License        | Purpose                                  |
| ---------------------- | ---------- | -------------- | ---------------------------------------- |
| `serde` + `serde_json` | 1.x        | MIT/Apache-2.0 | Human-readable project files             |
| `bincode`              | 1.3        | MIT            | Fast autosave (~10–50× faster than JSON) |
| `rusqlite`             | **0.38.0** | MIT            | Peak cache, undo history, metadata index |
| `undo`                 | 0.52+      | MIT/Apache-2.0 | Command-pattern undo/redo                |

Store audio file **references** (relative paths + SHA-256 hashes), not raw audio, in the project file. Use the command pattern via the `undo` crate for full undo/redo with support for command merging (e.g., collapse many small fader moves into one undo step via `id()`). rusqlite with `bundled` feature compiles SQLite into the binary with zero system dependencies.

---

## 7. Audio file I/O (import/export)

**Verdict: ⚠️ decodeAudioData works for WAV/MP3/AAC but format support varies on WebKit → Rust recommended for reliable cross-format decoding and all encoding**

`decodeAudioData` handles WAV and MP3 everywhere. AAC works on macOS natively but requires GStreamer plugins on Linux. **OGG Vorbis is unsupported on Safari before 18.4** (macOS 15.4, March 2025). For a DAW that must decode any format reliably, use Rust.

**Export** is Rust-only regardless — `MediaRecorder` outputs MP4/AAC on Safari (WebM/Opus only since Safari 18.4) and provides no sample-accurate control over the output format.

| Crate             | Version   | License         | Purpose                               |
| ----------------- | --------- | --------------- | ------------------------------------- |
| `symphonia`       | **0.5.5** | MPL-2.0         | Decode WAV, MP3, AAC, FLAC, OGG, AIFF |
| `hound`           | **3.5.1** | Apache-2.0      | WAV read/write                        |
| `mp3lame-encoder` | 0.2.2     | **LGPL-3.0** ⚠️ | MP3 export via LAME                   |
| `fdk-aac`         | 0.8.0     | MIT (crate)     | AAC encoding                          |

symphonia is a **pure Rust decode-only** library supporting WAV, AIFF, CAF, MP3, AAC, FLAC, OGG Vorbis, and ALAC — generally ±15% of FFmpeg performance. Its MPL-2.0 license is file-level copyleft (compatible with proprietary code if symphonia source files are kept separate).

For export: WAV via `hound` (trivial, no licensing issues), MP3 via `mp3lame-encoder` (LGPL — must dynamically link or accept LGPL terms), AAC via `fdk-aac` (permissive license). For full format coverage, consider an ffmpeg sidecar binary distributed alongside the app.

---

## 8. Waveform rendering peak data

**Verdict: ❌ CPU-intensive computation — Rust regardless, streamed to WebGPU frontend via Tauri IPC**

Peak/RMS computation is O(n) over potentially millions of samples and must produce multi-resolution caches. This belongs in Rust unconditionally.

**Multi-resolution peak cache**: Pre-compute `PeakPair { min: f32, max: f32 }` at standard zoom levels (1, 2, 4, 8, … 8192 samples per pixel). Store in SQLite or memory-mapped files for fast access.

**Binary transfer to WebGPU** uses `tauri::ipc::Response` which bypasses JSON serialization and returns raw `ArrayBuffer` to JavaScript:

```rust
#[tauri::command]
fn get_peaks(clip_id: String, samples_per_pixel: u32) -> tauri::ipc::Response {
    let peaks: Vec<PeakPair> = cache.get(&clip_id, samples_per_pixel);
    let bytes: &[u8] = unsafe {
        std::slice::from_raw_parts(peaks.as_ptr() as *const u8,
            peaks.len() * std::mem::size_of::<PeakPair>())
    };
    tauri::ipc::Response::new(bytes.to_vec())
}
```

```typescript
// Frontend: ArrayBuffer → Float32Array → WebGPU buffer
const buffer: ArrayBuffer = await invoke('get_peaks', { clipId, samplesPerPixel });
device.queue.writeBuffer(waveformBuffer, 0, new Float32Array(buffer));
```

For **spectrograms**, use `rustfft` **6.4.1** with Hann windowing and overlap-add STFT. The `realfft` crate (v3.5.0, same author) provides 2× more efficient real-to-complex transforms for audio signals.

**WebGPU gotcha on Linux**: WebKitGTK does **not support WebGPU** as of March 2026. Design your waveform renderer with a **WebGL2 fallback** path. Feature-detect at runtime with `navigator.gpu`.

---

## 9. Metering (VU / LUFS / peak)

**Verdict: ⚠️ AnalyserNode works cross-platform for basic visualization but is insufficient for professional metering → Rust for LUFS and true-peak**

`AnalyserNode` provides FFT-based frequency data and time-domain waveform data, but **it does not provide true-peak detection** (which requires 4× oversampled peak measurement per EBU R 128) and has no LUFS measurement capability. For broadcast-compliant metering, use Rust.

| Crate     | Version | License | GitHub                             |
| --------- | ------- | ------- | ---------------------------------- |
| `ebur128` | latest  | MIT     | https://github.com/sdroege/ebur128 |

`ebur128` is a pure Rust port of libebur128 by Sebastian Dröge (GStreamer maintainer). It passes **all EBU TECH 3341 and 3342 compliance tests** and provides integrated LUFS, short-term, momentary loudness, loudness range, and true-peak measurement.

**Stream meter data at ~30 fps** via Tauri's Channel API:

```rust
#[tauri::command]
async fn start_metering(channel: Channel<MeterData>) {
    tokio::spawn(async move {
        loop {
            let data = MeterData {
                peak_l: engine.peak_l(), peak_r: engine.peak_r(),
                rms_l: engine.rms_l(), rms_r: engine.rms_r(),
                lufs_momentary: engine.lufs_momentary(),
                lufs_short_term: engine.lufs_short_term(),
            };
            if channel.send(data).is_err() { break; }
            tokio::time::sleep(Duration::from_millis(33)).await;
        }
    });
}
```

---

## 10. Sample rate conversion

**Verdict: ✅ Web Audio API handles SRC internally and it works on WebKit — but if audio runs in Rust, keep SRC in Rust too**

Web Audio's `AudioContext` automatically resamples buffers of differing sample rates. This works correctly on all platforms per spec. However, since the audio engine is Rust-based (per topic 1), SRC should stay in Rust for consistency and control.

| Crate    | Version    | License | GitHub                             |
| -------- | ---------- | ------- | ---------------------------------- |
| `rubato` | **0.16.2** | MIT     | https://github.com/HEnquist/rubato |

rubato provides three modes: **asynchronous sinc interpolation** (highest quality, adjustable ratio at runtime), **polynomial interpolation** (fast, lower quality), and **synchronous FFT-based** (fastest for fixed ratios like 44100→48000). It's SIMD-accelerated on x86_64 (AVX, SSE3) and AArch64 (NEON), real-time safe after setup (no allocations during processing), and designed explicitly for audio resampling.

---

## 11. Recording (audio + multi-track)

**Verdict: ⚠️ getUserMedia works on WKWebView (macOS 11+) and WebKitGTK but lacks multi-track control and has latency issues → Rust required for DAW-grade recording**

`getUserMedia` works on WKWebView since macOS 11 and on WebKitGTK via GStreamer/PipeWire. However: every call triggers a permission popup on WKWebView (mitigated via `WKUIDelegate` in macOS 12+), device enumeration is limited on WebKitGTK, the microphone is muted when the app backgrounds on macOS, and there's no way to select specific audio interface channels or achieve low-latency monitoring. `MediaRecorder` on WebKit outputs MP4/AAC only (WebM/Opus added in Safari 18.4). None of this is sufficient for multi-track DAW recording.

**Rust recording architecture**: Use cpal for audio input, lock-free ring buffers for real-time-safe data transfer to a writer thread, and hound for WAV file output.

```rust
// Audio input callback (real-time thread — no allocations)
fn input_callback(data: &[f32], tracks: &[rtrb::Producer<f32>]) {
    for (i, sample) in data.iter().enumerate() {
        let channel = i % num_channels;
        if let Some(producer) = armed_tracks.get(channel) {
            let _ = producer.push(*sample); // Lock-free, never blocks
        }
    }
}

// Writer thread (normal priority — handles disk I/O)
fn writer_thread(consumers: &mut [rtrb::Consumer<f32>], writers: &mut [hound::WavWriter<_>]) {
    loop {
        for (consumer, writer) in consumers.iter_mut().zip(writers.iter_mut()) {
            while let Ok(sample) = consumer.pop() {
                writer.write_sample(sample).unwrap();
            }
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
```

**Punch in/out**: Compare the transport's musical-time position against punch boundaries on each sample. Apply **2–10 ms crossfades** at boundaries to prevent clicks. **Takes management**: Store each recording pass as a separate WAV file with metadata (start position, length, take lane index), then let the user comp across takes by selecting regions.

---

## 12. Ableton Link (BPM sync)

**Verdict: ❌ No Web API for peer-to-peer tempo sync — Rust required**

Ableton Link is a peer-to-peer protocol using mDNS/Bonjour for discovery and a custom sync protocol for tempo, beat phase, and start/stop state across apps on a LAN.

| Crate             | Version   | License         | GitHub                                     |
| ----------------- | --------- | --------------- | ------------------------------------------ |
| `rusty_link`      | **0.4.8** | **GPL-2.0+** ⚠️ | https://github.com/anzbert/rusty_link      |
| `ableton-link-rs` | latest    | GPL-3.0         | https://github.com/anweiss/ableton-link-rs |

`rusty_link` wraps Ableton's official C11 SDK via bindgen + cmake. It's actively maintained, fully documented, and provides `AblLink`, `SessionState`, and `HostTimeFilter` structs. Build requires CMake 3.14+ and a C++ compiler. The pure-Rust alternative `ableton-link-rs` uses Tokio for async networking but is less battle-tested.

**Licensing is the major concern**: Link's SDK is dual-licensed GPL-2.0+ / proprietary (contact link-devs@ableton.com for commercial license). Any code linking against rusty_link inherits GPL-2.0+. Consider making Link an **optional, separately-licensed feature**.

```rust
use rusty_link::{AblLink, SessionState};

// In audio callback:
fn audio_callback(link: &AblLink, sample_time: u64) {
    let mut session = SessionState::new();
    link.capture_audio_session_state(&mut session);
    let tempo = session.tempo();
    let beat = session.beat_at_time(host_time, 4.0); // quantum = 4 beats
    let phase = session.phase_at_time(host_time, 4.0);
    // Use beat/phase to drive transport and MIDI clock
}
```

---

## 13. Internal clock and transport

**Verdict: ⚠️ AudioContext.currentTime works on WebKit but audio runs in Rust → build transport in Rust**

`AudioContext.currentTime` provides monotonically increasing time in seconds with sub-millisecond precision on WebKit. Since the entire audio engine lives in Rust (topic 1), the transport must too.

**Architecture** (based on the Meadowlark DAW research by Billy Messenger):

Use **fixed-point time representations** to avoid floating-point drift. Musical time uses **1,476,034,560 ticks per beat** (LCM of all common subdivisions including triplets and quintuplets). Sample time uses **282,240,000 subdivisions per second** (divisible by all standard sample rates: 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000) — the same modulus Ardour uses.

```rust
struct Transport {
    state: TransportState, // Stopped | Playing | Recording
    position_samples: u64,
    loop_enabled: bool,
    loop_start: MusicalTime,
    loop_end: MusicalTime,
    tempo_map: Arc<TempoMap>, // Atomically swapped from UI thread
}

struct TempoMap {
    entries: Vec<TempoEntry>, // Sorted by position
    // Precomputed: musical time → sample position at each boundary
    cached_boundaries: Vec<u64>,
}
```

**Store all events in musical time** (source of truth). When the tempo map changes, recompute sample positions. Advance the transport position in the audio callback by `buffer_size` samples per block, converting to musical time via piecewise integration over tempo map segments.

**Synchronization flow**: The audio callback drives everything — it advances the transport, processes audio, emits MIDI clock ticks (24 PPQ via midir), captures Link session state, and pushes position snapshots to the UI thread via a lock-free channel. The Tauri frontend polls position at ~30–60 Hz via the Channel API.

---

## 14. Stems export and offline bounce

**Verdict: ⚠️ OfflineAudioContext works on WebKit but the audio graph is in Rust → Rust offline render**

`OfflineAudioContext` functions correctly on WKWebView for rendering Web Audio graphs faster-than-realtime. Since the DAW's audio graph, plugins, and effects all live in Rust, the offline render pipeline must be Rust as well.

**Architecture**: Process the audio graph in a tight loop with no timing constraints. Use `rayon` for **parallel stem bouncing** — each stem (track solo'd) renders on a separate thread. Report progress to the frontend via the Channel API.

```rust
use rayon::prelude::*;

#[tauri::command]
async fn bounce_stems(
    project: State<'_, Arc<DawProject>>,
    output_dir: String,
    channel: Channel<BounceProgress>,
) -> Result<Vec<String>, String> {
    let stems: Vec<_> = project.tracks.iter().filter(|t| !t.mute).collect();

    stems.par_iter().map(|track| {
        let path = format!("{}/{}.wav", output_dir, track.name);
        let mut writer = hound::WavWriter::create(&path, wav_spec())?;
        let mut position = 0u64;
        while position < project.total_samples() {
            let block = render_track_block(&project, track.id, position, 1024);
            for sample in &block { writer.write_sample(*sample)?; }
            position += 1024;
            channel.send(BounceProgress { stem: track.name.clone(),
                progress: position as f32 / project.total_samples() as f32 })?;
        }
        writer.finalize()?;
        Ok(path)
    }).collect()
}
```

---

## Cross-platform verdicts at a glance

| #   | Subsystem              | Verdict | Approach                                                                  |
| --- | ---------------------- | ------- | ------------------------------------------------------------------------- |
| 1   | Real-time audio engine | ❌      | Rust: cpal 0.17.3 + custom audio graph                                    |
| 2   | Plugin hosting         | ❌      | Rust: clack (CLAP), vst3 0.3.0 (VST3), rack 0.3.0 (AU)                    |
| 3   | Built-in synthesis     | ❌      | Rust: fundsp 0.23.0, rustysynth (SF2)                                     |
| 4   | DSP / effects          | ❌      | Rust: fundsp 0.23.0, rustfft 6.4.1                                        |
| 5   | MIDI clock + MPE       | ❌      | Rust: midir 0.10.3, custom MPE module                                     |
| 6   | Project persistence    | ✅/⚠️   | IndexedDB ✅; file dialogs → Tauri dialog plugin; serde + rusqlite 0.38.0 |
| 7   | Audio file I/O         | ⚠️      | Rust: symphonia 0.5.5 (decode), hound 3.5.1 (WAV), fdk-aac 0.8.0          |
| 8   | Waveform peak data     | ❌      | Rust: rustfft 6.4.1, binary IPC via `Response`                            |
| 9   | Metering               | ⚠️      | Rust: ebur128 (LUFS), Channel API at 30 fps                               |
| 10  | Sample rate conversion | ✅      | Web Audio handles it, but Rust rubato 0.16.2 since engine is Rust         |
| 11  | Recording              | ⚠️      | Rust: cpal + rtrb ring buffers + hound                                    |
| 12  | Ableton Link           | ❌      | Rust: rusty_link 0.4.8 (GPL-2.0+ ⚠️)                                      |
| 13  | Internal clock         | ❌      | Rust: custom fixed-point transport on cpal                                |
| 14  | Stems export           | ❌      | Rust: rayon + hound parallel bounce                                       |

## Conclusion

The dominant architecture that emerges is a **Rust-heavy backend** with the React/TypeScript frontend serving exclusively as the UI layer — rendering waveforms via WebGPU, displaying meters from streamed data, and controlling the engine via Tauri commands. The web layer does not touch audio processing at all.

Three findings stand out. First, **WebKitGTK on Linux is the most constrained target** — Web Audio remains unfinished, WebGPU is absent, and MediaRecorder depends on installed GStreamer plugins. Design with a WebGL2 fallback and test rigorously on target distros. Second, **licensing requires careful navigation**: rusty_link (GPL-2.0+), mp3lame-encoder (LGPL-3.0), oxisynth (LGPL-2.1), and the older vst3-sys (GPL-3.0) all carry copyleft obligations. The newer vst3 crate from coupler-rs (MIT/Apache-2.0) solves the VST3 licensing problem now that Steinberg has relicensed the SDK. Third, **Tauri v2's Channel API and `Response` type** provide the critical performance bridge — Channel for streaming meter data at 30 fps with JSON payloads, and `Response::new(bytes)` for zero-serialization binary transfer of peak data directly into WebGPU buffers. Avoid the event system for anything larger than a few kilobytes.
