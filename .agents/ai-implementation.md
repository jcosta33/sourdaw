# AI music production in a React/TypeScript/Tauri v2 DAW

**The most viable architecture for AI-powered DAW features uses a three-tier system: lightweight browser-side inference via ONNX Runtime Web and Essentia.js for real-time analysis, Rust-native processing via the `ort` crate and `mistral.rs` for heavy inference, and cloud APIs (Claude, OpenAI, Replicate) as an optional premium tier.** This approach ensures offline capability, low latency for interactive features, and access to state-of-the-art models when needed. The critical constraint is Linux — WebKitGTK lacks WebGPU support, making the Rust tier essential as a universal fallback. Every feature described below has been validated against current library versions and working implementations as of early 2026.

---

## Decision table: recommended tier for each feature

| Feature | Primary Tier | Fallback | Key Library | Latency Target |
|---|---|---|---|---|
| **Spectrum/spectrogram** | Web | — | Web Audio AnalyserNode | Real-time (<16ms) |
| **BPM/beat detection** | Web | Rust | Essentia.js / `bpm-analyzer` | <2s offline |
| **Key detection** | Web | Rust | Essentia.js KeyExtractor / `stratum-dsp` | <2s offline |
| **Pitch detection** | Web | Rust | CREPE tiny ONNX / `pitch-detection` crate | <100ms per frame |
| **Audio-to-MIDI** | Web | Rust | `@spotify/basic-pitch` / `ort` + nmp.onnx | <10s per song |
| **Stem separation** | Rust | Cloud | `demucs-rs` or `ort` + Demucs ONNX | 1-2× song duration |
| **Pitch correction** | Rust | — | `ort` + CREPE + `rubato` | Near real-time |
| **AI EQ / spectral matching** | Rust | Web | `realfft` + custom algorithm | <500ms |
| **Reference mastering** | Rust | Cloud | `realfft` + loudness matching | <5s |
| **Intelligent gain staging** | Rust | Web | `realfft` + EBU R128 | <1s |
| **NL → DAW tool calls** | Rust | Cloud → Web | `mistral.rs` Qwen3-8B / Claude API / WebLLM (Hermes-2-Pro) | <3s |
| **MIDI generation** | Web | Cloud | Magenta.js MusicVAE / Claude tool use | <2s |

**Priority order for implementation** (maximum user impact first): spectrum analysis → BPM/key detection → stem separation → audio-to-MIDI → NL→tool calls → pitch detection → MIDI generation → AI EQ → gain staging → pitch correction → reference mastering.

---

## 1. Web API / WebAssembly tier

### WebLLM (@mlc-ai/web-llm) — local LLM in the browser

**Version `0.2.82`**, Apache-2.0 license, **17.6k GitHub stars**. Provides an OpenAI-compatible chat completions API running entirely in-browser via WebGPU.

```bash
npm install @mlc-ai/web-llm
```

**DAW implementation uses `Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC`** — this model supports native one-round function calling via the `tools` + `tool_choice` API. Use `CreateWebWorkerMLCEngine` to run inference off the main thread, then pass tools and read `tool_calls` from the last streamed chunk:

```typescript
import { CreateWebWorkerMLCEngine, type ChatCompletionTool } from "@mlc-ai/web-llm";

const engine = await CreateWebWorkerMLCEngine(
  new Worker(new URL("./webllm-worker.ts", import.meta.url), { type: "module" }),
  "Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC",
  { initProgressCallback: (p) => setLoadProgress(p.progress) },
  { context_window_size: 4096 }
);

const dawTools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "addTrack",
      description: "Add a new track",
      parameters: { type: "object", properties: { name: { type: "string" }, kind: { type: "string" } }, required: ["name", "kind"] }
    }
  },
  // ... all DAW tools
];

const asyncChunks = await engine.chat.completions.create({
  messages: [
    { role: "system", content: dawSystemPrompt },
    { role: "user", content: userMessage }
  ],
  tools: dawTools,
  tool_choice: "auto",
  stream: true,
  stream_options: { include_usage: true },
  temperature: 0.1,
  seed: 0,
});

let lastChunk;
for await (const chunk of asyncChunks) {
  if (!chunk.usage) lastChunk = chunk; // usage chunk is always last
}
// lastChunk.choices[0].delta.tool_calls → array of tool calls
```

**Supported models and memory requirements:**

| Model | Quantized Size | VRAM | Tokens/sec (M3 Max) | Tool Calling |
|---|---|---|---|---|
| **Hermes-2-Pro-Llama-3-8B q4f16_1** | **~4 GB** | **~6 GB** | **~41** | **✅ Native (recommended)** |
| TinyLlama-1.1B q4f16_1 | ~600 MB | ~1.5 GB | ~100+ | ❌ No |
| Phi-3.5-mini-instruct q4f16_1 | ~1.8 GB | ~3 GB | ~71 | ❌ JSON mode only |
| Llama-3.1-8B-Instruct q4f16_1 | ~4 GB | ~6 GB | ~41 | ⚠️ Limited |
| Mistral-7B q4f16_1 | ~3.5 GB | ~5 GB | ~45 | ❌ No |

The worker file is minimal:

```typescript
// webllm-worker.ts
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
```

**Critical Tauri WebView compatibility for WebGPU:**

| Platform | WebView | WebGPU Status |
|---|---|---|
| Windows | WebView2 (Chromium) | **✅ Yes** — since Edge 113 |
| macOS | WKWebView | **✅ Yes** — macOS Tahoe 26+ only |
| Linux | WebKitGTK | **❌ No** — not available, timeline unclear |

**Linux is a hard blocker for WebLLM.** The fallback chain must route to Rust-tier inference (mistral.rs) or cloud APIs on Linux. Always check `navigator.gpu` before initializing.

