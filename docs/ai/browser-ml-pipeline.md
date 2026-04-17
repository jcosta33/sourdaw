# Browser ML Pipeline

How Sourdaw runs neural audio models in the browser — no server, no sidecar, no cloud dependency.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Research / Training (offline, one-time)         │
│                                                  │
│  PyTorch or TensorFlow model                     │
│       ↓ export (torch.onnx.export / tf2onnx)     │
│  ONNX model file (.onnx)                         │
│       ↓ upload                                   │
│  HuggingFace CDN (CORS-accessible)               │
└─────────────────────────────────────────────────┘
                    ↓ fetch (on first use)
┌─────────────────────────────────────────────────┐
│  Browser (runtime)                               │
│                                                  │
│  OPFS cache ← download manager                   │
│       ↓ load                                     │
│  ONNX Runtime Web (WebGPU or WASM backend)       │
│       ↓ inference                                │
│  Output tensors (mel-spectrograms, parameters)   │
│       ↓ post-processing                          │
│  Audio (Float32Array at 44.1 kHz)                │
└─────────────────────────────────────────────────┘
```

## What is ONNX?

ONNX (Open Neural Network Exchange) is a standard file format for ML models. It describes the model's computation graph — layers, weights, and operations — in a framework-agnostic way. A model trained in PyTorch can be exported to ONNX and run in any ONNX-compatible runtime:

- **ONNX Runtime** (C++/Python, production servers)
- **ONNX Runtime Web** (browser, via WebGPU or WASM)
- **ONNX Runtime Mobile** (iOS/Android)
- **TensorRT** (NVIDIA GPUs)
- **Core ML** (Apple devices, via onnx-coreml)

This is the industry-standard deployment path. When you use Whisper transcription, Stable Diffusion, or any ML feature in a mobile app, the model likely went through an ONNX (or equivalent) conversion step.

## Models in Sourdaw

### Currently deployed

| Model | Source | Size | Format | Purpose |
|-------|--------|------|--------|---------|
| Kokoro TTS | [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) | 86 MB | ONNX (pre-converted) | Text → spoken audio |
| NSF-HiFiGAN vocoder | [openvpi/vocoders](https://github.com/openvpi/vocoders) → [jcosta33/vocoder-models](https://huggingface.co/jcosta33/vocoder-models) | 52 MB | ONNX (extracted from .oudep) | Mel-spectrogram → audio waveform (for DiffSinger) |
| DiffSinger voicebanks | Community | ~150 MB each | ONNX | MIDI + lyrics → singing mel-spectrogram |

### Planned

| Model | Source | Size | Conversion | Purpose |
|-------|--------|------|------------|---------|
| MIDI-DDSP decoder | [magenta/midi-ddsp](https://github.com/magenta/midi-ddsp) | ~8 MB | TF checkpoint → ONNX (via Colab) | MIDI → instrument synthesis parameters |

## How to add a new model

### 1. Find or train the model

Look for pretrained models on [HuggingFace](https://huggingface.co/models), [GitHub](https://github.com), or academic repos. Prefer models that are:
- Small enough for browser use (<500 MB, ideally <100 MB)
- Available in PyTorch or TensorFlow (for ONNX export)
- Already converted to ONNX (check for repos ending in `-ONNX`)
- Permissively licensed (Apache 2.0, MIT, CC-BY)

### 2. Convert to ONNX

**If the model is already ONNX:** Skip this step. Download the `.onnx` file directly.

**If PyTorch:**
```python
import torch

model = load_pretrained_model()
model.eval()

dummy_input = torch.randn(1, 250)  # match model's expected input shape
torch.onnx.export(
    model,
    dummy_input,
    "model.onnx",
    input_names=["input"],
    output_names=["output"],
    dynamic_axes={"input": {1: "sequence_length"}},
)
```

**If TensorFlow:**
```python
import tf2onnx

# From SavedModel directory
tf2onnx.convert.from_saved_model(
    "saved_model_dir/",
    output_path="model.onnx",
)
```

**If the model has complex dependencies** (like MIDI-DDSP): Use Google Colab where all deps are pre-installed. See `scripts/export_ddsp_to_onnx.ipynb` for an example.

### 3. Validate

```python
import onnxruntime as ort
import numpy as np

