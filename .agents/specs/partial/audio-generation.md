# Audio generation pipeline — singing synthesis MVP

## Context

This spec translates the findings from `.agents/research/pipelines/audio-generation.md` into concrete requirements for the first shippable AI audio generation feature in Sourdaw. The research establishes that local-first AI singing synthesis is now feasible, with DiffSinger (OpenVPI fork) as the production-proven engine, and recommends a hybrid architecture (Rust ONNX + Python sidecar) as the integration pattern.

Sourdaw already has foundational infrastructure for AI audio work:

- **Python sidecar architecture** — `src-tauri/sidecar/audio_gen.py` runs Stable Audio Open Small via JSON-over-stdin IPC, managed by `src-tauri/src/commands/audio_gen.rs`. This proves the sidecar spawn/IPC/lifecycle pattern works.
- **ONNX Runtime** — `ort` v2.0.0-rc.12 is already a dependency, used for Demucs stem separation in `src-tauri/src/commands/ai_audio.rs` (native) and `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts` (browser via `onnxruntime-web`).
- **Model download infrastructure** — `src-tauri/src/commands/model_download.rs` handles cached downloads to `~/.local/share/com.sourdaw.app/models/` with SHA256 verification, progress logging, disk-space checks, and 10 MB chunked streaming.
- **RAVE neural audio stores** — `src/modules/AudioEngine/stores/rave.ts` defines `RaveModel`, `LatentVector`, `RaveState`, and factory model metadata (ONNX-based). Use cases under `src/modules/AudioEngine/useCases/rave/` implement `encodeAudio`, `decodeLatent`, `timbreTransfer`, `interpolateLatent`, `randomizeLatent`, `loadModel`, `unloadModel`. These are placeholder implementations (spectral feature simulation, no actual ONNX inference) but establish the store/useCase shape.
- **Audio post-processing** — `src-tauri/src/commands/audio_postprocess.rs` provides bar-length trim/pad, normalization to -1 dB headroom, and equal-power crossfades at loop boundaries.
- **Audio decoding** — `crates/daw-io/src/audio_decode.rs` via Symphonia handles WAV, FLAC, MP3, OGG, AAC, ALAC.
- **Audio engine** — `crates/daw-engine/` manages the CPAL audio thread, lock-free scheduler, ring-buffer bridges, and plugin hosting (VST3/CLAP).

The research identifies three maturity tiers: **Build now** (DiffSinger singing synthesis, RVC voice conversion, DDSP timbre transfer), **Prototype** (ACE-Step full-song generation, SoulX-Singer zero-shot, TokenSynth instruments), and **Wait** (MIDI-DDSP, MIDI-VALLE, MusicGen). This spec covers the Build-now tier for singing synthesis and the foundational model-routing infrastructure that all tiers share.

---

## Goal

After implementation, Sourdaw can generate singing voice audio from MIDI notes + lyrics using the DiffSinger ONNX pipeline running natively in Rust, with optional RVC voice conversion via the Python sidecar, producing WAV output that the existing audio engine can play back on a track.

---

## User-visible behavior

1. **Voice browser** — The user opens a model browser that lists available DiffSinger voicebanks. Each entry shows: voice name, language, size, download status (not downloaded / downloading / ready). The user clicks to download a voicebank; progress is shown inline. Downloaded voicebanks persist across sessions.

2. **Singing synthesis render** — The user selects a region of MIDI notes that have lyrics assigned (via the existing piano roll), chooses a voice, and triggers "Render Voice." The system shows phrase-level progress through pipeline stages: Phonemizing → Predicting variance → Synthesizing audio → Applying vocoder. When complete, the rendered audio appears as a clip on the track, playable immediately.

3. **Render quality modes** — Two modes: **Preview** (fewer diffusion steps, faster, lower quality) and **Final** (full diffusion steps, slower, higher quality). Preview is the default for iterative editing. Final is explicit and batchable.

4. **Render queue** — Multiple phrases can be queued. The queue is visible. Phrases render in priority order (current selection first, then audible loop range, then background). Users can cancel or reprioritize.

5. **Stale detection** — After the user edits MIDI notes or lyrics in a rendered phrase, the phrase is marked "stale" with a visual badge. Stale phrases are not automatically re-rendered; the user triggers re-render explicitly or via a "Render all stale" action.

6. **Voice conversion (optional post-processing)** — If the Python sidecar is running and an RVC model is loaded, the user can apply voice conversion to a rendered singing clip. This replaces the clip audio with the re-voiced version. The original is retained in the undo stack.

7. **Provenance metadata** — Each rendered phrase stores: voice name, language, seed, render quality (preview/final), diffusion steps, model version, render timestamp. This metadata is inspectable in the note inspector panel.

---

## Scope

**In scope:**