### Transformers.js (@huggingface/transformers) — ML models in the browser

**Version `3.8.1`** (v4.0.0 in preview), MIT license. Runs ONNX models with WebGPU acceleration — up to **100× faster than WASM** for supported models.

```bash
npm install @huggingface/transformers
```

Supports **1,850+ models** across 27 task types. For audio: automatic speech recognition (Whisper), audio classification (AST), text-to-speech (SpeechT5), and MusicGen. **No built-in pitch or beat detection models** — use dedicated libraries for those. Whisper-tiny runs at ~41 MB and handles real-time transcription for voice commands. All inference uses ONNX Runtime Web internally. Run heavy models in Web Workers:

```typescript
// worker.ts
import { pipeline } from '@huggingface/transformers';
let transcriber = null;
self.onmessage = async (e) => {
  if (e.data.type === 'load') {
    transcriber = await pipeline('automatic-speech-recognition',
      'onnx-community/whisper-tiny.en', { device: 'webgpu' });
    self.postMessage({ type: 'loaded' });
  }
  if (e.data.type === 'transcribe') {
    const result = await transcriber(e.data.audio, { return_timestamps: 'word' });
    self.postMessage({ type: 'result', data: result });
  }
};
```

### ONNX Runtime Web (@microsoft/onnxruntime-web) — general ONNX inference

**Version `1.24.3`**, MIT license. The backbone for running custom ONNX models in-browser.

```bash
npm install onnxruntime-web
```

**Vite configuration is critical** — WASM files must be explicitly copied:

```typescript
// vite.config.ts
import { viteStaticCopy } from 'vite-plugin-static-copy';
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/onnxruntime-web/dist/*.wasm', dest: 'wasm' },
        { src: 'node_modules/onnxruntime-web/dist/*.jsep.*', dest: 'wasm' },
      ],
    }),
  ],
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
```

Set the WASM path at runtime: `ort.env.wasm.wasmPaths = '/wasm/';`. Use execution provider fallback: `executionProviders: ['webgpu', 'wasm']`. The **4 GB WASM memory limit** constrains maximum model size in the browser.

**Key audio ONNX models confirmed working in-browser:**

| Model | Package/Source | Size | Browser Status |
|---|---|---|---|
| Basic Pitch | `@spotify/basic-pitch` | ~10 MB | ✅ Production-ready |
| CREPE tiny | onnxcrepe GitHub releases | ~2-3 MB | ✅ Excellent |
| CREPE full | onnxcrepe GitHub releases | ~89 MB | ⚠️ Heavy but feasible |
| Demucs htdemucs | demucs-onnx / free-music-demixer | 81-160 MB | ⚠️ WebGPU required, slow |

### Essentia.js — comprehensive music analysis via WebAssembly

**Version `0.1.3`**, **AGPL-3.0 license** (copyleft — requires open-sourcing your DAW or purchasing a commercial license from UPF Barcelona). WebAssembly port of the Essentia C++ library with **200+ algorithms**.

```bash
npm install essentia.js
```

The WASM module is ~2-4 MB. Provides production-grade implementations of beat tracking, key detection, BPM estimation, pitch detection, and spectral analysis. Performance benchmarks show most algorithms run in **1.5-6.8% of input audio duration** on a 5-second clip — fast enough for near-real-time use in a Web Worker.

```typescript
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
const essentia = new Essentia(EssentiaWASM);

// Key detection
const audioVector = essentia.arrayToVector(audioBuffer.getChannelData(0));
const key = essentia.KeyExtractor(audioVector, true, 4096, 4096, 12, 3500, 60, 25, 0.2,
  'bgate', 44100, 0.0001, 0.6, 'cosine', 'hann');
console.log(`${key.key} ${key.scale}`, key.strength); // "C minor" 0.85

// BPM detection
const bpm = essentia.PercivalBpmEstimator(audioVector, 1024, 2048, 256, 50, 44100);
console.log(bpm.bpm); // 128

// Pitch detection (pYIN)
const pitch = essentia.PitchYinProbabilistic(audioVector, 4096, 256, 0.1, 'zero', false, 44100);
```

**⚠️ The AGPL-3.0 license is a significant concern for a commercial DAW.** If distributing as closed-source, you must either obtain a commercial license or replace Essentia.js with MIT-licensed alternatives (Meyda for features, pitchy/pitchfinder for pitch, realtime-bpm-analyzer for BPM). The Rust-tier equivalents (pure Rust crates) are all MIT/Apache-2.0.

### Magenta.js (@magenta/music) — MIDI generation

