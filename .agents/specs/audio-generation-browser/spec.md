---
type: spec
id: SPEC-audio-generation-browser
title: Browser AI inference infrastructure
status: in-progress
owner: The Sourdaw team
sources:
  - research.md
---

# Browser AI inference infrastructure

## Intent

Provide the shared browser-native AI inference foundation that the audio-generation features
build on: dedicated Web Workers per runtime (ONNX Runtime Web and TensorFlow.js), a session
manager that routes by model type, OPFS model storage, a resilient download manager, Chrome +
WebGPU capability detection, a deterministic render cache, and dual-runtime routing that falls
back to the Tauri-native pipeline. All of this lives in a new `BrowserAi` module and runs
entirely client-side with no server or sidecar dependency.

## Non-goals

- The model-specific pipelines themselves — DDSP (`../browser-ddsp-instruments/spec.md`),
  Kokoro TTS (`../browser-kokoro-tts/spec.md`), DiffSinger SVS (`../browser-diffsinger-svs/spec.md`).
- Real-time AudioWorklet inference — all rendering is offline-then-play.
- Non-Chrome browser support, WebNN, cloud/server inference, RVC in browser, voice cloning.
- Tier-3 neural-codec instrument synthesis (registry schema stays forward-compatible only).

## Requirements

### AC-001 — Inference runs only in Web Workers

All model inference must run in dedicated Web Workers; no inference, and no main-thread or
AudioWorklet blocking, may occur during a render.

Verify with: `manual` — start a 15 s DiffSinger render and confirm UI animations hold 60fps with no main-thread block

### AC-002 — Session manager routes by runtime

The session manager must dispatch `onnx` model requests to the ONNX worker and `tfjs` requests
to the lazily-spawned TF.js worker over one typed message protocol.

Verify with: `pnpm test:run -- BrowserAi sessionManager`

### AC-003 — WebGPU execution provider with WASM fallback

ONNX sessions must initialize with `['webgpu', 'wasm']`, falling back to `['wasm']` only as a
safety net with a warning.

Verify with: `pnpm test:run -- BrowserAi executionProvider`

### AC-004 — Models persist in OPFS across reloads

Downloaded model weights must be stored in OPFS (no IndexedDB) and reload from cache without a
network request after a page reload.

Verify with: `pnpm test:run -- BrowserAi storageManager`

### AC-005 — Download manager verifies, retries, and serves cache-first

The download manager must report progress, verify SHA256, retry 3× with backoff, and serve
shards cache-first (OPFS → CDN on miss, then persist).

Verify with: `pnpm test:run -- BrowserAi downloadManager`

### AC-006 — Capability detection gates the feature to Chrome + WebGPU

On first use the system must detect Chrome + `navigator.gpu`, micro-benchmark to classify
`webgpu-fast`/`webgpu-slow`, and disable AI features with an explanatory popup elsewhere.

Verify with: `manual` — open in Firefox/Safari and confirm AI features are disabled with the explanatory popup; confirm a perf tier on Chrome

### AC-007 — Render cache uses deterministic keys with LRU eviction

Rendered audio must be cached by `SHA256(model_id + input + quality + seed)` in OPFS with a
2 GB default budget and LRU eviction.

Verify with: `pnpm test:run -- BrowserAi renderCache`

### AC-008 — Stale detection is shared across browser and native renders

Editing MIDI or lyrics in a rendered phrase must mark it `stale` under one shared render-status
model.

Verify with: `pnpm test:run -- BrowserAi staleDetection`

### AC-009 — Dual-runtime routing respects Tauri availability

Each render use case must check `isTauri()` and offer browser vs native rendering accordingly,
serving cached results without re-rendering natively unless final quality is requested.

Verify with: `pnpm test:run -- BrowserAi dualRuntimeRouting`

### AC-010 — COEP/COOP headers enable SharedArrayBuffer

The deployment must set `Cross-Origin-Embedder-Policy` and `Cross-Origin-Opener-Policy` so
multi-threaded WASM is available, falling back to single-threaded WASM with a warning otherwise.

Verify with: `manual` — confirm `crossOriginIsolated === true` in Chrome and multi-threaded WASM is active

### AC-011 — Only distribution-compatible weights, with attribution

The model manager must only register weights compatible with free non-commercial distribution
(MIT / Apache-2.0 / CC-BY-NC-SA; no AGPL) and display author, license, and source per model.