- DiffSinger ONNX inference pipeline in Rust (phonemizer, variance model, acoustic model, vocoder)
- Model router that directs inference to the correct runtime (native ONNX vs Python sidecar)
- DiffSinger voicebank download and management via HuggingFace Hub
- BigVGAN v2 (MIT) as the primary vocoder, Vocos (MIT) as the preview vocoder
- Grapheme-to-phoneme (g2p) for **English and Chinese** in v1 (the two languages with mature DiffSinger voicebanks). **Japanese** voicebanks exist in the community but are **out of scope** for v1 until phonemizer and voicebank licensing are specified (see Open questions).
- Render queue with priority, cancellation, and progress reporting
- Preview vs Final render quality modes
- Stale phrase detection after MIDI/lyric edits
- RVC voice conversion via Python sidecar (post-processing, optional)
- Provenance metadata on rendered phrases
- Frontend module for managing voice models, render state, and queue (new `SingingVoice` module or extension of existing `AudioAnalysis`)

**Non-goals (explicitly out of scope):**

- Real-time streaming synthesis (all rendering is offline; interactive preview is 2-5 seconds per phrase, not sub-20ms)
- Full-song generation (ACE-Step) — prototype tier, separate spec
- Instrument synthesis (TokenSynth, MIDI-DDSP) — prototype/wait tier
- RAVE timbre transfer integration beyond the existing placeholder — separate spec
- SoulX-Singer integration — no ONNX export exists yet; monitor only
- Piano roll UI for lyric entry — assumed to exist or be specified separately
- Arrangement-level multi-track vocal workflow — Phase 4 per research UX blueprint
- Retake tray / A-B compare UI — Phase 3 per research UX blueprint; deferred to a companion UX spec (see Open questions)
- Lock/unlock semantics for AI-generated regions (pitch, timing, lyrics, voice identity) — research §6 — deferred to the companion UX spec
- Change overlays (old-pitch-in-gray vs new-pitch-in-color deltas after regeneration) — research §6 — deferred to the companion UX spec
- Training custom voicebanks or vocoders
- Browser-only (WASM) DiffSinger inference — Tauri-native only for MVP
- Custom vocoder training to replace CC-BY-NC-SA NSF-HiFiGAN
- First-run setup wizard UI — the wizard is required (see Constraints), but its UI design and onboarding flow are a separate spec

---

## Requirements

### Model infrastructure

1. **Model router** — A Rust-side model router dispatches inference requests to the appropriate runtime. For ONNX models (DiffSinger, vocoders): load and run via `ort` in-process. For PyTorch models (RVC, future experimental models): route to the Python sidecar via the existing JSON-over-stdin IPC protocol. The router selects runtime based on a model's declared `runtime` field (`onnx-native` or `python-sidecar`).

2. **Model registry** — A persistent registry of known models and their state. Each entry stores: `model_id`, `name`, `category` (voicebank / vocoder / voice-conversion / variance), `runtime` (onnx-native / python-sidecar), `repo_id` (HuggingFace repo), `files` (list of filenames within the repo), `size_bytes`, `sha256` (per file), `download_status` (not-downloaded / downloading / ready / error), `local_path`. The registry is stored as a JSON file in the model cache directory and loaded at startup. It extends the existing `model_download.rs` infrastructure.

3. **Model download** — Downloads use the existing `model_download::ensure_model()` pattern: HuggingFace Hub URL, SHA256 verification, disk-space check, chunked streaming with progress events. DiffSinger voicebanks typically consist of 2-4 ONNX files (variance model, acoustic model, vocoder, optional phonemizer) totaling 200-400 MB per voice. The download emits Tauri events (`model-download-progress`, `model-download-complete`, `model-download-error`) that the frontend subscribes to.

4. **Model lifecycle** — ONNX sessions are created lazily on first inference and cached in memory (using the same `OnceLock` pattern as the existing Demucs session in `ai_audio.rs`). Sessions are unloaded on explicit request or when VRAM pressure is detected (via a configurable memory budget). Only one heavy model (acoustic model) is loaded at a time; the vocoder session is smaller and can remain resident.

5. **GPU execution providers** — ONNX Runtime is configured per-platform: CoreML EP on macOS, DirectML EP on Windows, CUDA EP on Linux (with CPU fallback on all platforms). The execution provider is selected at startup based on hardware detection and exposed to the frontend as a capability report.

### DiffSinger pipeline

6. **Phonemizer** — Converts lyrics text to phoneme sequences using language-specific grapheme-to-phoneme rules. For English: a dictionary-based g2p (CMU Pronouncing Dictionary or equivalent) with fallback rules. For Chinese: pinyin-based phonemizer matching DiffSinger's expected phoneme set. The phonemizer runs in Rust (no Python dependency). Input: UTF-8 lyric string + language tag. Output: ordered list of phoneme tokens matching the target voicebank's phoneme inventory.

7. **Variance model inference** — Takes phoneme sequence + MIDI note data (pitch, duration, position) and predicts: duration per phoneme, F0 (fundamental frequency) contour, energy contour, breathiness contour, and optionally voicing/tension. Runs via `ort` ONNX session. Input tensor shape follows the OpenVPI DiffSinger convention. Output: per-frame variance parameters at the model's hop rate (typically 512 samples at 44.1 kHz, i.e., ~11.6 ms per frame).