**Version `1.23.1`**, Apache-2.0 license. **Largely unmaintained** (Google's focus shifted to Lyria), but pre-trained models remain hosted and functional.

```bash
npm install @magenta/music
```

Key models for DAW MIDI generation:

- **MusicVAE** (`mel_2bar_small`, ~2-5 MB): Sample novel melodies, interpolate between sequences, humanize drum patterns via GrooVAE
- **MusicRNN** (`melody_rnn`, `drums_rnn`): Continue/extend existing MIDI sequences
- **MidiMe**: Personalize generation to match user style (trains in-browser)

```typescript
import * as mm from '@magenta/music';
const mvae = new mm.MusicVAE(
  'https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/mel_2bar_small');
await mvae.initialize();
const samples = await mvae.sample(1);
// Convert to MIDI: mm.sequenceProtoToMidi(samples[0])

const rnn = new mm.MusicRNN(
  'https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/melody_rnn');
await rnn.initialize();
const continued = await rnn.continueSequence(inputSequence, 32, 1.0);
```

### Additional web-tier analysis libraries

| Library | Version | License | Purpose | Install |
|---|---|---|---|---|
| **Tone.js** | 15.1.22 | MIT | Audio synthesis, DAW-like transport, effects | `npm i tone` |
| **Tonal.js** | 6.1.0 | MIT | Music theory (scales, chords, keys — not audio analysis) | `npm i tonal` |
| **Meyda** | 5.6.3 | MIT | Lightweight audio features (RMS, MFCC, chroma, spectral) | `npm i meyda` |
| **pitchy** | 4.1.0 | MIT | McLeod pitch detection, returns Hz + clarity | `npm i pitchy` |
| **pitchfinder** | 2.3.4 | **GPL-v3** | YIN, McLeod, AMDF pitch detection | `npm i pitchfinder` |
| **realtime-bpm-analyzer** | latest | MIT | Real-time BPM from audio stream | `npm i realtime-bpm-analyzer` |
| **web-audio-beat-detector** | latest | MIT | Offline AudioBuffer BPM analysis | `npm i web-audio-beat-detector` |
| **@tonejs/midi** | latest | MIT | MIDI file parse/create, JSON↔MIDI | `npm i @tonejs/midi` |
| **midi-writer-js** | latest | MIT | Programmatic MIDI file generation | `npm i midi-writer-js` |

Web Audio API's **AnalyserNode** handles real-time spectrum/spectrogram natively with zero dependencies:

```typescript
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 2048; // 1024 frequency bins at ~21.5 Hz resolution
const freqData = new Float32Array(analyser.frequencyBinCount);

function drawSpectrum() {
  analyser.getFloatFrequencyData(freqData); // dB values per bin
  // Remap to log scale for perceptual frequency display
  requestAnimationFrame(drawSpectrum);
}
```

---

## 2. Rust/Tauri local inference tier

### The `ort` crate — ONNX Runtime for Rust

**Version `2.0.0-rc.12`** (wraps ONNX Runtime 1.24), described as production-ready despite RC status. Used by SurrealDB, Bloop, Google Magika.

```toml
[dependencies]
ort = { version = "2.0.0-rc.12", features = ["half"] }
ndarray = "0.15"
# GPU acceleration:
# ort = { version = "2.0.0-rc.12", features = ["half", "cuda"] }       # NVIDIA
# ort = { version = "2.0.0-rc.12", features = ["half", "directml"] }   # Windows GPU
# ort = { version = "2.0.0-rc.12", features = ["half", "coreml"] }     # macOS
```

Execution providers cascade automatically — configure once and the runtime falls back gracefully:

```rust
use ort::{ep, session::Session};

fn create_session(model_path: &str) -> anyhow::Result<Session> {
    Session::builder()?
        .with_execution_providers([
            ep::CUDA::default().build(),
            ep::DirectML::default().build(),
            ep::CoreML::default()
                .with_compute_units(ep::coreml::ComputeUnits::CPUAndNeuralEngine)
                .build(),
        ])?
        .commit_from_file(model_path)
}
```

`Session` is `Send + Sync`, so it works naturally with `tokio::spawn_blocking` for non-blocking Tauri commands. Stream results back to the frontend using **Tauri Channels** (ordered, fast) rather than the event system:

```rust
use tauri::ipc::Channel;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum InferenceEvent {
    Progress { percent: f32 },
    Complete { result: Vec<f32> },
}

#[tauri::command]
async fn run_stem_separation(
    audio_path: String,
    on_progress: Channel<InferenceEvent>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let session = DEMUCS_SESSION.get().expect("Model not loaded");
        // Process in segments, emit progress per segment
        for (i, segment) in segments.iter().enumerate() {
            let output = session.run(ort::inputs![segment]?)?;
            on_progress.send(InferenceEvent::Progress {
                percent: (i as f32 / total as f32) * 100.0
            }).ok();
        }
        on_progress.send(InferenceEvent::Complete { result: final_output }).ok();
        Ok(())
    }).await.map_err(|e| e.to_string())?
}
```

### Demucs stem separation in Rust

Two proven approaches exist:

1. **`demucs-rs`** (github.com/nikhilunni/demucs-rs) — Full Rust implementation using the Burn deep learning framework. Ships as CLI, WASM+WebGPU browser app, and **VST3/CLAP plugin**. Supports htdemucs, htdemucs_6s, htdemucs_ft. Models auto-download from Hugging Face. Best for a DAW that wants native integration.

2. **Mixxx GSOC 2025 self-contained ONNX export** — The ONNX model includes STFT/ISTFT internally, so it can be loaded directly with the `ort` crate without reimplementing signal processing. Quality verified within 0.1 dB SI-SDR of PyTorch original. C++ ONNX runs **17.9% faster on CPU** than PyTorch.

Additionally, the **`stem-splitter-core`** crate on crates.io wraps htdemucs ONNX with GPU support (CUDA/CoreML/DirectML) and progress callbacks — ready to integrate into Tauri.

### mistral.rs — local LLM with tool calling

**Version `0.7.0`** on crates.io, built on HuggingFace Candle. **Full tool calling support**, MCP client, agent loop, and structured output via llguidance — far ahead of alternatives for the DAW tool-calling use case.

```toml
[dependencies]
mistralrs = "0.7.0"
# For GPU: mistralrs = { version = "0.7.0", features = ["cuda"] }
# For Apple: mistralrs = { version = "0.7.0", features = ["metal"] }
```

Embed as a library directly in Tauri (no HTTP server needed):

```rust
use mistralrs::{TextModelBuilder, IsqType, PagedAttentionMetaBuilder, Tool, Function};

// Load model on app startup
let model = TextModelBuilder::new("Qwen/Qwen3-8B-Instruct".to_string())
    .with_isq(IsqType::Q4K)  // 4-bit quantization → ~4.5 GB
    .with_paged_attn(|| PagedAttentionMetaBuilder::default().build())?
    .build()
    .await?;

// Define DAW tools
let tools = vec![Tool {
    r#type: "function".to_string(),
    function: Function {
        name: "set_eq".to_string(),
        description: Some("Set EQ band on a track".to_string()),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "trackId": {"type": "string"},
                "frequency": {"type": "number"},
                "gain": {"type": "number"},
                "q": {"type": "number"}
            },
            "required": ["trackId", "frequency", "gain"]
        }),
    },
}];
```

**MCP support is built-in** — register DAW tools via MCP server and mistral.rs discovers them automatically:

```rust
use mistralrs::{McpClientConfig, McpServerConfig, McpServerSource};

let mcp_config = McpClientConfig {
    servers: vec![McpServerConfig {
        name: "daw-tools".to_string(),
        source: McpServerSource::Process {
            command: "node".to_string(),
            args: vec!["daw-mcp-server.js".to_string()],
        },
        auto_register_tools: true,
        ..Default::default()
    }],
    ..Default::default()
};
let model = TextModelBuilder::new("Qwen/Qwen3-8B-Instruct".to_string())
    .with_mcp_client(mcp_config)
    .build().await?;
```

**Model benchmark for tool calling** (Docker 2025, 3,570 scenarios):

| Model | Tool Selection F1 | Q4_K_M Size | Recommendation |
|---|---|---|---|
| **Qwen3-8B** | **0.919** | ~4.9 GB | **Primary recommendation** — near GPT-4 (0.974) accuracy |
| Llama-3.1-8B | 0.793 | ~4.9 GB | Good fallback |
| Qwen2.5-7B | 0.753 | ~4.7 GB | Lighter option |
| Phi-3.5-mini (3.8B) | — | ~2.2 GB | Low RAM machines |
| Mistral-Small-3.1-24B | — | ~14 GB | 32 GB machines only |

**Qwen3-8B at Q4_K_M is the top recommendation** — it produces reliable structured JSON, handles complex multi-step tool calling, and fits on 16 GB machines alongside a running DAW session (~3-6 GB) + OS (~3 GB). Use `Q5_K_M` (~5.5 GB) for higher fidelity when RAM permits. GGUF files: `bartowski/Qwen3-8B-GGUF` on HuggingFace (imatrix quantizations); Qwen also publishes official GGUFs. Load with ISQ instead to skip GGUF hunting: `.with_isq(IsqType::Q4K)` quantizes on load from any HuggingFace repo.

**Memory requirements summary:**

| Model | Q4_K_M Size | RAM Needed | Use When |
|---|---|---|---|
| Qwen3-8B | ~4.9 GB | ~7 GB | Default — best tool calling |
| Qwen2.5-7B | ~4.7 GB | ~6 GB | Slightly lighter |
| Phi-3.5-mini (3.8B) | ~2.2 GB | ~4 GB | 16 GB machines, fast responses |
| Mistral-Small-3.1-24B | ~14 GB | ~16+ GB | 32 GB machines only |

**Comparison with llama-cpp alternatives:** The `llama-cpp-2` crate (v0.1.133) provides lower-level control and GBNF grammar-constrained output, but requires manual tool-calling implementation and has a more complex API. The `llama_cpp` crate (v0.3.2) is safer but less feature-rich. **mistral.rs is strongly recommended** for the DAW use case due to built-in tool calling, MCP, agent loops, and streaming — all with an ergonomic async API. It also re-exports **llguidance** (Microsoft's constrained decoding engine, ~50μs/token overhead) for enforcing JSON schemas, which is the same engine used by OpenAI's Structured Outputs.

### Pure Rust audio processing crates

```toml
[dependencies]
# Audio decoding (pure Rust, ±15% of FFmpeg performance)
symphonia = { version = "0.5.5", features = ["all"] }
# Resampling (sinc interpolation, SIMD-accelerated)
rubato = "0.16.2"
# FFT (SIMD: AVX, SSE4.1, Neon)
rustfft = "6.4.1"
# Real-valued FFT (2× faster than rustfft for audio)
realfft = "3.5.0"
# DSP primitives (samples, frames, signals, envelopes, windows)
dasp = { version = "0.11.0", features = ["signal", "window", "envelope", "rms"] }
# Pitch detection (YIN, McLeod, Autocorrelation)
pitch-detection = "0.3.0"
```

**Full audio pipeline for AI inference** — decode → mono → resample → infer → return:

```rust
use symphonia::core::{codecs::DecoderOptions, formats::FormatOptions,
    io::MediaSourceStream, meta::MetadataOptions, probe::Hint, audio::SampleBuffer};
use rubato::{Resampler, SincFixedIn, SincInterpolationParameters,
    SincInterpolationType, WindowFunction};

fn decode_to_mono_f32(path: &str) -> (Vec<f32>, u32) {
    let file = std::fs::File::open(path).unwrap();
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(path.rsplit('.').next().unwrap_or(""));
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()).unwrap();
    let mut format = probed.format;
    let track = format.default_track().unwrap().clone();
    let sr = track.codec_params.sample_rate.unwrap();
    let ch = track.codec_params.channels.unwrap().count();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default()).unwrap();
    let mut samples = Vec::new();
    while let Ok(pkt) = format.next_packet() {
        if pkt.track_id() != track.id { continue; }
        if let Ok(decoded) = decoder.decode(&pkt) {
            let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
            buf.copy_interleaved_ref(decoded);
            samples.extend_from_slice(buf.samples());
        }
    }
    // Mix to mono
    let mono: Vec<f32> = samples.chunks(ch)
        .map(|f| f.iter().sum::<f32>() / ch as f32).collect();
    (mono, sr)
}

fn resample(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to { return samples.to_vec(); }
    let params = SincInterpolationParameters {
        sinc_len: 256, f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256, window: WindowFunction::BlackmanHarris2,
    };
    let mut resampler = SincFixedIn::<f64>::new(
        to as f64 / from as f64, 2.0, params, 1024, 1).unwrap();
    // Process chunks and collect output...
    // (see full implementation in Rust audio crates section)
}
```

**Spectrum analysis with realfft** (2× faster than rustfft for real signals):

```rust
use realfft::RealFftPlanner;

fn compute_spectrum(samples: &[f32], fft_size: usize) -> Vec<f32> {
    let mut planner = RealFftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);
    let mut input = fft.make_input_vec();
    let mut output = fft.make_output_vec(); // N/2+1 complex values
    // Apply Hann window and copy samples
    for (i, s) in samples.iter().take(fft_size).enumerate() {
        let w = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / fft_size as f32).cos());
        input[i] = s * w;
    }
    fft.process(&mut input, &mut output).unwrap();
    output.iter().map(|c| 20.0 * (c.norm().max(1e-10)).log10()).collect()
}
```

**Key detection via Krumhansl-Schmuckler** can be implemented in pure Rust: compute STFT with `realfft` → extract chroma features (map each FFT bin to one of 12 pitch classes) → correlate against major/minor key profiles → return the key with highest Pearson correlation. Alternatively, the **`stratum-dsp`** crate (v1.0.0, pure Rust) provides BPM detection, key detection, and beat tracking out of the box for DJ/DAW applications.

**DeepFilterNet** for noise reduction has a Rust core (`libDF`) using the `tract` crate for inference. Real-time capable at **0.19× real-time factor** on an i5-8250U. For Tauri integration, the recommended approach is exporting DeepFilterNet3 to ONNX and using the `ort` crate, avoiding tight coupling with the `tract` dependency chain.

---

## 3. External cloud API tier

### Anthropic Claude API — best for DAW tool orchestration

The **Claude Sonnet 4.6** (`claude-sonnet-4-6`) and **Claude Opus 4.6** models offer the most sophisticated tool use among cloud LLMs, with features specifically valuable for DAW integration: fine-grained tool streaming, tool search for large tool libraries (1,000+), and programmatic tool calling.

```bash
npm install @anthropic-ai/sdk@0.80.0
```

**Cost: $3.00/MTok input, $15.00/MTok output** (Sonnet 4.6). For a DAW making ~50 tool-calling requests per session averaging 500 tokens each, expect **~$0.01-0.05 per session** — negligible for a pro DAW.

```typescript
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();

const dawTools: Anthropic.Tool[] = [
  {
    name: "set_eq",
    description: "Set EQ parameters on a track",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string" },
        band: { type: "number" },
        frequency: { type: "number", description: "20-20000 Hz" },
        gain: { type: "number", description: "-24 to +24 dB" },
        q: { type: "number", description: "0.1 to 10.0" }
      },
      required: ["trackId", "band", "frequency", "gain"]
    }
  },
  {
    name: "add_midi_notes",
    description: "Add MIDI notes to a track",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string" },
        notes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              pitch: { type: "number", description: "MIDI 0-127" },
              velocity: { type: "number" },
              startBeat: { type: "number" },
              durationBeats: { type: "number" }
            }
          }
        }
      },
      required: ["trackId", "notes"]
    }
  }
];

const stream = client.messages.stream({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: 'You are a professional music production AI integrated into a DAW. Use the provided tools to execute all actions. Never describe actions — execute them via tools. You understand music theory, mixing, and arrangement.',
  tools: dawTools,
  messages: [{ role: 'user', content: 'Add a walking bass line in C minor starting at bar 5' }]
});
```

### MCP (Model Context Protocol) for DAW tool registration

MCP has become the **industry-standard protocol** for connecting AI systems to tools, with adoption by Anthropic, OpenAI, Google, and Microsoft. Monthly SDK downloads exceed **97 million**.

```bash
npm install @modelcontextprotocol/sdk
```

Register DAW tools as an MCP server:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "daw-tools", version: "1.0.0" });

