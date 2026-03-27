# Local AI audio generation in a Tauri v2 DAW

**A complete Python sidecar running MusicGen or Stable Audio Open can generate production-quality audio clips from text prompts entirely on-device, with no external APIs.** The architecture pairs a Tauri v2 Rust host with a bundled Python subprocess communicating over stdin/stdout JSON Lines, targeting Apple Silicon (MPS/MLX) and NVIDIA CUDA. This guide covers every layer — model selection, sidecar plumbing, inference code, prompt parsing, Rust post-processing, model distribution, and end-to-end integration — with real, version-pinned code that reflects the state of the ecosystem as of early 2026.

The critical constraint most teams discover late: **every Meta AudioCraft model (MusicGen, AudioGen, MAGNeT, JASCO) ships CC-BY-NC 4.0 weights**, prohibiting commercial use. Stable Audio Open uses Stability AI's community license, free for organizations under $1M annual revenue. This licensing reality drives architecture decisions throughout.

---

## 1. Which models actually work for a shipping DAW

Seven local audio generation models merit serious evaluation. The table below captures the facts that matter for integration — not paper benchmarks but shipping realities: VRAM floors, licensing, sample rates, and whether BPM conditioning actually works.

| Model                                                               | Params | Output             | Max Duration | License             | BPM/Key Native               | MPS Works              |
| ------------------------------------------------------------------- | ------ | ------------------ | ------------ | ------------------- | ---------------------------- | ---------------------- |
| **MusicGen-small** (`facebook/musicgen-small`)                      | 300M   | 32kHz mono         | 30s          | CC-BY-NC 4.0        | ❌ Text only                 | ❌ (MLX port required) |
| **MusicGen-medium** (`facebook/musicgen-medium`)                    | 1.5B   | 32kHz mono         | 30s          | CC-BY-NC 4.0        | ❌ Text only                 | ❌                     |
| **MusicGen-stereo-small** (`facebook/musicgen-stereo-small`)        | 300M   | 32kHz stereo       | 30s          | CC-BY-NC 4.0        | ❌ Text only                 | ❌                     |
| **Stable Audio Open 1.0** (`stabilityai/stable-audio-open-1.0`)     | 1.2B   | **44.1kHz stereo** | 47s          | Stability Community | ⚠️ Timing yes, BPM text only | ✅ via diffusers       |
| **Stable Audio Open Small** (`stabilityai/stable-audio-open-small`) | 341M   | **44.1kHz stereo** | 11s          | Stability Community | ⚠️ `seconds_total` only      | ✅                     |
| **AudioLDM 2** (`cvssp/audioldm2-music`)                            | 1.1B   | 16kHz mono         | Variable     | CC-BY-NC-SA 4.0     | ❌                           | ✅                     |
| **JASCO** (`facebook/jasco-chords-drums-400M`)                      | 400M   | 32kHz mono         | 10s          | CC-BY-NC 4.0        | ✅ Chords + drums native     | Unknown                |

**MusicGen** remains the most mature text-to-music model. The `small` variant requires **~2 GB** on disk, **~4–6 GB VRAM** during inference, and produces reasonable results across percussion, melodic loops, and pads. The `medium` variant (~6 GB disk, ~10–16 GB VRAM) substantially improves quality. BPM and key are not natively conditioned — you embed them in the text prompt ("120 BPM shaker loop in C# minor") and results are approximate. The **stereo variants** double codebook count but maintain the same parameter count.

**Stable Audio Open 1.0** is the strongest choice for a commercial product. Its **44.1kHz stereo output** is production-grade, it natively conditions on timing (`seconds_start`, `seconds_total`), and the Stability Community License permits commercial use under $1M revenue. Its weakness: trained primarily on Freesound/FMA data, it excels at sound effects and textural content but produces less musically diverse results than MusicGen. The **Small variant** (341M params, 1.68 GB) generates up to 11 seconds in just **8 diffusion steps** using a `pingpong` sampler — dramatically faster than the full model's 200 steps.

**JASCO** deserves attention for DAW integration because it accepts **native chord progressions and drum track conditioning** — `[('C', 0.0), ('D', 2.0), ('F', 4.0)]` — making it the most musically controllable open model. However, it inherits AudioCraft's non-commercial license.

**AudioLDM 2** outputs at only 16kHz, disqualifying it for production DAW audio. **MAGNeT** (`facebook/magnet-small-10secs`) generates **~7× faster** than MusicGen via masked non-autoregressive decoding but does not work on MPS and shares the CC-BY-NC license.

### Recommendation for commercial products

For a shipping product, use **Stable Audio Open 1.0** (or Small for faster generation) as the primary model. Supplement with MusicGen for music-focused generation if your license permits non-commercial use or you fine-tune with your own data on the MIT-licensed AudioCraft code. The `audiocraft` Python package provides the training framework; weights trained on your own data can be licensed however you choose.

---

## 2. Tauri v2 sidecar architecture from config to code

The sidecar pattern bundles a compiled Python binary (via PyInstaller or conda-pack) alongside the Tauri app. Tauri spawns it as a subprocess and communicates via stdin/stdout. The user never sees Python.

### Configuration

**`src-tauri/tauri.conf.json`** — Register the sidecar binary:

```json
{
    "bundle": {
        "externalBin": ["binaries/audio-sidecar"]
    }
}
```

Tauri automatically appends the target triple at build time. Place platform-specific binaries in `src-tauri/binaries/` with triple suffixes:

```
audio-sidecar-aarch64-apple-darwin          # macOS Apple Silicon
audio-sidecar-x86_64-apple-darwin           # macOS Intel
audio-sidecar-x86_64-pc-windows-msvc.exe    # Windows
audio-sidecar-x86_64-unknown-linux-gnu      # Linux
```

Get your current triple with `rustc --print host-tuple`.

### Capabilities

**`src-tauri/capabilities/default.json`** — Grant sidecar permissions. The `tauri-plugin-shell` requires explicit capability grants for spawn, stdin write, and kill:

```json
{
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "default",
    "windows": ["main"],
    "permissions": [
        "core:default",
        {
            "identifier": "shell:allow-spawn",
            "allow": [{ "name": "binaries/audio-sidecar", "sidecar": true, "args": true }]
        },
        {
            "identifier": "shell:allow-stdin-write",
            "allow": [{ "name": "binaries/audio-sidecar", "sidecar": true }]
        },
        "shell:allow-kill"
    ]
}
```

### Communication protocol: stdin/stdout JSON Lines wins

| Factor              | stdin/stdout JSON                  | Local HTTP (FastAPI)                        |
| ------------------- | ---------------------------------- | ------------------------------------------- |
| Latency per message | **~1 ms** (OS pipe)                | ~5–15 ms (TCP + HTTP parse)                 |
| Streaming progress  | Natural — one JSON line per update | Requires SSE or WebSocket                   |
| Port conflicts      | None                               | Possible                                    |
| Security            | No network exposure                | localhost accessible to all local processes |
| Binary size impact  | Zero additional deps               | +FastAPI, uvicorn (~20 MB)                  |

**Use stdin/stdout JSON Lines.** Each message is one JSON object per line, terminated by `\n`. The sidecar reads from `sys.stdin` line-by-line and writes to `sys.stdout` with `flush=True`. This is critical — Python buffers stdout when not connected to a TTY.

### Complete Rust sidecar manager

**`src-tauri/Cargo.toml`:**

```toml
[dependencies]
tauri = "2.10"
tauri-plugin-shell = "2.3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["sync", "time"] }
uuid = { version = "1", features = ["v4"] }
```

**`src-tauri/src/sidecar.rs`:**

```rust
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{mpsc, Mutex, oneshot};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateRequest {
    pub command: String,
    pub request_id: String,
    pub prompt: String,
    pub bpm: f32,
    pub key: String,
    pub duration_bars: u32,
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(rename = "requestId", default)]
    pub request_id: String,
    #[serde(default)]
    pub progress: f64,
    #[serde(rename = "wavPath", default)]
    pub wav_path: String,
    #[serde(default)]
    pub error: String,
    #[serde(default)]
    pub message: String,
}

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub request_id: String,
    pub progress: f64,
    pub message: String,
}

pub struct SidecarState {
    child: Arc<Mutex<Option<CommandChild>>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<String, String>>>>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Spawn the sidecar process and begin listening for stdout events.
#[tauri::command]
pub async fn start_sidecar(app: AppHandle) -> Result<(), String> {
    let state: tauri::State<'_, SidecarState> = app.state();

    // Don't double-spawn
    if state.child.lock().await.is_some() {
        return Ok(());
    }

    let model_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    std::fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;

    let sidecar_cmd = app
        .shell()
        .sidecar("audio-sidecar")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?
        .args(["--model-dir", model_dir.to_str().unwrap_or("/tmp")]);

    let (mut rx, child) = sidecar_cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    *state.child.lock().await = Some(child);

    let pending = state.pending.clone();
    let child_ref = state.child.clone();
    let app_handle = app.clone();

    // Background task: read stdout/stderr, dispatch to pending requests
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                    if line.is_empty() { continue; }

                    match serde_json::from_str::<SidecarMessage>(&line) {
                        Ok(msg) => match msg.msg_type.as_str() {
                            "progress" => {
                                let _ = app_handle.emit("audio-gen-progress", ProgressPayload {
                                    request_id: msg.request_id,
                                    progress: msg.progress,
                                    message: msg.message,
                                });
                            }
                            "result" => {
                                let mut map = pending.lock().await;
                                if let Some(tx) = map.remove(&msg.request_id) {
                                    let _ = tx.send(Ok(msg.wav_path));
                                }
                            }
                            "error" => {
                                let mut map = pending.lock().await;
                                if let Some(tx) = map.remove(&msg.request_id) {
                                    let _ = tx.send(Err(msg.error));
                                }
                            }
                            "ready" | "loaded" => {
                                let _ = app_handle.emit("sidecar-status", &msg.msg_type);
                            }
                            _ => {}
                        },
                        Err(_) => {
                            eprintln!("[sidecar stdout] {line}");
                        }
                    }
                }
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    eprintln!("[sidecar stderr] {line}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("Sidecar terminated: code={:?}", payload.code);
                    *child_ref.lock().await = None;
                    let _ = app_handle.emit("sidecar-terminated", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Send a generation request and await the result (WAV path).
#[tauri::command]
pub async fn generate_audio(
    app: AppHandle,
    prompt: String,
    bpm: f32,
    key: String,
    duration_bars: u32,
) -> Result<String, String> {
    let state: tauri::State<'_, SidecarState> = app.state();
    let request_id = Uuid::new_v4().to_string();

    let output_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("generated");
    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let request = GenerateRequest {
        command: "generate".into(),
        request_id: request_id.clone(),
        prompt,
        bpm,
        key,
        duration_bars,
        output_dir: output_dir.to_str().unwrap_or("/tmp").into(),
    };

    let (tx, rx) = oneshot::channel();
    state.pending.lock().await.insert(request_id.clone(), tx);

    // Write JSON request to sidecar stdin
    {
        let mut child_lock = state.child.lock().await;
        let child = child_lock.as_mut().ok_or("Sidecar not running")?;
        let msg = serde_json::to_string(&request).map_err(|e| e.to_string())? + "\n";
        child.write(msg.as_bytes()).map_err(|e| e.to_string())?;
    }

    // Await response with timeout
    match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Response channel dropped".into()),
        Err(_) => {
            state.pending.lock().await.remove(&request_id);
            Err("Generation timed out after 120 seconds".into())
        }
    }
}

/// Gracefully shut down the sidecar.
#[tauri::command]
pub async fn stop_sidecar(app: AppHandle) -> Result<(), String> {
    let state: tauri::State<'_, SidecarState> = app.state();
    let mut guard = state.child.lock().await;
    if let Some(ref child) = *guard {
        // Ask nicely first
        let _ = child.write(b"{\"command\":\"quit\"}\n");
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
    Ok(())
}
```

