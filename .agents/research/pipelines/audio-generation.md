# Local-first AI audio generation for a Tauri v2 DAW

**A local-first AI audio DAW is now feasible, but the path forward demands careful model selection and a staged build strategy.** The open-source landscape transformed dramatically between late 2024 and early 2026: ACE-Step v1.5 (Apache 2.0, <4 GB VRAM) now generates full songs with vocals in under 10 seconds on an RTX 3090, DiffSinger's ONNX pipeline powers the production-grade OpenUtau editor, and SoulX-Singer delivers zero-shot singing synthesis under Apache 2.0. The quality gap with AceStudio remains real — roughly 70–85% parity depending on the task — but the engineering gap has closed enough that a shippable product is achievable. The recommended MVP is **DiffSinger-based singing synthesis via ONNX Runtime**, integrated through a Python sidecar architecture with shared-memory audio transfer, targeting offline rendering first and adding interactive preview later.

---

## 1. Executive summary and recommended stack

Three converging trends make this project viable now. First, **singing voice synthesis** has matured: DiffSinger's ONNX export is production-proven through OpenUtau, and SoulX-Singer adds zero-shot voice cloning under Apache 2.0. Second, **full-song generation** crossed the consumer-hardware threshold with ACE-Step v1.5, which runs on 4 GB VRAM and produces vocals plus accompaniment from text prompts. Third, **infrastructure components** — vocoders (Vocos at 6,700× realtime, BigVGAN v2 for quality), codecs (DAC at 44.1 kHz), and the `ort` Rust crate for ONNX Runtime — are all MIT-licensed and battle-tested.

The recommended first feature to build is **MIDI + lyrics → singing voice** using DiffSinger ONNX models, because OpenUtau proves this pipeline works in a shipped desktop application. The recommended stack is:

- **Synthesis engine**: DiffSinger (OpenVPI fork) exported to ONNX
- **Vocoder**: Vocos (MIT) for preview, BigVGAN v2 (MIT) for final render
- **Voice conversion** (optional post-processing): RVC/Applio (MIT)
- **Runtime**: ONNX Runtime via the `ort` Rust crate (DirectML on Windows, CoreML on macOS)
- **Architecture**: Hybrid — Rust core handling DAW logic and lightweight ONNX inference, Python sidecar (FastAPI + PyTorch) for heavy/experimental models
- **Packaging**: Lightweight installer (~100 MB) with on-demand model downloads via HuggingFace Hub

The closest open-source parity with AceStudio is approximately **70–80% for singing synthesis** (DiffSinger with well-trained voicebanks), **40–60% for expressive instruments** (MIDI-DDSP and TokenSynth are functional but far from orchestral sample libraries), and **~85% for full-song generation** (ACE-Step v1.5 approaches Suno v4.5 quality). No open-source system matches AceStudio's real-time parameter editing with instant audio feedback — all neural synthesis is currently offline or near-offline.

---

## 2. Capability matrix

The table below evaluates every serious candidate across the six criteria that matter for a shippable DAW feature: capability quality, local feasibility, integration difficulty, license safety, DAW workflow fit, and realistic parity with cloud tools. Models are grouped by task.

### Singing voice synthesis (MIDI + lyrics → vocals)

| Model                    | License (weights)                            | Architecture                      | Hardware                         | Inference speed                    | ONNX                   | Quality vs AceStudio | Shippability                              |
| ------------------------ | -------------------------------------------- | --------------------------------- | -------------------------------- | ---------------------------------- | ---------------------- | -------------------- | ----------------------------------------- |
| **DiffSinger (OpenVPI)** | Apache 2.0 code; **CC-BY-NC-SA 4.0 vocoder** | Diffusion mel + NSF-HiFiGAN       | 4–8 GB VRAM; CPU viable via ONNX | ~50× faster with shallow diffusion | ✅ Mature, first-class | 70–80%               | ✅ Production-proven (OpenUtau)           |
| **SoulX-Singer**         | **Apache 2.0** (code + weights)              | Zero-shot SVS, 42k hours training | Likely 8–12 GB VRAM              | Not yet benchmarked                | ❌ Not yet             | 75–85% (estimated)   | ⚠️ Very new (Feb 2026), untested at scale |
| **NNSVS**                | MIT                                          | Parametric SVS (Sinsy-inspired)   | 4–6 GB VRAM                      | Near-realtime                      | ❌                     | 50–60%               | ⚠️ Research toolkit                       |
| **VISinger2**            | Research                                     | End-to-end VITS + DDSP vocoder    | 4–8 GB VRAM                      | Moderate                           | ❌                     | 60–70%               | ⚠️ Academic only                          |
| **TCSinger 2**           | Research                                     | Flow + MoE transformer            | Multi-GPU training               | Slow                               | ❌                     | Research-grade       | ❌ No pretrained weights                  |

### Voice conversion (audio → re-voiced audio)

| Model               | License     | Architecture                          | Training data needed | Realtime?               | ONNX       | Quality                    | Shippability                 |
| ------------------- | ----------- | ------------------------------------- | -------------------- | ----------------------- | ---------- | -------------------------- | ---------------------------- |
| **RVC / Applio**    | **MIT**     | HuBERT + VITS + FAISS retrieval       | 5–10 min clean audio | Yes (200–500 ms chunks) | ✅ Partial | Excellent timbre transfer  | ✅ Mature, large community   |
| **Seed-VC**         | Open-source | Diffusion transformer + flow matching | Zero-shot            | ~400 ms with TensorRT   | ❌         | Beats RVC v2 on benchmarks | ⚠️ Newer, less battle-tested |
| **so-vits-svc 4.0** | AGPL-3.0    | SoftVC + VITS                         | Few minutes          | Yes (with latency)      | ✅ Partial | Good but dated             | ❌ Archived, license issues  |

### MIDI → instrument audio

| Model          | License (weights) | Instruments                       | Sample rate     | MIDI input? | Realtime?      | Quality                                | Shippability             |
| -------------- | ----------------- | --------------------------------- | --------------- | ----------- | -------------- | -------------------------------------- | ------------------------ |
| **TokenSynth** | **MIT**           | Any (zero-shot from 5s reference) | 44.1 kHz (DAC)  | ✅ Direct   | ❌ Offline     | Promising, limited velocity (4 levels) | ⚠️ Very new (Feb 2025)   |
| **MIDI-DDSP**  | Apache 2.0        | 13 monophonic orchestral          | **16 kHz** mono | ✅ Direct   | ❌ 2.5–5× RT   | Moderate (student-level training data) | ⚠️ TensorFlow dependency |
| **MIDI-VALLÉ** | CC-BY 4.0         | Piano only                        | ~24 kHz         | ✅ Direct   | ❌ Offline     | Best open-source piano                 | ⚠️ Complex dependencies  |
| **DDSP-Piano** | Apache 2.0        | Piano only                        | 24 kHz          | ✅ Direct   | Near-RT on GPU | Decent, not Pianoteq-level             | ✅ Simple, lightweight   |

### Full-song generation (text/lyrics → complete song)

| Model             | License        | VRAM                          | Generation speed   | Vocals? | Quality vs Suno           | Shippability                  |
| ----------------- | -------------- | ----------------------------- | ------------------ | ------- | ------------------------- | ----------------------------- |
| **ACE-Step v1.5** | **Apache 2.0** | **<4 GB** (base); ≥12 GB (XL) | <10s on RTX 3090   | ✅ Yes  | ~Suno v4.5 level          | ✅ ComfyUI integration exists |
| **YuE**           | Apache 2.0     | 24 GB+ recommended            | Minutes            | ✅ Yes  | First to match commercial | ⚠️ Very heavy                 |
| **DiffRhythm 2**  | Open-source    | Moderate                      | 50× faster than AR | ✅ Yes  | Below ACE-Step            | ⚠️ Research-stage             |