Verify with: `manual` — inspect every registered model's credits entry for author, license id, and source link

### AC-012 — Module boundaries hold

The `BrowserAi` module must respect domain-driven boundaries and work without Tauri.

Verify with: `pnpm deps:validate`

### AC-013 — Direct manipulation is the editing foundation

Notes, phonemes, pitch curves, parameter curves, and phrase boundaries must be visible,
draggable objects edited directly on the canvas (drag to move pitch/time, drag edges for
duration, draw pitch deviation and breath/tension curves inline) — never settings buried in
dialogs.

Verify with: `manual` — on the singing-editor canvas, drag a note's pitch and edge, and draw a pitch-deviation curve, confirming each edits in place with no dialog

### AC-014 — Render status is pipeline-aware per phrase

Because browser synthesis takes seconds, each phrase must show its own render state on the
canvas — Queued → Preparing → Synthesizing expression → Rendering audio → Ready → Stale, plus
Preview-quality vs Final-quality labels — never a single generic spinner, with phrase progress
bars, a global render-queue panel, cache badges, and explicit cancel/reprioritize actions.

Verify with: `manual` — queue three phrase renders and confirm each shows its own staged status, a cache badge when up to date, and a working cancel/reprioritize control

### AC-015 — Three-layer progressive disclosure

Controls must be organized into exactly three disclosable layers — Layer 1 fast composition
(arrangement, piano roll, lyrics on notes, transport, voice selector, one-click render, macro
sliders), Layer 2 guided vocal shaping (pitch/vibrato lanes, phoneme timing, phrase retakes,
note properties, pronunciation assist, lane chooser), Layer 3 expert surgery (per-phoneme
duration table, raw variance curves, seed, retake masks, model quality/speed, speaker-blend
curves, debug/provenance) — and must never present every lane and parameter at once.

Verify with: `manual` — confirm the default view shows only Layer 1, and that Layer 2 and Layer 3 controls appear only when explicitly opened

### AC-016 — AI presents as an auditionable, reversible variation engine

Every AI generation must be auditionable and reversible through four patterns: retake trays
(3–5 mini-cards with waveform + pitch-contour thumbnails, descriptive tags, seed/model
metadata, one-click apply/pin), change overlays (old pitch gray vs new pitch in color, changed
durations as highlighted splits, parameter deltas shaded), locks/scopes (timing, pitch, lyrics,
phoneme timing, voice identity, parameter lanes — Regenerate acts only on the unlocked scope),
and provenance chips (voice, language, seed, render quality, model version, timestamp, cache
status).

Verify with: `manual` — generate retakes for a phrase and confirm the tray, a change overlay on apply, a lock that scopes Regenerate, and a provenance chip on the result

### AC-017 — Every vocal parameter supports three linked editing modes

Each expressive vocal parameter must offer a macro control (slider/preset chip), a precise
numeric input, and a temporal curve/automation lane — all three, linked — so coarse exploration
and surgical precision both have a control.

Verify with: `manual` — for breathiness, confirm a macro slider, a note-level numeric input, and an automation lane are all present and edit the same parameter

### AC-018 — The five core editing flows are frictionless

The five high-repetition micro-loops must each complete without leaving the canvas: sketch
melody fast (MIDI import → inline lyric typing → split/merge → pitch preview on move → auto
phrase segmentation → instant low-quality preview), fix one awkward word (click note →
pronunciation popover → inline phoneme-timing edit → A/B solo), audition expressive
alternatives (select → retakes → preview in place → compare → apply pitch/timing/timbre/all),
tune a repeated chorus (copy/paste vocal settings → expression presets → optional linked phrases
→ break-link), and micro-edit-and-replay (playhead return on stop → sticky loop → pre-roll
toggle → instant phrase-only replay → audition-selection shortcut).

Verify with: `manual` — walk each of the five flows end to end and confirm each completes on-canvas with no separate screen

### AC-019 — Browser-specific empty states guide first use

The app must present guiding empty states for the no-voice-installed (explain voice packs,
offer one-click starter voice), no-phrase-selected (show track quick actions), no-render-yet
(explain preview vs final), and model-downloading (honest stage labels, editing stays
available) conditions.

Verify with: `manual` — open a fresh project with no installed voice and confirm each empty state renders its guidance and pathway