8. **Acoustic model inference** — Takes variance model output (F0, energy, breathiness, phoneme embeddings) and generates a mel-spectrogram via shallow diffusion. Configurable diffusion depth: fewer steps for preview (e.g., 20 steps), more for final quality (e.g., 100 steps). Runs via `ort` ONNX session. The shallow diffusion approach is what makes DiffSinger fast enough for interactive use (50x speedup factor per the research).

9. **Vocoder inference** — Converts mel-spectrogram to waveform audio. Two vocoders:
    - **Vocos** (MIT, ~50 MB) — 6,700x realtime, used for Preview renders. Optimized for speed.
    - **BigVGAN v2 44 kHz** (MIT, ~400 MB) — 45-135x realtime, used for Final renders. Optimized for quality across music, speech, and effects.
      Both run via `ort` ONNX sessions. Output: 44.1 kHz float32 PCM audio buffer.

10. **Pipeline orchestration** — The full pipeline runs as an async task on Tokio, not on the audio thread. Steps are sequential within a phrase but parallelizable across phrases. Each step emits a progress event to the frontend. The pipeline:
    1. Phonemize lyrics for the phrase
    2. Build input tensors from MIDI + phoneme data
    3. Run variance model → duration, F0, energy, breathiness
    4. Run acoustic model (shallow diffusion) → mel-spectrogram
    5. Run vocoder → PCM audio buffer
    6. Apply post-processing (normalization to -1 dB, fade-in/out at phrase boundaries)
    7. Write result to the generated audio cache directory
    8. Emit completion event with audio path + provenance metadata

11. **Phrase segmentation** — Long sequences are split into phrases at rest boundaries (gaps between MIDI notes exceeding a configurable threshold, default 500ms). Each phrase is rendered independently. Phrase boundaries include 10ms crossfade overlap for seamless concatenation, using the existing `audio_postprocess.rs` crossfade logic.

### Voice conversion (RVC post-processing)

12. **RVC via Python sidecar** — Voice conversion runs through the existing Python sidecar architecture. A new `rvc_convert` command is added to the sidecar protocol. Input: path to rendered WAV + RVC model ID + optional parameters (pitch shift semitones, index ratio). Output: path to converted WAV. The sidecar manages RVC model loading (lazy, one at a time). RVC models are ~150 MB each (MIT license).

13. **RVC model management** — RVC models are registered in the same model registry as DiffSinger voicebanks, with `runtime: python-sidecar` and `category: voice-conversion`. Download and verification use the same infrastructure.

13a. **Sidecar lifecycle and resilience (RVC path)** — If the Python sidecar is not installed, any RVC request MUST fail fast with a user-visible error ("Install Python companion to use voice conversion") and MUST NOT degrade the DiffSinger-only path. If the sidecar process exits unexpectedly during an RVC job, the job MUST fail with a user-visible error and the app MUST NOT crash. A new RVC request after crash MUST re-spawn the sidecar following the existing `audio_gen` spawn pattern (single immediate retry; no exponential backoff in v1). A `rvc_health` command (ping → pong) MAY be used pre-flight to surface "sidecar unreachable" as a distinct error from "model not loaded". Exponential-backoff restart and continuous-health monitoring (research §4 Option C) are deferred.

### Render queue

14. **Queue manager** — A Rust-side render queue accepts render requests and executes them in priority order. Priority levels: `immediate` (current user action), `audible` (within the active loop range), `background` (everything else). The queue supports: enqueue, cancel by phrase ID, cancel all, reprioritize. Queue state is exposed to the frontend via Tauri events.

15. **Concurrency** — One render runs at a time per GPU (to avoid VRAM contention). CPU renders may run concurrently if the CPU execution provider is active and system resources allow. The queue manager respects a configurable concurrency limit (default: 1).

### Frontend integration

16. **SingingVoice module** — A new frontend module `src/modules/SingingVoice/` following the existing domain-driven architecture. Contains:
    - `stores/`: render queue state, voice model registry state, active render progress
    - `repositories/`: Tauri IPC wrappers for render commands, model download commands, queue commands
    - `useCases/`: `renderPhrase`, `renderAllStale`, `cancelRender`, `downloadVoice`, `removeVoice`, `applyVoiceConversion`, `getAvailableVoices`
    - `models/`: `RenderRequest`, `RenderResult`, `VoiceModel`, `RenderProgress`, `PhraseProvenance`, `QueueEntry`
    - `presentations/views/`: Voice browser panel, render queue panel
    - `events/`: render-complete, render-progress, phrase-stale

17. **Phrase-render state on clips** — Each singing clip in the arrangement carries render metadata: `renderStatus` (not-rendered / rendering / preview / final / stale), `provenance` (voice, seed, quality, steps, model version, timestamp), and `audioPath` (path to cached WAV). When the underlying MIDI or lyrics change, `renderStatus` transitions to `stale`.

18. **Progress UI** — Render progress for each phrase shows the current pipeline stage and a determinate progress bar. Stages map to the research-recommended render states: Queued → Preparing (phonemizing/tensor building) → Synthesizing expression (variance model) → Rendering audio (acoustic + vocoder) → Ready. A global render queue panel shows all pending/active/completed renders.

