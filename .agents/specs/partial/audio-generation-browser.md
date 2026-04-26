# Browser audio generation pipeline — DDSP instruments, Kokoro TTS, and DiffSinger SVS

## Context

This spec translates the findings from `.agents/research/pipelines/audio-generation-browser.md` into concrete requirements for browser-native AI audio generation in Sourdaw. It is the browser counterpart to the Tauri-native spec at `.agents/specs/pipelines/audio-generation.md`. The two specs share the same product vision but differ in runtime, model constraints, and phasing.

The research establishes that browser-based AI audio inference is production-ready for models up to ~500M parameters via WebGPU + ONNX Runtime Web, with WASM SIMD as universal fallback. The recommended build order is: (1) DDSP instrument synthesis (proven, tiny models, immediate DAW value), (2) Kokoro TTS for vocal scratch tracks (82M params, npm-ready), (3) DiffSinger singing voice synthesis (the industry-first browser SVS, highest impact, highest risk).

The research file's executive assessment (competitive quality vs cloud SVS, the ~60–70% TTS-relative quality ceiling, and the "matching AceStudio quality purely in-browser is not achievable today" conclusion) is background only. This spec does **not** require matching commercial AceStudio-class singing in the browser. Browser output is explicitly a **preview tier** relative to the Tauri-native pipeline (see Non-goals and the "Render quality" decision). The 15-model capability matrix in research §2 remains the canonical inventory for future roadmap and licensing review; only DDSP, Kokoro, DiffSinger, and the shared NSF-HiFiGAN vocoder are in scope here.

Sourdaw already has working browser AI infrastructure that this spec builds on:

- **ONNX Runtime Web with WebGPU/WASM** — `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts` runs Demucs v4 (~235 MB ONNX) in the browser using `onnxruntime-web`. It handles dynamic import, WebGPU-with-WASM-fallback execution provider selection, model caching via Cache API, tensor construction, segmented processing, and resampling via OfflineAudioContext. This is the reference pattern for all browser ONNX inference.
- **Dual-runtime pattern** — `src/modules/AudioAnalysis/repositories/audioAiEngine.ts` demonstrates the Tauri-native vs browser routing: `isTauri()` dispatches to Rust IPC, else dynamic-imports the browser implementation. The `separateStems` function is the canonical example.
- **RAVE neural audio placeholders** — `src/modules/AudioEngine/stores/rave.ts` defines `RaveModel`, `LatentVector`, `RaveState`, and factory model metadata. Use cases under `src/modules/AudioEngine/useCases/rave/` implement `encodeAudio`, `decodeLatent`, `timbreTransfer`, etc. These are spectral-feature simulations (no actual ONNX) but establish the store shape and domain concepts.
- **Web Worker infrastructure** — The codebase uses Web Workers for background processing (LLM inference in `AiRuntime/repositories/llmWorker.ts`). ONNX Runtime Web inference should also run in Web Workers to avoid blocking the UI thread.
- **AudioContext/OfflineAudioContext** — Used throughout for audio decoding, resampling, and playback. The browser pipeline outputs AudioBuffer instances that integrate with the existing Web Audio graph.

### Browser support: Chrome-only (latest versions)

This spec targets **Chrome/Chromium latest versions only**. WebGPU in Chrome delivers 3-8x faster matrix multiplication than WebGL, reaching ~10-20% of native CUDA performance for ML workloads. The practical model size ceiling is ~500M parameters with INT4 quantization before the ~4 GB per-tab memory limit becomes prohibitive. Chrome's WebGPU is the most mature and best-tested implementation.

**Other browsers are explicitly out of scope.** If the feature is accessed on Firefox, Safari, or older Chrome, the UI disables browser AI features and shows an explanatory popup: "Browser AI features require Chrome [version]+. Use the desktop app for AI features on other browsers." This eliminates the entire class of cross-browser WebGPU compatibility issues (Firefox OPFS gaps, Safari WebGPU limitations on older macOS, Linux WebKitGTK having no WebGPU).

In Tauri v2, **Windows** (WebView2/Chromium) gets full WebGPU. **macOS** (WKWebView/Safari) and **Linux** (WebKitGTK) do not — on these platforms, disable browser AI features and route to the Tauri-native pipeline (`.agents/specs/pipelines/audio-generation.md`) instead.

**Chrome on Linux (pure browser)** does support WebGPU per current Chromium builds; capability detection treats it identically to Chrome on Windows/macOS and the feature is enabled if `navigator.gpu` exists. This is separate from the **Tauri Linux** case above, which uses WebKitGTK (no WebGPU). The two Linux cases must not be collapsed in code or in user-facing copy.

---

## Goal

After implementation, Sourdaw can generate instrument audio from MIDI (DDSP), speech-quality vocal previews from text (Kokoro TTS), and singing voice audio from MIDI + lyrics (DiffSinger) — all running entirely in the browser via WebGPU on Chrome, with no server or sidecar dependency. On non-Chrome platforms, the feature is disabled with a clear explanation, and the Tauri-native pipeline serves as the alternative where available.

---

## User-visible behavior

### Phase 0 — SoundFont baseline (non-ML)

This is not a phase to build — it is the assumed baseline that all neural phases enhance. Every MIDI track must have a non-ML SoundFont sample playback path (Web Audio API oscillators or SoundFont via Tone.js) that provides instant, zero-download instrument audio. DDSP models (Phase 1) enhance this baseline — they do not replace it. When DDSP models are not yet downloaded or inference is too slow, the SoundFont path is the automatic fallback.

### Phase 1 — DDSP instrument synthesis

1. **Instrument selector** — The user selects a DDSP instrument (violin, trumpet, flute, clarinet, etc.) from a dropdown on a MIDI track. Up to 13 monophonic instruments are available. A "Standard" (SoundFont) option is always available as the zero-download fallback.
2. **MIDI-to-audio render** — The user selects a region of MIDI notes and triggers "Render Instrument." The system synthesizes monophonic instrument audio matching the MIDI pitch and dynamics. Output appears as an audio clip on the track. Rendering is faster than real-time on most hardware.
3. **Model download** — DDSP instrument models (~10-25 MB each) download on first use. The user can pre-download all instruments (~150 MB total) from a model manager. Cached in OPFS.

### Phase 2 — Kokoro TTS vocal previews

4. **Text-to-speech scratch track** — The user types lyrics or text into a track and triggers "Preview Voice." Kokoro TTS generates natural speech audio that serves as a placeholder vocal during composition. The output is not singing — it is spoken audio aligned to approximate timing.
5. **Voice selection** — 21 expressive voices available (Kokoro ships these). The user picks a voice from a selector. Voice models are ~160 MB total (q8 quantization).
6. **Speed control** — The user can adjust speech speed to match the song tempo approximately. This is a simple time-stretch, not tempo-aware synthesis.

### Phase 3 — DiffSinger browser SVS

7. **Browser singing synthesis** — The user selects MIDI notes with lyrics, chooses a DiffSinger voice, and triggers "Render Voice." The full pipeline (phonemize → variance → acoustic → vocoder) runs in the browser via ONNX Runtime Web. Total model size per voice: **~115-160 MB** (acoustic ~50-80 MB + variance/pitch/linguistic ~15-30 MB + shared vocoder ~50 MB). Rendering takes 5-30 seconds per phrase depending on length and hardware.
8. **Render quality control** — A "Render Quality" slider in the right inspector (Layer 2) controls shallow diffusion depth: **Low** (3 steps, fastest), **Standard** (5 steps, default), **High** (10 steps), **Maximum** (20 steps). Default is Standard. The slider directly maps to the `steps` input tensor. Higher settings produce smoother, more natural-sounding vocals at the cost of longer render time (roughly linear scaling).
9. **Speaker blending** — For multi-speaker voicebanks, individual speakers appear as discrete choices in the voice dropdown (Layer 1). A "Voice Blend" panel (Layer 2) exposes a blend slider between two selected speakers. An advanced multi-speaker mixer (Layer 3) allows weighting across all speakers with per-phrase blend automation curves.

10. **Graceful degradation to Tauri-native** — On non-Chrome platforms (macOS Tauri via WKWebView, Linux Tauri via WebKitGTK, or any non-Chrome browser), browser AI features are disabled entirely. The UI shows a brief explanation and, if running in Tauri, offers a "Use native renderer" button that dispatches to the Tauri-native DiffSinger pipeline (per `.agents/specs/pipelines/audio-generation.md`). In a non-Tauri non-Chrome browser, the features are simply unavailable.

### Cross-phase behaviors

11. **Progressive model loading** — Critical lightweight models (phonemizer, DDSP instruments) load first. Heavier models (Kokoro, DiffSinger acoustic) download in the background with progress indication. The user can start working with available models immediately.
12. **Capability detection** — On first launch, the system checks for Chrome + WebGPU. If available, a micro-benchmark estimates inference speed. Results shown in a "Browser AI Capabilities" panel: WebGPU fast / WebGPU slow / Not available (with explanation). On non-Chrome browsers, AI features are disabled with an explanatory popup.
13. **Model storage status** — A model manager shows all downloadable models, their sizes, download status, and total storage used. Users can delete cached models to reclaim space.

---

## UI/UX requirements

The research establishes that the winning UI strategy is **producer-first UI with AI embedded into existing music workflows** — not an AI-first interface. The core design principles, derived from analysis of ACE Studio, Synthesizer V, and HCI research (NN/g, Apple HIG), are:

### Design principles

1. **Direct manipulation as foundation** — Notes, phonemes, pitch curves, parameter curves, and phrase boundaries must be **visible, draggable objects on the canvas**, not settings in dialogs. Drag to move pitch/time, drag edges to change duration, draw pitch deviation directly over notes, draw breath/tension curves inline.