server.tool("set_eq", {
  trackId: z.string(),
  band: z.number(),
  frequency: z.number().min(20).max(20000),
  gain: z.number().min(-24).max(24),
  q: z.number().min(0.1).max(10).optional()
}, async (params) => {
  const result = await invoke('set_eq', params);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});
```

This MCP server works with Claude (via Claude Desktop or API), mistral.rs (via built-in MCP client), and any other MCP-compatible agent runtime — a single tool definition serves all three tiers.

### OpenAI API

**GPT-5.4** is the latest model (March 2026). The Responses API is now recommended over Chat Completions for function calling. The `openai` npm package is at **v6.32.0**. GPT-4o can process audio input but focuses on speech — it cannot perform spectral analysis or beat detection on music. **Whisper API** remains useful for lyric transcription and voice commands.

```bash
npm install openai@6.32.0
```

### Replicate API — cloud inference for heavy models

**Demucs on Replicate** (`cjwbw/demucs`): Processes a 4-minute song in ~30-120 seconds. Cost is ~**$0.02-0.08 per song** depending on GPU type. Supports htdemucs, htdemucs_ft, htdemucs_6s.

```typescript
import Replicate from "replicate";
const replicate = new Replicate();

const output = await replicate.run("cjwbw/demucs:latest", {
  input: { audio: audioUrl, model_name: "htdemucs", shifts: 1 }
});
// Returns { vocals, drums, bass, other } as URLs to WAV files
```

**MusicGen** (`meta/musicgen`): Text-to-music generation, ~$0.08 per generation, completes within 60 seconds. **Stable Audio 2.5** (`stability-ai/stable-audio-2.5`): Up to 3-minute tracks, <2s on H100.

### APIs without public access

**Suno** and **Udio** do **not have official public APIs** as of March 2026. Both face pending copyright lawsuits from major labels. Unofficial reverse-engineered wrappers exist but carry legal and reliability risks. For a commercial DAW, use **Stable Audio** or **MusicGen** instead — both use properly licensed training data.

### MIDI generation via LLM

No dedicated MIDI generation APIs exist. The recommended approach: define a structured tool that returns note arrays, then convert to MIDI with `midi-writer-js`:

```typescript
import MidiWriter from 'midi-writer-js';