### Tauri commands

19. **New Tauri commands** — The following `#[tauri::command]` functions are added to `src-tauri/src/commands/`:
    - `render_singing_phrase` — accepts MIDI notes, lyrics, voice model ID, quality mode; returns render result or enqueues
    - `cancel_singing_render` — cancels a queued or in-progress render by phrase ID
    - `get_render_queue` — returns current queue state
    - `list_voice_models` — returns registered models with download status
    - `download_voice_model` — starts download of a voicebank by model ID
    - `remove_voice_model` — deletes local model files
    - `get_gpu_capabilities` — returns detected GPU, VRAM, available execution providers
    - `apply_rvc_conversion` — sends RVC request to sidecar, returns converted audio path

---

## Constraints

- Must follow the domain-driven module architecture per `AGENTS.md` — cross-module imports only via root `index.ts`, one function per useCase/repository file, no deep imports.
- Audio rendering runs on Tokio async tasks, never on the CPAL audio thread. The audio thread only plays back already-rendered WAV files via the existing ring-buffer bridge mechanism.
- No allocation, mutex locks, or blocking on the audio thread — all existing audio-thread safety rules apply.
- All ONNX inference uses `ort` v2.0.0-rc.12 (already a dependency). No additional ML frameworks in Rust.
- Python sidecar follows the existing JSON-over-stdin IPC protocol established by `audio_gen.py`/`audio_gen.rs`. No new IPC mechanisms. **Deviation from research:** research §4 "Option C" prescribes HTTP (FastAPI) + shared-memory ring buffers for zero-copy audio as the hybrid transport; this MVP deliberately standardizes on the **existing stdin-JSON sidecar** for cost and consistency. RVC is therefore specified as **file-in / file-out** (paths passed in JSON) rather than streaming audio over shared memory. Any future migration to the research-recommended transport is a separate spec.
- Model downloads go through `model_download.rs` infrastructure. No new download mechanisms.
- License safety: only MIT or Apache 2.0 model weights for shippable features. The community DiffSinger NSF-HiFiGAN vocoder is CC-BY-NC-SA 4.0 — it must NOT be shipped. BigVGAN v2 (MIT) and Vocos (MIT) are the approved vocoders.
- Generated audio files are cached in `~/.local/share/com.sourdaw.app/generated/singing/` with deterministic naming based on input hash (MIDI data + lyrics + voice + quality + seed), enabling cache hits on re-render.
- **First-run setup required.** Per research §5, the initial installer (~100–200 MB) ships with the Tauri app and `ort` statically linked — no Python, no CUDA, no models. On first launch, the app must detect GPU hardware, install the correct Python/PyTorch variant via `uv` (or equivalent) only if RVC is requested, and pull the first voicebank + vocoder on demand via HuggingFace Hub. Existing Stable Audio Open sidecar setup already uses a compatible pattern — reuse it; do not introduce a second sidecar runtime.
- **GPU execution provider selection is mandatory on startup.** Windows without CUDA must fall back to DirectML (covers AMD/Intel/NVIDIA via DirectX 12) rather than CPU — CPU is the last-resort fallback, not the default. macOS uses CoreML; Linux uses CUDA when drivers are present.
- **Accessibility baseline.** Render progress, stale badges, queue state, and provenance chips must be keyboard-navigable, screen-reader-labeled, and communicate state through shape/text rather than color alone, per research §12. Specific shortcut bindings and full keyboard workflows are deferred to the companion UX spec.
- **Latency UX targets.** Per research §11 (Nielsen response-time thresholds), the preview pipeline targets ≤1 s perceived start (queue acknowledgment + first progress frame) and ≤5 s to first audible output on Apple M1 / equivalent GPU. Progress stages must be labeled honestly per the research UX appendix section **"The second principle: visibility of system status"** ("queued", "preparing", "synthesizing expression", "rendering audio", "ready", "stale"); generic spinners and "almost done" language are disallowed. (Note: this references the UX appendix in the research file, not the technical "§4 Tauri architecture options" section.)
- `pnpm deps:validate` must pass with zero violations after implementation.
- The frontend must not import from `src-tauri/` or any Rust crate directly — all communication is via Tauri IPC commands and events.

---

## Design decisions

### Decision: ONNX-native DiffSinger in Rust (not Python sidecar)

**Chosen:** Run the full DiffSinger pipeline (phonemizer, variance, acoustic, vocoder) via `ort` in the Rust process.

**Considered and rejected:**

- **Python sidecar for DiffSinger** — rejected because DiffSinger's ONNX export is production-proven (OpenUtau ships this way in C#), the `ort` crate is already integrated and tested (Demucs works), and in-process inference eliminates IPC overhead for the latency-sensitive preview path. The sidecar adds ~2.6 GB packaging burden and 2-5 second startup latency that is unnecessary for ONNX-compatible models.
- **candle (Rust-native ML)** — rejected because DiffSinger models are trained in PyTorch and exported to ONNX; reimplementing the architecture in candle would be high-effort with no quality benefit. ONNX Runtime is the standard path.

