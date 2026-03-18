# Native AI integration for a Tauri v2 desktop DAW

**The most viable architecture pairs Rust-native LLM inference (via mistral.rs or llama-cpp-2) with Python sidecars for audio/MIDI ML models, all orchestrated through Tauri v2's Channel API and shell plugin.** This guide covers every layer of that stack — from crate selection and model recommendations to IPC patterns and bundling strategies — targeting macOS Apple Silicon, Windows with RTX GPUs, and Linux.

---

## 1. Local LLM inference in the Rust backend

### Crate landscape and recommendations

Six Rust crates compete for local LLM inference. Two stand out for a production DAW.

**mistral.rs** (https://github.com/EricLBuehler/mistral.rs, crate `mistralrs`) is the most feature-complete option. Built on HuggingFace's Candle, it supports **GGUF and safetensors model loading**, CUDA with FlashAttention V2/V3, Metal on Apple Silicon, PagedAttention, continuous batching, streaming, and — critically — **native tool calling** for Llama 3.1, Mistral, and Hermes models. It auto-detects model architecture, quantization format, and chat template. The Rust SDK is straightforward:

```rust
use mistralrs::{IsqType, TextModelBuilder};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let model = TextModelBuilder::new("Qwen/Qwen2.5-7B-Instruct")
        .with_isq(IsqType::Q4K)
        .with_logging()
        .build()
        .await?;
    let response = model.send_chat_request(messages).await?;
    Ok(())
}
```

**llama-cpp-2** (https://github.com/utilityai/llama-cpp-rs, crate `llama-cpp-2`) provides near-direct safe wrappers around the llama.cpp C API. It tracks upstream closely, meaning you get **GBNF grammar support** for structured output immediately when llama.cpp adds features. Enable Metal with `--features metal`, CUDA with `--features cuda`. This is the better choice when you need fine-grained control over sampling, grammar-constrained decoding, or the absolute latest llama.cpp capabilities.

A higher-level alternative, **llama_cpp** (https://github.com/edgenai/llama_cpp-rs, crate `llama_cpp` v0.3.2), offers a simpler API where you can load and run GGUF models in about 15 lines of code, but it lags behind upstream.

The remaining crates serve different niches. **Candle** (https://github.com/huggingface/candle) is the pure-Rust ML framework underpinning mistral.rs — use it directly only if building custom model architectures. **ort** (https://github.com/pykeio/ort, v2.0.0-rc.12) wraps ONNX Runtime and excels for auxiliary ML tasks like embeddings and audio analysis, supporting CUDA, TensorRT, CoreML, and DirectML. **Burn** (https://github.com/tracel-ai/burn, v0.13) is a training-first framework with wgpu/Metal/CUDA backends but lacks pre-built LLM inference pipelines — not suitable for LLM work. **tch-rs** (https://github.com/LaurentMazare/tch-rs) binds LibTorch but requires shipping a ~2GB dependency, making it impractical for desktop distribution.

### Streaming tokens to the React frontend

Tauri v2 provides three backend-to-frontend communication mechanisms. The **Channel API** is purpose-built for streaming and should be your default for token delivery — it guarantees ordered delivery with lower overhead than events.

```rust
use tauri::ipc::Channel;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum LlmEvent {
    Token { text: String },
    ToolCall { name: String, arguments: String },
    Done { total_tokens: u32 },
    Error { message: String },
}

#[tauri::command]
async fn inference(
    prompt: String,
    model_path: String,
    on_event: Channel<LlmEvent>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // Load model via mistral.rs or llama-cpp-2
        let model = load_model(&model_path).map_err(|e| e.to_string())?;
        let mut total = 0u32;
        for token in model.generate(&prompt) {
            on_event.send(LlmEvent::Token {
                text: token.to_string()
            }).map_err(|e| e.to_string())?;
            total += 1;
        }
        on_event.send(LlmEvent::Done { total_tokens: total })
            .map_err(|e| e.to_string())?;
        Ok(())
    }).await.map_err(|e| e.to_string())?
}
```

The frontend consumes this with Tauri's `Channel` class:

```typescript
import { invoke, Channel } from '@tauri-apps/api/core';

type LlmEvent =
    | { event: 'token'; data: { text: string } }
    | { event: 'toolCall'; data: { name: string; arguments: string } }
    | { event: 'done'; data: { totalTokens: number } }
    | { event: 'error'; data: { message: string } };

async function runInference(prompt: string, modelPath: string) {
    const channel = new Channel<LlmEvent>();
    channel.onmessage = (event) => {
        if (event.event === 'token') appendToken(event.data.text);
        if (event.event === 'toolCall') handleToolCall(event.data);
        if (event.event === 'done') finalize(event.data.totalTokens);
    };
    await invoke('inference', { prompt, modelPath, onEvent: channel });
}
```

### Structured output and grammar-constrained decoding

For a DAW agent that must output structured JSON (tool calls, MIDI parameters, audio generation configs), **grammar-constrained decoding** ensures every token the model produces is valid according to a schema.

**llguidance** (https://github.com/guidance-ai/llguidance, crate `llguidance`, MIT license) is the strongest option. It computes token masks in **~50μs per step** for 128K tokenizers, supports JSON Schema, regex, Lark CFGs, and GBNF format. It's already integrated into llama.cpp (via `-DLLAMA_LLGUIDANCE=ON`), SGLang, and ONNX Runtime GenAI. OpenAI credited it as foundational work behind their Structured Outputs feature.

**GBNF grammars** in llama.cpp constrain output at the token level during generation. llama.cpp natively converts JSON Schema to GBNF. Through `llama-cpp-2`, you pass the grammar string directly to the sampler. A companion crate, **gbnf** (https://crates.io/crates/gbnf), converts JSON Schema to GBNF strings in pure Rust.

**xgrammar-rs** (https://crates.io/crates/xgrammar-rs) provides Rust bindings for XGrammar (used by vLLM and SGLang), offering near-zero overhead bitmask generation.

### Best models for local tool calling

For a DAW targeting machines with **8–16GB available for inference**, these GGUF models balance capability with resource usage:

| Model                     | Size (Q4_K_M) | Tool calling quality                        | Source                                      |
| ------------------------- | ------------- | ------------------------------------------- | ------------------------------------------- |
| **Qwen2.5-7B-Instruct**   | ~4.4 GB       | Excellent structured JSON, strong reasoning | `bartowski/Qwen2.5-7B-Instruct-GGUF`        |
| Llama 3.1 8B Instruct     | ~4.9 GB       | Native tool calling support                 | `bartowski/Meta-Llama-3.1-8B-Instruct-GGUF` |
| Hermes 2 Pro (Llama 3 8B) | ~4.9 GB       | Specifically trained for tool use           | `NousResearch/Hermes-2-Pro-Llama-3-8B-GGUF` |
| Mistral 7B Instruct v0.3  | ~4.1 GB       | Good function calling                       | `bartowski/Mistral-7B-Instruct-v0.3-GGUF`   |
| **Qwen2.5-3B-Instruct**   | ~2 GB         | Good for lighter hardware                   | `Qwen/Qwen2.5-3B-Instruct-GGUF`             |

**Qwen2.5-7B-Instruct at Q4_K_M** is the top recommendation — it produces reliable structured JSON, handles complex multi-step tool calling, and fits comfortably alongside audio models in memory. Use **Q5_K_M** (~5.5 GB) for higher fidelity or **Q8_0** (~7.5 GB) when VRAM permits. The primary GGUF providers on HuggingFace are **bartowski** (highest quality imatrix quantizations), official model repos (Qwen, Meta), and **mradermacher**.

### Existing Tauri + LLM prior art

**tauri-plugin-llm** (https://github.com/crabnebula-dev/tauri-plugin-llm) by CrabNebula is the most relevant existing project. It supports GGUF model loading, streaming via a TypeScript `LLMStreamListener` API, runtime model switching, and tool support. It works on all three platforms. However, it uses a **PolyForm license** — verify commercial use terms before adopting.

Other proven patterns include **tauri-local-lm** (https://github.com/dillondesilva/tauri-local-lm), which bundles llama.cpp as a sidecar binary and communicates via HTTP, and several community projects using `ollama-rs` to interface with a user-installed Ollama instance.

---

## 2. Prompt-based AI MIDI generation

### The model landscape for local symbolic music generation

No single model yet handles "create a jazz trio with walking bass" end-to-end from a text prompt. The practical approach combines an LLM for prompt interpretation with a specialized MIDI model for note generation.

**SkyTNT midi-model** (https://github.com/SkyTNT/midi-model, 351+ stars, Apache 2.0) is the strongest candidate for native integration. It's a **0.2B parameter** multi-instrument event transformer with pre-exported ONNX models on HuggingFace (`skytnt/midi-model-tv2o-medium`). The ONNX files include `model_base.onnx` and `model_token.onnx` with KV-cache support. At 0.2B parameters, it runs comfortably on **4GB+ GPU or CPU**. The model generates multi-instrument sequences conditioned on instrument selection, seed patterns, and sampling parameters (temperature, top-p, top-k). LoRA variants exist for specific styles like J-Pop.

**Anticipatory Music Transformer** (https://github.com/jthickstun/anticipation, Apache 2.0) from Stanford offers GPT-based symbolic music with **infilling control** — it can complete compositions, generate accompaniments, and compose from scratch across multiple instruments. Weights are on HuggingFace at `stanford-crfm/music-medium-800k` (~168M parameters). It lacks pre-built ONNX exports but uses a standard GPT architecture exportable via `torch.onnx.export()` or HuggingFace Optimum.

**Magenta's RNN family** (MelodyRNN, ImprovRNN, PerformanceRNN) from Google are lightweight LSTM models that run on CPU. They're mature and well-documented but limited to single-instrument generation (mostly piano) with no text prompt support. Available through `magenta-js` for browser use or Python for backend use.

**MuseNet** (OpenAI) was the gold standard for multi-instrument generation but **weights were never released** and the demo is offline. **MusicTransformer** implementations exist as community PyTorch repos but are research-grade and piano-only. No MIDI generation models exist in **GGUF format** — GGUF is exclusively for text LLMs.

### Running MIDI models through ONNX Runtime in Rust

The **ort** crate (v2.0.0-rc.12) is the recommended runtime since SkyTNT already provides ONNX exports. The `load-dynamic` feature flag loads ONNX Runtime at runtime via dlopen, avoiding shared library packaging issues:

```rust
use ort::{Session, GraphOptimizationLevel};

let session = Session::builder()?
    .with_optimization_level(GraphOptimizationLevel::Level3)?
    .commit_from_file("models/midi_model_base.onnx")?;

let outputs = session.run(ort::inputs!["x" => input_tensor]?)?;
```

The critical implementation detail is **replicating SkyTNT's MIDITokenizerV2 in Rust**. This tokenizer maps integer IDs to MIDI events (note-on, note-off, time-shift, patch-change). The tokenization scheme is event-based and relatively straightforward to port. You must also implement the autoregressive generation loop with top-p/top-k sampling in Rust, feeding output tokens back as input.

For MIDI file creation, **midly** (https://crates.io/crates/midly) is the standard Rust crate — feature-complete for both reading and writing Standard MIDI Files, with zero-copy parsing and multithreaded support. For higher-level musical abstractions, **rust-music** (https://github.com/paveyry/rust-music) provides Notes, Phrases, Parts, and Scores with MIDI export.

### The recommended pipeline for text-to-MIDI

The most practical architecture uses the local LLM as an orchestrator with tool calling:

```
User: "Create a 16-bar jazz trio with walking bass and brush drums"
         │
         ▼
┌─────────────────────────────────────┐
│  Local LLM (Qwen2.5-7B, GGUF)      │  Parses prompt, calls tools:
│  with structured JSON output         │  generate_track("piano", "jazz_comping", 16, "Bb")
│                                      │  generate_track("bass", "walking_bass", 16, "Bb")
│                                      │  generate_track("drums", "jazz_brushes", 16)
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  SkyTNT midi-model (ONNX via ort)   │  Per-instrument autoregressive generation
│  conditioned on instrument + style   │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  Token → MIDI decoder (Rust/midly)  │  Deterministic conversion
└──────────────┬──────────────────────┘
               ▼
         Multi-track MIDI file → Frontend piano roll
```

An alternative short-term approach skips the specialized model entirely: the LLM outputs a JSON array of MIDI note events (`pitch`, `velocity`, `start_tick`, `duration_ticks` per note), which a deterministic Rust function converts to a MIDI file via midly. This is faster to implement and surprisingly effective for simple patterns, though it lacks the musical coherence of a dedicated model.

The Tauri command returns MIDI bytes as base64 or writes to a file:

```rust
#[tauri::command]
async fn generate_midi(
    request: GenerateMidiRequest,
    state: tauri::State<'_, Arc<Mutex<MidiModelState>>>,
    app_handle: tauri::AppHandle,
) -> Result<GenerateMidiResponse, String> {
    let model = state.lock().await;
    // Run ONNX inference per track, merge, encode to MIDI via midly
    let midi_bytes = generate_and_encode(&model.session, &request)?;
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let file_path = app_dir.join("generated.mid");
    std::fs::write(&file_path, &midi_bytes).map_err(|e| e.to_string())?;
    Ok(GenerateMidiResponse {
        midi_base64: base64::engine::general_purpose::STANDARD.encode(&midi_bytes),
        file_path: file_path.to_string_lossy().to_string(),
    })
}
```

---

## 3. AI audio generation from text prompts

### Model comparison for DAW-quality output

**MusicGen** (Meta AudioCraft, https://github.com/facebookresearch/audiocraft) is the best overall choice for a DAW. It offers text-to-music generation at **32kHz** with autoregressive transformer decoding over EnCodec tokens. The model comes in four sizes:

| Variant    | Parameters | VRAM (fp16) | Speed on M4 Max (MLX) | Speed on RTX 4090 (est.) |
| ---------- | ---------- | ----------- | --------------------- | ------------------------ |
| **small**  | 300M       | ~2 GB       | **1.3× realtime**     | ~3–4× realtime           |
| **medium** | 1.5B       | ~5 GB       | 0.6× realtime         | ~1.5–2× realtime         |
| **large**  | 3.3B       | ~8 GB       | 0.3× realtime         | ~0.8–1× realtime         |
| **melody** | 1.5B       | ~5 GB       | N/A                   | ~1.5× realtime           |

The **small model at 300M parameters** is fast enough for interactive preview use. The **melody variant** accepts an audio reference and generates music matching its chroma — ideal for "generate accompaniment to this melody" workflows. Stereo variants exist for all sizes. MusicGen supports **audio continuation** via a sliding-window approach (30s window, 10s slide) for extending beyond the initial generation limit.

An **MLX port** exists for Apple Silicon (https://github.com/andrade0/musicgen-mlx), delivering the best M-series performance. On CUDA, standard PyTorch inference applies. Partial ONNX export is available through `Xenova/musicgen-small` on HuggingFace (quantized for Transformers.js), though full ONNX export for larger models remains problematic.

**Stable Audio Open** (https://github.com/Stability-AI/stable-audio-tools, ~1.21B parameters) uses latent diffusion with a DiT backbone, producing **44.1kHz stereo** audio up to 47 seconds — significantly higher fidelity than MusicGen. It excels at sound design, textures, and production elements. Generation takes ~12 seconds on an RTX 3090 (100 diffusion steps). A **Small variant** optimized for on-device/ARM deployment exists with a permissive commercial license. ControlNet extensions support audio conditioning, chroma control, and envelope control.

**AudioLDM2** (https://github.com/haoheliu/AudioLDM2) is a latent diffusion model with a music-specific variant (`audioldm2-music-665k`). With HuggingFace Diffusers optimizations (fp16 + torch.compile + DPM++ scheduler), it generates **10 seconds of audio in ~1 second** on modern GPUs.

**Bark** (https://github.com/suno-ai/bark, **MIT license**) generates speech, music fragments, and sound effects. Its **bark.cpp** port (https://github.com/PABannier/bark.cpp) provides GGML quantization with Metal and CUDA backends — the closest path to Rust-native audio generation via FFI. Music quality is low, but the MIT license is uniquely attractive for commercial use.

### Critical licensing warning

**AudioCraft model weights are CC-BY-NC 4.0** — non-commercial only. This is the biggest risk for a commercial DAW. The code is MIT, but the trained weights prohibit commercial use without a separate Meta license. **Bark** (MIT) and **Stable Audio Open Small** (Stability AI Community License, commercial allowed) are the safest options for commercial products.

### Running audio generation from Tauri

The Python sidecar approach is the most practical path since all major audio generation models are Python-first. Bundle a PyInstaller-compiled script as a Tauri sidecar:

```python
#!/usr/bin/env python3
# audio_gen.py — compiled with PyInstaller
import argparse, sys
from audiocraft.models import MusicGen
from audiocraft.data.audio import audio_write

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--duration", type=float, default=8.0)
    parser.add_argument("--model", default="facebook/musicgen-small")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    print(f"STATUS:loading:{args.model}", flush=True)
    model = MusicGen.get_pretrained(args.model)
    model.set_generation_params(duration=args.duration, top_k=250, cfg_coef=3.0)

    print(f"STATUS:generating:{args.prompt}", flush=True)
    wav = model.generate([args.prompt])
    audio_write(args.output.rsplit('.wav', 1)[0], wav[0].cpu(),
                model.sample_rate, strategy="loudness", loudness_compressor=True)
    print(f"DONE:{args.output}", flush=True)

if __name__ == "__main__":
    main()
```

The Rust side spawns the sidecar and streams progress:

```rust
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

#[tauri::command]
async fn generate_audio(
    app: tauri::AppHandle,
    prompt: String,
    duration: f32,
    model: String,
    output_dir: String,
) -> Result<String, String> {
    let output_path = format!("{}/gen_{}.wav", output_dir,
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .unwrap().as_millis());

    let (mut rx, _child) = app.shell()
        .sidecar("audio-gen")
        .map_err(|e| e.to_string())?
        .args(&["--prompt", &prompt, "--duration", &duration.to_string(),
                "--model", &model, "--output", &output_path])
        .spawn()
        .map_err(|e| e.to_string())?;

    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stdout(line) = event {
            let line = String::from_utf8_lossy(&line);
            let _ = app.emit("audio-gen-progress", line.to_string());
        }
    }
    Ok(output_path)
}
```

The frontend loads the generated file via Tauri's asset protocol — use `convertFileSrc(filePath)` from `@tauri-apps/api/core` to get a URL playable by the Web Audio API. For audio files (hundreds of KB to several MB), **file-path-based transfer is strongly preferred** over base64 encoding through IPC.

---

## 4. AI audio enhancement and source separation

### Source separation for stem extraction

**Demucs v4** (https://github.com/adefossez/demucs, MIT license) is the industry standard for 4-stem separation (vocals, drums, bass, other). The Hybrid Transformer Demucs (HTDemucs) model uses a dual U-Net operating on both time-domain waveforms and spectrograms with cross-domain Transformer attention. The fine-tuned variant `htdemucs_ft` achieves **SDR 9.20 dB** on MUSDB HQ. Processing a 3-minute song takes ~30 seconds on GPU, ~5 minutes on CPU. A 6-stem variant (`htdemucs_6s`) adds guitar and piano separation.

For Rust-native integration, two production-ready options exist. **stem-splitter-core** (https://crates.io/crates/stem-splitter-core) is a full Rust library for 4-stem separation using HTDemucs ONNX models with auto-detected GPU acceleration (CUDA, CoreML, DirectML). **demucs-rs** (https://github.com/nikhilunni/demucs-rs) is a complete native Rust implementation using the Burn framework with Metal, Vulkan, and WebGPU backends — it even includes a VST3/CLAP plugin and WebAssembly target.

The ONNX export path for Demucs requires handling STFT/iSTFT operations outside the neural network. The **Mixxx GSoC 2025 project** (documented at mixxx.org) successfully exported HTDemucs to ONNX with MSE < 1e-4 versus PyTorch. The **demucs.onnx** project (https://github.com/sevagh/demucs.onnx) provides C++ ONNX Runtime inference with conversion scripts.

**MDX-Net** (available through Ultimate Vocal Remover, https://github.com/Anjok07/ultimatevocalremovergui) excels specifically at vocal isolation — **SDR 15.22** for instrumental, outperforming Demucs on vocals. MDX-Net models are **already in ONNX format** within the UVR ecosystem, simplifying Rust integration via `ort`.

### Audio denoising and enhancement

**DeepFilterNet** (https://github.com/Rikorose/DeepFilterNet) is the top recommendation for Tauri integration because **it has a native Rust library (libDF)**. It processes full-band 48kHz audio in real-time with **~5ms latency** on CPU, using only ~1M parameters. DeepFilterNet3 achieves PESQ 3.5–4.0+. Link it directly into your Tauri binary — no sidecar needed.

**nnnoiseless** (https://crates.io/crates/nnnoiseless) is a pure Rust reimplementation of Mozilla's RNNoise. Ultra-lightweight GRU-based noise suppression with 10–20ms latency, suitable for real-time processing on any hardware. Lower quality than DeepFilterNet but zero external dependencies.

For AI mastering, **Matchering 2.0** (https://github.com/sergree/matchering, MIT license) performs reference-based mastering — matching RMS, frequency response, peak amplitude, and stereo width against a reference track. It's Python-based and best called through the sidecar pattern.

**Audio inpainting** (filling gaps or completing audio) is still research-stage. CQT-Diff+ handles gaps up to 300ms using diffusion models, but no production-ready ONNX-exportable inpainting models exist. For a DAW MVP, crossfade interpolation is more practical.

**DDSP** (https://github.com/magenta/ddsp) by Google Magenta offers real-time timbre transfer via its **DDSP-VST plugin**, which uses TFLite for lightweight inference. **MIDI-DDSP** (https://github.com/magenta/midi-ddsp) provides MIDI-controlled synthesis of 13 instruments.

### Piping audio through the Tauri stack

The file-path pattern is recommended for offline processing (separation, mastering). For real-time processing (denoising), link the Rust library directly and process audio buffers in-memory:

```rust
use tauri::ipc::Channel;

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
enum ProcessingEvent {
    Progress { percent: u8, stage: String },
    Complete { output_path: String },
}

#[tauri::command]
async fn separate_stems(
    state: tauri::State<'_, Arc<Mutex<AudioProcessor>>>,
    input_path: String,
    output_dir: String,
    on_progress: Channel<ProcessingEvent>,
) -> Result<StemPaths, String> {
    let processor = state.lock().await;
    on_progress.send(ProcessingEvent::Progress {
        percent: 0, stage: "Loading audio".into()
    }).ok();
    // 1. Read audio with symphonia
    // 2. Run ONNX inference (or demucs-rs Burn inference)
    // 3. Write stems to output_dir with hound
    on_progress.send(ProcessingEvent::Complete {
        output_path: output_dir.clone()
    }).ok();
    Ok(StemPaths { vocals, drums, bass, other })
}
```

Tauri v2's IPC is JSON-based, so sending large audio buffers (>1MB) as base64-encoded JSON is slow. Always prefer writing to disk and returning file paths. For real-time use cases where the ML model runs in-process (DeepFilterNet), process audio in the Rust backend via **cpal** for audio I/O and **rubato** for resampling, keeping data entirely in Rust memory.

Key audio ecosystem crates for the backend: **symphonia** (pure Rust audio decoding for MP3, FLAC, WAV, OGG), **cpal** v0.15 (cross-platform audio I/O), **rubato** v0.15 (resampling), **hound** v3.5 (WAV writing), **ndarray** v0.16 (tensor operations).

---

## 5. The Python sidecar pattern in Tauri v2

### Configuring the Tauri v2 shell plugin

The sidecar system lives in Tauri v2's shell plugin. Install it:

```toml
# Cargo.toml
[dependencies]
tauri-plugin-shell = "2"
```

```rust
// lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error running app");
}
```

Define sidecar binaries in `tauri.conf.json` under the top-level `bundle` key (not nested under `tauri` as in v1):

```json
{
    "bundle": {
        "externalBin": ["binaries/ml-sidecar"]
    }
}
```

Every sidecar binary must have a **target-triple suffix**. For `"binaries/ml-sidecar"`, Tauri expects files at `src-tauri/binaries/` named:

- `ml-sidecar-aarch64-apple-darwin` (macOS ARM)
- `ml-sidecar-x86_64-apple-darwin` (macOS Intel)
- `ml-sidecar-x86_64-unknown-linux-gnu` (Linux)
- `ml-sidecar-x86_64-pc-windows-msvc.exe` (Windows)

The permissions system in Tauri v2 replaces the v1 allowlist. Configure in `src-tauri/capabilities/default.json`:

```json
{
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "default",
    "windows": ["main"],
    "permissions": [
        "core:default",
        {
            "identifier": "shell:allow-spawn",
            "allow": [
                {
                    "name": "binaries/ml-sidecar",
                    "sidecar": true,
                    "args": true
                }
            ]
        },
        "shell:allow-stdin-write"
    ]
}
```

### Building the Python sidecar with PyInstaller

The proven workflow: write a Python ML server script, compile it with PyInstaller `--onefile`, place the binary in `src-tauri/binaries/` with the correct target-triple suffix.

```bash
# Automated build with correct naming
TARGET=$(rustc --print host-tuple)
pyinstaller --onefile --name ml-sidecar-$TARGET ml_server.py
cp dist/ml-sidecar-$TARGET src-tauri/binaries/
```

**You must use `--onefile` mode.** The `--onedir` default creates a folder with an `_internal/` subdirectory that Tauri's sidecar resolver cannot find at runtime — this is the most common gotcha documented by multiple Tauri+Python projects.

Size expectations: a minimal Python + FastAPI binary is ~40 MB. Adding PyTorch and AudioCraft balloons to **200–500 MB**. Use `--hidden-import` for packages PyInstaller misses (common with ML libraries). On macOS, PyInstaller doesn't produce universal2 binaries — build separately for arm64 and x86_64 or combine with `lipo`.

### IPC patterns ranked by use case

**stdin/stdout JSON-line protocol** is the default choice for most ML interactions. The Python process reads newline-delimited JSON from stdin and writes responses to stdout. This is reliable, simple, and handles streaming naturally (one JSON line per LLM token or progress update). The critical detail: **always `flush=True`** on Python prints, or use `sys.stdout.flush()`.

```python
# Python sidecar: JSON-line protocol
import sys, json

for line in sys.stdin:
    request = json.loads(line.strip())
    if request["command"] == "generate":
        for token in generate(request["input"]):
            print(json.dumps({"type": "token", "data": token}), flush=True)
        print(json.dumps({"type": "done"}), flush=True)
```

**Local HTTP server** (FastAPI/Flask running on localhost) suits complex APIs with multiple endpoints. The Python sidecar starts a FastAPI server on a random port, reports the port via stdout, and Tauri communicates via HTTP. This enables SSE streaming and independent testing. However, Tauri v2's WebView CSP blocks direct `fetch()` to localhost — use `@tauri-apps/plugin-http` to bypass CORS, or route all HTTP through Rust commands with `reqwest`.

**Shared memory** is essential for large audio buffers. Python's `multiprocessing.shared_memory` and Rust's `shared_memory` crate (v0.12) provide cross-process memory mapping. For a 10-second stereo 48kHz float32 buffer (~3.7 MB), shared memory avoids serialization overhead entirely. Signal readiness via stdout or a Unix domain socket. Benchmarks show shared memory ring buffers are **~3× faster than Unix sockets and ~60× faster than D-Bus** for 64K packets.

| Data type                  | Recommended pattern              | Rationale                             |
| -------------------------- | -------------------------------- | ------------------------------------- |
| LLM tokens, MIDI events    | stdin/stdout JSON-line           | Low volume, natural streaming         |
| Audio file generation      | stdin/stdout + file path return  | Large output, write once              |
| Real-time audio buffers    | Shared memory + socket signaling | Zero-copy, minimal latency            |
| Complex multi-endpoint API | Local HTTP (FastAPI)             | SSE streaming, testable independently |

### Alternative to sidecars: PyO3 embedding

**PyO3** (https://github.com/PyO3/pyo3, crate `pyo3` v0.23) embeds Python directly in the Rust process, eliminating IPC overhead. However, **the Python GIL blocks Rust threads** — a critical problem for a real-time audio DAW. Python crashes can also take down the entire application. PyO3 is not recommended for this use case. The sidecar pattern provides crash isolation, independent lifecycle management (restart the ML process without restarting the DAW), and simpler debugging.

---

## 6. Recommended architecture and decision framework

### When to use Rust-native inference versus Python sidecars

The decision hinges on three factors: **model availability in Rust-compatible formats**, **latency requirements**, and **deployment complexity**.

**Use Rust-native inference** (mistral.rs, llama-cpp-2, ort) for:

- LLM inference — GGUF models load directly, streaming is fast, no Python dependency. This is the clear winner.
- Source separation — `stem-splitter-core` or `demucs-rs` provide full Rust pipelines with GPU acceleration.
- Audio denoising — DeepFilterNet's `libDF` is already Rust-native with 5ms latency.
- MIDI generation — SkyTNT's ONNX models load via `ort` with minimal overhead.
- Anything requiring <100ms response time or real-time processing.

**Use Python sidecars** (PyInstaller + stdin/stdout or FastAPI) for:

- Audio generation (MusicGen, Stable Audio, AudioLDM2) — these models have no Rust-native runtime and complex dependencies (EnCodec, T5 encoders, diffusion schedulers).
- AI mastering (Matchering) — Python-only with numpy/scipy dependencies.
- Any model that exists only as a Python package with no ONNX export.
- Experimental or rapidly evolving models where Python lets you iterate faster.

**Use hybrid approaches** for:

- MIDI generation pipeline — Rust-native LLM (tool calling) + Rust-native ONNX inference for the MIDI model + midly for MIDI encoding, all in one process.
- Source separation + audio generation — Rust-native Demucs for stems, Python sidecar for MusicGen to generate new parts.

### The full stack architecture

```
┌─────────────────────────────────────────────────────────┐
│                  React + TypeScript UI                    │
│  - Piano roll, waveform display, prompt input             │
│  - Web Audio API for playback                             │
│  - @tauri-apps/api/core (invoke, Channel, convertFileSrc) │
├─────────────────────────────────────────────────────────┤
│                 Tauri v2 Rust Backend                      │
│                                                           │
│  ┌──────────────────────┐  ┌────────────────────────┐    │
│  │  LLM Engine          │  │  Audio Pipeline         │    │
│  │  (mistral.rs)        │  │  (cpal, symphonia,      │    │
│  │  - Tool calling      │  │   rubato, hound)        │    │
│  │  - JSON structured   │  │  - DeepFilterNet        │    │
│  │    output            │  │    (libDF, real-time)    │    │
│  │  - GGUF models       │  │  - Demucs-rs / ort      │    │
│  └──────────────────────┘  └────────────────────────┘    │
│                                                           │
│  ┌──────────────────────┐  ┌────────────────────────┐    │
│  │  MIDI Engine         │  │  Sidecar Manager        │    │
│  │  (ort + midly)       │  │  (tauri-plugin-shell)   │    │
│  │  - SkyTNT ONNX model │  │  - Lifecycle control    │    │
│  │  - Token→MIDI decode │  │  - stdin/stdout IPC     │    │
│  └──────────────────────┘  │  - Health checking      │    │
│                             └────────────┬───────────┘    │
├─────────────────────────────────────────┬────────────────┤
│                                         │                 │
│  ┌──────────────────────────────────────▼──────────────┐ │
│  │          Python Sidecar (PyInstaller --onefile)       │ │
│  │  - MusicGen / Stable Audio / AudioLDM2               │ │
│  │  - Matchering (AI mastering)                          │ │
│  │  - Any Python-only ML models                          │ │
│  │  - Communicates via JSON-line on stdin/stdout          │ │
│  │  - Shared memory for large audio buffers              │ │
│  └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Structuring the Tauri command layer

Organize commands into focused modules, each managing its own model state:

```rust
// src-tauri/src/lib.rs
mod llm;      // LLM inference commands (mistral.rs)
mod midi;     // MIDI generation commands (ort + midly)
mod audio;    // Audio processing commands (demucs, denoising)
mod sidecar;  // Python sidecar management

pub fn run() {
    let llm_state = llm::init_state("models/qwen2.5-7b-q4km.gguf");
    let midi_state = midi::init_state("models/midi_model_base.onnx");
    let audio_state = audio::init_state("models/htdemucs.onnx");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(llm_state)
        .manage(midi_state)
        .manage(audio_state)
        .invoke_handler(tauri::generate_handler![
            llm::inference, llm::tool_call,
            midi::generate_midi, midi::extend_midi,
            audio::separate_stems, audio::denoise,
            audio::generate_audio,  // delegates to Python sidecar
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}
```

Load models lazily on first use rather than at startup — a user who only needs stem separation shouldn't wait for the LLM to load. Cache loaded models in `Arc<Mutex<Option<Model>>>` state and initialize on demand. For model downloads, use a registry pattern (like stem-splitter-core's approach) that fetches from HuggingFace on first use and caches in the app data directory.

### Key trade-offs at a glance

| Approach                          | Startup time               | Memory overhead  | Deployment size         | Crash isolation | Latency             |
| --------------------------------- | -------------------------- | ---------------- | ----------------------- | --------------- | ------------------- |
| **Rust-native (mistral.rs, ort)** | Model load only            | Minimal          | +50–200 MB per model    | No (in-process) | Lowest              |
| **Python sidecar (PyInstaller)**  | Process spawn + model load | Separate process | +200–500 MB per sidecar | Yes             | ~10ms IPC           |
| **PyO3 embedded**                 | Python init + model load   | GIL contention   | +100–300 MB             | No              | Low but GIL-blocked |
| **Ollama/external service**       | None (user-managed)        | External         | 0 (user installs)       | Yes             | HTTP overhead       |

### Known Tauri v2 gotchas

- The `bundle.externalBin` path in `tauri.conf.json` is relative to `src-tauri/`, but when calling `app.shell().sidecar("name")` from Rust, use only the filename without the directory prefix.
- In JavaScript, `Command.sidecar()` takes the full path from the config (`"binaries/ml-sidecar"`), while Rust's `app.shell().sidecar()` takes just `"ml-sidecar"`. This asymmetry catches many developers.
- Tauri v2's IPC serializes everything as JSON — there is no binary transfer. An open feature request (tauri-apps/tauri#13405) tracks array buffer support in events. Until resolved, use file paths for audio data.
- `SharedArrayBuffer` is **not available** in Tauri's WebView due to security restrictions.
- PyInstaller `--onefile` binaries use a bootloader that creates a child process — the PID Tauri kills may differ from the actual Python process PID. Implement a stdin-based shutdown command (`{"command":"shutdown"}`) for clean termination.
- Tauri v2's WebView CSP blocks `fetch()` to `http://localhost:*`. If using a FastAPI sidecar, route requests through Rust commands with `reqwest`, or use `@tauri-apps/plugin-http`.

### Essential dependency summary

```toml
[dependencies]
# Core Tauri
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }

# LLM inference (choose one)
mistralrs = "0.4"                    # Full-featured LLM engine
# OR
llama-cpp-2 = "0.1"                 # Direct llama.cpp bindings

# Structured output
llguidance = "0.7"                   # Grammar-constrained decoding

# ONNX Runtime (for MIDI models, audio models)
ort = { version = "2.0.0-rc.12", features = ["load-dynamic"] }
ndarray = "0.16"

# MIDI
midly = { version = "0.5", features = ["std"] }

# Audio processing
symphonia = { version = "0.5", features = ["mp3", "flac", "wav", "ogg"] }
cpal = "0.15"
rubato = "0.15"
hound = "3.5"

# Source separation (choose one)
# stem-splitter-core = "0.1"        # ONNX-based Demucs
# OR use demucs-rs for Burn-based native inference

# Utilities
base64 = "0.22"
reqwest = { version = "0.12", features = ["json"] }
```

### A phased implementation roadmap

**Phase 1 (MVP):** Integrate `mistral.rs` for LLM tool calling with Qwen2.5-7B Q4_K_M. Implement the LLM-to-JSON-to-MIDI pipeline using midly. Add DeepFilterNet for real-time denoising. Build the Python sidecar for MusicGen-small.

**Phase 2 (Enhanced):** Add SkyTNT midi-model via `ort` for higher-quality MIDI generation. Integrate `stem-splitter-core` or `demucs-rs` for source separation. Add Stable Audio Open via the Python sidecar for sound design.

**Phase 3 (Production):** Implement grammar-constrained decoding with `llguidance` for robust tool calling. Add shared memory IPC for audio buffer transfer. Optimize model loading with lazy initialization and a download registry. Build platform-specific PyInstaller sidecars in CI for all targets.

The key insight driving this architecture: **keep the real-time audio path entirely in Rust** (cpal, DeepFilterNet, audio I/O), use Rust-native inference for latency-sensitive ML (LLM, MIDI), and delegate heavyweight batch processing (audio generation, mastering) to Python sidecars where the rich ecosystem outweighs the IPC overhead.