**`src-tauri/src/lib.rs`:**

```rust
mod sidecar;
mod postprocess;

use sidecar::SidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState::new())
        .invoke_handler(tauri::generate_handler![
            sidecar::start_sidecar,
            sidecar::generate_audio,
            sidecar::stop_sidecar,
            postprocess::post_process_audio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Bundling the Python sidecar

**PyInstaller** creates a self-contained binary. Use `--onedir` mode (not `--onefile`) to avoid cold-start extraction delays:

```bash
pip install pyinstaller
pyinstaller --onedir --name audio-sidecar sidecar_main.py \
    --collect-all audiocraft \
    --collect-all stable_audio_tools \
    --hidden-import torch.jit \
    --copy-metadata torch \
    --copy-metadata torchaudio

# Rename with target triple
mv dist/audio-sidecar dist/audio-sidecar-aarch64-apple-darwin
cp -r dist/audio-sidecar-aarch64-apple-darwin src-tauri/binaries/
```

**Known issue**: PyInstaller's `--onefile` mode wraps the Python process inside a bootloader. Tauri's `child.kill()` only kills the bootloader, not the inner Python process. With `--onedir`, the PID is the actual Python process. Always send a `{"command": "quit"}` message before killing.

**Bundle sizes**: PyTorch CUDA adds **~4–5 GB**. CPU-only PyTorch is **~800 MB**. For macOS Apple Silicon, consider shipping an MLX-based sidecar (~100 MB for MLX itself) instead of PyTorch.

---

## 3. The Python sidecar that generates audio

This sidecar loads a model once on startup (warm start), then processes JSON requests on stdin indefinitely. It supports both MusicGen (via `audiocraft`) and Stable Audio Open (via `stable-audio-tools`).

### Complete sidecar implementation

```python
#!/usr/bin/env python3
"""Audio generation sidecar for Tauri DAW.

Reads JSON requests from stdin, generates audio, writes JSON responses to stdout.
Model stays loaded between requests (warm inference).
"""
import sys
import os
import json
import argparse
import traceback
import tempfile

# Force line-buffered stdout for reliable IPC
sys.stdout = os.fdopen(sys.stdout.fileno(), "w", buffering=1)

def emit(msg: dict):
    """Write one JSON line to stdout, immediately flushed."""
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()

def log(msg: str):
    """Logging goes to stderr to keep the stdout protocol clean."""
    print(msg, file=sys.stderr, flush=True)

def get_device():
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
        return "mps"
    return "cpu"

# ── MusicGen Backend ───────────────────────────────────────────────

class MusicGenBackend:
    def __init__(self, model_name="facebook/musicgen-small", device=None):
        import torch
        from audiocraft.models import MusicGen

        self.device = device or get_device()
        log(f"Loading MusicGen '{model_name}' on {self.device}...")
        # audiocraft handles device placement internally
        self.model = MusicGen.get_pretrained(model_name, device=self.device)
        self.sample_rate = self.model.sample_rate  # 32000
        log(f"MusicGen loaded. Sample rate: {self.sample_rate}")

    def generate(self, request: dict) -> str:
        import torch
        import torchaudio
        from audiocraft.data.audio import audio_write

        rid = request["requestId"]
        prompt = request["prompt"]
        duration = request.get("duration_seconds", 8.0)
        output_dir = request.get("output_dir", tempfile.gettempdir())

        emit({"type": "progress", "requestId": rid, "progress": 0.1,
              "message": "Configuring generation"})

        self.model.set_generation_params(
            duration=min(duration, 30.0),
            use_sampling=True,
            top_k=250,
            temperature=1.0,
            cfg_coef=3.0,
        )

        emit({"type": "progress", "requestId": rid, "progress": 0.2,
              "message": "Generating audio tokens"})

        with torch.inference_mode():
            wav = self.model.generate([prompt])  # [1, C, T]

        emit({"type": "progress", "requestId": rid, "progress": 0.85,
              "message": "Saving WAV"})

        out_path = os.path.join(output_dir, f"{rid}")
        audio_write(out_path, wav[0].cpu(), self.sample_rate,
                    strategy="loudness", loudness_compressor=True)

        if self.device == "cuda":
            torch.cuda.empty_cache()

        return out_path + ".wav"

# ── Stable Audio Open Backend ──────────────────────────────────────