### Audio infrastructure (vocoders and codecs)

| Component       | License | Speed (GPU)       | Quality                                     | Best use                                       |
| --------------- | ------- | ----------------- | ------------------------------------------- | ---------------------------------------------- |
| **Vocos**       | MIT     | **6,700× RT**     | Good (speech-focused)                       | Real-time preview, EnCodec decoder replacement |
| **BigVGAN v2**  | MIT     | 45–135× RT        | **Best universal** (music, speech, effects) | High-quality offline rendering                 |
| **HiFi-GAN V1** | MIT     | 168× RT           | Good (needs fine-tuning per domain)         | Proven TTS pipelines                           |
| **DAC**         | MIT     | 50–200× RT decode | Best at 44.1 kHz                            | Token-based generation pipelines               |
| **EnCodec**     | MIT     | 100× RT decode    | Good, foundation for MusicGen               | Codec-language-model pipelines                 |
| **SNAC**        | MIT     | 100× RT decode    | Good, multi-scale tokens                    | Efficient LM token generation                  |

### Timbre and style transfer

| Model     | License                      | Realtime?        | Polyphonic?  | Retraining needed?  | Content preservation      | DAW integration                   |
| --------- | ---------------------------- | ---------------- | ------------ | ------------------- | ------------------------- | --------------------------------- |
| **RAVE**  | IRCAM (check for commercial) | ✅ 20× RT on CPU | Limited      | Yes, per instrument | Good (rhythmic structure) | ✅ VST exists (Neutone, Scyclone) |
| **DDSP**  | Apache 2.0                   | ✅ ~20 ms        | ❌ Mono only | Yes (13 min audio)  | **Excellent** (exact F0)  | ✅ DDSP-VST (stalled dev)         |
| **AFTER** | IRCAM                        | ✅ Via MaxMSP    | Possible     | Yes, per domain     | Good (disentangled)       | ⚠️ Max/PureData only              |

---

## 3. Pipeline blueprints

### Pipeline A: MIDI + lyrics → singing voice → final audio

This is the highest-value pipeline and the recommended MVP. It replicates AceStudio's core workflow.

```
┌──────────┐    ┌────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────┐
│ MIDI +   │───▶│ Phonemizer │───▶│ DiffSinger   │───▶│ DiffSinger   │───▶│ Vocoder  │──▶ WAV
│ Lyrics   │    │ (g2p,      │    │ Variance     │    │ Acoustic     │    │ (Vocos / │
│ (piano   │    │  language-  │    │ Model (ONNX) │    │ Model (ONNX) │    │ BigVGAN) │
│  roll)   │    │  specific)  │    │ duration,    │    │ mel-spec via │    │ (ONNX)   │
└──────────┘    └────────────┘    │ F0, energy,  │    │ shallow      │    └──────────┘
                                  │ breathiness  │    │ diffusion    │
                                  └──────────────┘    └──────────────┘
                                         ▼ (optional post-processing)
                                  ┌──────────────┐
                                  │ RVC / Applio │──▶ Re-voiced WAV
                                  │ (MIT, voice  │    (custom timbre)
                                  │  conversion) │
                                  └──────────────┘
```

**Runtime**: ONNX Runtime via `ort` crate. DirectML on Windows, CoreML on macOS. **Latency**: 2–10 seconds for a phrase (offline render). **Reference implementation**: OpenUtau's `DiffSingerRenderer.cs` — directly portable logic. **License concern**: The community NSF-HiFiGAN vocoder is CC-BY-NC-SA 4.0. Mitigation: train a custom vocoder on licensed data, use BigVGAN v2 (MIT) as the vocoder instead, or use the DDSP vocoder option.

### Pipeline B: MIDI → expressive performance → neural instrument audio

This pipeline adds human-like expression to flat MIDI scores, then synthesizes instrument audio.

```
┌──────────┐    ┌───────────────┐    ┌──────────────┐    ┌──────────────┐
│ Flat     │───▶│ Performance   │───▶│ TokenSynth   │───▶│ DAC Decoder  │──▶ 44.1kHz WAV
│ MIDI     │    │ Renderer      │    │ (MIT)        │    │ (MIT)        │    (any instrument)
│ Score    │    │ (DExter or    │    │ MIDI → codec │    │              │
│          │    │  ScorePerf.)  │    │ tokens via   │    │              │
│          │    │ adds dynamics,│    │ 5s audio ref │    │              │
│          │    │ timing, artic.│    │ or text desc │    │              │
└──────────┘    └───────────────┘    └──────────────┘    └──────────────┘

                    Alternative instrument path (piano only):
                                  ┌──────────────┐    ┌──────────────┐
                           ──────▶│ MIDI-VALLÉ   │───▶│ EnCodec      │──▶ Piano WAV
                                  │ (CC-BY 4.0)  │    │ Decoder      │
                                  │ + 3s piano   │    │              │
                                  │   reference  │    │              │
                                  └──────────────┘    └──────────────┘
```

**Runtime**: PyTorch via Python sidecar (TokenSynth and MIDI-VALLÉ are not ONNX-exportable yet). **Latency**: 10–60 seconds per phrase (offline). **Key limitation**: TokenSynth has only 4 velocity levels; MIDI-DDSP outputs 16 kHz mono. Neither matches commercial sample libraries. **Best current use**: creative/experimental instrument sounds, not production orchestration.

### Pipeline C: audio → timbre transformation → new instrument identity

This pipeline takes existing audio and transforms its timbre while preserving musical content.

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Source   │───▶│ F0 + Loud-   │───▶│ DDSP Decoder │───▶│ Output Audio │
│ Audio    │    │ ness Extract │    │ (Apache 2.0) │    │ (monophonic, │
│ (voice,  │    │ (CREPE/RMVPE)│    │ trained on   │    │  target      │
│  guitar) │    │              │    │ target instr │    │  instrument) │
└──────────┘    └──────────────┘    └──────────────┘    └──────────────┘

                    Alternative (creative/polyphonic):
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Source   │───▶│ RAVE Encoder │───▶│ Latent Space │───▶│ RAVE Decoder │──▶ Transformed
│ Audio    │    │ (trained on  │    │ Manipulation │    │ (realtime,   │    Audio
│          │    │  target      │    │ (interpolate,│    │  20× RT on   │
│          │    │  instrument) │    │  morph, mix) │    │  CPU)        │
│          │    │              │    │              │    │              │
└──────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

**DDSP path**: Realtime, excellent pitch preservation, monophonic only. Apache 2.0. Needs 13 minutes of training audio per instrument. **RAVE path**: Realtime (20× on CPU), handles polyphonic material, but pitch preservation is approximate and each model must be trained on a specific instrument corpus. **AFTER path** (IRCAM): Higher quality disentanglement of timbre from structure, realtime via MaxMSP, but less mature tooling.

---

## 4. Tauri v2 architecture options

### Option A: Pure Python sidecar

The Tauri v2 shell plugin (`@tauri-apps/plugin-shell`) spawns an external binary as a sidecar process. A PyInstaller-compiled Python backend runs all inference.

**Data flow**: Frontend (WebView) → Tauri IPC → Rust backend → HTTP/TCP to Python sidecar (FastAPI on localhost) → PyTorch inference → audio file or shared memory buffer → Rust reads audio → frontend displays result.

**Pros**: Maximum model compatibility (any PyTorch model works immediately), fastest development iteration, Python ecosystem fully available. **Cons**: PyInstaller + CUDA PyTorch produces a **~2.6 GB minimum** sidecar binary. Startup is slow (2–5 seconds for `--onefile`, better with `--onedir`). CUDA version coupling creates fragile builds. Cross-platform builds require building on each target OS.

**Packaging burden**: Very high. Must ship Python runtime + CUDA libraries + cuDNN + model weights. Total installer could reach 5–15 GB.