2. **Pipeline-aware system status** — Because browser synthesis takes seconds, the UI must show render state per phrase on the canvas, not just a generic spinner. Required render states: **Queued** → **Preparing** (phonemizing/tensor building) → **Synthesizing expression** (variance pass) → **Rendering audio** (acoustic + vocoder) → **Ready** (cached, playable) → **Stale** (edit invalidated cache). Also: **Preview quality** vs **Final quality** labels. Show phrase-level progress bars on the canvas, a global render queue panel, cache badges, "stale after edit" indicators, and explicit cancel/reprioritize actions.

3. **Three-layer progressive disclosure** — Never show every control at once:
    - **Layer 1 (fast composition)**: arrangement timeline, piano roll, lyrics on notes, playback/loop controls, voice selector, one-click render, macro sliders (naturalness, energy, brightness, gender, breathiness)
    - **Layer 2 (guided vocal shaping)**: pitch deviation lane, vibrato lane, phoneme timing view, phrase retakes, note properties, language/pronunciation assist, parameter lane chooser
    - **Layer 3 (expert surgery)**: per-phoneme duration table, raw variance curves, seed control, retake masks, model quality/speed selector, speaker-blend curves, debug/provenance panel

4. **AI as auditionable variation engine** — AI must be controllable, transparent, and reversible:
    - **Retake trays**: 3-5 retakes as mini-cards per phrase (waveform thumbnail, pitch contour, tags, seed metadata, one-click apply/pin)
    - **Change overlays**: old pitch in gray, new pitch in color, changed phoneme durations as highlighted splits, parameter deltas as shaded areas
    - **Locks and scopes**: users can lock note timing, pitch, lyrics, phoneme timing, voice identity, selected parameter lanes. "Regenerate" works only on unlocked scope.
    - **Provenance chips**: every generated phrase exposes voice, language, seed, render quality, model version, timestamp, cache status

5. **Linked parameter controls** — Every vocal parameter supports three editing modes: macro slider/preset chip, precise numeric input, and temporal curve/automation lane. E.g., breathiness: global track slider for exploration, note-level number for precision, automation lane for phrase shaping.

### Productive waiting during renders

Long-running synthesis in the browser typically falls in the 1–30 s band. Per Nielsen's rough thresholds — ~0.1 s feels instant, ~1 s preserves flow, ~10 s risks attention loss — the UI MUST prioritize **productive waiting** and honest stage labels over generic spinners; a user who is blocked longer than ~1 s MUST always see a concrete next stage (not "loading…").

While a phrase renders (5-30 seconds in browser), the user must be able to: edit another track, type lyrics, scrub existing audio, queue another render, inspect retakes, continue arranging. The UI thread must never block during inference (Web Worker isolation ensures this).

**Latency patterns**:

- **Two-tier rendering**: draft preview renders automatically; final-quality renders are explicit and batchable
- **Phrase-local invalidation**: only the edited phrase becomes stale; everything else remains playable
- **Predictive pre-render**: when the user stops editing briefly, pre-render current phrase, neighboring phrase, and selected retake candidate
- **Transparent prioritization**: users choose render order — current selection first, audible loop range, or all stale phrases in background

### Five core editing flows

These micro-loops are repeated hundreds of times per session — they must be frictionless:

1. **Sketch melody fast**: paste/import MIDI → inline lyric typing across notes → quick split/merge → piano pitch preview on move → auto phrase segmentation → instant low-quality preview
2. **Fix one awkward word**: click note → pronunciation popover near the note → edit phoneme timing inline → A/B solo the microphrase → no separate screen needed
3. **Audition expressive alternatives**: select phrase → generate retakes → preview each in place → compare with original → apply only pitch, timing, timbre, or all
4. **Tune repeated chorus fast**: copy/paste vocal settings across groups → save/apply expression presets → link repeated phrases optionally → break-link for local changes
5. **Micro-edit and replay**: playhead return on stop → sticky loop → pre-roll toggle → instant phrase-only replay → audition selection shortcut

### Empty states

Browser-specific opportunities for guiding new users:

- **No voice installed**: explain voice packs, offer one-click starter voice download
- **No phrase selected**: show quick actions for the current track
- **No render yet**: explain preview vs final rendering
- **Model downloading**: show progress with honest stage labels, allow the user to continue editing

### Workspace layout for singing synthesis

The research recommends a **three-region pro-app layout** for singing synthesis, which aligns with Sourdaw's existing DAW layout:

- **Region 1 — Arrangement strip** (top): project overview, phrase boundaries, loop range, section naming
- **Region 2 — Piano roll** (center, largest): note placement, lyric entry, pitch/timing editing, overlays for generated pitch and expression. This must remain the visual center.
- **Region 3 — Contextual inspector** (right, collapsible): tabbed panels for Voice, Note, Pronunciation, Retakes, Render
- **Bottom utility strip** (collapsible): mixer, render queue, warnings/log, model downloads

Layout rule: the center canvas must never get visually bullied by chrome.

### UX phased roadmap (from research)

The UI/UX work phases separately from the technical pipeline phases:

1. **Browser proof of workflow**: one voice, one language, piano roll, lyric entry, phrase preview, progress states, undo/redo
2. **Serious editing**: pronunciation editor, direct pitch drawing, note properties, parameter lanes, keyboard shortcuts, looped audition
3. **AI trust layer**: retake tray, scoped regeneration, locks, A/B compare, provenance chips, preview/final quality distinction
4. **Arrangement-grade workspace**: multi-track arrangement, mixer drawer, track colors/grouping, reusable presets, linked chorus phrases, batch rendering
5. **Pro depth**: frame-level expert controls, speaker/style automation, collaborative review, workspace presets

### Accessibility baseline

- Full keyboard navigation for transport, note nudging, selection
- Screen-reader labels for controls, state badges, progress
- Non-color-only status signaling (stale badge must not rely on color alone)
- Large enough note handles and lane targets for touch/imprecise input
- Reduced-motion option for loading indicators
- High-contrast theme and robust zoom (per research §12 — both are hard requirements, not opt-in accessibility extras)
- Text / caption summaries for AI warnings and render errors, so audio-only feedback does not exclude low-vision or deaf/HOH users

### High-value keyboard shortcuts

- nudge note left/right/up/down
- split/merge note
- cycle parameter lanes
- open pronunciation editor
- audition selected phrase
- generate retakes
- accept best retake
- lock/unlock selection
- return playhead to start of selection

### Feature-to-UI-pattern mapping (from research)

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

### UX risk register (from research)

| Risk                                              | Severity | UX mitigation                                                  |
| ------------------------------------------------- | -------- | -------------------------------------------------------------- |
| Interface feels like a research demo, not a DAW   | High     | Anchor everything in arrangement + piano roll                  |
| Too many visible controls overwhelm users         | High     | Three-layer progressive disclosure                             |
| AI output feels random or untrustworthy           | High     | Retakes, locks, change overlays, provenance                    |
| Browser rendering delays feel like freezing       | High     | Detailed system-status feedback and queue control              |
| Repeat tasks become tedious                       | High     | Copy/paste attributes, presets, linked phrases, shortcuts      |
| Accidental edits break trust                      | Medium   | Strong undo, object locking, non-destructive operations        |
| Users cannot learn why a phrase sounds wrong      | Medium   | Pronunciation guidance, visible phoneme timing, smart warnings |
| Advanced controls become form-heavy and slow      | Medium   | Keep editing on-canvas; inspector for precision only           |
| Large workspace feels cramped in browser          | Medium   | Collapsible panels, focus modes, bottom drawers                |
| Product excludes keyboard-only / low-vision users | Medium   | Shortcut parity, high contrast, accessible labels              |

### MVP UX validation gate

The first session must let a new user: (1) load a template, (2) enter or import notes, (3) type lyrics, (4) click preview, (5) fix one word, (6) draw one pitch change, (7) compare one retake, (8) export audio. If these eight steps don't feel obvious, the product isn't ready.

---

## Scope

**In scope:**

- DDSP instrument synthesis from MIDI (13 monophonic instruments, Apache 2.0, TensorFlow.js)
- Kokoro TTS for vocal scratch tracks (82M params, Apache 2.0, ONNX via Transformers.js v3)
- DiffSinger ONNX browser pipeline (phonemizer in JS, variance/acoustic/vocoder via ONNX Runtime Web)
- WebGPU execution on Chrome (features disabled on non-Chrome)
- Model download, caching (OPFS on Chrome), and lifecycle management
- Web Worker isolation for inference (no UI thread blocking)
- Capability detection and micro-benchmarking
- Graceful degradation to Tauri-native pipeline when available
- Render progress reporting per pipeline stage
- Deterministic cache keying for rendered audio (same inputs = cache hit)

**Non-goals (explicitly out of scope):**