### Decision: BigVGAN v2 + Vocos dual vocoder (not NSF-HiFiGAN)

**Chosen:** BigVGAN v2 (MIT) for final quality, Vocos (MIT) for preview speed.

**Considered and rejected:**

- **Community NSF-HiFiGAN** — rejected because it is licensed CC-BY-NC-SA 4.0, which blocks commercial use. The research flags this as a "High severity, Certain likelihood" risk.
- **Single vocoder** — rejected because the quality/speed tradeoff is significant. BigVGAN v2 at 45-135x realtime is fast enough for final renders but slower than Vocos at 6,700x realtime. Preview needs speed; final render needs quality.
- **DDSP vocoder** — considered as a license-safe alternative but rejected for MVP scope. DDSP vocoders are monophonic and require per-instrument training. May be revisited for the timbre transfer feature.

### Decision: Hybrid architecture — native ONNX + Python sidecar

**Chosen:** Rust handles DiffSinger ONNX pipeline natively; Python sidecar handles RVC and future experimental models.

**Considered and rejected:**

- **Pure ONNX native** — rejected because RVC's full pipeline (HuBERT + VITS + FAISS retrieval) does not have a validated single-ONNX export. The sidecar is needed for models that don't export cleanly.
- **Pure Python sidecar** — rejected because it adds 2-5 GB packaging burden and eliminates the performance advantage of in-process ONNX inference for the primary DiffSinger pipeline.
- **External service (ComfyUI-style)** — rejected for worst user experience (two separate installs). Only suitable for power users.

### Decision: Offline phrase rendering (not streaming synthesis)

**Chosen:** Render entire phrases offline (2-10 seconds per phrase on GPU), cache results, play back from cache.

**Considered and rejected:**

- **Real-time streaming** — rejected because no neural singing synthesis model achieves sub-20ms latency on consumer hardware. The research confirms this across all candidates. The best achievable for complex generation is "interactive preview" at 1-5 seconds.
- **Chunk-by-chunk streaming** — rejected for MVP. Could be added later for the preview path where partial audio plays back as it generates, but adds significant complexity to the render pipeline and audio engine integration.

### Decision: New SingingVoice module (not extension of AiRuntime or AudioAnalysis)

**Chosen:** Create `src/modules/SingingVoice/` as a dedicated domain module.

**Considered and rejected:**

- **Extend AiRuntime** — rejected because AiRuntime is focused on LLM chat/dictation/speech. Singing synthesis is a distinct domain with its own models, pipeline, and UI surface.
- **Extend AudioAnalysis** — rejected because AudioAnalysis handles analysis (stem separation, denoising). Singing synthesis is generative, not analytic. The `generateAudio` function in AudioAnalysis is for Stable Audio Open text-to-audio, which is a different pipeline and use case.
- **Extend AudioEngine** — rejected because AudioEngine owns the real-time audio thread, CPAL, and plugin hosting. Singing synthesis is offline rendering, not real-time DSP. The RAVE placeholder in AudioEngine is a different feature (real-time timbre transfer).

### Decision: Deterministic cache keying for rendered phrases

**Chosen:** Cache key = SHA256(MIDI note data + lyrics + voice model ID + quality mode + diffusion steps + seed). Same inputs produce the same cache key, enabling instant cache hits when re-rendering unchanged phrases.

**Considered and rejected:**

- **No caching** — rejected because re-rendering unchanged phrases wastes 2-10 seconds per phrase.
- **Timestamp-based cache** — rejected because it never produces cache hits.
- **Content-addressable with eviction** — chosen implicitly. Cache grows until a configurable limit (default 5 GB), then LRU eviction removes oldest entries.

---

## Acceptance criteria