function notesToMidi(notes: Array<{pitch: string, duration: string, velocity: number}>): Uint8Array {
  const track = new MidiWriter.Track();
  for (const note of notes) {
    track.addEvent(new MidiWriter.NoteEvent({
      pitch: [note.pitch], duration: note.duration, velocity: note.velocity
    }));
  }
  return new MidiWriter.Writer(track).buildFile();
}
```

---

## 4. Tauri v2 integration architecture

### Current versions and fundamentals

**Tauri `2.10.3`** (stable since October 2024), `@tauri-apps/api` v2. Commands use the `invoke()` pattern with automatic camelCase↔snake_case conversion. For streaming data from Rust to frontend, **Channels are preferred over Events** — they guarantee ordered delivery and are designed for high-throughput use cases like inference progress.

### Binary data transfer for audio

Standard JSON IPC is slow for large audio buffers. Use `tauri::ipc::Response` for returning raw bytes:

```rust
use tauri::ipc::Response;

#[tauri::command]
fn get_audio_buffer(track_id: String) -> Response {
    let audio_data: Vec<u8> = load_audio_bytes(&track_id);
    Response::new(audio_data) // Arrives as ArrayBuffer in JS
}
```

```typescript
const buffer: ArrayBuffer = await invoke('get_audio_buffer', { trackId: '1' });
const float32 = new Float32Array(buffer);
```

For sending audio from JS to Rust, convert Float32Array to a number array (works for buffers up to ~3 MB without significant overhead) or use Tauri's raw request body for larger transfers.

### Tiered fallback pattern

```typescript
async function analyzeAudio(buffer: AudioBuffer): Promise<AnalysisResult> {
  const samples = buffer.getChannelData(0);

  // Tier 1: Browser WASM (fastest, no IPC)
  try { return await runWebInference(samples); }
  catch { console.warn('Web tier failed, trying Rust'); }

  // Tier 2: Rust native (most capable)
  try { return await invoke<AnalysisResult>('analyze_audio', { samples: Array.from(samples) }); }
  catch { console.warn('Rust tier failed, trying cloud'); }

  // Tier 3: Cloud (highest quality, requires internet)
  return await cloudAnalyze(samples);
}
```

### Model storage and download

**Browser-side models**: Use **OPFS** (Origin Private File System) for best performance (2-4× faster than IndexedDB for reads), with Cache API as fallback. Call `navigator.storage.persist()` to prevent eviction. Note: OPFS support in WebKitGTK (Linux) may be limited.

**Rust-side models**: Store in Tauri's app data directory — no quota limits, memory-mapped loading possible:

```rust
#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    url: String,
    filename: String,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> Result<String, String> {
    let models_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?.join("models");
    std::fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
    let dest = models_dir.join(&filename);
    if dest.exists() { return Ok(dest.to_string_lossy().to_string()); }

    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(&dest).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = futures::StreamExt::next(&mut stream).await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        on_progress.send(serde_json::json!({
            "downloaded": downloaded, "total": total,
            "percent": if total > 0 { downloaded as f64 / total as f64 * 100.0 } else { 0.0 }
        })).ok();
    }
    Ok(dest.to_string_lossy().to_string())
}
```

### React hooks for AI features

```typescript
function useStreamingInference() {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle'|'running'|'done'|'error'>('idle');
  const [result, setResult] = useState<any>(null);

  const run = useCallback(async (command: string, params: Record<string, unknown>) => {
    setStatus('running');
    setProgress(0);
    const channel = new Channel<{ event: string; data: any }>();
    channel.onmessage = (msg) => {
      if (msg.event === 'Progress') setProgress(msg.data.percent);
      if (msg.event === 'Complete') { setStatus('done'); setResult(msg.data); }
    };
    try {
      await invoke(command, { ...params, onProgress: channel });
    } catch { setStatus('error'); }
  }, []);

  return { progress, status, result, run };
}
```

---

## 5. Feature-by-feature implementation guides

### Stem separation

**Recommended: Rust tier as primary, cloud as fallback.** Browser-side Demucs works (via demucs-rs WASM+WebGPU or free-music-demixer) but is significantly slower than native and requires WebGPU. The **Mixxx self-contained ONNX export** of htdemucs is the cleanest path for the `ort` crate — it includes STFT/ISTFT in the model graph, requiring zero pre/post-processing code. Model size is ~160 MB (float32 ONNX). Processing time: ~1.5× song duration on CPU, much faster with GPU. The `stem-splitter-core` crate provides a ready-made Rust wrapper. For cloud fallback, Replicate's Demucs endpoint costs ~$0.02-0.08 per song. **LALAL.AI's API** (released Feb 2026) supports up to 10-stem separation at ~$0.07-0.22/min.

### Audio-to-MIDI (Basic Pitch)

**Recommended: Web tier as primary.** The `@spotify/basic-pitch` npm package is production-ready, uses ONNX Runtime Web internally, and the model is only **~10 MB** with <17K parameters. It processes faster than real-time on modern hardware and handles polyphonic instruments with pitch bends.

```typescript
import { BasicPitch, noteFramesToTime, addPitchBendsToNoteEvents,
  outputToNotesPoly } from '@spotify/basic-pitch';