class StableAudioBackend:
    def __init__(self, model_name="stabilityai/stable-audio-open-1.0",
                 device=None, use_small=False):
        import torch
        from stable_audio_tools import get_pretrained_model

        self.device = device or get_device()
        self.use_small = use_small
        actual_model = ("stabilityai/stable-audio-open-small"
                        if use_small else model_name)
        log(f"Loading Stable Audio Open '{actual_model}' on {self.device}...")

        self.model, self.config = get_pretrained_model(actual_model)
        self.sample_rate = self.config["sample_rate"]  # 44100
        self.sample_size = self.config["sample_size"]

        # float32 required for MPS; float16 ok for CUDA
        dtype = torch.float32 if self.device == "mps" else torch.float16
        self.model = self.model.to(device=self.device, dtype=dtype)
        log(f"Stable Audio Open loaded. Sample rate: {self.sample_rate}")

    def generate(self, request: dict) -> str:
        import torch
        import torchaudio
        from einops import rearrange
        from stable_audio_tools.inference.generation import generate_diffusion_cond

        rid = request["requestId"]
        prompt = request["prompt"]
        duration = request.get("duration_seconds", 10.0)
        output_dir = request.get("output_dir", tempfile.gettempdir())

        # Small model: max 11s, 8 steps, pingpong sampler
        # Full model: max 47s, 100 steps, dpmpp-3m-sde sampler
        if self.use_small:
            steps, sampler, cfg = 8, "pingpong", 1.0
            duration = min(duration, 11.0)
        else:
            steps, sampler, cfg = 100, "dpmpp-3m-sde", 7.0
            duration = min(duration, 47.0)

        conditioning = [{
            "prompt": prompt,
            "seconds_start": 0,
            "seconds_total": duration,
        }]
        # Small model only uses seconds_total
        if self.use_small:
            conditioning[0].pop("seconds_start", None)

        emit({"type": "progress", "requestId": rid, "progress": 0.15,
              "message": f"Running {steps}-step diffusion"})

        with torch.inference_mode():
            output = generate_diffusion_cond(
                self.model,
                steps=steps,
                cfg_scale=cfg,
                conditioning=conditioning,
                sample_size=self.sample_size,
                sigma_min=0.3,
                sigma_max=500,
                sampler_type=sampler,
                device=self.device,
            )

        emit({"type": "progress", "requestId": rid, "progress": 0.9,
              "message": "Saving WAV"})

        output = rearrange(output, "b d n -> d (b n)")
        output = (output.to(torch.float32)
                  .div(torch.max(torch.abs(output)).clamp(min=1e-8))
                  .clamp(-1, 1))

        out_path = os.path.join(output_dir, f"{rid}.wav")
        torchaudio.save(out_path, output.cpu(), self.sample_rate)

        if self.device == "cuda":
            torch.cuda.empty_cache()

        return out_path

# ── Main Loop ──────────────────────────────────────────────────────

def build_audio_prompt(request: dict) -> str:
    """Combine structured metadata with the user's text prompt."""
    parts = []
    bpm = request.get("bpm")
    key = request.get("key")
    prompt = request.get("prompt", "")

    if bpm:
        parts.append(f"{int(bpm)} BPM")
    parts.append(prompt)
    if key:
        parts.append(f"in {key}")
    parts.append("high quality, clear, professional")
    return ", ".join(parts)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", default=None)
    parser.add_argument("--backend", default="musicgen",
                        choices=["musicgen", "stable-audio", "stable-audio-small"])
    parser.add_argument("--model", default=None)
    args = parser.parse_args()

    if args.model_dir:
        os.environ["HF_HUB_CACHE"] = args.model_dir
        os.environ["TORCH_HOME"] = args.model_dir

    device = get_device()
    emit({"type": "ready", "device": device, "backend": args.backend})

    backend = None

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            emit({"type": "error", "requestId": "unknown",
                  "error": f"Invalid JSON: {e}"})
            continue

        cmd = request.get("command", "generate")
        rid = request.get("requestId", "unknown")

        try:
            if cmd == "load":
                chosen_backend = request.get("backend", args.backend)
                if chosen_backend == "musicgen":
                    model_name = request.get("model", "facebook/musicgen-small")
                    backend = MusicGenBackend(model_name, device)
                elif chosen_backend == "stable-audio-small":
                    backend = StableAudioBackend(device=device, use_small=True)
                else:
                    backend = StableAudioBackend(device=device, use_small=False)
                emit({"type": "loaded", "requestId": rid,
                      "backend": chosen_backend})

            elif cmd == "generate":
                if backend is None:
                    # Auto-load default
                    if args.backend.startswith("stable"):
                        backend = StableAudioBackend(
                            device=device,
                            use_small=(args.backend == "stable-audio-small"))
                    else:
                        backend = MusicGenBackend(device=device)
                    emit({"type": "loaded", "requestId": rid,
                          "backend": args.backend})

                # Calculate duration in seconds from bars + BPM
                bpm = request.get("bpm", 120)
                bars = request.get("duration_bars", 4)
                beats_per_bar = request.get("beats_per_bar", 4)
                duration_s = (bars * beats_per_bar * 60.0) / bpm

                enriched = dict(request)
                enriched["prompt"] = build_audio_prompt(request)
                enriched["duration_seconds"] = duration_s

                wav_path = backend.generate(enriched)
                emit({"type": "result", "requestId": rid,
                      "wavPath": wav_path, "duration": duration_s,
                      "sampleRate": backend.sample_rate})

            elif cmd == "ping":
                emit({"type": "pong", "requestId": rid})

            elif cmd == "quit":
                emit({"type": "shutdown"})
                break

        except Exception as e:
            log(traceback.format_exc())
            emit({"type": "error", "requestId": rid,
                  "error": f"{type(e).__name__}: {e}"})

if __name__ == "__main__":
    main()