- [ ] `render_singing_phrase` Tauri command accepts MIDI notes + lyrics + voice model ID + quality mode, runs the full DiffSinger pipeline (phonemize → variance → acoustic → vocoder), and returns a path to a valid 44.1 kHz WAV file
- [ ] Rendered audio for a simple English phrase (4-8 notes, single syllable per note) is recognizable as sung speech matching the input melody
- [ ] Preview mode completes in under 5 seconds per phrase on Apple M1 8GB (or equivalent GPU)
- [ ] Final mode produces audibly higher quality than preview mode for the same input
- [ ] Vocos is used for preview renders; BigVGAN v2 is used for final renders
- [ ] Voice model browser lists available DiffSinger voicebanks with correct download status
- [ ] Downloading a voicebank shows progress, completes successfully, and the voice becomes available for rendering
- [ ] Downloaded models persist across app restarts (stored in `~/.local/share/com.sourdaw.app/models/`)
- [ ] Model SHA256 verification catches corrupted downloads and triggers re-download
- [ ] Render queue accepts multiple phrases and processes them in priority order (immediate > audible > background)
- [ ] Cancelling a queued render removes it; cancelling an in-progress render stops it within 2 seconds
- [ ] Editing MIDI notes or lyrics in a previously rendered phrase marks it as "stale"
- [ ] Re-rendering a phrase with identical inputs hits the cache and returns immediately (no inference)
- [ ] RVC voice conversion via Python sidecar produces a re-voiced WAV when an RVC model is available
- [ ] Pipeline progress events are emitted per stage (phonemizing, variance, acoustic, vocoder) and received by the frontend
- [ ] GPU capabilities are detected and reported correctly (CoreML on macOS, DirectML on Windows, CUDA on Linux, CPU fallback everywhere)
- [ ] No model weights with CC-BY-NC-SA or other non-commercial licenses are bundled or downloaded by default
- [ ] Provenance metadata (voice, seed, quality, steps, model version, timestamp) is stored with each rendered phrase and retrievable from the frontend
- [ ] `pnpm deps:validate` passes with zero violations
- [ ] `pnpm typecheck` passes with zero errors
- [ ] No ONNX inference runs on the CPAL audio thread — rendering is async on Tokio only
- [ ] Cache eviction removes oldest entries when cache exceeds 5 GB
- [ ] On first run, a DiffSinger voicebank + BigVGAN v2 vocoder can be downloaded and rendered end-to-end without the Python sidecar being installed (RVC is optional)
- [ ] On Windows without CUDA, rendering uses the DirectML execution provider (not CPU) when a DX12 GPU is present; the capability report reflects this
- [ ] Progress UI uses the exact stage labels from the research UX appendix — section "visibility of system status" — ("queued", "preparing", "synthesizing expression", "rendering audio", "ready", "stale"); no generic spinners or "almost done" language
- [ ] Playback of rendered WAV works on Windows (WASAPI), macOS (CoreAudio), and Linux (ALSA/PulseAudio) without per-platform adjustments from the singing-voice code path — this is a regression check for the existing audio engine rather than new functionality, but the release gate is explicit
- [ ] When the Python sidecar is missing, RVC is visibly disabled in the UI and requesting voice conversion produces a single user-visible error without degrading DiffSinger-only rendering
- [ ] Render progress, stale badges, queue state, and provenance chips are keyboard-navigable, screen-reader-labeled, and communicate state through shape/text rather than color alone

---

## Implementation notes

### Porting DiffSinger from OpenUtau

The primary reference implementation is OpenUtau's `DiffSingerRenderer.cs`. Key classes to port:

- `DiffSingerSinger` — model loading, phoneme inventory parsing, voicebank metadata
- `DiffSingerRenderer` — the render pipeline orchestration
- `DiffSingerVariance` — variance model inference (duration, F0, energy, breathiness)
- `DiffSingerAcoustic` — acoustic model inference (mel-spectrogram via shallow diffusion)

OpenUtau uses ONNX Runtime in C# — the `ort` Rust crate provides the same API surface. Tensor shapes and model formats are identical.

### Phonemizer implementation

DiffSinger voicebanks include a `dsdict.txt` mapping graphemes to phonemes. The phonemizer must:

1. Tokenize lyrics into words
2. Look up each word in the dictionary
3. Fall back to rule-based g2p for unknown words
4. Map phonemes to the voicebank's phoneme inventory indices
5. Insert silence/breath tokens at phrase boundaries

For English, the CMU Pronouncing Dictionary (~134k words) covers most cases. For Chinese, DiffSinger uses pinyin-to-phoneme mapping.

### ONNX session management

Follow the existing pattern from `ai_audio.rs`:

```rust
static DIFF_SINGER_SESSION: OnceLock<ort::Session> = OnceLock::new();
```

But extend to support multiple sessions (variance, acoustic, vocoder) and multiple voicebanks. A `ModelSessionCache` struct maps `(model_id, model_type)` to loaded `ort::Session` instances with LRU eviction.

### Integration with existing audio engine

Rendered singing clips are standard WAV files. They integrate with the existing audio engine the same way any audio clip does — the arrangement/clip system references the file path, and playback uses the existing `daw-io` decoding and ring-buffer bridge. No changes to the audio thread or scheduler are needed.

### Python sidecar extension for RVC

The existing `audio_gen.py` sidecar handles Stable Audio Open. RVC support can be added as a new backend class alongside `StableAudioBackend`:

```python
class RvcBackend:
    def __init__(self, model_path, device):
        # Load RVC model
    def convert(self, input_wav_path, pitch_shift=0, index_ratio=0.75):
        # Run voice conversion, return output path
```

The sidecar's main loop already dispatches on `command` field — add `rvc_load` and `rvc_convert` commands.

### Tensor format reference