const basicPitch = new BasicPitch(modelUrl);
const frames = [], onsets = [], contours = [];
await basicPitch.evaluateModel(audioBuffer,
  (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
  (pct) => updateProgress(pct)
);
const notes = noteFramesToTime(
  addPitchBendsToNoteEvents(contours,
    outputToNotesPoly(frames, onsets, 0.25, 0.25, 5))
);
// notes[] = { startTimeSeconds, durationSeconds, pitchMidi, amplitude, pitchBends }
```

For Rust-tier fallback, load the `nmp.onnx` model via `ort` and port the CQT preprocessing from basicpitch.cpp (C++ reference implementation).

### BPM and beat detection

**Recommended: Web tier.** Use Essentia.js `PercivalBpmEstimator` or `RhythmExtractor2013` for the highest accuracy (note AGPL license). MIT alternatives: `realtime-bpm-analyzer` for real-time stream analysis, `web-audio-beat-detector` for offline AudioBuffer analysis. For Rust fallback: `bpm-analyzer` crate (wavelet decomposition + autocorrelation, pure Rust) or `stratum-dsp` (v1.0.0, professional-grade).

### Key detection

**Recommended: Web tier.** Essentia.js `KeyExtractor` with the `'bgate'` profile provides production-quality results including confidence scores. Supports Temperley, Krumhansl, and EDMA profiles. For the Rust tier, implement Krumhansl-Schmuckler using `realfft` for chroma extraction, or use `stratum-dsp`. The algorithm: FFT → map bins to 12 pitch classes → average chroma profile → Pearson correlation against major/minor key profiles → highest correlation wins.

### Pitch detection and correction

**Recommended: Hybrid.** For **detection**, use CREPE tiny ONNX (~2-3 MB) via ONNX Runtime Web in the browser for real-time monophonic pitch tracking, or `pitchy` (MIT, McLeod method) for zero-dependency detection. For **correction**, use the Rust tier: detect pitch with CREPE ONNX via `ort`, compute correction offsets, and apply pitch shifting with `rubato` (sample rate conversion for small shifts) or phase vocoder techniques using `realfft`.

```typescript
// Browser: pitchy for real-time pitch detection
import { PitchDetector } from 'pitchy';
const detector = PitchDetector.forFloat32Array(2048);
const [pitch, clarity] = detector.findPitch(audioFrame, 44100);
if (clarity > 0.8) console.log(`Pitch: ${pitch.toFixed(1)} Hz`);
```

### AI-assisted EQ with "learn" button

**Recommended: Rust tier for analysis, web tier for display.** The "learn" feature captures the spectral profile of a reference signal: compute average magnitude spectrum over multiple frames using `realfft` → smooth into ~31 bands (1/3 octave) → compare target vs reference → generate EQ curve as the difference. This is a pure DSP task — no ML needed.

```rust
fn compute_spectral_profile(samples: &[f32], sr: u32, fft_size: usize) -> Vec<f32> {
    let mut planner = RealFftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);
    let hop = fft_size / 2;
    let mut avg_spectrum = vec![0.0f32; fft_size / 2 + 1];
    let mut frame_count = 0;
    for start in (0..samples.len().saturating_sub(fft_size)).step_by(hop) {
        let mut input = fft.make_input_vec();
        let mut output = fft.make_output_vec();
        for (i, s) in samples[start..start+fft_size].iter().enumerate() {
            let w = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / fft_size as f32).cos());
            input[i] = s * w;
        }
        fft.process(&mut input, &mut output).unwrap();
        for (i, c) in output.iter().enumerate() { avg_spectrum[i] += c.norm(); }
        frame_count += 1;
    }
    avg_spectrum.iter().map(|v| 20.0 * (v / frame_count as f32).max(1e-10).log10()).collect()
}