```

### MPS gotchas that will burn you

**MusicGen does not work on PyTorch MPS.** The EnCodec decoder crashes with unsupported ops. There are two viable Apple Silicon paths:

- **MLX port** (`musicgen-mlx` by Andrade Olivier): Generates 8 seconds of audio in ~6 seconds on M4 Max with `musicgen-small`. Uses Apple's MLX framework natively. The T5 encoder still runs on CPU via PyTorch. Install: `pip install mlx musicgen-mlx`.
- **CPU fallback**: Works but is 5–10× slower. Set `device="cpu"` explicitly.

**Stable Audio Open works on MPS** via the `diffusers` or `stable-audio-tools` library, but requires `torch.float32` (not float16 — MPS does not support float64 and some float16 paths trigger errors). Set `PYTORCH_ENABLE_MPS_FALLBACK=1` for any unsupported ops. Avoid batch generation on MPS.

### Python package versions

```
torch>=2.4.0
torchaudio>=2.4.0
audiocraft>=1.3.0          # For MusicGen
stable-audio-tools>=0.1.0  # For Stable Audio Open
diffusers>=0.30.0           # Alternative Stable Audio Open pipeline
einops>=0.7.0
soundfile>=0.12.0
```

---

## 4. Parsing natural language into structured prompts

A small local LLM converts freeform text like "add a shaker here" into structured JSON that combines with DAW metadata before hitting the audio model.

### Model choice: Qwen2.5-1.5B-Instruct

**Qwen2.5-1.5B-Instruct** is the clear winner for this task. At 1.54B parameters, it fits in ~1.1 GB as a Q5_K_M GGUF quantization. Its release notes explicitly highlight **"significant improvements in generating structured outputs especially JSON."** It supports 128K context, is Apache 2.0 licensed, and has GGUF variants on HuggingFace at `Qwen/Qwen2.5-1.5B-Instruct-GGUF`.

### Where to run it: Python sidecar alongside the audio model

Since you already have a Python sidecar running for audio generation, **run the LLM there too** via `llama-cpp-python`. This avoids a second process and shares the sidecar lifecycle. The LLM inference takes 50–200 ms for short extractions on CPU — negligible compared to audio generation time.

```python
# Add to the Python sidecar
from llama_cpp import Llama

class PromptParser:
    SYSTEM_PROMPT = """You are a music production assistant. Parse the user's
request into JSON with these fields:
{
  "instrument": string,
  "character": string,
  "generation_prompt": string
}

Rules:
- "instrument": the sound/instrument requested (shaker, kick, synth pad, etc.)
- "character": sonic character (rhythmic, sustained, punchy, bright, dark, warm)
- "generation_prompt": a detailed prompt for an audio generation model, combining
  instrument, character, and any sonic details. Do NOT include BPM or key — those
  are added separately.

Respond with ONLY valid JSON. No explanation.

Examples:
User: "add a shaker here"
{"instrument":"shaker","character":"rhythmic","generation_prompt":"shaker percussion loop, crisp and rhythmic, tight groove"}

User: "create a marching band percussion loop"
{"instrument":"marching drums","character":"powerful","generation_prompt":"marching band snare and bass drum loop, military cadence, powerful and precise"}

User: "add a swelling synth in C#"
{"instrument":"synth pad","character":"swelling","generation_prompt":"synthesizer pad with slow attack swell, lush and evolving, rich harmonics"}"""

    def __init__(self, model_path: str):
        self.llm = Llama(
            model_path=model_path,
            n_ctx=2048,
            n_gpu_layers=0,  # CPU is fine for 1.5B
            verbose=False,
        )

    def parse(self, user_text: str) -> dict:
        response = self.llm.create_chat_completion(
            messages=[
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": user_text},
            ],
            response_format={"type": "json_object"},
            max_tokens=256,
            temperature=0.1,
        )
        content = response["choices"][0]["message"]["content"]
        return json.loads(content)
```

### How structured metadata merges with the audio prompt

The LLM extracts instrument and character. The sidecar's `build_audio_prompt()` function (shown in Section 3) then prepends BPM and appends key from DAW metadata. The final prompt sent to MusicGen or Stable Audio Open looks like: **"120 BPM, shaker percussion loop, crisp and rhythmic, tight groove, in C# minor, high quality, clear, professional"**.

For an all-Rust approach (no Python LLM), **mistral.rs** provides the most ergonomic API with built-in CUDA and Metal support, auto-detection of model formats, and an OpenAI-compatible interface. Add `mistralrs = "0.4"` to Cargo.toml and point it at a GGUF file. The **llama-cpp-2** crate (`llama-cpp-2 = "0.1"`) offers lower-level control and a `llguidance` feature that enforces valid JSON at the token level via grammar-constrained decoding.

---

## 5. Rust post-processing pipeline: tempo, pitch, trim, normalize

After the sidecar returns a raw WAV, Rust handles tempo-alignment, pitch-shifting, trimming, normalization, and crossfade — all on the main thread with zero Python dependency.

### Crate selection

- **`hound` 3.5.1** — WAV read/write. Simple, stable, Apache 2.0.
- **`ssstretch` 0.1.0** — Signalsmith Stretch Rust bindings via cxx. **MIT licensed.** Time-stretching and pitch-shifting. Requires a C++14 compiler at build time.
- **`dasp` 0.11** — Sample conversion utilities. MIT/Apache 2.0.

**Why not rubberband?** No published Rust crate exists. Rubberband itself is GPL v2+ — a commercial license costs money, and you'd need to write your own FFI bindings. Signalsmith Stretch matches rubberband's quality in the 0.75×–1.5× stretch range and ships MIT.

### Complete post-processing code

**`src-tauri/Cargo.toml` additions:**

```toml
hound = "3.5"
ssstretch = "0.1"
```

**`src-tauri/src/postprocess.rs`:**

```rust
use hound::{WavReader, WavSpec, WavWriter, SampleFormat};
use ssstretch::Stretch;
use std::path::Path;