DiffSinger ONNX models expect (from OpenUtau's implementation):

- **Variance model input**: `phoneme_ids` [1, T_phoneme], `note_midi` [1, T_phoneme], `note_duration` [1, T_phoneme], `note_rest` [1, T_phoneme]
- **Variance model output**: `duration` [1, T_phoneme], `f0` [1, T_frame], `energy` [1, T_frame], `breathiness` [1, T_frame]
- **Acoustic model input**: `f0` [1, T_frame], `energy` [1, T_frame], `breathiness` [1, T_frame], `phoneme_ids` [1, T_frame], `speed` [1]
- **Acoustic model output**: `mel` [1, 128, T_frame]
- **Vocoder input**: `mel` [1, 128, T_frame], `f0` [1, T_frame]
- **Vocoder output**: `audio` [1, 1, T_sample]

Frame rate: 44100 / 512 = ~86.13 frames/second.

---

## Test plan

- [ ] **Unit: Phonemizer** — English g2p produces correct phoneme sequences for known words ("hello" → HH AH L OW) and handles unknown words via fallback rules
- [ ] **Unit: Tensor building** — MIDI notes + phoneme sequence produce correctly shaped tensors matching DiffSinger's expected input format
- [ ] **Unit: Cache key generation** — Same inputs produce same cache key; different inputs produce different keys
- [ ] **Unit: Phrase segmentation** — A sequence of MIDI notes with a 600ms gap is split into two phrases; a sequence with no gap >500ms remains one phrase
- [ ] **Integration: Full pipeline** — Render a 4-note English phrase end-to-end, verify output is a valid 44.1 kHz stereo WAV file with non-silent audio
- [ ] **Integration: Model download** — Download a test voicebank, verify files exist at expected paths with correct SHA256
- [ ] **Integration: Render queue** — Enqueue 3 phrases, verify they complete in priority order, verify cancel works
- [ ] **Integration: Cache hit** — Render a phrase, render the same phrase again, verify second render returns immediately from cache
- [ ] **Integration: Stale detection** — Render a phrase, modify one MIDI note, verify render status transitions to stale
- [ ] **Integration: RVC** — If Python sidecar + RVC model available, apply voice conversion and verify output WAV exists and differs from input
- [ ] **Manual: Audio quality** — Listen to rendered phrases and confirm they are recognizable as singing matching the input melody and lyrics
- [ ] **Manual: Progress UI** — Trigger a render and observe that all pipeline stages appear in the progress display in correct order

---

## Open questions

- [ ] **[CRITICAL]** Which specific DiffSinger voicebanks should be included in the default model registry? The research mentions ~16 community voicebanks, mostly Chinese with some English and Japanese. We need at least one English voicebank with fully MIT/Apache 2.0 compatible weights (not just code). Candidate: OpenVPI's open-source voicebanks — but their vocoder weights are CC-BY-NC-SA. This is resolvable by using BigVGAN v2 as vocoder, but the acoustic model weights' licenses must be individually verified.

- [ ] **[CRITICAL]** Is BigVGAN v2 directly compatible with DiffSinger's mel-spectrogram output format? DiffSinger typically produces 128-bin mel-spectrograms at a specific frequency range. BigVGAN v2 was trained on a potentially different mel configuration. If incompatible, a mel-spectrogram adapter or fine-tuning would be needed. OpenUtau uses NSF-HiFiGAN (CC-BY-NC-SA) — there may not be a drop-in MIT vocoder that works out of the box. This must be validated before implementation begins.

- [ ] **[CRITICAL]** What is the exact ONNX model format for the DiffSinger variance and acoustic models? The tensor shapes documented above are derived from OpenUtau's C# source, but the specific opset version, dynamic axis names, and optional inputs (e.g., speaker embedding for multi-speaker models) must be confirmed against actual exported ONNX files.

- [ ] **[MINOR]** Should the phonemizer be implemented purely in Rust, or should it use a compiled dictionary (e.g., embedded CMU dict as a `phf` hash map)? Pure Rust is simpler to maintain and deploy; a compiled dictionary is faster for lookup but adds ~5 MB to the binary.

- [ ] **[MINOR]** What seed strategy provides the best balance of reproducibility and variation? DiffSinger's shallow diffusion is somewhat deterministic given the same seed. Users should be able to pin a seed for reproducible renders and randomize for variation. The default should be random-per-render with a visible seed that can be copied and reused.

- [ ] **[MINOR]** Should the cache eviction policy be LRU, LFU, or size-based? LRU is simplest and sufficient for MVP. The research does not specify a preference.

- [ ] **[MINOR]** How should phrase crossfade overlap be handled when two adjacent singing phrases have different voicebanks or voice conversion settings? The simplest approach is no crossfade between heterogeneous phrases (hard cut), with crossfade only between homogeneous phrases.

- [ ] **[MINOR]** Where does the companion UX spec for Phase 2–5 of the research UX blueprint live? Proposal: a new `.agents/specs/features/singing-voice-editor.md` covering pronunciation editor, direct pitch drawing, parameter lanes, keyboard shortcuts, retake tray, locks, provenance chips, A/B compare, and the three-region layout (arrangement strip / piano-roll / inspector). Confirm naming and scope boundary before writing.

- [ ] **[MINOR]** How should GPU VRAM pressure be surfaced to the user when a requested render exceeds the available budget? Research §8 flags VRAM exhaustion as a "Medium severity, High likelihood" risk. Simplest: expose detected VRAM in the capability report, block renders that would exceed (available - safety_margin), and prompt the user to either unload another model or fall back to CPU.

- [ ] **[MINOR]** Should the model cache share the standard HuggingFace Hub path (`~/.cache/huggingface/hub/`)? Research §5 notes this as the conventional location; this spec uses a Sourdaw-scoped path (`~/.local/share/com.sourdaw.app/models/`) for isolation and cache-invalidation control. Confirm whether interoperability with other HF tooling on the user's machine is a design goal before release; if yes, symlinking or mirroring is a minimal accommodation.

- [ ] **[MINOR]** Confirm explicitly that prototype-tier models (ACE-Step full-song, SoulX-Singer zero-shot, TokenSynth instruments) do **not** ship in the v1 Python sidecar image. Research §4 lists them in the sidecar Option C diagram; this spec implicitly excludes them by scoping the sidecar to RVC, but they should be named as out-of-scope here so the sidecar image size and Python dependency surface stay bounded.

- [ ] **[MINOR]** Should HuggingFace model revisions be pinned in the registry (so a server-side re-upload does not silently change local behavior)? Research §5 calls out update-strategy gaps. Minimal v1 answer: record the `sha256` per file (already required); a future spec can add `revision` pinning and user-visible rollback if model churn becomes a real problem.

---

## Tradeoffs and risks

1. **Vocoder compatibility risk (HIGH)** — BigVGAN v2 and Vocos may not produce acceptable quality when fed DiffSinger's mel-spectrograms without fine-tuning. If vocoder compatibility fails, the fallback is to use the CC-BY-NC-SA NSF-HiFiGAN for development/prototyping only and invest in vocoder fine-tuning before commercial release.

2. **Model size and first-run experience** — A minimal working set (one voicebank + vocoder) is ~400-600 MB of downloads. This is acceptable for a desktop DAW but must be clearly communicated. The research recommends a first-run setup wizard — this is not in scope for the MVP spec but should be planned.

3. **GPU fragmentation** — ONNX Runtime's execution providers have different maturity levels. CoreML EP on macOS is well-tested. DirectML EP on Windows covers all GPUs but may have performance gaps vs CUDA. CPU fallback is always available but 10x slower. Testing must cover all three platforms.

4. **Phonemizer accuracy** — Rule-based g2p for English handles ~90% of words correctly. Unusual words, proper nouns, and borrowed words may produce incorrect phonemes, leading to mispronunciation. The CMU dictionary covers common cases; a fallback rule set handles the rest. Users can eventually override phonemes manually (out of scope for this spec, in scope for the UX Phase 2 pronunciation editor per research).

5. **VRAM pressure** — Loading the acoustic model (~200 MB in VRAM) plus vocoder (~100-400 MB) plus the OS and other apps may exceed 8 GB on entry-level hardware. The model lifecycle manager must unload aggressively. On Apple Silicon, unified memory helps but the budget is still constrained.

6. **Sidecar packaging for RVC** — The Python sidecar for RVC adds packaging complexity (Python runtime + PyTorch + RVC dependencies). This is the same challenge as the existing Stable Audio Open sidecar. The research estimates 2-4 weeks of packaging engineering. For MVP, RVC is optional — the feature degrades gracefully to DiffSinger-only if the sidecar is not available.

7. **OpenUtau C# → Rust port fidelity** — Subtle differences in floating-point behavior, tensor padding, or phoneme handling between the C# and Rust implementations could produce different-sounding output. The port must be validated against OpenUtau's output for the same input, using reference test cases.

8. **Setting quality expectations for paying users (research §8 High / Medium)** — Open-source DiffSinger is ~70–80% of AceStudio's naturalness for straightforward singing and falls short on emotional range, cross-lingual pronunciation, and complex melisma. Positioning must be "AI-assisted" rather than "AI-replaces-singer"; the UI must communicate preview vs final quality honestly, and the release notes / marketing must not overclaim. RVC post-processing is the primary quality lever within the MVP.

9. **ONNX export maturity for future models (research §8 Medium / Medium)** — SoulX-Singer, TokenSynth, ACE-Step, and other prototype-tier models do not yet have validated ONNX exports. Any plan to graduate one of them from sidecar to native ONNX must gate on thorough regression testing (fixture WAV parity against the PyTorch reference), pinned ONNX opset versions, and a fallback path to the sidecar. Do not remove the Python sidecar dependency on the strength of one successful export.

10. **Multi-runtime maintenance burden (research §8 Medium / Certain)** — Maintaining both the Rust `ort` path and the Python sidecar path permanently is expensive. The architecture must be designed so models graduate from sidecar to native as their ONNX exports mature; the sidecar is a bridge, not a permanent home. Document the graduation criteria (ONNX parity tests, licence check, regression budget) and track which models are pending graduation.

11. **Apple Silicon performance variability (research §8 Low / Medium)** — CoreML EP and MLX give reasonable acceleration on M-series, but some models are Apple-silicon-optimisation-sensitive (e.g., attention kernels, FFT sizes). Regressions are easy to miss because fallback to CPU is silent. Add a per-model benchmark capture at session creation so the capability report includes real wall-clock numbers for the user's machine, not just "GPU available".

## Implementation Status

- **What is implemented**: Nothing.
- **What is not implemented**: The entire `SingingVoice` module, Rust `ort` inference pipeline, Python sidecar extensions for RVC, and related UI components.
- **What is done well**: N/A.
- **What needs refactoring**: N/A.