### Option B: ONNX Runtime / native Rust

All inference runs through the `ort` crate (Rust bindings for ONNX Runtime, v2.0.0-rc.12). Models are exported to ONNX format and loaded directly in the Rust process.

**Data flow**: Frontend → Tauri IPC → Rust backend → `ort` Session with GPU execution provider → inference → audio buffer → frontend.

**Pros**: Single-process architecture (no IPC overhead), **~50–100 MB binary** (no Python), excellent GPU support across platforms (CUDA, DirectML, CoreML all via `ort` features), crash-free inference (no Python GIL), HuggingFace's `candle` crate provides Rust-native alternatives for some models. **Cons**: Not all models export cleanly to ONNX — diffusion models with dynamic shapes, custom operators, and novel architectures often fail or lose performance. **DiffSinger exports well** (OpenUtau proves this). MusicGen, ACE-Step, TokenSynth, and SoulX-Singer do not have validated ONNX exports.

**Best for**: DiffSinger pipeline, vocoders, codecs, and any model with stable ONNX support.

### Option C: Hybrid (recommended)

Rust core handles DAW engine, audio I/O, and ONNX-based inference for proven models. A Python sidecar handles heavy or experimental PyTorch models.

```
┌─────────────────────────────────────────────────────┐
│                 Tauri v2 App                        │
│  ┌───────────┐    ┌──────────────────────────────┐  │
│  │ Frontend  │    │ Rust Backend                 │  │
│  │ (WebView) │◄──►│  ├─ DAW Engine (MIDI, audio) │  │
│  │           │    │  ├─ ort ONNX Runtime         │  │
│  └───────────┘    │  │  (DiffSinger, vocoders)   │  │
│                   │  ├─ Model Router             │  │
│                   │  └─ IPC Manager              │  │
│                   └────────┬─────────────────────┘  │
│                            │ HTTP + shared memory   │
│                   ┌────────▼─────────────────────┐  │
│                   │ Python Sidecar (FastAPI)      │  │
│                   │  ├─ PyTorch heavy models      │  │
│                   │  │  (ACE-Step, SoulX-Singer,  │  │
│                   │  │   TokenSynth, RVC)         │  │
│                   │  ├─ GPU inference manager     │  │
│                   │  └─ Health endpoint           │  │
│                   └──────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Communication**: HTTP (FastAPI) for the control plane — job submission, status, model management. Shared memory ring buffers (`shmem-ipc` on Linux, `ipmpsc` cross-platform) for zero-copy audio data transfer. The Python sidecar reports its port via stdout on startup; Rust connects and monitors health.

**Process lifecycle**: Rust spawns sidecar via `app.shell().sidecar()`, monitors `CommandEvent::Terminated` for crashes, implements exponential backoff restart. Python sidecar exposes `GET /health` for liveness checks. GPU capabilities (device name, VRAM, compute capability) are reported on startup so Rust can make routing decisions.

**Failure handling**: Sidecar crashes do not take down the main app. In-progress jobs are marked failed and can be retried. Models are lazy-loaded and unloaded when VRAM pressure is detected. The Rust side can continue operating the DAW (MIDI editing, audio playback) even when the AI backend is unavailable.

**Pros**: Best of both worlds — proven ONNX models run natively in Rust with zero overhead, while experimental PyTorch models work through the sidecar. Models can graduate from sidecar to native as ONNX exports mature. **Cons**: Two runtimes to manage, complex first-run setup, per-platform GPU handling.

### Option D: External decoupled service

AI backend runs as a completely separate application (like ComfyUI), communicating via HTTP/WebSocket.

**Pros**: Independent update cycles, user could run the backend on a separate GPU machine, follows the ComfyUI/Stability Matrix pattern. **Cons**: Worst user experience (two separate installs), highest latency, most complex setup. Only recommended if targeting power users who already run local AI tooling.

### Architecture comparison

| Factor                    | A: Python sidecar | B: ONNX native     | C: Hybrid         | D: External  |
| ------------------------- | ----------------- | ------------------ | ----------------- | ------------ |
| Model compatibility       | ★★★★★             | ★★★                | ★★★★★             | ★★★★★        |
| Installer size            | ★★ (2–5 GB)       | ★★★★★ (50–100 MB)  | ★★★               | ★★           |
| Audio transfer efficiency | ★★★ (IPC)         | ★★★★★ (in-process) | ★★★★ (shared mem) | ★★ (network) |
| Crash isolation           | ★★★★★             | ★★                 | ★★★★★             | ★★★★★        |
| Cross-platform complexity | ★★                | ★★★★               | ★★★               | ★★           |
| Development velocity      | ★★★★★             | ★★★                | ★★★★              | ★★★★         |

---

## 5. Packaging and distribution strategy

The installer must be lightweight. Bundling PyTorch + CUDA + models into a single installer produces a **5–15 GB download** — unacceptable for first impressions. The proven pattern, used by LM Studio, Stability Matrix, and ComfyUI Desktop, is a staged approach.

**Stage 1 — Initial install** (~100–200 MB): Ship the Tauri app (Rust binary + WebView frontend) with the `ort` crate statically linked. No Python, no models, no CUDA libraries. Platform-native installers: `.msi` (Windows), `.dmg` (macOS), `.AppImage` (Linux).

**Stage 2 — First-run setup wizard**: Detect GPU hardware via `nvidia-smi` (NVIDIA) or `system_profiler` (macOS). Download the appropriate Python runtime (~50 MB via `uv` or standalone Python build). Install PyTorch with the correct CUDA/Metal/CPU variant. On Windows, DirectML (`onnxruntime-directml`) provides GPU acceleration without any CUDA install — a critical fallback for AMD and Intel GPUs.

**Stage 3 — On-demand model downloads**: In-app model browser backed by HuggingFace Hub. The `hf-hub` Rust crate handles downloads with progress tracking, SHA256 verification, and the standard `~/.cache/huggingface/hub/` cache (shared with other HF tools). DiffSinger voicebanks are ~50–200 MB each. Vocoders are ~50–100 MB. Heavy models (ACE-Step, SoulX-Singer) are 1–4 GB.

**Model size reality**: DiffSinger acoustic model + variance model + vocoder ≈ **200–400 MB** per voice. RVC models ≈ **150 MB** each. ACE-Step base ≈ **2–3 GB**. BigVGAN v2 44 kHz ≈ **400 MB**. Total for a useful working set: **1–5 GB** of models, downloaded incrementally.

**Update strategy**: App updates via Tauri's built-in updater plugin. Model updates via HuggingFace Hub revision tracking (compare local SHA against remote). Python sidecar can be updated independently of the main app.

**GPU dependency handling by platform**:

- **Windows**: ONNX Runtime DirectML works with any DirectX 12 GPU (zero install). For CUDA: bundle `cudart` and `cuDNN` DLLs with the sidecar, or require CUDA Toolkit pre-installed.
- **macOS**: Metal and CoreML are built into the OS. No additional GPU dependencies. ONNX Runtime CoreML EP and PyTorch MPS backend work out of the box. MLX is available for Apple Silicon-optimized inference.
- **Linux**: Require NVIDIA drivers pre-installed (standard for Linux GPU users). Bundle CUDA runtime libraries with the sidecar or link against system CUDA.

---

## 6. Realtime viability by approach

Every candidate falls into one of four categories. **No neural singing or instrument synthesis model achieves true realtime** (sub-20 ms latency) on consumer hardware today. The best achievable for complex generation is "interactive preview" — generating a few seconds of audio in 1–3 seconds.

| Category                           | Latency                            | Models in this tier                                                                                                                              |
| ---------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Realtime** (<20 ms)              | Continuous streaming               | RAVE (20× RT on CPU), DDSP tone transfer (20 ms), RTNeural guitar amp models (<5 ms), vocoders (Vocos, HiFi-GAN, BigVGAN all far above realtime) |
| **Interactive preview** (1–5 s)    | Generate-then-play for short clips | DiffSinger with shallow diffusion (2–5s for a phrase), RVC voice conversion (200–500 ms chunks), Seed-VC streaming (~400 ms)                     |
| **Short clip generation** (5–30 s) | Offline render, user waits         | ACE-Step v1.5 (<10s for full song on 3090), TokenSynth (seconds per phrase), DDSP-Piano (near-RT on GPU)                                         |
| **Offline render only** (30s+)     | Background job, minutes of wait    | MIDI-DDSP (2.5–5× RT), MIDI-VALLÉ, MusicGen (10–30s per 10s clip), YuE (minutes), SoulX-Singer (TBD)                                             |

**Practical DAW workflow**: The user edits MIDI and lyrics in the piano roll, hits "render," and the system generates audio in the background (5–30 seconds for a phrase). A low-quality preview can use shallow diffusion with fewer steps for near-instant feedback. Final render uses full diffusion steps for maximum quality. This matches AceStudio's "Turbo Mode" pattern — not truly realtime, but fast enough for iterative editing.

---

## 7. MVP recommendation

### Feature: MIDI + lyrics → singing voice (offline render)

**Why this feature first**: It is the core value proposition of AceStudio, has a proven open-source pipeline (DiffSinger + OpenUtau), offers the best quality-to-effort ratio, and creates immediate differentiation from existing DAWs. Full-song generation (ACE-Step) is impressive but less controllable; instrument synthesis is too immature.

**Model stack**:

- **Phonemizer**: Language-specific grapheme-to-phoneme (g2p) — DiffSinger's built-in phonemizer handles Chinese; `espeak-ng` or `g2p-en` for English
- **Variance model**: DiffSinger OpenVPI variance predictor (ONNX) — predicts duration, F0, energy, breathiness, voicing, tension from phoneme + note input
- **Acoustic model**: DiffSinger OpenVPI acoustic model (ONNX) — shallow diffusion with configurable depth (fewer steps = faster, more steps = higher quality)
- **Vocoder**: **BigVGAN v2 44 kHz** (MIT) for final render quality, **Vocos** (MIT) for preview speed. Train or fine-tune on singing data if needed. Alternatively, use the community NSF-HiFiGAN (accepting CC-BY-NC-SA for initial prototyping, replacing later)
- **Optional voice conversion**: RVC/Applio (MIT) as a post-processing step for custom voice timbre

**Architecture**: Start with Option C (Hybrid). Use `ort` in Rust for the full DiffSinger ONNX pipeline (this is the proven path — OpenUtau does exactly this in C#). Add the Python sidecar for RVC voice conversion and future experimental models. Communication via HTTP for job control + shared memory for audio buffers.

**Development sequence**:

1. Port OpenUtau's DiffSinger rendering logic from C# to Rust using `ort`
2. Build a piano-roll UI in the Tauri WebView frontend
3. Implement the phonemizer → variance → acoustic → vocoder pipeline
4. Add model download and management (HuggingFace Hub)
5. Add RVC post-processing via Python sidecar
6. Monitor SoulX-Singer maturity — if ONNX export becomes available, evaluate as primary engine replacement (Apache 2.0 + zero-shot cloning would eliminate per-voice training)

**Hardware requirements**: RTX 3060 (12 GB) or Apple M1+ (8 GB unified). CPU-only mode viable but ~10× slower. DiffSinger ONNX inference on CPU takes 10–30 seconds per phrase; on GPU, 2–5 seconds.

---

## 8. Risk register

| Risk                                                | Severity | Likelihood | Mitigation                                                                                                                                                |
| --------------------------------------------------- | -------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DiffSinger vocoder license (CC-BY-NC-SA)**        | High     | Certain    | Train custom BigVGAN v2 vocoder on licensed singing data. Or negotiate with OpenVPI community. Or use DDSP vocoder.                                       |
| **GPU availability fragmentation**                  | High     | High       | DirectML on Windows covers AMD/Intel/NVIDIA. CoreML on macOS covers all Apple Silicon. CPU fallback always available.                                     |
| **Model quality insufficient for paying users**     | High     | Medium     | Set expectations appropriately. Position as "AI-assisted" not "AI-replaces-singer." Complement with RVC for voice quality. Monitor SoulX-Singer.          |
| **Python sidecar packaging complexity**             | Medium   | High       | Follow Transformer Lab's approach: `uv` for Python management, conda for CUDA. Implement first-run wizard. Budget 2–4 weeks of packaging engineering.     |
| **ONNX export breaks for new models**               | Medium   | Medium     | Maintain PyTorch sidecar path as fallback. Only graduate models to ONNX after thorough testing. Pin ONNX opset versions.                                  |
| **Model instability / regressions**                 | Medium   | Medium     | Pin model versions. Checksum verification. Allow users to roll back to previous model versions.                                                           |
| **Cross-platform audio latency differences**        | Medium   | Medium     | Use `cpal` (Rust audio library) with platform-specific backends. Test on Windows (WASAPI/ASIO), macOS (CoreAudio), Linux (ALSA/PulseAudio/JACK).          |
| **VRAM exhaustion with multiple models**            | Medium   | High       | Implement model unloading when not in use. Only one heavy model loaded at a time. Report VRAM budget to user.                                             |
| **Maintenance burden of multi-runtime system**      | Medium   | Certain    | Architect for gradual migration to ONNX-only. Document everything. CI/CD for all platforms.                                                               |
| **IRCAM/RAVE license ambiguity for commercial use** | Low      | Medium     | Contact IRCAM directly for commercial licensing terms before shipping RAVE-based features. DDSP (Apache 2.0) is the safe alternative for timbre transfer. |
| **Apple Silicon performance gaps**                  | Low      | Medium     | CoreML EP and MLX provide good acceleration. Test early and often on M-series. Some models may need Apple-specific optimization.                          |

---

## 9. Build vs wait matrix

This matrix categorizes each capability by whether the technology is mature enough to build now, worth prototyping to validate feasibility, or too immature to invest in.

| Capability                                            | Verdict                       | Rationale                                                                                                                                                               |
| ----------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MIDI + lyrics → singing voice (DiffSinger)**        | **Build now**                 | Production-proven via OpenUtau. ONNX pipeline works. Voicebanks available. Clear integration path.                                                                      |
| **Voice conversion post-processing (RVC)**            | **Build now**                 | MIT license, mature ecosystem, well-documented, ONNX export available. Adds immediate value.                                                                            |
| **Full-song generation (ACE-Step)**                   | **Prototype**                 | Apache 2.0, consumer GPU viable, impressive quality. But text-to-song is less controllable than MIDI-based synthesis. Build a prototype to evaluate DAW integration UX. |
| **Zero-shot singing (SoulX-Singer)**                  | **Prototype**                 | Apache 2.0 + zero-shot would be transformative. But very new (Feb 2026), no ONNX export, untested at scale. Build a sidecar prototype.                                  |
| **MIDI → instrument audio (TokenSynth)**              | **Prototype**                 | MIT, any-instrument, but limited velocity and possible note accuracy issues. Worth prototyping for creative use cases.                                                  |
| **Realtime timbre transfer (RAVE)**                   | **Prototype**                 | Realtime on CPU is impressive. But license unclear for commercial, requires per-instrument training. Prototype with Neutone SDK.                                        |
| **MIDI → orchestral instruments (MIDI-DDSP)**         | **Wait**                      | 16 kHz output, TensorFlow dependency, and quality far below commercial orchestral libraries. Wait for improvements.                                                     |
| **Piano synthesis (MIDI-VALLÉ)**                      | **Wait**                      | Best open-source piano quality, but complex dependencies and piano-only. Wait for simpler integration or ONNX export.                                                   |
| **Monophonic timbre transfer (DDSP)**                 | **Build now** (limited scope) | Apache 2.0, proven VST exists, fast training. Worth including as a creative tool even if limited to monophonic.                                                         |
| **Text-to-audio/SFX (Stable Audio Open)**             | **Wait**                      | Good for sound effects but not core DAW workflow. Community license has revenue cap. Not a priority.                                                                    |
| **MusicGen / AudioCraft**                             | **Wait**                      | CC-BY-NC blocks commercial use. Not MIDI-conditioned. Wait for permissively licensed alternatives.                                                                      |
| **MIDI → expressive timing (DExter, ScorePerformer)** | **Prototype**                 | Adds realism to flat MIDI. Lightweight, could run in Rust. Worth evaluating as a preprocessing step.                                                                    |

---

## 10. How close can we get to AceStudio locally?

AceStudio's core value comes from four pillars: **massive voice library** (140+ voices across 8 languages), **real-time parameter editing** (instant audio feedback), **studio-grade naturalness** (proprietary models trained on professional recordings), and **deep expressive control** (pitch curves, consonant timing, vibrato, breathiness, tension, emotion). An honest assessment of achievable parity:

**Voice library**: DiffSinger has ~16 community voicebanks, mostly Chinese with some English and Japanese. SoulX-Singer offers zero-shot cloning across Chinese, English, and Cantonese. Combined, this provides a **fraction of AceStudio's variety** but a viable starting point. RVC can extend any base voice with timbre conversion from minimal training data.

**Real-time editing**: AceStudio renders parameter changes in near-realtime. Open-source DiffSinger with shallow diffusion takes 2–5 seconds per phrase on GPU. This is **not instant** but workable for iterative editing — comparable to rendering a software instrument in a DAW. A "draft preview" mode using fewer diffusion steps (50× speedup factor) can approach 1-second rendering for short phrases.

**Naturalness**: The quality gap is **real but narrowing**. Well-trained DiffSinger voices on clean datasets produce convincing vocals for straightforward singing. They fall short on emotional range, complex melisma, and cross-lingual pronunciation. SoulX-Singer's 42,000-hour training set may close this gap further, but the model needs more community validation.

**Expressive control**: DiffSinger supports variance parameters (energy, breathiness, voicing, tension, pitch expression) and voice color curves for blending vocal modes. This provides **meaningful expressiveness** — less granular than AceStudio's full control suite, but sufficient for musical use. The missing pieces are AceStudio's style-specific vocal modes (Power, Soft, Breathy, Chest, Rap, Opera) which require per-voice style training.

**Bottom line**: A local-first DAW built on DiffSinger + RVC + BigVGAN v2, with SoulX-Singer as a next-generation engine, can deliver **70–80% of AceStudio's core singing capability** today. The remaining 20–30% gap is in voice variety, emotional nuance, and editing responsiveness. This gap is closing quarter by quarter. The recommended strategy is to ship the 70–80% now and iterate — the local-first, no-subscription, fully-offline value proposition compensates for the quality delta for many users, as Synthesizer V's commercial success demonstrates.

# Browser-first singing synthesis: achieving AceStudio parity on UI/UX

**The UI/UX challenge is not to invent a radically new interface. It is to combine three patterns that users already understand — DAW arrangement, piano-roll note editing, and AI-assisted direct manipulation — into a browser-first workflow that feels fast, traceable, and safe to experiment with.** The strongest evidence from current singing-synthesis products and broader HCI research points in the same direction: users want familiar editing surfaces, immediate visual feedback, lightweight access to advanced controls, and AI that behaves like a reversible assistant rather than an opaque black box. The best path is not “AI-first UI.” It is **producer-first UI with AI embedded into existing music workflows**.

This report translates that into a full product blueprint for a browser-local singing editor. It covers benchmarked patterns from ACE Studio and Synthesizer V, user feedback from public communities, complex-application UX guidance, and human-AI co-creation research. The conclusion is straightforward: a browser app can compete on usability if it is built around **fast iteration, strong system-status visibility, progressive disclosure, robust keyboard workflows, and traceable AI suggestions**.

---

## 1. Core conclusion

A browser-first singing tool should aim for **DAW familiarity on the surface and AI depth underneath**.

That means:

- **Primary canvas:** arrangement + piano roll, not chat.
- **Primary interaction style:** direct manipulation, not form filling.
- **Primary AI role:** generate, suggest, retake, and explain — never trap the user.
- **Primary trust mechanism:** every AI output must be previewable, comparable, undoable, and attributable to visible controls.
- **Primary performance rule:** the interface must stay interactive even when synthesis is not instant.

The key benchmark products already signal this direction. ACE Studio 2.0 is described as adding “a more DAW-like workflow” and “a DAW-like environment canvas.” Synthesizer V is repeatedly praised for its familiar piano-roll workflow, phoneme editing, and parameter control. Broader UX research reinforces the same pattern: complex creative tools work best when visible objects can be edited directly, system status is always clear, and advanced complexity is layered rather than dumped on screen.

---

## 2. What current products are teaching us

### ACE Studio’s visible trajectory

ACE Studio’s strongest UI signal is not any single feature. It is the move toward **an all-in-one music workspace**.

> “ACE Studio 2.0 begins an ambitious expansion beyond its vocal synthesis roots, with v2 evolving into an all-in-one AI music studio environment that adds a more DAW-like workflow...” — John Walden, _Sound On Sound_ review excerpt reposted by ACE Studio, March 2026

That matters because it suggests where user expectations are heading:

1. A singing tool is no longer judged only as a voice editor.
2. Users increasingly expect arrangement context, audio context, and generation context in one place.
3. Browser-first products should avoid forcing constant mode switches between “editor,” “generator,” and “export tool.”

### Synthesizer V’s stronger day-to-day workflow signal

Synthesizer V offers the clearest evidence for what producers actually value in daily use.

From the official manual:

> “Synthesizer V Studio allows a combination of automatic pitch generation by AI, direct editing of pitch curves, and manual pitch editing using parameters.”

> “The AI Retakes panel allows you to adjust the amount of variation in the pitch curves generated by the AI.”

> “In Direct Pitch Editing mode, edit the pitch curves directly on the Piano Roll.”

These are not cosmetic details. They point to the winning interaction model:

- AI generates a reasonable default.
- The result is shown in the same editing surface.
- Users can override it directly.
- Variation is managed as a first-class UI concept.

Public user feedback around Synthesizer V reinforces the same pattern.

> “The workflow is improved, the phoneme editing is vastly superior.” — user comment, r/SynthesizerV

> “I love the new mouth opening parameter and the phoneme timing panel, it allows for easier control over the way different words are pronounced.” — user comment, r/SynthesizerV

At the same time, requests from users expose the friction points that still matter:

> “Allow copy-paste of vocal mode settings between groups.”

> “Add shortcuts to nudge selected notes left/right...”

> “Option to lock/unlock group positions in the arrangement to prevent accidental moves.”

> “Often we just want to tweak a note and replay the same section...”

These requests are extremely valuable because they are not abstract UX opinions. They show where expert workflows live or die:

- repeated operations,
- tiny note-level adjustments,
- accidental destructive moves,
- and fast A/B replay of the same musical passage.

### The practical benchmark

The best competitive target is therefore not “copy AceStudio’s look” or “copy SynthV’s layout.” It is to match the **underlying workflow principles**:

- DAW-like overview at the project level,
- piano-roll precision at the note level,
- curve editing for expression,
- simple default views with deep optional controls,
- and AI retakes that fit into an editing workflow rather than interrupt it.

---

## 3. The most important UX principle: direct manipulation

For this product category, direct manipulation is not a nice-to-have. It is the foundation.

NN/g defines it this way:

> “Direct manipulation is an interaction style in which UI elements are visible and can be acted upon via actions that receive immediate feedback.”

And more specifically:

> “Users act on displayed objects of interest using physical, incremental, and reversible actions whose effects are immediately visible on the screen.”

That maps almost perfectly to singing synthesis editing:

- notes are visible objects,
- pitch curves are visible objects,
- phoneme boundaries are visible objects,
- parameter curves are visible objects,
- and AI changes should appear as visible, reversible deltas.

### Product implication

The interface should treat **notes, phonemes, curves, retakes, and phrase boundaries as manipulable objects**, not settings buried in dialogs.

The browser UI should therefore prioritize:

- drag note to move pitch/time,
- drag note edge to change duration,
- drag phoneme split handles,
- draw pitch deviation directly over notes,
- draw breath/tension/gender curves inline,
- drag retake options onto a phrase or selected note region,
- audition changes on hover or scrubbing where feasible.

### Anti-pattern to avoid

Do not turn advanced vocal editing into a stack of sidebar forms. Sidebars are useful for exact values and presets, but the main work should happen on the canvas.

---

## 4. The second principle: visibility of system status

Browser-local singing synthesis has an unavoidable UX problem: generation is not instant. That makes feedback design central.

NN/g’s warning is blunt:

> “The visibility of system status is a basic tenet of a great user experience.”

And for complex applications:

> “The design should always keep users informed about what is going on, through appropriate feedback within a reasonable amount of time.”

Apple’s guidance on progress indicators is equally direct:

> “Progress indicators let people know that your app isn't stalled while it loads content or performs lengthy operations.”

Material adds an important operational distinction:

> “When using a determinate indicator, the indicator must accurately represent the progress of what it's measuring.”

### Product implication

Because browser singing synthesis often takes seconds rather than milliseconds, the UI must expose **pipeline-aware status**, not just a generic spinner.

Recommended render states:

1. **Queued** — waiting behind another phrase or model load.
2. **Preparing** — phonemizing / building tensors.
3. **Synthesizing expression** — AI pitch/variance pass.
4. **Rendering audio** — acoustic + vocoder pass.
5. **Ready** — cached and playable.
6. **Stale** — visible change exists that has not yet been re-rendered.
7. **Preview quality** vs **final quality** — explicitly labeled.

Recommended UI treatment:

- phrase-level progress bars on the canvas,
- a global render queue panel,
- a cache badge on phrases that are already up to date,
- “stale after edit” indicators,
- explicit cancel / reprioritize actions,
- and an estimate only when confidence is good enough.

### Why this matters

In music tools, uncertainty kills flow. If the user cannot tell whether the app is loading a model, rendering a phrase, waiting on a queue, or simply frozen, trust collapses fast.

---

## 5. Progressive disclosure is mandatory

Singing synthesis is inherently parameter-heavy. That does not mean the default UI has to be overwhelming.

NN/g’s guidance is simple:

> “To reduce complexity in a user interface, employ progressive disclosure to defer secondary options...”

And in complex applications specifically, designers should prevent overwhelm by “putting things in predictable places, using a clear visual hierarchy, and taking advantage of progressive disclosure.”

### Product implication

The app should ship with a **three-layer control model**:

#### Layer 1 — fast composition view

Visible by default.

- arrangement timeline
- piano roll
- lyrics on notes
- playback and loop controls
- voice selector
- one-click render / preview
- one expression preset selector
- one macro slider group: naturalness, energy, brightness, gender, breathiness

This is the mode for most users, most of the time.

#### Layer 2 — guided vocal shaping

Shown on demand, still friendly.

- pitch deviation lane
- vibrato lane or vibrato overlay tool
- phoneme timing view
- phrase-level retakes
- note properties panel
- language / pronunciation assistance
- parameter lane chooser

This is where everyday serious editing happens.

#### Layer 3 — expert surgery

Hidden until explicitly opened.

- per-phoneme duration table
- raw variance curves
- seed control
- retake masks
- model quality/speed selector
- speaker-blend curves
- frame-level expression tools
- debug / provenance panel

This is where power users can go deep without scaring everyone else.

### Default rule

Never show every lane, every parameter, and every AI option at once. Let users progressively “open the instrument.”

---

## 6. The right mental model: not a chatbot, an instrument

The best research on music-oriented AI co-creation points in a consistent direction: musicians enjoy novelty, but they quickly become frustrated when AI is unpredictable or untraceable.

From an evaluation of a creative AI music system:

> “Users report experiences of novelty, surprise and ease of use... and limitations on controllability and predictability of the interface when generating music.”

From a study of composers evaluating an AI music tool:

> “Concerns around trust, transparency, and ethical design” shaped feedback.

> “Composers valued transparency in how variations evolve from the source material.”

> “Some suggested that having the ability to visually and interactively follow how the model transforms the output... could help them better understand and select variations that align with their artistic intentions.”

This is exactly the right design constraint for browser-first singing synthesis.

### Product implication

The app should present AI as an **auditionable variation engine with visible causality**, not as an all-knowing generator.

That means:

- show what changed,
- show why it changed,
- show how to undo it,
- let users pin what should stay fixed,
- and let users compare multiple alternatives side by side.

### Specific UI patterns for AI trust

#### A. Retake trays

For any phrase or selected note range, offer 3–5 retakes as mini-cards:

- waveform thumbnail
- pitch contour thumbnail
- tags like “more natural,” “brighter consonants,” “flatter pitch,” “stronger vibrato”
- seed / model / mode metadata
- one-click apply
- one-click pin original

#### B. Change overlays

When AI regenerates something, overlay the delta:

- old pitch in gray,
- new pitch in color,
- changed phoneme durations as highlighted splits,
- changed parameters as shaded deltas.

#### C. Locks and scopes

Users should be able to lock:

- note timing,
- pitch,
- lyrics,
- phoneme timing,
- voice identity,
- selected parameter lanes.

Then “Regenerate” works only on the unlocked scope.

#### D. Provenance chips

Every generated phrase should expose lightweight provenance:

- voice,
- language,
- seed,
- render quality,
- date/time,
- cache status,
- model version.

Trust improves when outputs are legible objects rather than mysterious artifacts.

---

## 7. The winning workspace layout

The best default workspace for this category is a **three-region pro-app layout**.

### Region 1 — arrangement strip

Top band.

Purpose:

- project overview,
- track relationships,
- phrase boundaries,
- muting/soloing,
- loop range,
- section naming,
- quick navigation.

Design target: enough context to think musically, not enough detail to edit phonemes.

### Region 2 — primary piano-roll editor

Largest center region.

Purpose:

- note placement,
- lyric entry,
- pitch and timing editing,
- phrase selection,
- audition,
- overlays for generated pitch and expression.

This must remain the visual center of the app.

### Region 3 — contextual inspector

Right side by default, collapsible.

Purpose:

- exact values,
- voice/style settings,
- retakes,
- parameter tabs,
- pronunciation tools,
- note properties,
- export / render details.

Future Music’s review of Synthesizer V 2 describes a pattern worth copying:

> “The green tinted user interface works with the familiar piano roll environment and then utilizes clever tabs along the right side to open up specific parameters...”

That is a strong model because it keeps the canvas primary while still making deep settings nearby.

### Bottom utility strip

Optional, collapsible.

Use for:

- mixer,
- render queue,
- warnings,
- batch operations,
- comparison player,
- model downloads.

### Layout rule

The center canvas should never get visually bullied by chrome. Producers need room to see notes, words, and curves.

---

## 8. Parameter editing should use linked controls, not single controls

NN/g’s recommendation is especially relevant here:

> “Linked controls support coarse and fine parameter selection and ensure both ease of exploration and precision.”

And another NN/g guideline warns:

> “Users will have a hard time achieving precision” with pure path-steering controls like sliders unless additional mechanisms exist.

### Product implication

Every expressive vocal parameter should support **three linked editing modes**:

1. **Macro control** — slider / knob / preset chip.
2. **Precise numeric control** — exact value entry.
3. **Temporal control** — draw lane / handles on a curve.

For example, breathiness:

- global track slider for quick exploration,
- note-level number input for exact matches,
- automation lane for phrase shaping.

For vibrato:

- preset chips like Natural / Pop / Dramatic / None,
- rate/depth numeric fields,
- visual envelope overlay directly on selected notes.

### Why this matters

Music editing alternates between broad expressive exploration and surgical correction. A single control type never covers both modes well.

---

## 9. The most valuable editing flows

The highest-value UI work is not glamorous. It is the set of loops users repeat hundreds of times.

### Flow 1 — sketch melody fast

User goal: rough in melody and lyrics as fast as possible.

Best pattern:

- paste or import MIDI,
- inline lyric typing across selected notes,
- quick split/merge notes,
- real-time piano pitch preview when moving notes,
- auto phrase segmentation,
- instant low-quality preview.

### Flow 2 — fix one awkward word

User goal: stop one lyric from sounding wrong.

Best pattern:

- click note,
- open pronunciation popover near the note,
- edit phoneme timing inline,
- A/B solo that note or microphrase,
- no need to open a separate screen.

This is strongly supported by user praise for phoneme timing features in SynthV.

### Flow 3 — audition expressive alternatives

User goal: try different interpretations without losing the current one.

Best pattern:

- select phrase,
- generate retakes,
- preview each in place,
- compare with original,
- apply only pitch, only timing, only timbre, or all.

### Flow 4 — tune a repeated chorus fast

User goal: propagate useful settings across sections.

Best pattern:

- copy/paste vocal settings across groups,
- save reusable expression presets,
- apply lane presets to selected regions,
- link repeated phrases optionally,
- allow break-link for local changes.

This directly addresses public user requests around copy-paste and faster repeated edits.

### Flow 5 — micro-edit and replay

User goal: tweak, replay same bar, tweak again.

Best pattern:

- playhead return on stop,
- sticky loop,
- pre-roll toggle,
- instant phrase-only replay,
- audition selection shortcut.

If this loop is not frictionless, the whole product feels slow no matter how good the synthesis is.

---

## 10. Browser-specific UX opportunities

A browser-first singing tool has limitations, but it also has a few unusual UX advantages.

### Advantage 1 — frictionless entry

Users can open a project link or demo in seconds. That makes onboarding, templates, and collaboration previews easier than desktop-only tools.

### Advantage 2 — progressive asset loading

A browser app can start with a thin shell and pull models, voices, and optional tools on demand. The UI can treat heavy capabilities as installable modules instead of initial clutter.

### Advantage 3 — better empty states

NN/g notes:

> “Empty states provide opportunities for designers to communicate system status, increase learnability of the system, and deliver direct pathways for key tasks.”

This is especially powerful in a browser context, where the app may initially have no downloaded voice, no project, and no cached audio.

Recommended empty states:

- **No project loaded:** show template choices and import options.
- **No voice installed:** explain voice packs and offer one-click starter voice.
- **No phrase selected:** show quick actions relevant to the current track.
- **No render yet:** show how preview vs final rendering works.
- **No audio permission / MIDI unavailable:** clear browser-specific guidance.

### Advantage 4 — inline docs and examples

Because help content can live in the same shell, browser products can embed mini tutorials, hover demos, and example projects without forcing the user into PDFs or external docs.

---

## 11. Latency UX is a product feature, not a fallback

Jakob Nielsen’s classic response-time thresholds still matter:

- around **0.1 seconds** feels instantaneous,
- around **1 second** keeps flow mostly uninterrupted,
- around **10 seconds** risks losing attention.

A browser singing tool often lands in the 1–10 second zone for meaningful synthesis work. That means the app must be designed for **productive waiting**.

NN/g’s summary on complex applications is directly relevant:

> “5 guidelines help users tolerate the long waits and frequent interruptions that are typical of complex workflows.”

### Product implication

While a phrase renders, the user should still be able to:

- edit another track,
- type lyrics,
- scrub existing audio,
- queue another render,
- inspect retakes already generated,
- and continue arranging.

### Recommended latency patterns

#### A. Two-tier rendering

- Draft preview renders automatically.
- Final-quality renders are explicit and batchable.

#### B. Phrase-local invalidation

Only the edited phrase becomes stale. Everything else remains playable.

#### C. Predictive pre-render

When the user stops editing for a beat, pre-render likely next actions:

- current phrase,
- neighboring phrase,
- selected retake candidate.

#### D. Transparent prioritization

Let users choose:

- render current selection first,
- render audible loop range,
- render all stale phrases in background.

#### E. Accurate progress language

Never say “almost done” unless you know that. Use honest stage labels instead.

---

## 12. Accessibility and inclusivity requirements

This category often ignores accessibility because it is seen as a pro tool. That is a mistake.

A browser-first product should aim to be better than incumbents in a few concrete ways.

### Essential accessibility requirements

- full keyboard navigation for transport, note nudging, and selection
- screen-reader labels for controls, state badges, and progress
- high-contrast theme and robust zoom
- non-color-only status signaling
- large enough note handles and lane targets
- reduced-motion option for animated cursors and loading indicators
- captions/text summaries for AI warnings and render errors

### Power-user accessibility is workflow accessibility

Apple’s keyboard guidance is relevant here:

> “Keyboard users often appreciate using keyboard shortcuts to speed up their interactions...”

In pro creative software, keyboard efficiency is not only an expert luxury. It is an accessibility feature for anyone minimizing strain, avoiding precision mousing, or working quickly.

### High-value shortcut targets

- nudge note left/right/up/down
- split/merge note
- cycle parameter lanes
- open pronunciation editor
- audition selected phrase
- generate retakes
- accept best retake
- lock/unlock selection
- return playhead to start of selection

---

## 13. User feedback themes that should drive the roadmap

Across product reviews, manuals, and public community feedback, the same needs keep showing up.

### Theme 1 — Familiarity wins

Users repeatedly respond well to piano-roll and DAW-like paradigms because they reduce learning cost.

> “The familiar piano roll environment...” — _Future Music_, April 2025

> “Users can edit pitch curves, vibrato depth, and phoneme timing through an intuitive piano-roll interface...” — Dreamtonics product page

### Theme 2 — Fine-grained pronunciation control matters

This is one of the clearest recurring praise points.

> “Phoneme editing is vastly superior.”

> “The phoneme timing panel... allows for easier control over the way different words are pronounced.”

### Theme 3 — AI must stay controllable

Users appreciate assistance, but not when it becomes hard to predict or steer.

> “Limitations on controllability and predictability...” — study on AI music-composition UX

### Theme 4 — Transparency builds trust

Not only around ethics, but around outputs and transformations.

> “Composers valued transparency in how variations evolve from the source material.”

### Theme 5 — Small workflow irritations are disproportionately expensive

Requests for better copy/paste, note nudging, playhead behavior, and locking may look minor, but they compound over every session.

### Theme 6 — Complexity is acceptable only when layered

Users will tolerate a deep tool if the first-run view is legible and advanced editing is progressively disclosed.

---

## 14. Recommended feature-to-pattern mapping

| Product need               | Best UI pattern                                   | Why                       |
| -------------------------- | ------------------------------------------------- | ------------------------- |
| Melody entry               | Piano roll with inline lyric entry                | Familiar, fast, scalable  |
| Global vocal shaping       | Macro parameter strip + presets                   | Fast exploration          |
| Precise expression editing | Automation lanes and direct pitch drawing         | Fine control              |
| AI variation               | Retake tray with side-by-side compare             | Trust + audition          |
| Pronunciation fixes        | Inline phoneme popover and timing panel           | Localized problem solving |
| Style switching            | Inspector presets + region-based automation       | Powerful but contained    |
| Long renders               | Phrase progress, stale badges, queue panel        | Clear feedback            |
| Repeat edits               | Presets, copy/paste attributes, linked phrases    | Efficiency                |
| Multi-track work           | DAW-like arrangement strip and mixer drawer       | Context                   |
| Learnability               | Empty states, templates, guided overlays          | Faster activation         |
| Browser constraints        | Progressive loading and installable voice modules | Lower startup cost        |
| Power-user speed           | Keyboard-first editing and context menus          | Reduced friction          |

---

## 15. UX blueprint for the MVP

The MVP should not try to expose every parameter. It should prove the workflow.

### MVP screen design

#### Top bar

- project name
- save status
- undo/redo
- transport
- loop toggle
- render selection
- voice picker
- model/cache status

#### Left sidebar

- project navigator
- track list
- templates
- assets / installed voices

#### Center

- arrangement mini-map on top
- piano roll below
- inline lyrics on notes
- optional one visible lane at a time under notes

#### Right inspector

Tabbed:

- Voice
- Note
- Pronunciation
- Retakes
- Render

#### Bottom drawer

- mixer
- render queue
- warnings/log

### MVP interaction goals

The first session should let a new user:

1. load a template,
2. enter or import notes,
3. type lyrics,
4. click preview,
5. fix one word,
6. draw one pitch change,
7. compare one retake,
8. export audio.

If the product cannot make those eight steps feel obvious, it is not ready, even if the model stack is impressive.

---

## 16. UX blueprint for the full product

### Phase 1 — browser proof of workflow

Goal: show that the browser can feel like a real editing tool, not a demo.

Must-have UX:

- one voice
- one language
- piano roll
- lyric entry
- phrase preview
- progress states
- undo/redo
- downloadable demo project

### Phase 2 — serious editing

Goal: become usable for actual song sections.

Add:

- pronunciation editor
- direct pitch drawing
- note properties
- parameter lanes
- keyboard shortcuts
- looped audition
- phrase cache states

### Phase 3 — AI trust layer

Goal: make generation feel professional, not random.

Add:

- retake tray
- scoped regeneration
- locks
- A/B compare
- provenance chips
- preview/final quality distinction

### Phase 4 — arrangement-grade workspace

Goal: compete with standalone editors on daily usability.

Add:

- multi-track arrangement
- mixer drawer
- track colors and grouping
- reusable presets
- linked chorus phrases
- batch rendering

### Phase 5 — pro depth

Goal: satisfy advanced vocal producers.

Add:

- frame-level expert controls
- speaker/style automation
- collaborative review links
- region comments
- advanced keyboard customization
- workspace presets

---

## 17. UX risk register

| Risk                                               | Severity | Likelihood | UX mitigation                                                  |
| -------------------------------------------------- | -------- | ---------- | -------------------------------------------------------------- |
| Interface feels like a research demo, not a DAW    | High     | High       | Anchor everything in arrangement + piano roll                  |
| Too many visible controls overwhelm users          | High     | High       | Three-layer progressive disclosure                             |
| AI output feels random or untrustworthy            | High     | High       | Retakes, locks, change overlays, provenance                    |
| Browser rendering delays feel like freezing        | High     | High       | Detailed system-status feedback and queue control              |
| Advanced controls become form-heavy and slow       | Medium   | High       | Keep editing on-canvas; inspector only for precision           |
| Repeat tasks become tedious                        | High     | High       | Copy/paste attributes, presets, linked phrases, shortcuts      |
| Accidental edits break trust                       | Medium   | High       | Strong undo, object locking, non-destructive operations        |
| Users cannot learn why a phrase sounds wrong       | Medium   | Medium     | Pronunciation guidance, visible phoneme timing, smart warnings |
| Large workspace feels cramped in browser           | Medium   | High       | Collapsible panels, focus modes, bottom drawers                |
| Product excludes keyboard-only or low-vision users | Medium   | Medium     | Shortcut parity, high contrast, robust zoom, accessible labels |

---

## 18. What “best-in-class” looks like

A best-in-class browser singing product would feel like this:

- Opening the app presents a clear project shell, not a blank technical screen.
- The first meaningful action happens in under a minute.
- Notes, words, and curves are edited directly on the canvas.
- AI defaults are good, but never final unless the user wants them to be.
- Every generated change is visible, comparable, and undoable.
- Waits are explained precisely enough that the user never thinks the tab is dead.
- Advanced power is available, but not dumped on day-one users.
- Repetitive micro-edits are fast because shortcuts, presets, and playhead behavior are thoughtfully designed.
- The user feels they are playing an instrument and directing a performer, not wrestling a machine-learning pipeline.

---

## 19. Final recommendation

The best UI/UX strategy is to build **the most legible, direct, and trustworthy singing editor in the category**, not the flashiest AI interface.

The evidence points to a simple product thesis:

1. **Use a DAW-like arrangement plus piano-roll center of gravity.**
2. **Make expression editing direct and visual.**
3. **Hide depth until it is needed.**
4. **Treat AI as a set of scoped, reversible suggestions.**
5. **Make latency visible and manageable.**
6. **Obsess over tiny workflow details.**

That combination is more important than any single model feature. The products users praise most are not just the ones that sound good. They are the ones that let users get from idea to convincing result without confusion, fear, or wasted motion.

In other words: **AceStudio parity on UI/UX is achievable, but it will come less from copying visual design and more from mastering workflow design.**

---

## Appendix: quoted evidence used in this report

### Product and review signals

> “ACE Studio 2.0 begins an ambitious expansion beyond its vocal synthesis roots, with v2 evolving into an all-in-one AI music studio environment that adds a more DAW-like workflow...” — _Sound On Sound_ review excerpt reposted by ACE Studio, March 2026

> “The green tinted user interface works with the familiar piano roll environment and then utilizes clever tabs along the right side to open up specific parameters...” — _Future Music_, April 2025

> “Users can edit pitch curves, vibrato depth, and phoneme timing through an intuitive piano-roll interface...” — Dreamtonics product page

### Manual and official workflow signals

> “Synthesizer V Studio allows a combination of automatic pitch generation by AI, direct editing of pitch curves, and manual pitch editing using parameters.” — Synthesizer V manual

> “The AI Retakes panel allows you to adjust the amount of variation in the pitch curves generated by the AI.” — Synthesizer V manual

> “In Direct Pitch Editing mode, edit the pitch curves directly on the Piano Roll.” — Synthesizer V manual

### Public user feedback signals

> “The workflow is improved, the phoneme editing is vastly superior.” — user comment, r/SynthesizerV

> “I love the new mouth opening parameter and the phoneme timing panel...” — user comment, r/SynthesizerV

> “Allow copy-paste of vocal mode settings between groups.” — user comment, r/SynthesizerV

> “Add shortcuts to nudge selected notes...” — user comment, r/SynthesizerV

> “Option to lock/unlock group positions...” — user comment, r/SynthesizerV

### UX and HCI signals

> “Direct manipulation is an interaction style in which UI elements are visible and can be acted upon via actions that receive immediate feedback.” — Nielsen Norman Group

> “The visibility of system status is a basic tenet of a great user experience.” — Nielsen Norman Group

> “Linked controls support coarse and fine parameter selection and ensure both ease of exploration and precision.” — Nielsen Norman Group

> “Empty states provide opportunities for designers to communicate system status, increase learnability of the system, and deliver direct pathways for key tasks.” — Nielsen Norman Group

> “Progress indicators let people know that your app isn't stalled while it loads content or performs lengthy operations.” — Apple Human Interface Guidelines

### Human-AI music research signals

> “Users report experiences of novelty, surprise and ease of use... and limitations on controllability and predictability of the interface when generating music.” — study on AI music-composition UX

> “Composers valued transparency in how variations evolve from the source material.” — study on composers evaluating an AI music tool

> “Some suggested that having the ability to visually and interactively follow how the model transforms the output...” — study on composers evaluating an AI music tool