/// Calculate the pitch shift in semitones between two musical keys.
/// Simple mapping — extend as needed for your DAW's key representation.
fn key_to_semitone(key: &str) -> Option<i32> {
    match key.to_uppercase().trim() {
        "C" => Some(0), "C#" | "DB" => Some(1), "D" => Some(2),
        "D#" | "EB" => Some(3), "E" => Some(4), "F" => Some(5),
        "F#" | "GB" => Some(6), "G" => Some(7), "G#" | "AB" => Some(8),
        "A" => Some(9), "A#" | "BB" => Some(10), "B" => Some(11),
        _ => None,
    }
}

fn pitch_shift_semitones(from_key: &str, to_key: &str) -> f32 {
    match (key_to_semitone(from_key), key_to_semitone(to_key)) {
        (Some(a), Some(b)) => {
            let diff = (b - a + 12) % 12;
            if diff > 6 { diff as f32 - 12.0 } else { diff as f32 }
        }
        _ => 0.0,
    }
}

/// Read a WAV file into per-channel f32 buffers.
fn read_wav(path: &Path) -> Result<(Vec<Vec<f32>>, u32, u16), String> {
    let reader = WavReader::open(path).map_err(|e| format!("WAV read error: {e}"))?;
    let spec = reader.spec();
    let channels = spec.channels as usize;
    let sample_rate = spec.sample_rate;

    let all_samples: Vec<f32> = match spec.sample_format {
        SampleFormat::Float => reader.into_samples::<f32>()
            .map(|s| s.unwrap_or(0.0)).collect(),
        SampleFormat::Int => {
            let max_val = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader.into_samples::<i32>()
                .map(|s| s.unwrap_or(0) as f32 / max_val).collect()
        }
    };

    let samples_per_ch = all_samples.len() / channels;
    let mut per_channel = vec![vec![0.0f32; samples_per_ch]; channels];
    for (i, &s) in all_samples.iter().enumerate() {
        per_channel[i % channels][i / channels] = s;
    }

    Ok((per_channel, sample_rate, spec.channels))
}

/// Write per-channel f32 buffers to a WAV file.
fn write_wav(path: &Path, data: &[Vec<f32>], sample_rate: u32, channels: u16)
    -> Result<(), String>
{
    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 32,
        sample_format: SampleFormat::Float,
    };
    let mut writer = WavWriter::create(path, spec)
        .map_err(|e| format!("WAV write error: {e}"))?;

    let length = data[0].len();
    for i in 0..length {
        for ch in data.iter() {
            writer.write_sample(ch[i]).map_err(|e| format!("Write error: {e}"))?;
        }
    }
    writer.finalize().map_err(|e| format!("Finalize error: {e}"))?;
    Ok(())
}

/// Normalize audio to a target peak level (e.g. 0.95 = 5% headroom).
fn normalize(data: &mut [Vec<f32>], target_peak: f32) {
    let peak = data.iter()
        .flat_map(|ch| ch.iter())
        .fold(0.0f32, |acc, &s| acc.max(s.abs()));
    if peak > 1e-8 {
        let gain = target_peak / peak;
        for ch in data.iter_mut() {
            for s in ch.iter_mut() {
                *s *= gain;
            }
        }
    }
}

/// Apply equal-power crossfade at loop boundaries.
fn apply_fade(data: &mut [Vec<f32>], fade_samples: usize) {
    for ch in data.iter_mut() {
        let len = ch.len();
        let fade = fade_samples.min(len / 2);
        for i in 0..fade {
            let t = i as f32 / fade as f32;
            // Equal-power: use sqrt for smoother fades
            let gain = (t * std::f32::consts::FRAC_PI_2).sin();
            ch[i] *= gain;
            ch[len - 1 - i] *= gain;
        }
    }
}