fn compute_eq_curve(reference: &[f32], target: &[f32]) -> Vec<f32> {
    reference.iter().zip(target).map(|(r, t)| r - t).collect() // dB difference
}
```

### Reference-based mastering/matching

Similar to AI EQ but extended to loudness (EBU R128), stereo width, and dynamic range. Compute the spectral profile, loudness (integrated LUFS), and crest factor of both reference and target. Generate a combined correction: EQ curve + gain offset + optional multiband compression settings. All achievable with `realfft` + EBU R128 loudness calculation in pure Rust.

### Natural language → DAW tool calls

**Recommended fallback chain: Rust (mistral.rs) → Cloud (Claude) → Web (WebLLM).**

The Rust tier using mistral.rs with **Qwen3-8B** (Q4K, ~4.5 GB) provides the best balance of quality, latency, and offline capability. It supports native tool calling, MCP, and structured output via llguidance. For machines with <16 GB RAM, fall back to Claude API (best tool-calling quality) or GPT-5.4. WebLLM serves as a fallback for offline-only scenarios on Windows/macOS where the native tier isn't loaded, using **Hermes-2-Pro-Llama-3-8B** (~4 GB) with native OpenAI-compatible tool calling (no JSON mode prompt engineering required).

### MIDI generation and completion

**Recommended: Web tier (Magenta.js) for quick generation, Cloud tier (Claude) for musical intelligence.** Use MusicVAE's `sample()` for generating novel melodies and `continueSequence()` in MusicRNN for extending existing MIDI. For more musically aware generation (chord progressions, style-specific patterns), use Claude with a structured tool that returns note arrays, then convert via `midi-writer-js`. The Magenta models are small (2-20 MB) and load in seconds.

### Intelligent gain staging

Pure DSP — no ML required. Analyze each track's peak level, RMS, and LUFS using `realfft`-based analysis. Apply gain corrections to bring each track to a target level (e.g., -18 dBFS RMS for mixing headroom). Implement EBU R128 loudness measurement in Rust for accurate integrated loudness.

---

## 6. Package versions, installation, and complete Cargo.toml

### npm packages (TypeScript/React)

```json
{
  "dependencies": {
    "@mlc-ai/web-llm": "^0.2.82",
    "@huggingface/transformers": "^3.8.1",
    "onnxruntime-web": "^1.24.3",
    "@spotify/basic-pitch": "latest",
    "essentia.js": "^0.1.3",
    "@magenta/music": "^1.23.1",
    "tone": "^15.1.22",
    "tonal": "^6.1.0",
    "meyda": "^5.6.3",
    "pitchy": "^4.1.0",
    "realtime-bpm-analyzer": "latest",
    "midi-writer-js": "latest",
    "@tonejs/midi": "latest",
    "@anthropic-ai/sdk": "^0.80.0",
    "openai": "^6.32.0",
    "replicate": "latest",
    "@modelcontextprotocol/sdk": "latest",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-fs": "^2.0.0",
    "vite-plugin-static-copy": "latest"
  }
}
```

### Cargo.toml (Rust/Tauri backend)

```toml
[dependencies]
# Tauri
tauri = { version = "2.10", features = ["protocol-asset"] }
tauri-plugin-fs = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
futures = "0.3"
reqwest = { version = "0.12", features = ["stream"] }