### AC-020 — Three-region workspace layout with a protected center canvas

The singing editor must use a three-region layout — arrangement strip (top), piano-roll editor
(center, largest, the visual center), contextual inspector (right, collapsible, tabbed: Voice /
Note / Pronunciation / Retakes / Render) — plus a collapsible bottom utility strip (mixer,
render queue, warnings, model downloads).

Verify with: `manual` — confirm the three regions render, the inspector and bottom strip collapse, and the piano roll remains the largest region

### AC-021 — Accessibility baseline and keyboard shortcuts

The editor must ship full keyboard navigation (transport, note nudging, selection) with screen-
reader labels for controls/state-badges/progress, non-color-only status signaling, large note
handles/lane targets, a reduced-motion option, a high-contrast theme with robust zoom, text
summaries for AI warnings/render errors, and shortcuts for nudge/split-merge/cycle-lanes/open-
pronunciation/audition/generate-retakes/accept-retake/lock-unlock/return-playhead.

Verify with: `manual` — drive a full edit-render-compare cycle using only the keyboard, with the high-contrast theme on and color status removed, confirming no action is blocked

### AC-022 — MVP first-session validation gate

A new user's first session must complete eight steps without confusion: load a template, enter
or import notes, type lyrics, click preview, fix one word, draw one pitch change, compare one
retake, and export audio.

Verify with: `manual` — have a first-time user complete all eight steps in one session and confirm each step is discoverable without guidance

### AC-023 — Model weights shard around the 128 MB WebGPU buffer limit

Because Chrome's `maxStorageBufferBindingSize` is often capped at 128 MB regardless of GPU
capability, the inference worker must load models exceeding that size as sharded multi-buffer
weights (ONNX Runtime Web external-data `model.onnx` + `model.onnx_data` pattern).

Verify with: `pnpm test:run -- BrowserAi shardedModelLoading`

### AC-024 — Inference is batched/graph-captured, never per-frame dispatched

Because WebGPU ML runs at ~10–20% of native CUDA dominated by per-dispatch overhead, inference
must use batched / graph-captured execution (ONNX Runtime Web graph capture for static-shape
models) and must not issue per-frame single-tensor dispatches from UI code.

Verify with: `pnpm test:run -- BrowserAi graphCapture`

### AC-025 — Capability detection re-runs on every cold start with provenance

Capability detection must run on every cold start (not only first launch) so a WebView2/WebGPU
regression is caught.

Verify with: `pnpm test:run capabilityColdStart`

### AC-026 — Cache hits skip inference for identical inputs

Identical render inputs must hit the cache without inference.

Verify with: `pnpm test:run -- BrowserAi renderCache`

### AC-027 — Native re-render replaces the browser result

A native re-render must replace the browser result under one shared render-status model.

Verify with: `pnpm test:run -- BrowserAi staleDetection`

### AC-028 — The center canvas is protected from chrome

The center canvas must never be crowded out by chrome.

Verify with: `manual` — confirm the three regions render, the inspector and bottom strip collapse, and the piano roll remains the largest region

### AC-029 — The download manager fetches every model shard

The download manager must fetch every shard of a sharded multi-buffer model.

Verify with: `pnpm test:run -- BrowserAi shardedModelLoading`

### AC-030 — Detected capability values attach to render provenance

The detected capability values must be attached to every render's provenance chip so a later
support reader can attribute a bad render to a capability change.

Verify with: `pnpm test:run capabilityColdStart`

### AC-031 — onnxruntime-web minimum version is 1.17+

The build must depend on `onnxruntime-web` at version 1.17 or later, the minimum that ships the
WebGPU execution provider, IO binding, FP16 inference, and graph capture for static-shape models
(AC-024 depends on graph capture).

Verify with: `pnpm test:run -- BrowserAi onnxRuntimeVersion`

### AC-032 — Native audio transfer uses the Channel API with binary serialization

When running inside Tauri and routing rendered audio to the native engine, audio buffers must
cross the IPC boundary via the Tauri v2 Channel API with binary serialization (or a
`register_uri_scheme_protocol` fetchable resource) — never `emit()`/`listen()`, whose event
system is ~200 ms for a 3 MB payload.

Verify with: `manual` — route a 3 MB rendered buffer to the native engine and confirm transit over the Channel API (or URI-scheme fetch), not `emit()`/`listen()`