#[tauri::command]
pub fn post_process_audio(
    input_path: String,
    output_path: String,
    source_bpm: f32,
    target_bpm: f32,
    source_key: String,
    target_key: String,
    target_bars: u32,
    beats_per_bar: u32,
) -> Result<String, String> {
    let input = Path::new(&input_path);
    let output = Path::new(&output_path);

    // 1. Read input WAV
    let (mut audio, sample_rate, channels) = read_wav(input)?;
    let ch_count = audio.len();

    // 2. Calculate time-stretch ratio and target length
    let time_ratio = source_bpm / target_bpm;
    let input_len = audio[0].len();
    let stretched_len = (input_len as f32 * time_ratio) as usize;

    // 3. Calculate pitch shift
    let semitones = pitch_shift_semitones(&source_key, &target_key);

    // 4. Apply time-stretch and pitch-shift with Signalsmith Stretch
    let mut stretch = Stretch::new();
    stretch.preset_default(ch_count as i32, sample_rate as f32);

    if semitones.abs() > 0.01 {
        stretch.set_transpose_semitones(semitones, None);
    }

    let mut output_audio = vec![vec![0.0f32; stretched_len]; ch_count];
    stretch.process_vec(
        &audio,
        input_len as i32,
        &mut output_audio,
        stretched_len as i32,
    );

    // 5. Trim or pad to exact bar length
    let seconds_per_bar = (beats_per_bar as f32 * 60.0) / target_bpm;
    let total_seconds = seconds_per_bar * target_bars as f32;
    let target_samples = (total_seconds * sample_rate as f32) as usize;

    for ch in output_audio.iter_mut() {
        ch.resize(target_samples, 0.0);  // Pad with silence or truncate
    }

    // 6. Normalize to -1 dB headroom
    normalize(&mut output_audio, 0.89);  // ~-1 dB

    // 7. Apply 10 ms fade at loop boundaries
    let fade_samples = (0.010 * sample_rate as f32) as usize;
    apply_fade(&mut output_audio, fade_samples);

    // 8. Write output
    write_wav(output, &output_audio, sample_rate, channels)?;

    Ok(output_path)
}
```

---

## 6. Model weight distribution and download management

Models like MusicGen-small (~2 GB) and Stable Audio Open Small (~1.7 GB) should never be bundled in the installer. **Every major desktop AI app — DiffusionBee, Easy Diffusion, Ollama — downloads models on first use.** This keeps the installer under 100 MB and lets users choose model size.

### Storage location

Use Tauri's `app_data_dir()` — this resolves to `~/Library/Application Support/{bundle_id}` on macOS, `%APPDATA%/{bundle_id}` on Windows, `~/.local/share/{bundle_id}` on Linux. Create a `models/` subdirectory and pass it to the sidecar via command-line argument.

### Rust download manager with progress

```rust
use futures_util::StreamExt;
use reqwest::Client;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

#[derive(serde::Serialize, Clone)]
struct DownloadProgress {
    model_id: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    percent: f64,
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    model_id: String,     // e.g. "facebook/musicgen-small"
    filename: String,      // e.g. "model.safetensors"
    sha256: Option<String>,
) -> Result<String, String> {
    let model_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join(model_id.replace('/', "--"));

    tokio::fs::create_dir_all(&model_dir).await.map_err(|e| e.to_string())?;

    let dest = model_dir.join(&filename);

    // Skip if already downloaded
    if dest.exists() {
        return Ok(dest.to_string_lossy().into());
    }

    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        model_id, filename
    );

    let client = Client::builder()
        .user_agent("tauri-daw/1.0")
        .build().map_err(|e| e.to_string())?;

    // Support resume
    let existing_size = if dest.exists() {
        tokio::fs::metadata(&dest).await.map(|m| m.len()).unwrap_or(0)
    } else { 0 };

    let mut request = client.get(&url);
    if existing_size > 0 {
        request = request.header("Range", format!("bytes={}-", existing_size));
    }

    let response = request.send().await.map_err(|e| e.to_string())?;

    if !response.status().is_success() && response.status().as_u16() != 206 {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let total_bytes = response.content_length().unwrap_or(0) + existing_size;

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&dest).await
        .map_err(|e| e.to_string())?;

    let mut downloaded = existing_size;
    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        // Throttle progress events to ~10 Hz
        if last_emit.elapsed().as_millis() > 100 {
            let _ = app.emit("model-download-progress", DownloadProgress {
                model_id: model_id.clone(),
                downloaded_bytes: downloaded,
                total_bytes,
                percent: if total_bytes > 0 {
                    downloaded as f64 / total_bytes as f64 * 100.0
                } else { 0.0 },
            });
            last_emit = std::time::Instant::now();
        }
    }

    file.flush().await.map_err(|e| e.to_string())?;

    // Verify checksum
    if let Some(expected) = sha256 {
        let actual = format!("{:x}", hasher.finalize());
        if actual != expected {
            tokio::fs::remove_file(&dest).await.ok();
            return Err(format!("Checksum mismatch: expected {expected}, got {actual}"));
        }
    }

    Ok(dest.to_string_lossy().into())
}
```

Add to `Cargo.toml`:

```toml
reqwest = { version = "0.12", features = ["stream"] }
futures-util = "0.3"
sha2 = "0.10"
```

Note: The Python sidecar can also use `huggingface_hub` to handle downloads (it provides resumable downloads, caching, and integrity checks out of the box). Set the `HF_HUB_CACHE` environment variable to the same `models/` directory so both Rust and Python see the same weights.

---

## 7. Realistic performance expectations

### Generation times: what to actually expect

**MusicGen-small (300M) generation benchmarks:**

| Duration         | Clip Length | RTX 3080 (CUDA) | M2 Mac (MLX) | M4 Max (MLX) |
| ---------------- | ----------- | --------------- | ------------ | ------------ |
| 2 bars @ 120 BPM | ~4 s        | **~1–2 s**      | ~5–6 s       | ~3 s         |
| 4 bars @ 120 BPM | ~8 s        | **~2–4 s**      | ~10–13 s     | ~6 s         |
| 8 bars @ 120 BPM | ~16 s       | **~4–8 s**      | ~20–26 s     | ~12 s        |

MusicGen generates 50 autoregressive tokens per second of audio. On CUDA with an RTX 3080 (8704 cores, 10 GB VRAM), expect **2–4× realtime** for the small model. On Apple Silicon via MLX, the M4 Max achieves **~1.3× realtime** (faster than realtime), while the M2 base with fewer GPU cores runs at roughly **~0.6–0.8× realtime**.

**Stable Audio Open 1.0** uses 200 diffusion steps by default. At **~8 steps/second on an RTX 3080**, that's ~25 seconds per generation regardless of output duration (diffusion models generate the full sequence in parallel). Reducing to 50 steps with the DPM++ 3M SDE sampler cuts this to **~6 seconds** with acceptable quality. The **Small variant** needs only **8 steps** with a pingpong sampler — under 2 seconds on CUDA, and even a smartphone ARM chip generates 10 seconds of audio in ~7–8 seconds.

### Quantization that actually works

**Quanto** (from HuggingFace's `optimum-quanto`) is the only quantization library that works on both CUDA and MPS. Apply int8 weight-only quantization to reduce memory by ~2× with minimal quality loss:

```python
from optimum.quanto import quantize, freeze, qint8