sess = ort.InferenceSession("model.onnx")
print("Inputs:", [(i.name, i.shape) for i in sess.get_inputs()])
print("Outputs:", [(o.name, o.shape) for o in sess.get_outputs()])

# Run inference with dummy data
result = sess.run(None, {"input": np.random.randn(1, 250).astype(np.float32)})
print("Output shape:", result[0].shape)
print("Output range:", result[0].min(), "to", result[0].max())
```

### 4. Host on HuggingFace

HuggingFace serves files with CORS headers — browsers can fetch directly. No proxy needed.

```bash
hf login
hf upload your-org/your-repo model.onnx path/in/repo/model.onnx --repo-type model
```

The resolve URL will be:
```
https://huggingface.co/your-org/your-repo/resolve/main/path/in/repo/model.onnx
```

### 5. Integrate in Sourdaw

1. Add the URL and size to the model catalog (`src/modules/BrowserAi/models/`)
2. Add a download entry in `initBrowserAi.ts`
3. Add an inference handler in `onnxInferenceWorker.ts` (or use the generic `run-inference` path)
4. Write a render use case (`src/modules/BrowserAi/useCases/`)
5. Wire up the UI

## The DDSP decomposition pattern

Some models fuse ML inference with DSP (digital signal processing) in their computation graph. This makes ONNX conversion difficult because the DSP operations (FFT, sine wave generation, phase accumulation) may use custom ops that ONNX doesn't support.

The solution: **split the model into ML + DSP**.

```
┌─────────────────┐     ┌──────────────────────┐
│  ML (ONNX)      │     │  DSP (TypeScript)    │
│                 │     │                      │
│  (f0, loudness, │ ──→ │  Additive synthesis  │
│   instrument)   │     │  (harmonic oscbank)  │
│        ↓        │     │        +             │
│  amplitudes     │     │  Subtractive synth   │
│  harmonics[60]  │     │  (filtered noise)    │
│  noise[65]      │     │        ↓             │
└─────────────────┘     │  Audio waveform      │
                        └──────────────────────┘
```

The ML part predicts *what parameters to use*. The DSP part *generates the audio*. This pattern:
- Makes ONNX export trivial (the ML part is just Dense/GRU/Conv layers)
- Allows a handcrafted fallback when the ML model isn't available
- Runs the DSP in an AudioWorklet for real-time use (future)
- Is exactly how Google's DDSP-VST works (TFLite + C++)

## Candidate models for future integration

| Model | What it does | Size | Difficulty |
|-------|-------------|------|------------|
| [Demucs](https://github.com/facebookresearch/demucs) | Stem separation (vocals, drums, bass, other) | ~80 MB | Medium — already has ONNX exports |
| [NSNET2](https://github.com/microsoft/DNS-Challenge) | Speech denoising | ~5 MB | Easy — small, standard ops |
| [HybridDemucs](https://huggingface.co/models?search=demucs+onnx) | Higher quality stem separation | ~300 MB | Medium — large but proven |
| [OpenUnmix](https://github.com/sigsep/open-unmix-pytorch) | Stem separation (lighter) | ~25 MB | Easy — pure PyTorch, small |
| [CREPE](https://github.com/marl/crepe) | Pitch detection | ~20 MB | Easy — standard Conv1D |
| [BasicPitch](https://github.com/spotify/basic-pitch) | Audio to MIDI transcription | ~15 MB | Medium — needs ONNX export |
| [EnCodec](https://github.com/facebookresearch/encodec) | Neural audio codec (compression) | ~15-60 MB | Medium — future instrument synthesis via codec tokens |

## Performance considerations

- **WebGPU** (Chrome 113+): GPU-accelerated inference. 5-50x faster than WASM for large models.
- **WASM SIMD**: Universal fallback. Adequate for small models (<50 MB). Slow for large ones.
- **Model quantization**: INT8/FP16 quantized models (like Kokoro's `q8f16`) are smaller and faster with minimal quality loss.
- **Multi-threading**: Requires `crossOriginIsolated` (COEP/COOP headers). IIFE workers (Rolldown) don't support this — inference runs single-threaded.
- **Memory**: Chrome tabs have ~4 GB limit. Models share GPU memory. LRU eviction in the session cache prevents OOM.