- Real-time AudioWorklet inference (no model runs in the audio callback; all rendering is offline-then-play)
- Polyphonic DDSP instruments (DDSP is monophonic; polyphonic would require separate spec)
- Singing voice quality matching AceStudio or Tauri-native quality (browser quality will be lower; this is the preview tier)
- MusicGen or text-to-music generation (low DAW controllability — text-to-song is less useful than MIDI-based synthesis; ~1.2 GB model size is heavy for browser)
- Voice cloning (F5-TTS is too slow in browser at 30-90s; Chatterbox-Turbo needs browser optimization; revisit in 6-12 months per research)
- RVC voice conversion in browser (too large, requires Python sidecar)
- Custom model training or fine-tuning
- WebNN integration (too immature in 2026; revisit when NPU support stabilizes)
- RAVE timbre transfer integration beyond the existing placeholder (separate spec)
- Consistency distillation of DiffSinger (research-grade optimization; would dramatically improve speed but requires ML engineering beyond this spec)
- Server-side rendering or cloud inference
- Client-side Whisper ASR and large multimodal audio models (e.g. LFM-scale). Research §5 notes both run in browsers today (Whisper-large-v3-turbo via Transformers.js; LFM2.5-Audio 1.5B via quantized ONNX + WebGPU), but they are out of scope for this pipeline spec — any future ASR feature gets its own spec and its own UX surface.
- **Tier 3 neural-codec instrument synthesis (MIDI → EnCodec/DAC token transformer → codec decoder).** Research §2/§11 calls this out as a future direction (EnCodec ~15 M params / ~60 MB, DAC ~70 M / ~280 MB, ~5–15 s for a 10 s clip on WebGPU). The model registry schema is forward-compatible (`distillation_origin`, `quality_tier`) so this can slot in later, but no requirement or acceptance criterion in this spec covers it.

---

## Requirements

### Browser inference infrastructure

1. **Inference workers** — Two dedicated Web Workers, one per runtime:
    - **ONNX Worker** (`src/modules/BrowserAi/workers/onnxInferenceWorker.ts`) — loads `onnxruntime-web` (via Transformers.js for Kokoro, directly for DiffSinger), handles all ONNX-based inference. Always initialized when browser AI features are active.
    - **TF.js Worker** (`src/modules/BrowserAi/workers/tfjsInferenceWorker.ts`) — loads `@tensorflow/tfjs` + `@tensorflow/tfjs-backend-webgpu`, handles DDSP instrument inference. Lazily spawned only when a DDSP instrument is first used; destroyed when no DDSP sessions remain active.

    Both workers communicate with the main thread via `postMessage` with the same typed request/response protocol. A session manager on the main thread routes requests to the correct worker by model type (`onnx` vs `tfjs`). This isolates runtimes, prevents namespace conflicts, and allows independent memory management. The pattern extends the existing `browserStemSeparation.ts` approach but generalizes it for multiple model types and runtimes.

2. **Execution provider selection** — On worker initialization, detect WebGPU availability via `navigator.gpu`. If available (Chrome latest), create ONNX sessions with `executionProviders: ['webgpu', 'wasm']` (WebGPU primary, WASM fallback for operators without WebGPU kernels). If WebGPU is unavailable, the feature should have been disabled at the UI level — but as a safety net, fall back to `['wasm']` with a warning toast. Log the selected provider for diagnostics.

3. **Session management** — ONNX sessions are created per model and cached in the worker's memory. A session manager tracks loaded sessions by `model_id` and enforces a memory budget (configurable, default: 1 GB of model weights in memory). When the budget is exceeded, the least-recently-used session is released. Session creation is async and reports progress (model loading from cache/network → session initialization → warm-up inference).

4. **Model storage** — Models are stored using **OPFS** (Origin Private File System) as the sole browser storage backend. Chrome has full OPFS support with synchronous access handles in workers (fastest reads, 2-4x faster than IndexedDB). Use `navigator.storage.persist()` to prevent eviction. Chrome allows up to ~60% of available disk space per origin.
    - **Tauri app data directory** — when running in Tauri on Windows, bypass browser storage entirely. Use the Rust backend's `model_download.rs` for downloads and serve models to the webview via `register_uri_scheme_protocol` or direct file reads. This eliminates browser quota limits. On macOS/Linux Tauri, browser AI features are disabled (route to native pipeline).

5. **Model download manager** — A frontend service that handles model downloads with: progress reporting (bytes downloaded / total bytes) via `BroadcastChannel` for cross-context updates (Service Worker → main thread), resumable downloads (Range headers where CDN supports it), SHA256 integrity verification after download, automatic retry (3 attempts with exponential backoff), and cancellation. Downloads are initiated from the main thread, executed via `fetch()` in a Service Worker or the inference worker, and stored via the tiered strategy above. The manager maintains a registry of all known models and their local status (not-downloaded / downloading / ready / error / stale). For large downloads (>100 MB, e.g., Kokoro ~160 MB, DiffSinger voicebanks ~115-160 MB), use the **Background Fetch API** where available — it survives tab navigation, provides OS-level download progress, and handles network interruptions. Background Fetch requires Service Worker registration and is supported in Chrome/Edge (not Firefox/Safari); fall back to standard `fetch()` where unavailable. Where a Service Worker is used, the manager MUST follow a **cache-first** fetch strategy for model shards (OPFS → CDN on miss, then persist to OPFS), matching the research packaging pattern (research §5) so a re-load never re-downloads an intact model.

6. **Capability detection** — On feature first use, verify Chrome + WebGPU availability. If `navigator.gpu` is absent or the browser is not Chrome-based, disable AI features and show an explanatory popup. If WebGPU is available, run a micro-benchmark: create a small ONNX session (~1 MB test model), run a dummy inference, measure time. Classify: `webgpu-fast` (< 50ms), `webgpu-slow` (50-500ms). Store the result in localStorage. Expose to the UI as a capability badge. Use the classification to set default render quality (fewer diffusion steps on slower hardware). No WASM-only tier — if WebGPU is unavailable, the feature is disabled.

7. **SharedArrayBuffer support** — For multi-threaded WASM, ONNX Runtime Web requires SharedArrayBuffer. This requires `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`) and `Cross-Origin-Opener-Policy: same-origin` headers. In Tauri on Windows, set these in the webview configuration. In browser-only Chrome, a Service Worker can inject these headers. Chrome supports both COEP values. SharedArrayBuffer should always be available once headers are set — if not, log a warning and fall back to single-threaded WASM.

### Phase 1: DDSP instrument synthesis