# ONNX inference
ort = { version = "2.0.0-rc.12", features = ["half"] }
ndarray = "0.15"

# LLM inference (choose one)
mistralrs = "0.7.0"

# Audio decoding
symphonia = { version = "0.5.5", features = ["all"] }

# Resampling
rubato = "0.16.2"

# FFT and spectral analysis
rustfft = "6.4.1"
realfft = "3.5.0"

# DSP primitives
dasp = { version = "0.11.0", features = ["signal", "window", "envelope", "rms"] }

# Pitch detection
pitch-detection = "0.3.0"

# Logging
log = "0.4"
env_logger = "0.11"
```

### Build configuration gotchas for Tauri v2

- **ONNX Runtime Web + Vite**: Must copy `.wasm` and `.jsep.*` files via `vite-plugin-static-copy`. Set `ort.env.wasm.wasmPaths` at runtime. Exclude `onnxruntime-web` from Vite's `optimizeDeps`.
- **mistral.rs**: Pulls in the Candle framework — expect 5-10 minute clean builds. Isolate in a separate workspace crate to avoid recompiling on every change.
- **ort with `load-dynamic`**: Recommended for distribution — loads ONNX Runtime via `dlopen()` at runtime. Set `ORT_DYLIB_PATH` to the bundled library location. The `copy-dylibs` feature (default) handles development builds.
- **WebLLM in Web Workers**: Vite handles `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` natively. Firefox requires `dom.workers.modules.enabled = true` for ES module workers.
- **Essentia.js WASM**: Load in a Web Worker, not the main thread. The WASM binary is 2-4 MB.
- **Linux builds**: WebKitGTK does not support WebGPU or OPFS reliably. All GPU-accelerated browser inference must fall back to WASM (CPU) or the Rust tier.

---

## Licensing considerations

| Library | License | Commercial DAW Impact |
|---|---|---|
| ort, rustfft, realfft, rubato, symphonia, dasp, pitch-detection | MIT / Apache-2.0 | ✅ Safe for closed-source |
| WebLLM, Transformers.js, ONNX Runtime Web | Apache-2.0 / MIT | ✅ Safe |
| Tone.js, Tonal.js, Meyda, pitchy | MIT | ✅ Safe |
| Magenta.js, Basic Pitch | Apache-2.0 | ✅ Safe |
| mistral.rs | Apache-2.0 | ✅ Safe |
| **Essentia.js** | **AGPL-3.0** | **⚠️ Copyleft — requires open-sourcing or commercial license from UPF** |
| **pitchfinder** | **GPL-v3** | **⚠️ Copyleft — cannot use in closed-source** |
| symphonia | MPL-2.0 | ✅ Safe (file-level copyleft only) |
| Demucs models | MIT (code), CC-BY-NC (some pretrained weights) | **⚠️ Check specific model weights** |

The two critical licensing risks are **Essentia.js (AGPL)** and **pitchfinder (GPL)**. For a commercial DAW, replace Essentia.js with Meyda (features) + custom Rust analysis, and use pitchy (MIT) instead of pitchfinder.

## Conclusion

The three-tier architecture maps cleanly to the constraints of a desktop DAW: real-time visualization and lightweight analysis run in the browser's Web Audio API and ONNX Runtime Web with zero IPC overhead; heavy inference (stem separation, LLM tool calling) runs natively in Rust via `ort` and `mistral.rs` with GPU acceleration and progress streaming through Tauri Channels; and cloud APIs provide state-of-the-art quality for optional premium features. The single most important architectural decision is **making MCP the universal tool definition layer** — define your DAW actions once as MCP tools, and they work identically with mistral.rs locally, Claude/GPT in the cloud, and potentially WebLLM in the browser. The biggest risk factor is platform fragmentation: WebGPU availability varies by OS and WebView, making the Rust tier essential as the universal fallback. Start implementation with spectrum analysis (pure Web Audio, zero dependencies), BPM/key detection (Essentia.js or MIT alternatives), and stem separation (demucs-rs or stem-splitter-core) — these three features deliver the most visible impact with the most proven libraries.

---

## See Also

- **[audio-ai-runtime SKILL.md](./.agents/skills/audio-ai-runtime/SKILL.md)** — Authoritative rules for agents writing AI inference code in this codebase
- **[llm-action-bridge SKILL.md](./.agents/skills/llm-action-bridge/SKILL.md)** — Rules for connecting LLM output to typed, reversible DAW actions
- **[tauri-platform SKILL.md](./.agents/skills/tauri-platform/SKILL.md)** — COOP/COEP headers and Web vs Rust API decisions
- **[ai-ux.md](./ai-ux.md)** — Producer adoption data and UX trust patterns; read before designing AI feature UI