### AC-033 — Tauri/Windows bypasses browser storage for models

When running in Tauri on Windows, the model store must bypass browser storage entirely: download
via the Rust backend's `model_download.rs` and serve weights to the webview via
`register_uri_scheme_protocol` or direct file reads, so browser quota limits never apply. (On
macOS/Linux Tauri, browser AI features stay disabled and route to the native pipeline.)

Verify with: `manual` — on Tauri/Windows, download and load a model and confirm files land in the Rust-managed app data directory, not OPFS, with no browser-quota path exercised

### AC-034 — DiffSinger ONNX I/O honours the merged tensor and mel contracts

The DiffSinger inference must build tensors to the exported ONNX I/O contracts: the merged
acoustic model (opset 15) takes `tokens`/`durations` int64, `f0` float32, optional
`energy`/`breathiness`/`voicing`/`tension`/`gender`/`velocity` float32 `[1, n_frames]`, optional
`spk_embed` `[1, n_frames, 256]`, `depth` float32 `[1]`, `steps` int64 `[1]`, and outputs `mel`
float32 `[1, n_frames, 128]`; the vocoder takes `mel` + `f0` and outputs `waveform`
`[1, n_samples]`. Mel-spectrogram parameters must match `dsconfig.yaml`: sample_rate=44100,
hop_size=512, win_size=2048, fft_size=2048, num_mel_bins=128, mel_fmin=40, mel_fmax=16000,
mel_base=`e`, mel_scale=`slaney`; default shallow-diffusion `max_depth`=0.6.

Verify with: `pnpm test:run -- BrowserAi diffSingerTensorContracts`

### AC-035 — DiffSinger voicebank loading follows the OpenUtau layout and prep recipe

Voicebank loading must read the OpenUtau DiffSinger directory layout —
`dsconfig.yaml`/`character.yaml`/`dsdict.yaml`, the acoustic `{name}.onnx`,
`phonemes.txt`/`{name}.phonemes.json` token map, `{speaker}.emb` (256 float32 per speaker), and
the `dspitch/`/`dsvariance/`/`dsvocoder/` subfolders — and replicate OpenUtau's tensor-prep
order: parse the phoneme→token-id map, map lyrics via `dsdict.yaml`, convert note numbers to
`note_midi`, convert durations to frames (`duration_sec * sample_rate / hop_size`), build
`word_div`/`word_dur`, load/expand `.emb` to `[1, n_frames, 256]` (weighted-combine when
blending speakers), set `depth` from `max_depth` and `steps` from quality, pad to dynamic-axis
dims, wrap as ORT `Tensor`s, and read feature flags to decide which optional tensors to include.

Verify with: `pnpm test:run -- BrowserAi diffSingerVoicebankLoad`

## Open questions

- [ ] (non-blocking) Should the registry carry `distillation_origin` and `quality_tier` from day
  one to avoid a future migration? Proposed: yes.
- [ ] (restored detail) Per-stage SVS model budget. The MIDI→singing pipeline is five browser
  stages: phonemizer (rule-based JS, ~0 MB), duration model (~5–10 MB), pitch model (~10–20 MB),
  acoustic DiffSinger shallow-diffusion (~30–50 MB, later research revised to ~50–80 MB), and
  compatible vocoder (~30–55 MB), totalling ~80–175 MB. AC-034/AC-035 fix the tensor and
  voicebank contracts; this records the size envelope that progressive loading (load phonemizer
  + duration first, stream acoustic + vocoder behind) must budget against.
- [ ] (restored detail) DDSP synthesis-only mode parameters. The DDSP autoencoder (ICLR 2020) is
  30 MFCCs → 512-unit GRU → 16 latent dims at a 250 Hz frame rate; harmonic output
  `[batch, time, 101]` (1 amplitude + 100 harmonic distribution), noise output `[batch, time, 65]`;
  ~6M params (supervised solo) or 0.24M (tiny); 16 kHz native, 48 kHz with MAWF-style models. For
  MIDI rendering, DDSP runs synthesis-only — skip the encoder, feed F0 (Hz) and loudness (dB)
  directly to the decoder at 250 Hz. Forward reference because the DDSP/TF.js worker is currently
  stubbed (see Known risks); these are the contracts a future un-stubbing must honour. Precedent
  that the build order rests on: Google shipped DDSP in browsers via TensorFlow.js (Tone Transfer,
  Sounds of India, Paint with Music); DDSP-Piano adds polyphonic capability and MAWF extends to
  48 kHz, the two extension paths beyond the monophonic 16 kHz baseline.