quantize(model, weights=qint8)
freeze(model)
```

**`torch.compile()`** delivers a free 20–30% speedup on CUDA by enabling static computation graphs. It does **not** work on MPS. For MusicGen via transformers:

```python
model.generation_config.cache_implementation = "static"
model.forward = torch.compile(model.forward, mode="reduce-overhead")
```

### GPU memory coexistence with wgpu

On NVIDIA, the sidecar and DAW's wgpu visualization share the same GPU. Use `torch.cuda.set_per_process_memory_fraction(0.6)` in the sidecar to cap PyTorch at 60% of VRAM, leaving headroom for wgpu. Call `torch.cuda.empty_cache()` after every generation. On Apple Silicon, unified memory means the OS handles contention automatically — but monitor total memory pressure, as macOS will aggressively swap when under pressure, cratering both inference and UI performance.

---

## 8. End-to-end flow: from button click to timeline clip

Here is the complete sequence when a user types "add a shaker here" and clicks Generate in a project at 120 BPM, key of C, requesting 4 bars.

**Frontend (TypeScript):**

```typescript
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface ProgressPayload {
    request_id: string;
    progress: number;
    message: string;
}

async function generateClip(prompt: string, bpm: number, key: string, bars: number) {
    // Listen for progress updates
    const unlisten = await listen<ProgressPayload>('audio-gen-progress', (e) => {
        updateProgressBar(e.payload.progress * 100, e.payload.message);
    });

    try {
        // Ensure sidecar is running (no-op if already started)
        await invoke('start_sidecar');

        // Request generation — Rust handles sidecar communication
        const rawWavPath: string = await invoke('generate_audio', {
            prompt,
            bpm,
            key,
            durationBars: bars,
        });

        // Post-process in Rust: tempo-align, pitch-shift, trim, normalize
        const finalPath: string = await invoke('post_process_audio', {
            inputPath: rawWavPath,
            outputPath: rawWavPath.replace('.wav', '_final.wav'),
            sourceBpm: bpm, // Generated audio's assumed BPM
            targetBpm: bpm, // Project BPM (same if prompt-conditioned)
            sourceKey: key,
            targetKey: key,
            targetBars: bars,
            beatsPerBar: 4,
        });

        // Place on timeline
        addClipToTimeline(finalPath, currentPlayheadPosition);
    } finally {
        unlisten();
    }
}
```

**The Rust layer** (`generate_audio` from Section 2) writes a JSON request to the sidecar's stdin, waits for progress events (emitted to the frontend via `app.emit()`), and resolves with the WAV path when the sidecar writes a `result` message. The `post_process_audio` command (Section 5) then time-stretches, pitch-shifts, trims to exact bar length, normalizes, and applies fades — all in pure Rust with zero latency penalty.

**The Python sidecar** (Section 3) receives the JSON, runs the LLM prompt parser (Section 4) to extract structured intent, constructs the enriched audio prompt with BPM and key metadata, generates audio via MusicGen or Stable Audio Open, writes the WAV to the app's generated audio directory, and sends the path back as a JSON result line on stdout. The model stays warm in GPU memory between requests — subsequent generations skip the 5–15 second model load entirely.

### What takes how long in practice

For a 4-bar clip at 120 BPM (8 seconds of audio) using MusicGen-small:

| Step                                 | RTX 3080       | M2 Mac (MLX)     |
| ------------------------------------ | -------------- | ---------------- |
| LLM prompt parse (Qwen2.5-1.5B, CPU) | ~150 ms        | ~200 ms          |
| Audio generation                     | **~2–4 s**     | ~10–13 s         |
| WAV write                            | ~50 ms         | ~50 ms           |
| Rust post-processing                 | ~100 ms        | ~100 ms          |
| **Total**                            | **~2.5–4.5 s** | **~10.5–13.5 s** |

Using Stable Audio Open Small (8 diffusion steps) instead, generation drops to **~1–2 s on CUDA** but maxes at 11 seconds of audio.

---

## Conclusion: what to build first and what to watch

**Ship Stable Audio Open Small as your v1.** It generates 44.1kHz stereo in under 2 seconds on CUDA with only 8 diffusion steps, its 1.7 GB weight file downloads quickly, the Stability Community License permits commercial use under $1M revenue, and it works on MPS without the headaches that plague AudioCraft. Add MusicGen-small as an optional "music-focused" backend for users who accept the non-commercial license or when you've trained your own weights on AudioCraft's MIT code.

The **ssstretch** crate (Signalsmith Stretch, MIT) replaces rubberband for time-stretch and pitch-shift without GPL concerns. The `hound` crate handles all WAV I/O. Keep the Python sidecar warm — model loading is the dominant latency, not inference.

Three things to watch: **AudioCraft licensing** may evolve as Meta has historically relaxed model licenses over time (LLaMA went from research-only to permissive). **Stable Audio Open 2.0** weights remain unreleased due to AudioSparx licensing constraints — if they open up, they would substantially outperform 1.0 for music. And **MLX** continues to close the gap on Apple Silicon — the MusicGen-MLX port already runs faster than realtime on M4, and native MLX pipelines for diffusion models would eliminate PyTorch entirely on macOS.