8. **DDSP model format** — DDSP instrument models are **not available as ONNX** (confirmed via research — no official ONNX export exists and no successful tf2onnx conversion has been published). Models are distributed as TFLite (for DDSP-VST) and TF.js (for browser, proven by Google's Tone Transfer). The recommended approach is **TensorFlow.js** for browser DDSP inference — this is the proven path that Google shipped. Each model is ~10-25 MB (6M parameters at float32 = ~24 MB; TFLite/TF.js quantized ≈ 10-15 MB). A PyTorch reimplementation exists (`acids-ircam/ddsp_pytorch`, `chloelavrat/torch-ddsp`) that could enable future ONNX export via `torch.onnx.export`, but this is unvalidated.

    The DDSP autoencoder architecture (from the ICLR 2020 paper):
    - **Encoder**: 30 MFCCs → 512-unit GRU → 16 latent dims at 250 Hz frame rate
    - **Decoder**: Separate MLPs (3 layers, 512 units each) for F0, z, loudness; concatenated → 512-unit GRU → MLP
    - **Harmonic output**: `[batch, time, 101]` (1 amplitude + 100 harmonic distribution)
    - **Noise output**: `[batch, time, 65]` filter magnitudes
    - **Frame rate**: 250 Hz (frame_size=128 at 16 kHz)
    - **Output sample rate**: 16 kHz (original DDSP); 48 kHz with MAWF-style extended models if available
    - **Parameter count**: ~6M (supervised solo instrument), 0.24M (tiny variant)

    For MIDI-to-audio (as opposed to audio-to-audio timbre transfer), DDSP can run in **synthesis-only mode**: skip the encoder, feed pitch (F0 in Hz) and loudness (in dB) directly to the decoder at 250 Hz frame rate. This is the mode relevant for MIDI instrument rendering.

9. **MIDI to DDSP input conversion** — MIDI note data is converted to frame-level pitch and loudness sequences:
    - **Pitch**: MIDI note number → frequency in Hz. Interpolate between notes for legato/portamento. Insert silence (pitch = 0) for rests.
    - **Loudness**: MIDI velocity → dB scale (velocity 0 = silence, velocity 127 = 0 dB reference). Apply a simple envelope (attack/release) at note boundaries.
    - **Frame rate**: Resample the pitch/loudness contours to the model's expected frame rate (typically 250 Hz).

10. **DDSP render pipeline** — For a given MIDI region + instrument selection:
    1. Convert MIDI to pitch/loudness frame sequences
    2. Load instrument model (from cache or download)
    3. Run DDSP inference in the Web Worker → raw audio waveform
    4. Resample output to 44.1 kHz if needed (via OfflineAudioContext)
    5. Create AudioBuffer and return to main thread
    6. Store result in render cache with deterministic key

11. **Instrument model catalog** — Ship a static catalog of available DDSP instruments with metadata: name, instrument family, model size, sample rate, description. The catalog is a JSON file bundled with the app. Models are downloaded on demand. Available instruments (from Google DDSP): violin, viola, cello, flute, clarinet, trumpet, trombone, saxophone, oboe, bassoon, French horn, tuba, guitar.

### Phase 2: Kokoro TTS vocal previews

12. **Kokoro integration** — Integrate Kokoro-82M via **Transformers.js v3** (`@huggingface/transformers`). The model loads as quantized ONNX (q8 = ~160 MB preferred for audio quality; q4 = ~80 MB available as a smaller alternative). Inference runs in the ONNX Worker via ONNX Runtime Web with WebGPU acceleration. The API accepts: text string, voice ID, speed multiplier. Output: 24 kHz audio (upsampled to 44.1 kHz for DAW use via OfflineAudioContext). All 21 voices share the same model weights — voice selection is via `speaker_id` parameter.

13. **Text-to-timing alignment** — For DAW integration, the TTS output must be approximately aligned to the song timeline. The user places a "TTS region" on a track spanning a bar range; Kokoro generates speech for the full text; the output is time-stretched (via playback rate adjustment or WSOLA) to fit the region duration. Precise word-level alignment is a future enhancement — the initial TTS integration serves as a rough vocal placeholder, not a synchronized performance.

14. **Voice catalog** — Kokoro ships 21 voices with varied characteristics (male/female, accents, expressiveness). The catalog is exposed as a simple voice picker. No per-voice model downloads — all voices share the same model weights.

### Phase 3: DiffSinger browser SVS

15. **Phonemizer (JavaScript)** — A pure JavaScript/TypeScript phonemizer that converts lyrics to phoneme sequences compatible with DiffSinger voicebanks. Each voicebank ships a `dsdict.yaml` that defines its phoneme inventory and classifies phonemes as vowel/consonant. Additionally, a `phonemes.txt` or `phonemes.json` file maps phoneme strings to integer token IDs.

    For English: embed the CMU Pronouncing Dictionary as a compiled lookup (JSON or binary trie, ~5 MB). For unknown words: rule-based fallback using letter-to-phoneme rules. For Chinese: pinyin-to-phoneme mapping table matching DiffSinger's expected phoneme set. The phonemizer runs on the main thread (fast, no ML). Input: UTF-8 lyric string + language tag. Output: ordered array of integer phoneme token IDs matching the voicebank's phoneme inventory, with silence/breath tokens (`SP`, `AP`) inserted at phrase boundaries.

16. **DiffSinger variance model (browser)** — The DiffSinger variance pipeline consists of multiple ONNX files (~15-30 MB total) that run sequentially in the inference worker:

    **Linguistic encoder** (`*.linguistic.onnx`):
    - Input: `tokens` int64 `[1, n_tokens]`, `word_div` int64 `[1, n_words]`, `word_dur` int64 `[1, n_words]`, optional `languages` int64 `[1, n_tokens]`
    - Output: `encoder_out` float32 `[1, n_tokens, 256]`, `x_masks` bool `[1, n_tokens]`

    **Pitch predictor** (`*.pitch.onnx`):
    - Input: `encoder_out`, `ph_dur` int64 `[1, n_tokens]`, `note_midi` float32 `[1, n_notes]`, `note_dur` int64 `[1, n_notes]`, `pitch` float32 `[1, n_frames]`, `retake` bool, `steps` int64 `[1]`, optional `note_rest`, `note_glide`, `expr`, `spk_embed`
    - Output: `pitch_pred` float32 `[1, n_frames]`

    **Variance predictor** (`*.variance.onnx`):
    - Input: `encoder_out`, `ph_dur`, `pitch`, optional energy/breathiness/voicing/tension float32 `[1, n_frames]`, `retake` bool `[1, n_frames, num_variances]`, `steps` int64 `[1]`, optional `spk_embed`
    - Output: per-variance predictions (energy, breathiness, voicing, tension) as float32 `[n_frames]`

    Frame rate: 44100 / 512 = ~86.13 frames/second. All tensor preparation (padding, batching, type casting) is implemented in TypeScript following OpenUtau's `DiffSingerVariance.cs` logic.

17. **DiffSinger acoustic model (browser)** — The DiffSinger acoustic model is the heaviest component. **Research reveals the actual size is ~50-80 MB ONNX** (not 30-50 MB as originally estimated) — the backbone uses LynxNet with 1024 channels and 6 layers, hidden_size=256, producing 128-bin mel-spectrograms. Complete voicebanks (acoustic + variance + pitch + linguistic) are **100-300 MB compressed** per voice.

    The merged acoustic ONNX model (exported at opset version 15) contains both FastSpeech2 encoder and diffusion decoder:
    - Input: `tokens` int64 `[1, n_tokens]`, `durations` int64 `[1, n_tokens]`, `f0` float32 `[1, n_frames]`, optional `energy`/`breathiness`/`voicing`/`tension`/`gender`/`velocity` float32 `[1, n_frames]`, optional `spk_embed` float32 `[1, n_frames, 256]`, `depth` float32 `[1]`, `steps` int64 `[1]` (for continuous acceleration mode)
    - Output: `mel` float32 `[1, n_frames, 128]` (128 mel bins)

    Mel-spectrogram parameters (from `dsconfig.yaml`): sample_rate=44100, hop_size=512, win_size=2048, fft_size=2048, num_mel_bins=128, mel_fmin=40, mel_fmax=16000, mel_base=`e` (natural log), mel_scale=`slaney`.

    Default: 5 diffusion steps (Standard quality) via the `steps` input tensor in continuous acceleration mode. Configurable from 3 (Low) to 20 (Maximum) via the Render Quality control. The diffusion loop runs as sequential ONNX session calls within the ONNX Worker. Each step emits a progress event. Estimated render time for 5 seconds of audio on WebGPU: ~5-10s at 3 steps, ~8-15s at 5 steps, ~15-30s at 10 steps. The `depth` parameter controls shallow diffusion (default `max_depth: 0.6` in dsconfig).

18. **Vocoder (browser)** — The vocoder (~50 MB ONNX, confirmed from openvpi/vocoders releases) converts mel-spectrograms to waveform audio:
    - Input: `mel` float32 `[1, n_frames, 128]`, `f0` float32 `[1, n_frames]`
    - Output: `waveform` float32 `[1, n_samples]`

    **Vocoder choice: community NSF-HiFiGAN (CC-BY-NC-SA 4.0)**

    The app is free and non-commercial, so CC-BY-NC-SA is fully compatible. Use the **community NSF-HiFiGAN** from openvpi/vocoders (`pc_nsf_hifigan_44.1k_hop512_128bin_2025.02`, ~50 MB ONNX). This is the reference vocoder that DiffSinger is designed and tested against — zero compatibility risk, production-proven in OpenUtau.

    The vocoder is **shared across all voicebanks** — downloaded once, reused for every voice. The browser uses a single vocoder (no dual-vocoder strategy) since all browser renders are preview-quality relative to the Tauri-native pipeline.

19. **Browser SVS pipeline orchestration** — The full pipeline runs in the inference worker:
    1. Receive render request (MIDI notes, lyrics, voice model ID, diffusion steps)
    2. Run phonemizer (main thread, returns to worker)
    3. Build input tensors
    4. Load and run variance model → duration, F0, energy, breathiness
    5. Load and run acoustic model (shallow diffusion, N steps) → mel-spectrogram
    6. Load and run vocoder → PCM audio at model sample rate
    7. Post-process: normalize, apply fade-in/out at phrase boundaries
    8. Transfer audio buffer to main thread via Transferable (zero-copy)
    9. Report completion with provenance metadata

### Cross-phase: render cache and state management

20. **Render cache** — All rendered audio (DDSP, Kokoro, DiffSinger) is cached with deterministic keys: SHA256(model_id + input_data + quality_params + seed). Cache is stored in OPFS alongside model weights. Cache has a configurable size limit (default: 2 GB). LRU eviction removes oldest entries when limit is exceeded. Cache hits return immediately without inference.

21. **BrowserAi module** — A new frontend module `src/modules/BrowserAi/` following domain-driven architecture:
    - `stores/`: capability detection results, model registry state (download status per model), render queue state, active inference progress
    - `repositories/`: model download manager, inference worker wrapper (postMessage API), storage manager (OPFS), capability detector
    - `useCases/`: `renderDdspInstrument`, `renderKokoroTts`, `renderDiffSingerPhrase`, `downloadModel`, `removeModel`, `detectCapabilities`, `cancelRender`, `renderAllStale`
    - `models/`: `BrowserModel`, `InferenceRequest`, `InferenceResult`, `RenderProgress`, `CapabilityReport`, `StorageStatus`
    - `workers/`: `onnxInferenceWorker.ts` (ONNX Runtime Web — DiffSinger + Kokoro), `tfjsInferenceWorker.ts` (TensorFlow.js — DDSP instruments, lazy-spawned), `downloadWorker.ts` (background model downloads)
    - `presentations/views/`: Model manager panel, capability report panel, render progress indicators
    - `events/`: render-complete, render-progress, model-download-progress, capability-detected

22. **Dual-runtime routing** — Following the existing `audioAiEngine.ts` pattern, each render use case checks `isTauri()`. If Tauri is available AND the user has not opted for browser-only rendering, offer both options: "Render in browser (preview)" and "Render natively (higher quality)." If only browser is available, render in browser. If Tauri-native is available but the browser pipeline has cached a result, serve from cache without re-rendering natively unless the user explicitly requests final quality.

23. **Stale detection** — Same behavior as the Tauri-native spec: editing MIDI notes or lyrics in a rendered phrase marks it "stale." The stale state is shared between browser and native renders — a phrase rendered in browser and then re-rendered natively replaces the browser result. The render status model is: `not-rendered` / `rendering-browser` / `rendering-native` / `preview` (browser) / `final` (native) / `stale`.

---

## Constraints

- Must follow the domain-driven module architecture per `AGENTS.md` — the new `BrowserAi` module follows all cross-module import rules.
- All inference runs in Web Workers, never on the main thread or in AudioWorklet callbacks. The main thread orchestrates and receives results.
- **New npm dependencies required**: `@huggingface/transformers` (Transformers.js v3, for Kokoro TTS + general ONNX pipeline utilities), `@tensorflow/tfjs` + `@tensorflow/tfjs-backend-webgpu` (for DDSP instrument inference). `onnxruntime-web` is already a dependency.
- Model weights must be compatible with free, non-commercial distribution. CC-BY-NC-SA 4.0 is acceptable (the app is free). AGPL-licensed models (so-vits-svc) are excluded due to copyleft obligations on the app code.
- **Attribution is mandatory** for CC-BY models. Every model entry in the model manager must display: author/organization name, license identifier, and a link to the source. An "AI Model Credits" section must also exist in the app's About/Settings screen listing all bundled or downloaded model attributions. This satisfies the BY (Attribution) clause of CC-BY-NC-SA 4.0.
- Generated audio is always 44.1 kHz to match the DAW's sample rate. Models outputting at other rates (16 kHz DDSP, 24 kHz Kokoro) must be resampled.
- Browser storage quotas apply: Chrome allows ~60% of available disk space per origin. The model manager must track usage and warn when approaching limits. In Tauri on Windows, use the Rust-side model directory to bypass quotas.
- `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` headers must be set for SharedArrayBuffer support (required for multi-threaded WASM in ONNX Runtime Web). In Tauri, set these in the webview configuration. If they break cross-origin resources (fonts, images), use `credentialless` COEP instead. Chrome supports both values.
- The 128 MB `maxStorageBufferBindingSize` limit in Chrome WebGPU requires model weight sharding for models exceeding this size. The inference worker must handle multi-buffer model loading.
- `onnxruntime-web` minimum version: **1.17+** (required for WebGPU execution provider, IO binding, FP16 inference, and graph capture for static-shape models).
- **Quantization guidance**: Use INT8 (q8) for audio generation models — it achieves 4x size reduction with minimal quality loss (<1-2% on standard metrics). INT4 (q4) is acceptable only with mixed-precision selection (quantize attention/feedforward, keep critical audio layers in FP16). Research on TinyMusician showed FAD scores rising from ~3 to ~7 with naive INT4. Prefer q8 for Kokoro and any future model quantization.
- `pnpm deps:validate` must pass with zero violations after implementation.
- The browser pipeline must not assume Tauri is available — it must work in a pure browser deployment (no IPC, no Rust backend).
- When running inside Tauri and routing rendered audio to the native engine, use the **Tauri v2 Channel API** with binary serialization for audio buffers, or `register_uri_scheme_protocol` to serve generated audio as fetchable resources. The Tauri event system is documented as slow for large payloads (~200ms for 3 MB) — do not use `emit()`/`listen()` for audio buffer transfer.

---

## Design decisions

### Decision: Full browser-native pipeline (not two-tier hybrid)

**Chosen:** Run the complete audio generation pipeline — DDSP, Kokoro, and DiffSinger (phonemize → variance → acoustic → vocoder) — entirely in the browser via WebGPU + ONNX Runtime Web + TensorFlow.js. The Tauri-native pipeline (`.agents/specs/pipelines/audio-generation.md`) remains as an optional "Render natively" path for higher-quality final renders, not as a required tier for making the feature usable.

**What the research recommended:** `.agents/research/pipelines/audio-generation-browser.md` concludes that a **two-tier hybrid is essential, not optional** — lightweight models (Kokoro, DDSP, variance/duration) in the webview, and heavy models (DiffSinger acoustic, MusicGen, large SVS) in the Rust backend via Candle/`ort` with native CUDA/Metal. The research treats Tier 2 (Rust backend) as the required path for production-quality singing voice synthesis.

**Why the spec chose differently:**

- **Deployment reach.** A browser-only code path works in a plain Chrome tab with no installer, which is the primary user-acquisition surface. Requiring Tauri for the flagship singing feature would gate that feature behind a desktop download.
- **Single source of truth for the pipeline.** Splitting DiffSinger across webview (variance) and Rust (acoustic + vocoder) would force tensor-shape parity, mel-config parity, and vocoder-compatibility parity across two runtimes, with per-platform execution-provider divergence (CUDA/Metal/DirectML vs WebGPU). One pipeline, one runtime stack (ONNX Runtime Web + TF.js) is dramatically simpler to build and debug.
- **Quality gap is tolerable for the browser tier.** The research's "two-tier is essential" claim is framed around matching AceStudio final quality. This spec explicitly scopes the browser pipeline as preview-quality (requirement: "Singing voice quality matching AceStudio or Tauri-native quality" is a non-goal). Users who want final quality opt in to the native renderer on Windows Tauri.
- **Chrome-only + WebGPU lifts the feasibility floor.** The research's tiering assumes broad browser support including WASM fallback. By scoping to Chrome + WebGPU, the practical model-size ceiling (~500M params, ~4 GB per-tab) is high enough for DiffSinger's ~115-160 MB per voice to run end-to-end without spilling to native.

**Consequence:** On non-Chrome and on Tauri macOS/Linux, the feature is disabled and routes to the Tauri-native pipeline where available. This is documented in requirement 10 (graceful degradation) and the Scope section.

### Decision: DDSP instruments first (not DiffSinger first)

**Chosen:** Build DDSP instrument synthesis as Phase 1, before singing voice synthesis.

**Considered and rejected:**

- **DiffSinger first** — rejected because DiffSinger's browser pipeline is the highest-risk component (no browser SVS exists anywhere, 5-30 second render times, complex tensor preparation). Starting with DDSP proves the inference infrastructure (Web Worker, ONNX sessions, model caching, render pipeline) with a simple, fast, proven model. The infrastructure built for DDSP (worker, session manager, model download, cache) is reused directly by DiffSinger.
- **Kokoro first** — rejected because TTS is less DAW-relevant than instrument synthesis. Kokoro is simpler to integrate but provides less immediate value to the core DAW workflow. DDSP instruments fill a real gap (MIDI tracks that sound like real instruments).

### Decision: Dedicated BrowserAi module (not extending AudioAnalysis)

**Chosen:** Create `src/modules/BrowserAi/` as a new domain module for all browser-native AI inference.

**Considered and rejected:**

- **Extend AudioAnalysis** — rejected because AudioAnalysis is an analysis module (stem separation, denoising). Audio generation is a distinct domain. Combining them violates single-responsibility and would create a bloated module.
- **Extend AudioEngine** — rejected because AudioEngine owns the real-time audio thread. Browser inference is async/offline and should not be coupled to the engine.
- **Per-feature modules** (DdspInstruments, KokoroTts, BrowserSvs) — rejected because all three share the same inference infrastructure (Web Worker, ONNX Runtime, model caching, session management). Splitting them would duplicate the infrastructure. One module with per-feature use cases is cleaner.
- **Share module with Tauri-native SingingVoice** — rejected because the browser pipeline has fundamentally different infrastructure (Web Workers vs Tokio tasks, OPFS vs filesystem, WebGPU vs CUDA/CoreML). The dual-runtime routing layer in the use cases bridges the two modules.

### Decision: OPFS storage (Chrome-only simplifies this)

**Chosen:** Use OPFS as the sole browser storage backend. Chrome has full OPFS support.

**Considered and rejected:**

- **IndexedDB primary** — rejected because OPFS provides 2-4x faster reads via synchronous access handles in Web Workers. For 100-400 MB model files, this difference is significant (seconds vs. sub-second load times).
- **Cache API primary** — rejected as long-term storage because Cache API is designed for HTTP responses and may be evicted under storage pressure.
- **Tiered storage (OPFS → Cache API → IndexedDB)** — rejected because Chrome-only targeting eliminates the need for fallbacks. Simpler code, fewer bugs.
- **Firefox-compatible IndexedDB fallback** — rejected. Research §5 documents a dual OPFS / IndexedDB path for multi-browser support; because Firefox is already scoped out at the UI gate, keeping an IndexedDB code path only adds unreached branches. Re-adding it if Firefox becomes in-scope is a focused change, not a rewrite.
- **Always use Tauri backend** — rejected because the browser pipeline must work without Tauri for pure web deployments (Chrome browser tab).

### Decision: Single vocoder for browser tier (not dual vocoder)

**Chosen:** Use one vocoder in the browser (Vocos or NSF-HiFiGAN-compatible, whichever validates).

**Considered and rejected:**

- **Dual vocoder (Vocos preview + BigVGAN final)** — rejected for browser because BigVGAN v2 is ~400 MB, which is too large for the browser's memory budget alongside other models. All browser renders are inherently preview-quality relative to the Tauri-native pipeline. Users wanting final quality should use the native renderer.
- **No vocoder (output mel-spectrogram)** — rejected because mel-spectrograms are not playable audio. The vocoder is essential.

### Decision: Phased rollout (DDSP → Kokoro → DiffSinger)

**Chosen:** Three phases, each delivering standalone value, each building on the previous phase's infrastructure.

**Considered and rejected:**

- **All at once** — rejected because the combined scope is too large for a single implementation cycle. DiffSinger browser SVS alone is a multi-week effort. Each phase builds on the infrastructure of the previous one.
- **DiffSinger only** — rejected because it provides no fallback if DiffSinger browser inference proves too slow or vocoder compatibility fails. DDSP and Kokoro deliver value regardless.

---

## Acceptance criteria

### Phase 1: DDSP instruments

- [ ] At least 3 DDSP instrument models (violin, flute, trumpet) load and run in the browser via TensorFlow.js (per requirement 8; ONNX is not a valid substitute for DDSP)
- [ ] A 4-bar monophonic MIDI melody renders to recognizable instrument audio matching the input pitches
- [ ] DDSP render completes in under 2 seconds for a 4-bar phrase at 120 BPM on Chrome with WebGPU on a 2023 laptop
- [ ] Instrument models (~5-15 MB each) download on first use with progress indication
- [ ] Downloaded models persist across page reloads (verified by checking OPFS — IndexedDB is NOT used per the OPFS-only storage decision)
- [ ] All DDSP inference runs in a Web Worker — the main thread remains responsive during rendering (no frame drops in UI)
- [ ] Output audio is 44.1 kHz regardless of model native sample rate

### Phase 2: Kokoro TTS

- [ ] Kokoro TTS generates speech from text input using at least 3 different voices
- [ ] Generated speech is natural-sounding and matches the selected voice character
- [ ] TTS output fits approximately within a user-specified time region (time-stretched)
- [ ] Kokoro model (~160 MB q8) downloads with progress indication and persists across sessions
- [ ] Inference runs in Web Worker — UI remains responsive
- [ ] Output audio is 44.1 kHz

### Phase 3: DiffSinger browser SVS

- [ ] DiffSinger phonemizer converts English lyrics to correct phoneme sequences for known words
- [ ] DiffSinger variance model produces plausible F0/energy/breathiness contours from MIDI + phonemes
- [ ] DiffSinger acoustic model generates mel-spectrograms via 3-step shallow diffusion in the browser
- [ ] Vocoder converts mel-spectrograms to audible waveform audio
- [ ] Full pipeline renders a 4-note English phrase to recognizable singing in the browser
- [ ] Browser SVS render completes in under 30 seconds per phrase on Chrome with WebGPU
- [ ] Graceful degradation: if Tauri-native pipeline is available, the UI offers "Render natively" as an alternative

### Cross-phase

- [ ] Capability detection correctly identifies Chrome + WebGPU and reports estimated performance tier
- [ ] Model storage respects the 2 GB cache limit with LRU eviction
- [ ] Render cache produces instant cache hits for identical inputs
- [ ] Stale detection marks phrases as stale when MIDI or lyrics change
- [ ] Render progress events are emitted per pipeline stage and displayed in the UI
- [ ] All model weights used are compatible with free non-commercial distribution (MIT, Apache 2.0, or CC-BY-NC-SA 4.0; no AGPL)
- [ ] `pnpm deps:validate` passes with zero violations
- [ ] `pnpm typecheck` passes with zero errors
- [ ] The browser pipeline works in Chrome (latest) as a pure browser deployment (no Tauri dependency)
- [ ] On non-Chrome browsers (Firefox, Safari), AI features are disabled with an explanatory popup
- [ ] On Tauri macOS/Linux, browser AI features are disabled and the UI routes to the native pipeline
- [ ] SharedArrayBuffer is available and multi-threaded WASM is used (COEP/COOP headers configured)

---

## Implementation notes

### Inference worker architecture

Two Web Workers, one per runtime:

- **ONNX Worker** (`onnxInferenceWorker.ts`) — handles DiffSinger and Kokoro (via Transformers.js, which uses ONNX Runtime Web internally). This is the primary worker, always initialized.
- **TF.js Worker** (`tfjsInferenceWorker.ts`) — handles DDSP instrument models via TensorFlow.js. Lazily spawned only when a DDSP instrument is first used. Destroyed when no DDSP sessions are active.

Both workers share the same typed message protocol:

```typescript
// Main thread → Worker
type WorkerRequest =
    | { type: 'create-session'; modelId: string; modelData: ArrayBuffer; options: SessionOptions }
    | { type: 'run-inference'; modelId: string; feeds: Record<string, TensorData>; requestId: string }
    | { type: 'release-session'; modelId: string }
    | { type: 'get-status' };

// Worker → Main thread
type WorkerResponse =
    | { type: 'session-created'; modelId: string }
    | { type: 'inference-result'; requestId: string; outputs: Record<string, TensorData> }
    | { type: 'inference-progress'; requestId: string; stage: string; progress: number }
    | { type: 'error'; requestId: string; error: string }
    | { type: 'status'; loadedModels: string[]; memoryUsageBytes: number };
```

Audio buffers are transferred via `Transferable` objects to avoid copying.

### DDSP model runtime strategy

DDSP models are **only available as TFLite and TF.js** (confirmed — no ONNX export exists). ONNX conversion via tf2onnx is theoretically possible but unvalidated — DDSP uses custom signal-processing ops (harmonic synthesis, filtered noise) that are pure DSP math, not standard TF ops, and would need custom op handlers. No published successful conversion exists.

**Recommended approach**: Use TensorFlow.js directly for DDSP inference. This is the proven path — Google shipped Tone Transfer, Sounds of India, and Paint with Music using TF.js in production browsers. Reserve ONNX Runtime Web for DiffSinger and Kokoro.

This means the inference worker must support **two runtimes**:

- `@tensorflow/tfjs` + `@tensorflow/tfjs-backend-webgpu` for DDSP models
- `onnxruntime-web` for DiffSinger and Kokoro models

The session manager abstracts both behind a common `InferenceSession` interface. The TF.js bundle adds ~1.5 MB to the app (tfjs-core + tfjs-backend-webgpu). DDSP-VST ships 11 pre-bundled instrument models as TFLite — these must be loaded as TF.js LayersModel or GraphModel format instead.

**Alternative future path**: The PyTorch DDSP reimplementation at `acids-ircam/ddsp_pytorch` could enable `torch.onnx.export` → ONNX, which would unify runtimes. But this is unvalidated and adds a model conversion step.

### Kokoro integration path

Use **Transformers.js v3** (`@huggingface/transformers`). Integration:

```typescript
import { pipeline } from '@huggingface/transformers';
const tts = await pipeline('text-to-speech', 'onnx-community/Kokoro-82M-v1.0-ONNX', {
    device: 'webgpu',
    dtype: 'q8', // or 'q4' for smaller download, 'fp16' for max quality
});
const result = await tts('Hello world', { speaker_id: 'af_heart' });
// result.audio: Float32Array, result.sampling_rate: 24000
```

This runs inside the ONNX inference worker. Transformers.js handles model downloading, caching, and session management internally — but model storage should be redirected to the app's OPFS directory for consistency with the model manager. The 21 built-in voices are selected via `speaker_id`. Output is 24 kHz — resample to 44.1 kHz via OfflineAudioContext.

### DiffSinger voicebank file structure

A DiffSinger voicebank for OpenUtau has this directory layout (confirmed from research):

```
voicebank_root/
  dsconfig.yaml              # Main config (mel params, feature flags, model paths)
  character.yaml             # OpenUtau singer metadata (name, avatar, subbanks)
  {name}.onnx                # Acoustic model (~50-80 MB)
  phonemes.txt               # OR {name}.phonemes.json — phoneme-to-token ID mapping
  {name}.languages.json      # Language ID mapping (if use_lang_id)
  {speaker}.emb              # Speaker embedding (256 float32 = 1024 bytes per speaker)
  dsdict.yaml                # G2P dictionary (phoneme types: vowel/consonant)
  dspitch/                   # Pitch predictor subfolder
    dsconfig.yaml
    {name}.linguistic.onnx   # Linguistic encoder
    {name}.pitch.onnx        # Pitch predictor
    phonemes.txt
    dsdict.yaml
  dsvariance/                # Variance predictor subfolder
    dsconfig.yaml
    {name}.linguistic.onnx   # Linguistic encoder (may differ from pitch)
    {name}.variance.onnx     # Variance predictor
    phonemes.txt
    dsdict.yaml
  dsvocoder/                 # Optional bundled vocoder
    vocoder.yaml
    model.onnx               # NSF-HiFiGAN (~50 MB)
```

The `dsconfig.yaml` contains critical rendering parameters: `sample_rate`, `hop_size`, `win_size`, `fft_size`, `num_mel_bins`, `mel_fmin`, `mel_fmax`, `mel_base`, `mel_scale`, `hidden_size`, feature flags (`use_energy_embed`, `use_breathiness_embed`, etc.), `max_depth` (shallow diffusion), and `use_continuous_acceleration`.

### DiffSinger tensor preparation reference

The TypeScript tensor preparation must replicate OpenUtau's C# logic (primarily `DiffSingerRenderer.cs`, `DiffSingerVariance.cs`, `DiffSingerPitch.cs`). Key operations:

1. Parse `phonemes.txt` or `phonemes.json` to build a phoneme string → integer token ID map
2. Map lyrics to phoneme token IDs using the voicebank's `dsdict.yaml` inventory
3. Convert MIDI note numbers to MIDI pitch float values for `note_midi` tensor
4. Convert note durations from beats/ticks to frames (frame_count = duration_seconds \* sample_rate / hop_size, where hop_size is from dsconfig, typically 512)
5. Build `word_div` (phonemes per word) and `word_dur` (frames per word) for the linguistic encoder
6. For multi-speaker models: load `.emb` files (256 float32 values per speaker), expand to `[1, n_frames, 256]` via weighted combination if blending speakers
7. Set `depth` from `dsconfig.yaml`'s `max_depth` (typically 0.6) and `steps` based on quality setting
8. Pad all tensors to match expected dynamic axis dimensions
9. Create `Float32Array` / `BigInt64Array` typed arrays and wrap in ONNX Runtime Web `Tensor` instances
10. Check `dsconfig.yaml` feature flags to determine which optional tensors to include (energy, breathiness, voicing, tension, gender, velocity)

### OPFS storage pattern

```typescript
// In Web Worker (synchronous access)
const root = await navigator.storage.getDirectory();
const modelsDir = await root.getDirectoryHandle('models', { create: true });
const file = await modelsDir.getFileHandle('model.onnx', { create: true });
const accessHandle = await file.createSyncAccessHandle();
accessHandle.write(modelArrayBuffer);
accessHandle.flush();
accessHandle.close();

// Reading
const readHandle = await file.createSyncAccessHandle();
const buffer = new ArrayBuffer(readHandle.getSize());
readHandle.read(buffer);
readHandle.close();
```

### Resampling pattern

Follow the existing `browserStemSeparation.ts` pattern using OfflineAudioContext:

```typescript
async function resampleToDAWRate(buffer: AudioBuffer): Promise<AudioBuffer> {
    if (buffer.sampleRate === 44100) return buffer;
    const ratio = 44100 / buffer.sampleRate;
    const ctx = new OfflineAudioContext(buffer.numberOfChannels, Math.round(buffer.length * ratio), 44100);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    return ctx.startRendering();
}
```

### Forward-compatible design: consistency distillation and codec-token generation

Two research findings should inform the architecture even though they are out of scope for MVP:

1. **Consistency distillation** (research conclusion: "the key unlocking technique") — reduces diffusion models from many steps to 1-2 steps with competitive quality. Applied to DiffSinger's acoustic model, this could reduce 30-second browser renders to ~6 seconds. **The diffusion loop in the inference worker should be structured so the acoustic model session can be swapped for a consistency-distilled single-step model without changing the pipeline orchestration.** The `steps` input tensor already parameterizes this — a consistency model simply always uses steps=1.

2. **Neural audio codec architecture** (research novel insight) — MIDI → codec token prediction via small transformer → EnCodec/DAC decoder → waveform. EnCodec (~15M params, ~60 MB) and DAC (~70M params, ~280 MB) are both browser-feasible. This is the expected Tier 3 evolution for instrument synthesis beyond DDSP. **The render pipeline should use a pluggable model backend interface so codec-token models can slot in alongside DDSP and DiffSinger without rearchitecting the worker.**

3. **Knowledge distillation as a sizing lever** (research §6) — TinyMusician showed MusicGen-Small could be distilled to 55% smaller while retaining 93% of quality; combined with INT8 this compresses a 300M-parameter model to ~75 MB. Sourdaw is not distilling its own models in scope of this spec, but the model registry entry schema must already carry a `distillation_origin` field and a `quality_tier` enum (`preview` / `standard` / `high`) so a distilled variant of a DiffSinger voice or a codec-token model can be slotted in later without a registry migration.

### Checkpoint/resume for long diffusion renders

If a browser tab is killed during a multi-step DiffSinger render, the work is lost. For resilience, the inference worker should save intermediate diffusion state (mel-spectrogram at each step) to a temporary OPFS file. On resume, the worker checks for incomplete renders and offers to continue from the last checkpoint. This is a future enhancement — for MVP, lost renders are simply re-queued.

### Rust-to-WASM inference alternatives

If ONNX Runtime Web proves insufficient (operator coverage gaps, overhead for specific models), alternative Rust-to-WASM inference engines exist:

- **WONNX** — 100% Rust WebGPU ONNX engine, available as npm package. Direct WebGPU access without ONNX Runtime overhead.
- **Tract** — lightweight pure-Rust ONNX inference, ideal for WASM deployment (no GPU, CPU-only).
- **Candle** (HuggingFace) — compiles to wasm32 with working browser demos for Whisper/LLaMA.
- **Burn** (tracel-ai) — WGPU backend targeting WebGPU from Rust, with ONNX import.

These are contingency options, not first-choice. ONNX Runtime Web is the recommended path.

### Reference implementations

Proven browser AI audio demos for implementer reference:

- **Kokoro TTS**: `kokoro-web` (kokoro-js npm package) — 82M params, WebGPU, ~1s for 10s of speech
- **DDSP Tone Transfer**: `g.co/tonetransfer` — Google's TF.js browser demo, 13 instruments
- **RAVE.js**: `caillonantoine.github.io/ravejs/` — real-time timbre transfer via ONNX.js
- **MusicGen Web**: `musicgen-web` by imohanvadivel — text-to-music via ONNX Runtime Web
- **Whisper WebGPU**: via Transformers.js — near-server-quality ASR with <500ms streaming latency
- **Spotify Basic Pitch**: TypeScript package — polyphonic audio-to-MIDI, faster than real-time
- **LFM2.5-Audio** (Liquid AI): 1.5B-parameter audio model in browser via quantized ONNX + WebGPU

### Future phases beyond this spec

Per `.agents/research/pipelines/audio-generation-browser.md` section 11 build-vs-wait verdicts:

- **Audio-to-MIDI transcription** (Basic Pitch) — **Build now**, TypeScript package ready, Spotify-maintained
- **Timbre transfer** (RAVE.js) — **Build now**, proven browser demo, 4-20 MB models, unique creative feature
- **Voice cloning** — **Wait 6-12 months**, Chatterbox-Turbo (Apache 2.0) needs browser optimization
- **Full multi-instrument MIDI rendering** — **Wait 12-18 months**, requires polyphonic neural synthesis at browser scale
- **AceStudio-parity singing** — **Wait 24+ months**, needs consistency distillation + model innovations

### Model weight sharding for WebGPU 128 MB limit

Chrome's `maxStorageBufferBindingSize` is often capped at 128 MB even when the GPU reports higher. For models >128 MB (Kokoro q8, DiffSinger acoustic+vocoder), ONNX Runtime Web automatically shards weights across multiple buffers. Ensure model files are exported with ONNX Runtime Web's expected sharding format (external data files, `model.onnx` + `model.onnx_data` pattern). The `hf-hub` download must fetch all shards.

---

## Test plan

### Phase 1: DDSP

- [ ] **Unit: MIDI to pitch/loudness conversion** — MIDI note 69 (A4) converts to 440 Hz; velocity 64 converts to approximately -6 dB; rests produce pitch = 0
- [ ] **Unit: Frame rate resampling** — A 4-beat melody at 120 BPM (2 seconds) produces 500 frames at 250 Hz frame rate
- [ ] **Integration: DDSP violin render** — Load violin model, render a C major scale (8 notes), verify output is non-silent 44.1 kHz audio lasting ~4 seconds
- [ ] **Integration: Model caching** — Download DDSP model, reload page, verify model loads from OPFS/IndexedDB without network request

### Phase 2: Kokoro

- [ ] **Unit: Text segmentation** — Long text is split into sentences for sequential TTS processing
- [ ] **Integration: Kokoro render** — Generate speech for "Hello world, this is a test", verify output is natural-sounding ~3 second audio
- [ ] **Integration: Voice switching** — Render same text with 2 different voices, verify outputs sound different
- [ ] **Integration: Time stretch** — Render text into a 4-bar region, verify output duration approximately matches region

### Phase 3: DiffSinger

- [ ] **Unit: Phonemizer** — "Hello" → [HH, AH, L, OW] (or equivalent per CMU dict)
- [ ] **Unit: Tensor shapes** — Verify variance model input tensors match expected dimensions for a 4-note phrase
- [ ] **Integration: Full browser SVS pipeline** — Render "La la la la" on C4-D4-E4-F4, verify output is recognizable singing
- [ ] **Integration: Diffusion steps** — 3-step render completes faster than 5-step; 5-step sounds subjectively better

### Cross-phase

- [ ] **Integration: Capability detection** — On Chrome with WebGPU, detection reports `webgpu-fast` or `webgpu-slow`; on non-Chrome, reports `unavailable` and disables features
- [ ] **Integration: Cache hit** — Render a phrase, render identical phrase, verify second call returns in <100ms from cache
- [ ] **Integration: Memory budget** — Load models exceeding 1 GB total, verify LRU eviction releases oldest session
- [ ] **Integration: Worker isolation** — During a 15-second DiffSinger render, verify UI animations run at 60fps (main thread not blocked)
- [ ] **Manual: Chrome verification** — Test DDSP render in Chrome latest; verify audio output
- [ ] **Manual: Non-Chrome graceful degradation** — Open in Firefox/Safari; verify AI features are disabled with explanatory popup

---

## Open questions

### Resolved by research (2026-04-14)

- [x] **[RESOLVED]** ~~Are DDSP instrument models available as ONNX?~~ **No.** DDSP models are only available as TFLite and TF.js. No ONNX export exists and no successful tf2onnx conversion has been published. **Decision: Use TensorFlow.js for DDSP inference (proven by Google's Tone Transfer), ONNX Runtime Web for DiffSinger/Kokoro. Dual-runtime inference worker required.** This adds ~1.5 MB bundle size for tfjs-core.

- [x] **[RESOLVED]** ~~Is the DiffSinger ONNX acoustic model small enough for browser deployment?~~ **It is larger than originally estimated but still feasible.** Acoustic models are ~50-80 MB ONNX (not 30-50 MB). Complete voicebanks (acoustic + variance + pitch + linguistic) are 100-300 MB compressed. Total per voice including shared vocoder: ~115-160 MB. This is within the browser's ~500M parameter / ~4 GB memory ceiling but is at the heavy end. **Decision: Proceed — the size is comparable to the Demucs model (235 MB) already running in-browser. Memory-constrained devices may need to limit to one voice at a time.**

### Remaining open questions

Two [CRITICAL] items below must be resolved by a human (with legal / product sign-off) before Phase 3 ships. Earlier phases (DDSP, Kokoro) are not blocked.

- [ ] **[CRITICAL]** Which vocoder can the browser pipeline actually ship with? **Working answer under evaluation:** community NSF-HiFiGAN (CC-BY-NC-SA 4.0, ~50 MB ONNX) from openvpi/vocoders — it is the reference vocoder DiffSinger is designed against, with zero compatibility risk and production use in OpenUtau. **Why this stays [CRITICAL]:** the choice depends on Sourdaw's distribution model qualifying as "NonCommercial" under CC 4.0, and on the ShareAlike clause not forcing downstream obligations onto the app code or the generated audio. Both questions require a human legal determination, not an agent assumption. If NonCommercial or ShareAlike turns out to be incompatible, the fallback (fine-tuning BigVGAN v2 — MIT code — on DiffSinger's exact mel config: n_fft/hop/win/n_mels/sample_rate match, only fmin/fmax differ) is unvalidated and adds material ML-engineering work.

- [ ] **[CRITICAL]** Which DiffSinger voicebank ships on first release? **Working answer under evaluation:** Opencpop (Chinese, CC-BY-NC-SA, the most well-tested DiffSinger voice) as the default, plus any English community voicebanks available under CC-BY-NC-SA or similar non-commercial-compatible terms. **Why this stays [CRITICAL]:** (1) Opencpop is Chinese-only — first-ship without a viable English voicebank makes the flagship browser SVS feature unusable for the core English-speaking user base. (2) The "English community voicebanks under compatible licenses" claim is asserted but not enumerated — an actual shortlist with per-voicebank license verification does not yet exist. (3) Per-voicebank licenses must be displayed in the model registry to satisfy attribution. A concrete first-ship voicebank shortlist with licenses verified must exist before Phase 3 implementation starts.

- [x] **[RESOLVED]** ~~kokoro-js vs Transformers.js v3 for Kokoro?~~ **Use Transformers.js v3.** It is actively maintained by HuggingFace (1.4M monthly users, 155+ architectures), supports quantization variant switching (q4/q8/fp16) out of the box, covers future model additions (not just Kokoro), and uses ONNX Runtime Web internally — same runtime as DiffSinger. `kokoro-js` is a thin wrapper that would become a liability if unmaintained. Transformers.js is the ecosystem standard. Integration: `pipeline('text-to-speech', 'onnx-community/Kokoro-82M-v1.0-ONNX', { device: 'webgpu' })`.

- [x] **[RESOLVED]** ~~Single vs separate Web Workers?~~ **Two workers: one for ONNX Runtime Web (DiffSinger + Kokoro), one for TensorFlow.js (DDSP).** Rationale: loading both runtimes in a single worker context risks global namespace conflicts, doubles initialization time for features that don't need both, and makes memory accounting harder. The ONNX worker handles the majority of inference. The TF.js worker is lightweight (~15 MB models) and can be lazily spawned only when DDSP instruments are used. Both workers share the same typed message protocol — the session manager on the main thread routes requests to the correct worker by model type. GPU contention still prevents true parallel inference, but worker isolation keeps the runtimes clean.

- [x] **[RESOLVED]** ~~Optimal diffusion step count?~~ **Default: 5 steps. Range: 1-20. Configurable per render.** Rationale: this is the full product, not an MVP. 3 steps is the minimum for recognizable output. 5 steps is the sweet spot for quality/speed (DiffSinger's shallow diffusion with `max_depth: 0.6` converges well at 5 steps — OpenUtau uses similar defaults). Higher step counts (10-20) are available for users who want maximum quality and are willing to wait. The UI exposes this as a "Render Quality" slider in the right inspector panel (Layer 2 — guided vocal shaping): Low (3 steps) / Standard (5 steps) / High (10 steps) / Maximum (20 steps). The `steps` tensor input to the acoustic model makes this trivially configurable at inference time.

- [x] **[RESOLVED]** ~~Should the model download manager use the Background Fetch API?~~ **Yes, for downloads >100 MB where available.** Integrated into requirement 5.

- [x] **[RESOLVED]** ~~Speaker embedding blending UI?~~ **Two-tier interface following progressive disclosure:** In Layer 1 (fast composition), the voice selector shows individual speakers as discrete choices in a dropdown — each speaker is a separate selectable voice. In Layer 2 (guided vocal shaping), a "Voice Blend" panel appears when two or more speakers from the same voicebank are available, exposing a blend slider (0-100%) between any two selected speakers and a small visualization of the blend position. In Layer 3 (expert surgery), a multi-speaker blend mixer allows weighting across all available speakers simultaneously with per-phrase automation (blend curves over time). Blending is computed client-side: weighted sum of `.emb` vectors (256 float32 each), expanded to `[1, n_frames, 256]` and passed as the `spk_embed` tensor input.

---

## Tradeoffs and risks

1. **DiffSinger browser SVS is an industry first (HIGH RISK)** — No browser-native singing voice synthesizer exists. The research identifies this as both the highest-impact and highest-risk feature. If tensor preparation, vocoder compatibility, or inference speed prove unworkable, Phase 3 may need to be descoped to "Tauri-native only." Phases 1 and 2 deliver standalone value regardless.

2. **Non-Chrome platforms see disabled feature (LOW after scoping decision)** — macOS Tauri (WKWebView/Safari) and Linux Tauri (WebKitGTK) do not get browser AI features — they are disabled with a message directing to the native pipeline. This is by design. The only risk is user confusion if the feature availability difference is not clearly communicated.

3. **TensorFlow.js vs ONNX Runtime Web fragmentation (MEDIUM)** — If DDSP models require TF.js while DiffSinger uses ONNX Runtime Web, the app ships two inference frameworks. TF.js adds ~1.5 MB to the bundle and has its own WebGPU backend (`tfjs-backend-webgpu`). The inference worker must abstract over both. This is manageable but adds complexity. Prefer ONNX-only if DDSP ONNX conversion is feasible.

3b. **WebGPU dispatch overhead vs native CUDA (MEDIUM)** — Research §3 measures WebGPU ML inference at ~10–20 % of native CUDA performance; the gap is dominated by per-dispatch validation and compile-once costs rather than raw compute. Practical implication for this spec: favor **batched / graph-captured inference** (ONNX Runtime Web `graph capture` for static-shape models) and avoid per-frame single-tensor dispatches in UI code. Interactive previews that issue many tiny dispatches will regress more than a single end-to-end render.

4. **Memory pressure with multiple models (MEDIUM)** — Loading DDSP instrument (~15 MB) + Kokoro (~160 MB) + DiffSinger acoustic (~50-80 MB) + DiffSinger variance/pitch/linguistic (~15-30 MB) + vocoder (~50 MB) = ~290-335 MB of model weights in GPU/WASM memory. Chrome tabs have a ~4 GB memory limit. The session manager's LRU eviction prevents out-of-memory, but switching between instruments/voices incurs model reload latency (1-5 seconds from OPFS).

4b. **Voicebank variety is limited (LOW)** — The DiffSinger community has ~16 voicebanks, mostly Chinese with some English and Japanese. CC-BY-NC-SA licensing is fine for the free app, but users wanting more voice variety will be constrained. Mitigated by: community voicebank growth, potential SoulX-Singer zero-shot cloning in future, and user ability to download third-party voicebanks.

5. **Audio quality gap between browser and native (MEDIUM)** — Browser renders use fewer diffusion steps, smaller vocoders, and WebGPU inference (which may produce slightly different numerical results than native CUDA/CoreML). Users may be disappointed if browser preview quality is noticeably worse than native final quality. Clear labeling ("Preview quality — use native renderer for final") mitigates expectations.

6. **SharedArrayBuffer/COEP header conflicts (LOW)** — Setting `Cross-Origin-Embedder-Policy: require-corp` may break cross-origin resources (fonts from Google Fonts, images from CDNs) unless they include `Cross-Origin-Resource-Policy: cross-origin` headers. Chrome supports `credentialless` COEP as a safer alternative. If COEP cannot be set, ONNX Runtime Web falls back to single-threaded WASM — functional but ~2-3x slower for large models.

7. **Model download size deters users (MEDIUM)** — A fully-kitted browser install pulls Kokoro (~160 MB) + 1 DiffSinger voice (~115–160 MB) + vocoder (~50 MB) + one or two DDSP instruments (~10–30 MB) = **~335–400 MB** before the user hears anything meaningful. Research §10 flags this as "Medium severity, Medium likelihood." Mitigations already in scope: progressive loading order (phonemizer + DDSP first, DiffSinger acoustic last), background downloads via Background Fetch API where available, and per-phrase cache hits for re-renders. What is NOT in scope and must be tracked: a starter-voice path that ships a distilled/smaller variant for the first-render experience, and a storage-use indicator that sets expectations before the download starts. Add this to the companion UX spec's empty-state design.

8. **Browser tab killed during long inference (LOW)** — A 20-step DiffSinger render in the browser can take 30+ seconds, during which the tab may be backgrounded, reloaded, or killed by the OS. Research §10 rates this Low severity / Medium likelihood. For MVP, lost renders are simply re-queued from the beginning; the checkpoint/resume design in Implementation notes captures the future path (intermediate mel-spectrogram snapshots to OPFS per diffusion step). Constraint on MVP: the render queue state must persist across tab reloads (already implied by OPFS-backed cache keys), so at minimum the user returns to the exact queue state after a reload — even if no individual phrase resumes mid-inference.

9. **Tauri WebView drift on Windows (MEDIUM)** — WebView2 on Windows follows the user's installed Edge channel; WebGPU support, `maxStorageBufferBindingSize`, and Background Fetch availability can regress with a WebView2 update outside Sourdaw's control. Capability detection must run on every cold start (not just first launch) and the detected values must be attached to every render's provenance chip so a support reader can tell later whether a bad render came from a WebView2 regression.

## Implementation Status

- **What is implemented**: The browser-based audio generation pipeline is well implemented within the `src/modules/BrowserAi` module. It includes the capability detector, storage manager, download workers, ONNX and TF.js inference workers, and use cases for DDSP, Kokoro TTS, and DiffSinger rendering.
- **What is not implemented**: Moved to `.agents/specs/missing/spec-of-the-gaps.md`.
- **What is done well**: Excellent domain-driven architecture separation (workers, stores, repositories, UI views like `CapabilityReportPanel` and `ModelManagerPanel`), clear separation of inference workers for different backends (`onnxInferenceWorker.ts` and `tfjsInferenceWorker.ts`), and rich event definitions.
- **What needs refactoring**: Moved to `.agents/specs/missing/spec-of-the-gaps.md`.