- [ ] (restored detail) Tier-3 neural-codec instrument synthesis (registry forward-compat only,
  per Non-goals). The architecture is MIDI → EnCodec/DAC token prediction via a small transformer
  (~50–100M) → neural codec decoder (15–70M) → waveform, with ~5–15 s render for a 10 s clip on
  WebGPU. No turnkey solution exists; TokenSynth and MIDI-VALLE demonstrate the shape. Recorded so
  the registry schema stays compatible without committing to build it.
- [ ] (restored detail) Model-eviction prevention and OPFS storage figures. OPFS read speed is
  ~2–4× faster than IndexedDB for WebGPU model weights (motivates AC-004's OPFS-only store), and
  Chrome grants up to ~60% of available disk per origin — but cached weights can still be evicted
  under storage pressure. The app must call `navigator.storage.persist()` so downloaded models are
  not evicted between sessions; AC-004/AC-005 record cache-first reload but not this persist call.
  (The Tauri IPC mechanics behind AC-032 — Channel API binary serialization,
  `register_uri_scheme_protocol`, the ~200 ms-per-3 MB `emit()`/`listen()` slowness — are the same
  two-tier conclusion already noted under "Dropped from sources".)
- [ ] (restored detail) Browser-inference-stack figures the capability tier and execution-provider
  defaults rest on: `shader-f16` FP16 needs Chrome 121+; WebGPU covers ~83% of desktop and runs
  GEMM 3–8× faster than WebGL but only ~10–20% of native CUDA (per-dispatch overhead — motivates
  AC-024 batching/graph capture); WebNN NPU access (Intel Core Ultra / Apple Neural Engine) stays
  out of scope; Whisper-WebGPU's <500 ms ASR is the in-browser latency comparator but client-side
  Whisper is a future spec.

## Affected areas

- `src/modules/BrowserAi/` (new module: workers, stores, repositories, useCases, views, events)
- `src/modules/BrowserAi/workers/onnxInferenceWorker.ts`, `tfjsInferenceWorker.ts`, `downloadWorker.ts`
- reuses the worker-bridge and audio-engine patterns from `BrowserAi` and `AudioAnalysis`
- new npm deps: `@huggingface/transformers`, `@tensorflow/tfjs`, `@tensorflow/tfjs-backend-webgpu`

## Known risks

Present-state findings against the `BrowserAi` module as built (audit `audits/modules/BrowserAi.md`).
These are observations carried forward so the spec's requirements are read against today's code, not
prescriptions; each is anchored at file:line.

- `inferenceProgressStore.updateActiveRenderProgress` silently drops progress for an unknown
  requestId (`stores/inferenceProgressStore.ts:32-56`). A worker progress message that arrives just
  after `clearActiveRender` is dropped, so the user sees "render done" without ever seeing 100% —
  undermines the staged per-phrase status AC-014 promises.
- The ONNX worker has no channel to route logs to the main-thread logger and emits `console.warn`
  directly (`workers/onnxInferenceWorker.ts:79`); `selectExecutionProviders` at `:74-81` is a third,
  worker-side WebGPU gate duplicating `capabilityDetector.ts` and `renderDiffSingerPhrase.ts`. A
  typed `{ type: 'log', level, message }` `WorkerResponse` would let the main thread route worker
  logs to the same logger.
- The worker does not unwind partially-loaded sessions on a pipeline error
  (`workers/onnxInferenceWorker.ts:489-545`). Cancellation tears the whole worker down, so all
  sessions reload from OPFS on the next call; cumulative render→error→retry cycles re-pay the full
  session-load cost — relevant to the cancel/reprioritize control behind AC-014.
- `getStorageStatus` async iteration uses an `as AsyncIterable<...>` cast
  (`repositories/storageManager.ts:192-193`), an AGENTS.md soundness escape. (The recovered
  conformance set already lists #72/#75/#76/#78 but omits this one; recorded so AC-012's
  boundary/soundness pass covers it. Fix: a typed OPFS-iterator wrapper or a single
  `// @ts-expect-error` with a removal path.)
- Worker-bridge async functions carry `eslint-disable @typescript-eslint/require-await`
  (`repositories/inferenceWorkerBridge.ts:75-76,88-89,207-208,216-217`) — `async` only for a uniform
  fire-and-forget bridge API. Fix is to split the sync (no requestId) path from the async (with
  requestId) path into separate methods.
- `AiRenderClipPreview.tsx` carries three preview-path foot-guns: a `bufferIdRef.current!` non-null
  assertion immediately after `ensureBufferId` (`:60`); a `source.onended` race gated only on source
  identity that can leave the UI in `playing` while audio is silent (`:68-75`); and
  `ModelManagerPanel.formatBytes` uses a byte-ladder that diverges from the other byte formatters in
  the codebase (`presentations/views/ModelManagerPanel.tsx:35-43`).

## Dropped from sources

- The research's "two-tier hybrid is essential" conclusion — this build runs the full pipeline
  in-browser and treats native as an opt-in higher-quality path, not a required tier.
- IndexedDB / Cache API fallbacks and Firefox support — Chrome-only scoping removes them.
- WebNN, client-side Whisper ASR, LFM-scale models, codec-token Tier 3 — future specs.
- **Build-vs-wait timeline verdicts (original research §11).** The capability matrix preserves each
  model's row, score, and licensing constraint, but the original's explicit "when to build" verdicts
  are not carried as requirements: SVS *build in 6 months* (the path this spec commits to);
  Text→music (MusicGen) *build cautiously* (CC-BY-NC limits commercial use — wait for Apache-2.0 or
  distil your own); Voice cloning *wait 6–12 months*; Full multi-instrument MIDI rendering *wait
  12–18 months*; Real-time neural audio effects *wait 12+ months*; AceStudio-parity singing *wait
  24+ months*. Recorded here as the scoping rationale behind this spec's Non-goals, not as a
  scheduling commitment.
- **Companion UX spec (original `specs/partial/audio-generation-browser.md`, line 786).** The
  original anchored a full `## UI/UX requirements` body and said "Add this to the companion UX
  spec's empty-state design," expecting a separate UX spec to carry the UI/UX content. No such
  spec was ever created. The recovery deliberately keeps the UI/UX requirements in *this* spec
  (now AC-013…AC-022) rather than spinning up a companion spec — the requirements are restored,
  the separate-spec home was not. The full original UI/UX report survives in `research.md` under
  "Restored from migration".
- **UX risk register (original §"UI/UX requirements", lines 188-199) and "Tradeoffs and risks"
  register (lines 770-790).** Two specific tradeoffs lost their home: *Voicebank variety is
  limited (LOW)* — the DiffSinger community has only ~16 voicebanks, mostly Chinese, with some
  English and Japanese; CC-BY-NC-SA is fine for the free app but variety is constrained,
  mitigated by community growth and user-supplied third-party voicebanks. *Tauri WebView drift
  on Windows (MEDIUM)* — WebView2 follows the user's installed Edge channel, so WebGPU support,
  `maxStorageBufferBindingSize`, and Background Fetch availability can regress outside Sourdaw's
  control; the actionable requirement (re-detect on every cold start, attach to render
  provenance) is now AC-025. The full UX risk register is restored verbatim in `research.md`.
- **Reference-material implementation notes (original lines 663-702).** The checkpoint/resume
  design for long diffusion renders (intermediate mel snapshots to OPFS per diffusion step, with
  resume-from-last-checkpoint on tab kill — a future enhancement; for MVP lost renders are
  re-queued) and the Rust-to-WASM inference alternatives (WONNX, Tract, Candle, Burn as
  contingency engines if ONNX Runtime Web's operator coverage or overhead proves insufficient)
  are background reference, not requirements. They are recorded here as the dropped originals.
- **"What is not implemented / What needs refactoring" buckets (original lines 795, 797).** The
  original Implementation-Status section deferred these two buckets to `spec-of-the-gaps.md`,
  where they were collapsed (`intake/spec-of-the-gaps.md` §2.3) to three terse gaps: "Refine
  full fallback routing for browser-based AI generation", "Verify WebGPU fallback robustness
  across browser versions", and "Optimize OPFS storage cleanup logic for heavy use." Recorded
  here so the original two-bucket structure and its routing to the gaps file are not lost.
