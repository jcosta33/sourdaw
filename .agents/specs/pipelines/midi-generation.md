# MIDI generation pipeline — local symbolic inference

## Context

This spec translates the findings from `.agents/research/pipelines/midi-generation.md` into concrete requirements for the **local symbolic-MIDI inference pipeline** that powers Sourdaw's AI MIDI features (Session Players, Chord Track, Melodize, ghost-note suggestions, Humanize).

There are two distinct AI MIDI workstreams in Sourdaw, and this spec only covers one of them:

- **(a) High-level product / UX features** — Session Players (bass / keyboard / drummer), Chord Track, ghost-note suggestions, parametric controls (Complexity / Intensity / Swing). These are covered by `../global/full-spec.md` Chapter 14 and by `../features/workflow-ui.md` (AI ghost clips, preview-then-commit pipeline). **Not this spec.**
- **(b) Local symbolic-MIDI inference pipeline** — the Rust-side architecture that turns DAW MIDI state + user parameters into generated MIDI token streams using REMI/MidiTok tokenization, the Anticipatory Music Transformer (AMT) for infilling and continuation, GrooVAE for humanization, and `ort`-based ONNX inference on a blocking task pool, with results streamed back via typed Tauri Channels. **This spec.**

This is the MIDI-symbolic counterpart to `audio-generation.md` (which covers the audio-domain DiffSinger / RVC singing synthesis pipeline). The two specs share the same underlying infrastructure pattern — local ONNX models, `ort` in Rust, `tokio::spawn_blocking`, typed Tauri Channels, deterministic caching, preview-then-commit integration — but operate on different data domains (MIDI tokens vs audio waveforms).

Existing infrastructure this spec builds on:

- **ONNX Runtime** — `ort` v2.0.0-rc.12 is already a dependency (Demucs, DiffSinger). This spec adds symbolic-MIDI models under the same runtime.
- **Python sidecar** — `src-tauri/sidecar/` exists for models that do not export cleanly to ONNX. This spec does **not** use the sidecar; all MIDI models ship as ONNX.
- **Model download** — `src-tauri/src/commands/model_download.rs` handles HuggingFace downloads with SHA256 verification, chunked streaming, and `~/.local/share/com.sourdaw.app/models/` storage. This spec reuses that path for AMT and GrooVAE weights.
- **Tauri Channels** — `tauri-specta` typed channel contract is already established by the audio-generation pipeline (see `audio-generation.md` §19 and the Tauri v2 Channel API notes in `audio-generation-browser.md`). This spec reuses that pattern for streaming generated MIDI tokens.
- **Ghost-preview surface** — `../features/workflow-ui.md` §E1 (ghost MIDI clips) and §R-E1.* define the UI-layer preview pipeline that AI MIDI output flows into. This spec is the **producer** for that ghost-clip surface; it does not define the UI.
- **`../global/full-spec.md` Chapter 14** — defines the product features (Session Players, Chord Track, Melodize) and their user-visible parameters. This spec defines the inference plumbing that satisfies those features.

The research file establishes three architectural tiers — a zero-latency **rule-based core** (walking bass, probability grids, Euclidean rhythms), a **small-model enhancement** layer (GrooVAE humanization), and a **transformer accompaniment** layer (AMT 128M / 360M for chord-conditioned generation). This spec scopes all three tiers as they relate to the **inference pipeline**. It does **not** scope rule-engine pattern content (genre templates, specific grooves) — those are product content, not pipeline architecture.

**Informative research context (non-normative):**

- Research target (positioning): a viable "Session Players"-class feature in a Tauri DAW is a tiered rule + ~20–360M-parameter transformer architecture; a 360M model can generate 4–8 bars of MIDI in under 3 seconds on consumer hardware.
- Product precedent: Logic Pro's Session Players (Drummer XY pad, Bass/Keyboard parametric controls following a Chord Track, MIDI output rather than rendered audio) is the most-cited reference. Detailed control inventories live in `global/full-spec.md` (§Session Players) and in `research/pipelines/midi-generation.md` — they are **not** re-embedded here.
- **Parametric conditioning is primary**; optional natural-language → preset mappings are a future UX track, not a v1 conditioning surface. Text-only generation tools (text2midi, MuseCoco) are out of scope.
- Competitive landscape (Band-in-a-Box, Tonalic, EZdrummer Bandmate, Cubase's generative features, Ableton Drum Rack humanization) is surveyed in research for positioning only; this spec does not aim for feature parity with any single product.

---

## User-visible behavior

This pipeline has no direct UI; it is the **producer** feeding consumer features. From the producer's side, the visible behavior is:

- **Generation starts** when a caller (Session Players, Chord Track, Melodize, ghost-note suggestions, Humanize) invokes the corresponding use case in the producing feature.
- **Streaming preview:** Generated MIDI tokens arrive over a typed Tauri Channel, decoded into notes that appear as a **ghost MIDI clip** in the arrangement or piano roll (surface defined by `../features/workflow-ui.md`).
- **Latency envelope:** First notes visible in the ghost preview ≤ 300 ms after the generation request on a mid-tier Apple Silicon / Intel laptop; full generation for a typical 16-bar phrase ≤ 2 s.
- **Accept / dismiss / cycle alternatives** flows through the existing ghost-clip UI. Accepting a ghost clip copies provenance (model ID, temperature, seed, prompt hash) onto the committed clip's `aiProvenance` field.
- **Deterministic reproduction:** Given identical inputs (model version, seed, temperature, prompt, tokenizer version), two runs produce identical MIDI output.

## Goal

After implementation, Sourdaw has a local, offline, privacy-preserving symbolic-MIDI inference pipeline in Rust that:

1. Accepts DAW MIDI state (notes, chord track, tempo, time signature) plus per-feature parameters.
2. Tokenizes that state via REMI (for bar-position models) or arrival-time encoding (for AMT).
3. Runs inference on a blocking task pool via `ort`, with deterministic seedable RNG and KV-cache autoregressive decoding.
4. Streams generated MIDI tokens back to the frontend via typed `tauri-specta` channels.
5. Decodes tokens to DAW MIDI notes that land in the ghost-preview surface defined by `../features/workflow-ui.md` (AI ghost MIDI clips), where the user accepts, dismisses, or cycles alternatives.

Each product feature (Session Player continuation, Chord Track progression, Melodize, Humanize) maps to one numbered sub-contract inside this pipeline, with its own inputs, outputs, and latency budget.

---

## Scope

**In scope:**

- Tokenizer layer: REMI / REMI+ adapter (via a Rust port of MidiTok's decoder) and arrival-time adapter (for AMT), with round-trip guarantees.
- ONNX inference of the Anticipatory Music Transformer (AMT-small 128M, AMT-medium 360M) via `ort` with KV-cache.
- ONNX inference of GrooVAE (humanization + Tap2Drum variants) via `ort`.
- `tokio::spawn_blocking` execution harness for all CPU-heavy inference, with cooperative cancellation.
- Typed Tauri v2 Channels for streaming generated tokens / MIDI events back to the frontend, generated via `tauri-specta`.
- Deterministic seedable RNG for reproducible output.
- Per-feature inference contracts: Session Player continuation, Chord Track progression, Melodize (melody from chord), Humanize (micro-timing + velocity).
- Model bundle definition: which weights ship with the app, their storage location, checksum verification, and version pinning.
- Integration with the existing `../features/workflow-ui.md` ghost-preview surface (produce `GhostMidiClip` payloads that the frontend renders).
- Frontend module `src/modules/MidiGeneration/` (producer of ghost-clip payloads, consumer of typed channels).
- Tauri command surface for kicking off / cancelling inference and enumerating available models.

**Non-goals (explicitly out of scope):**

- Cloud inference — covered elsewhere / future work. All models in this spec run locally.
- Audio-domain MIDI (audio → MIDI transcription) — covered by the Knead module / a separate spec.
- UI details — panel layout, parameter labels, XY pads, icons, onboarding are covered by `../features/workflow-ui.md` and `../global/full-spec.md` Chapter 14.
- Pattern content / genre templates / voicing libraries — product content, not pipeline architecture. Rule-engine behaviour is only in scope insofar as this spec defines the call site that feeds the ML enhancement layer.
- Fine-tuning, training, or user-supplied model weights — only bundled or HuggingFace-pinned weights are supported.
- MusicLang (GPL-3.0) and any other copyleft-licensed weights — license incompatible with shipping.
- Full-song audio generation (ACE-Step), singing synthesis (DiffSinger), voice conversion (RVC) — audio domain, covered by `audio-generation.md`.
- WebGPU in-browser inference — the research flags WebGPU as an **optional Windows-only fallback**; out of scope for v1. Primary path is native `ort` in Rust.
- Browser-tier MIDI inference — all symbolic inference is Tauri-native. The browser tier is a consumer only.
- Rule-engine pattern content (walking-bass probabilities, drum-grid templates, voicing libraries). The harness that calls a rule engine from the pipeline is in scope; the content is not.

---

## Requirements

### R1 — Tokenizer layer (REMI + MidiTok adapter, arrival-time adapter)

The pipeline provides two pluggable tokenizer implementations, both in Rust, both operating on the shared DAW MIDI model:

- **REMI / REMI+ tokenizer** — bar / position / pitch / velocity / duration tokens, plus chord and tempo tokens at position markers. A faithful Rust port of MidiTok's REMI+ decoder (and its default chord vocabulary: 12 roots × 14 qualities = 168 chord tokens). Used for MIDI-GPT-family models and future REMI-based checkpoints.
- **Arrival-time tokenizer (AMT)** — `(onset_time_ms, duration, note = 128 × instrument + pitch)` triplets at 10 ms resolution, with the generated-vs-control event doubling (~55k-token vocabulary). Used for the Anticipatory Music Transformer.

Both adapters operate against a shared internal `MidiModel` type defined in the module that owns this pipeline; they do not depend on DAW-module models directly (model-isolation rule).

**Acceptance criteria:**

- **AC-R1.1** — For every fixture in `fixtures/midi/roundtrip/*.mid`, the sequence `MIDI → REMI tokens → MIDI` is bit-identical to the original at the byte level after canonical re-serialization (ignoring non-semantic metadata like producer string). Verified by a Vitest unit suite calling a Tauri command that performs the round-trip in Rust.
- **AC-R1.2** — For every fixture in `fixtures/midi/amt/*.mid`, the sequence `MIDI → arrival-time tokens → MIDI` produces the same note events (onset ±1 ms, duration ±1 ms, pitch and instrument exactly equal).
- **AC-R1.3** — Chord tokens in REMI+ round-trip without loss across the full 168-entry vocabulary; custom chord entries added at startup are serialized with their symbolic name and restored identically.
- **AC-R1.4** — Tokenizer errors (invalid token sequences, out-of-vocabulary tokens, invalid timing) return typed errors, never panic. Verified by a fuzz test that feeds 10k random token streams and asserts no panic.

### R2 — Anticipatory Music Transformer (AMT) inference

The AMT is integrated as the primary neural accompaniment engine, using its **anticipation mechanism** for constrained infilling and continuation:

- Control events (e.g. chord-track voicings, a user-supplied melody, an existing track) are interleaved into the generation sequence at positions determined by the lookahead parameter δ (default 5 seconds, configurable).
- Generated events are distinguished from control events via the doubled-vocabulary encoding.
- Generation is autoregressive with KV-cache, temperature, top-k / top-p sampling, and seedable RNG.
- Models are exported via `optimum-cli export onnx` with KV-cache I/O tensors and quantized to INT8 or FP16 (per-model choice documented in the model registry).

**Acceptance criteria:**

- **AC-R2.1** — Given a fixture `melody.mid` (top-line melody on one track) and `chords.mid` (chord track voicings), the AMT produces a continuation track where ≥ 85 % of generated note onsets land on chord tones of the active chord at that time (measured against the chord-track time grid, with tolerance of one 16th-note).
- **AC-R2.2** — Given the same inputs + a fixed seed, two successive runs produce byte-identical output MIDI (determinism).
- **AC-R2.3** — The AMT-small (128M) model generates 4 bars of continuation in **< 8 s on CPU (Apple M3 / Intel i9)** and **< 1.5 s on CUDA RTX 3060 or CoreML M-series** for a 4-bar context of ≤ 32 notes (research-derived bounds).
- **AC-R2.4** — KV-cache is enabled: disabling it (flag in the registry entry for diagnostics) produces identical output but measurably higher latency (≥ 10× slower in a benchmark).
- **AC-R2.5** — Control-event interleaving honours δ: with δ = 0, a control note at time `t` must appear in the prefix of every generated-event position at or before `t`. Verified by a tokenizer-level unit test that snapshots the interleaved sequence.

### R3 — GrooVAE humanization

GrooVAE (Google Magenta, CC BY 4.0) is integrated as the humanization layer that transforms straight quantized patterns into expressive performances:

- Humanization variant: input is a quantized 2-bar drum pattern (16th-grid), output is the same notes with per-note velocity and micro-timing offsets.
- Tap2Drum variant (optional, lower priority): input is a single-voice tapped rhythm, output is a full drum kit pattern. Gated behind a feature flag for v1.
- Training reference (informative): the Groove MIDI Dataset — 13.6 hours / 22,000+ measures / 10 professional drummers, CC BY 4.0.
- Runs via `ort` on CPU in < 100 ms per 2-bar pattern (research-derived).
- Swing parameter `0.0–1.0` (normalized; research expresses the same control as a `0–100%` percentage) is applied as a **post-processing pass** on top of GrooVAE output (upbeat shift = `swing × triplet_offset`), since no current model handles swing feel well (per research).

**Acceptance criteria:**

- **AC-R3.1** — Given the fixture `straight_fourfloor.mid` (kick on every beat, snare on 2 & 4, hi-hat on every 8th, all velocity 100, all on-grid) with `swing = 0.5`, GrooVAE-small produces velocity values within ±2 of the reference output fixture `groovae_fourfloor_swing0.5.mid`, and onset offsets within ±2 ms of the reference.
- **AC-R3.2** — Running GrooVAE twice with the same seed produces byte-identical output (determinism).
- **AC-R3.3** — GrooVAE humanization of a 2-bar pattern completes in < 100 ms on CPU (mean over 10 runs) and never exceeds 250 ms p99.
- **AC-R3.4** — Swing post-processing with `swing = 0` is a no-op (upbeats unchanged within ±1 µs).

### R4 — ONNX runtime via `ort`

All symbolic-MIDI models load and run through `ort` (already a dependency). Python-sidecar routing is **not** used for MIDI models — every model in this spec must export cleanly to ONNX.

- Models are quantized (INT8 or FP16 per model) to keep total resident memory within the **8 GB-system budget** (see open question O2).
- Execution providers are selected per platform identically to the audio pipeline: CoreML on macOS, DirectML on Windows, CUDA on Linux, CPU fallback everywhere. Per-feature CPU-vs-GPU routing is tracked as open question O3.
- Sessions are cached lazily using the `OnceLock` pattern established by `ai_audio.rs`, and unloaded on explicit request or under a configurable memory-budget.

**Acceptance criteria:**

- **AC-R4.1** — AMT-small loads in **< 3 s on cold start** on Apple M1 / Intel i5; AMT-medium loads in **< 8 s**. GrooVAE-small loads in **< 500 ms**.
- **AC-R4.2** — Per-feature inference latency bounds (P50, measured):
  - Session Player continuation (AMT-small, 4-bar context): **< 500 ms on GPU, < 4 s on CPU**
  - Chord Track progression (AMT-small, 8-bar gen): **< 1 s on GPU, < 8 s on CPU**
  - Melodize (AMT-small, 4-bar gen): **< 500 ms on GPU, < 4 s on CPU**
  - Humanize (GrooVAE-small, 2-bar): **< 100 ms on CPU**
- **AC-R4.3** — Only one heavy neural model (AMT) is resident at a time; small models (GrooVAE) can remain resident. Verified by a runtime-memory check that reports total ONNX-session bytes.
- **AC-R4.4** — No model weights with licenses incompatible with commercial shipping (GPL, CC-BY-NC-SA, CC-BY-NC) are loaded, and the model registry explicitly tags license strings that the registry loader whitelists.

**Implementation notes (ort ecosystem).** The `ort` crate is widely used in production (research cites HuggingFace TEI and Google Magika as adopters) and its `Session` type is `Send + Sync`, so read-only inference sessions can be shared across threads without a `Mutex`. Small symbolic-MIDI models (20–360M parameters) fit well under 1 GB at FP16 — memory is rarely the gating factor for this tier, integration/exportability is.

### R5 — `tokio::spawn_blocking` for inference

All CPU-heavy autoregressive inference runs on the Tokio blocking task pool, never on the main async runtime, and never on the CPAL audio thread:

- Every `#[tauri::command]` inference entry point wraps its inner loop in `tokio::task::spawn_blocking`.
- Cancellation is cooperative: the inference loop checks a `CancellationToken` between each token (or every N tokens for fine-grained control) and exits cleanly with a `Cancelled` result.
- Concurrent inference requests are serialized per-model (one AMT request at a time) via a per-model `tokio::sync::Semaphore`; non-conflicting requests (e.g. AMT + GrooVAE) may run concurrently.

**Acceptance criteria:**

- **AC-R5.1** — While an AMT inference is in-flight, unrelated Tauri IPC calls (e.g. `get_transport_state`, `list_models`) return within **10 ms P99** (UI-thread non-blocking verification).
- **AC-R5.2** — Cancelling a Session Player render within 500 ms of starting it stops the inference loop and returns a `Cancelled` result within 200 ms of the cancel call.
- **AC-R5.3** — Submitting two AMT requests in parallel results in one waiting on the semaphore; the second starts within 20 ms of the first completing (no starvation, no deadlock).
- **AC-R5.4** — No ONNX inference runs on the CPAL audio thread. Verified by an audio-thread assertion that panics if an `ort::Session::run` is entered from that thread in debug builds.

### R6 — Typed Tauri Channels for streaming

Results stream back to the frontend via Tauri v2 Channels, typed end-to-end via `tauri-specta` (same mechanism as the audio-generation pipeline):

- A single channel contract `MidiGenerationEvent` carries typed variants: `Started { request_id, model_id }`, `Tokens { request_id, tokens: Vec<Token>, progress: f32 }`, `Notes { request_id, notes: Vec<MidiNote>, progress: f32 }`, `Completed { request_id, final_notes, provenance }`, `Failed { request_id, error }`, `Cancelled { request_id }`.
- `tauri-specta` generates the matching TypeScript type and is consumed by the `MidiGeneration` frontend module.
- Token-level streaming is preferred for AMT (first notes appear in < 200 ms per research) so the ghost-clip UI can begin populating during generation.
- The Tauri event bus (`emit` / `listen`) is **not** used for streaming MIDI — the research and the audio-generation-browser-pipeline spec both document it as slow for large payloads. Channels are mandatory.

**Acceptance criteria:**

- **AC-R6.1** — `pnpm typecheck` passes with the generated TypeScript channel-payload types consumed by the frontend, with no `any` on the channel boundary.
- **AC-R6.2** — The generated TS type for `MidiGenerationEvent` is re-exported from `src/modules/MidiGeneration/index.ts` and imported by at least one frontend consumer (the ghost-clip producer).
- **AC-R6.3** — A fixture-level integration test (running Tauri in a test harness) asserts that a 4-bar Session Player render emits `Started → Tokens (≥ 1) → Notes (≥ 1) → Completed` events in strict order, and that every payload decodes against the generated TS type (no runtime parse failure).
- **AC-R6.4** — Cancelling mid-stream causes the channel to emit `Cancelled` exactly once, after which no further events are emitted for that `request_id`.

### R7 — Preview-then-commit integration with ghost MIDI clips

Inference output flows into the ghost-preview surface defined by `../features/workflow-ui.md` §E1 and §R-E1.* (AI ghost MIDI clips). This pipeline is the **producer**; the ghost-clip surface is the **consumer**.

- On `Completed`, the `MidiGeneration` frontend module constructs a `GhostMidiClip` UI object from the payload (notes, provenance metadata, request ID as the ghost ID) and hands it to the ghost-clip layer. The pipeline does not directly mutate the project model.
- Provenance metadata required on every ghost clip: `modelId`, `modelVersion`, `inputHash` (SHA256 of the serialized structured input), `seed`, `tokenizer` (`"remi+"` / `"arrival-time"`), `feature` (one of the R9 sub-contracts), `createdAt`.
- Accept / dismiss / cycle-alternatives is already defined by `../features/workflow-ui.md`. This spec only requires that **accepting** a ghost MIDI clip copies the provenance fields onto the committed clip's `aiProvenance` field (same field shape already defined for ghost audio clips, E2).

**Acceptance criteria:**

- **AC-R7.1** — A completed Session Player render appears as exactly one ghost MIDI clip on the target track, carrying the full provenance tuple, with `modelId = "amt-small"` and `feature = "session-player-continuation"`.
- **AC-R7.2** — Dismissing the ghost clip does not mutate the project model (asserted by a project-model snapshot before-and-after).
- **AC-R7.3** — Accepting the ghost clip produces a committed MIDI clip whose `aiProvenance` matches the ghost's provenance tuple byte-for-byte.
- **AC-R7.4** — The pipeline never writes to the project model directly; it only emits channel events that the frontend converts into ghost-clip state. Verified by a grep-level architectural test that the `MidiGeneration` module never imports project-model mutators.

### R8 — Model shipping, pinning, and checksums

The initial model bundle is:

- **AMT-small-800k** (128M params, Apache-2.0, INT8-quantized) — primary neural backbone.
- **GrooVAE-small (humanize)** (CC BY 4.0, FP16) — drum humanization.

Both are **downloaded at first-use** (not bundled into the installer) via the existing `model_download::ensure_model()` path, cached under `~/.local/share/com.sourdaw.app/models/midi/`, and version-pinned in a `midi_model_registry.json` that ships with the app. Each registry entry records: `model_id`, `hf_repo`, `hf_revision` (commit SHA, not tag), `files`, `sha256` (per file), `size_bytes`, `license`, `runtime = "ort"`, `quantization`, `min_ram_bytes`, `min_vram_bytes`, `tokenizer_id`.

AMT-medium (360M) is **optional** and gated behind a user-visible "Install higher-quality model" action — it is not part of the initial bundle; resource budget is the blocker (see O2).

**Acceptance criteria:**

- **AC-R8.1** — `midi_model_registry.json` is present in the Tauri resource bundle at build time and is loaded at app startup.
- **AC-R8.2** — On first use of a MIDI feature, if the corresponding model is not yet downloaded, the download is triggered, progress is shown via the existing `model-download-progress` event surface, and the inference call blocks until the download completes (or fails).
- **AC-R8.3** — SHA256 verification on every downloaded file is enforced; a corrupted file triggers an automatic re-download exactly once, then surfaces an error if still invalid.
- **AC-R8.4** — Version pinning uses the HuggingFace commit SHA, not a tag. Pointing the registry at a different SHA is the only supported way to upgrade a model.
- **AC-R8.5** — Removing a model from disk (via the model-management UI) transitions its registry status back to `not-downloaded` and invalidates any inference cache keyed by that model.

### R9 — Per-feature inference contracts

Every product feature maps to exactly one numbered inference contract. Each contract has a typed request, a typed response, and a latency budget. All contracts share the same channel (R6), differentiated by the `feature` field.

- **R9.1 — Session Player continuation.**
  - Input: `{ chordTrack: ChordSpan[], priorNotes: MidiNote[], instrument: "bass" | "keys" | "drums", bars: u8, parameters: SessionPlayerParams, seed: u64 }`
  - Output: `MidiNote[]` for the generated bars, on a single track.
  - Budget: per R4.2.
  - Implementation: AMT-small with chord-track voicings as control events, anticipation δ = 5 s.

- **R9.2 — Chord Track progression generation.**
  - Input: `{ key: Key, style: StyleTag, bars: u8, seedChord?: ChordSymbol, parameters: ChordTrackParams, seed: u64 }`
  - Output: `ChordSpan[]` (symbolic chord symbols + bar positions). **Not** raw MIDI notes — this contract emits chord-track entries, not a MIDI clip.
  - Budget: per R4.2.
  - Implementation: AMT-small with symbolic chord symbols expanded to voicings internally, plus a post-pass that converts the generated voicings back to chord symbols.

- **R9.3 — Melodize (melody from chord).**
  - Input: `{ chordTrack: ChordSpan[], bars: u8, parameters: MelodizeParams, seed: u64 }`
  - Output: `MidiNote[]` for a single monophonic melody track aligned to the chord track.
  - Budget: per R4.2.
  - Implementation: AMT-small with chord-track voicings as control events, conditioned for high chord-tone percentage.

- **R9.4 — Humanize.**
  - Input: `{ notes: MidiNote[], swing: f32, intensity: f32, seed: u64 }`
  - Output: `MidiNote[]` with per-note velocity and onset offsets applied.
  - Budget: per R4.2.
  - Implementation: GrooVAE-small (drums) or a deterministic rule-based humanizer (non-drum) — routing by instrument type; the per-instrument routing is tracked as part of O3 if hardware-accelerated execution is needed.

Every contract is exposed as a single Tauri command, generated with `#[tauri::command]` and declared via `tauri-specta` so the TS frontend sees the exact typed request shape.

**Acceptance criteria:**

- **AC-R9.1** — Each of R9.1–R9.4 has its own Tauri command, its own typed request / response in the generated TS types, and its own integration test fixture.
- **AC-R9.2** — The channel `feature` field for every event emitted by a given command matches that command's contract number (e.g. R9.1 always emits `feature = "session-player-continuation"`).

### R10 — Deterministic mode and seeded RNG

All stochastic operations (sampling, GrooVAE latent draw, humanization jitter) go through a single seedable RNG:

- Every inference call takes a `seed: u64` in its typed request. The same seed + same structured input produces byte-identical output.
- The RNG is a `ChaCha20Rng` (or equivalent cryptographically-strong RNG) seeded per-request — never a shared global.
- The seed is recorded in the provenance tuple on every generated clip (R7), so re-generating from a committed ghost's provenance produces the same MIDI.

**Acceptance criteria:**

- **AC-R10.1** — For every R9.1–R9.4 contract, two successive calls with identical structured input and identical seed produce byte-identical MIDI output.
- **AC-R10.2** — Calling with two different seeds produces different output (at least one note differs) in at least 99 of 100 trials for each contract.
- **AC-R10.3** — The provenance seed copied onto a committed clip, when re-submitted, regenerates the exact same MIDI (verified by a round-trip fixture test).

---

## Constraints

- Domain-driven architecture per `AGENTS.md` — cross-module imports only via root `index.ts`, one function per useCase / repository file, no deep imports, models private to the module.
- The `MidiGeneration` module does not import project-model mutators directly; all project-state changes happen via the existing ghost-clip accept / dismiss use cases in the Arrangement module (consumer / producer split per R7).
- No MIDI inference runs on the CPAL audio thread. All inference runs on `tokio::spawn_blocking`.
- ONNX inference uses `ort` only. No additional ML frameworks in Rust. No Python sidecar for MIDI.
- License safety: only Apache-2.0, MIT, or CC-BY (non-NC) weights. GPL-3.0 (MusicLang), CC-BY-NC-SA (NSF-HiFiGAN-style), and unclear licenses (MIDI-GPT per research) are excluded from the v1 model bundle.
- `pnpm deps:validate` passes with zero violations after implementation.
- `pnpm typecheck` passes with zero errors; the `tauri-specta` generated TS types flow through to the consumer without `any`.
- All symbolic chord handling goes through a single, shared chord vocabulary defined in the module (168 entries, matching MidiTok's default). Extensions are added in one place.

---

## Design decisions

### Decision: Local inference (not cloud)

**Chosen:** All symbolic-MIDI inference runs locally via `ort` + Tauri.

**Considered and rejected:**

- **Cloud inference via a hosted API** — rejected for v1 on privacy, offline use, and marginal-cost grounds. Sourdaw's positioning is local-first; a creative workflow should function without network, and every generation should be free at the margin. Cloud inference is a future workstream (not this spec).
- **Hybrid (cloud for AMT-medium, local for AMT-small)** — rejected for v1 to avoid a two-tier story in the UI on the first release. Revisit once local AMT-medium performance is a known-good baseline.

### Decision: `ort` (ONNX Runtime) over alternatives

**Chosen:** `ort` v2.0.0-rc.12 (already a dependency).

**Considered and rejected:**

- **Candle (HuggingFace)** — considered per research as the alternative for custom architectures. Rejected for v1 because AMT and GrooVAE both export cleanly to ONNX (AMT is a standard `GPT2LMHeadModel`; GrooVAE is a small VAE). ONNX Runtime's KV-cache and execution-provider story is more mature, and we already have `ort` integration tests in the audio pipeline. Reconsider only if a future model's architecture cannot be expressed in ONNX.
- **mistral.rs** — rejected per research: only supports standard LLM architectures; AMT's custom tokenization and doubled-vocabulary anticipation mechanism is not supported.
- **PyTorch via Python sidecar** — rejected because AMT and GrooVAE export cleanly to ONNX; the sidecar path exists only for models that don't (e.g. RVC in the audio pipeline).

### Decision: AMT over full MusicGen-style generators

**Chosen:** Anticipatory Music Transformer (128M / 360M) as the primary neural engine.

**Considered and rejected:**

- **MusicGen / MusicLang / large end-to-end models** — rejected on size, speed, license, and control-surface grounds. MusicLang is GPL-3.0 (incompatible). MusicGen is audio-domain, not symbolic-MIDI. Larger checkpoints would violate the 8 GB-system memory budget (see O2). AMT's anticipation mechanism gives us per-track control with explicit constraints — the exact interaction model needed for Session Players.
- **MIDI-GPT (20M)** — considered for edge deployment, but its license is unclear per research (the paper lists it ambiguously). Monitored as a future addition if licensing clarifies.
- **Composer's Assistant v2** — strong secondary candidate, already has a DAW integration (REAPER). Future addition, not v1, to avoid shipping two similar neural infilling engines before we have UX evidence for which one performs better in our workflow.

### Decision: Tokenizer diversity (REMI + arrival-time) rather than a single scheme

**Chosen:** Two tokenizer adapters — REMI+ (for future bar-position models and chord symbolic work) and arrival-time (for AMT).

**Considered and rejected:**

- **Arrival-time only** — rejected because the chord-track and chord-symbol vocabulary lives natively in REMI+, and R9.2 (Chord Track progression generation) works against chord symbols, not raw note voicings. A REMI+ path keeps chord generation first-class.
- **REMI only** — rejected because AMT is specifically an arrival-time model and its anticipation mechanism requires absolute-time positioning of control events. Forcing it through REMI would lose the model's core capability.

### Decision: Rule engine as producer, ML as enhancer — but only the call site is in scope

**Chosen:** This spec defines the call-site harness where a rule engine produces a pattern that is then optionally enhanced by GrooVAE humanization (R3) or AMT generation. The pattern content (walking-bass probabilities, drum templates, voicings) is **product content**, not pipeline plumbing, and is owned by a separate spec.

**Considered and rejected:**

- **All-ML pipeline, no rule engine** — rejected per research: ML-only is fragile, slow to first note, and wasteful for simple patterns.
- **Scoping the rule engine content into this spec** — rejected because it balloons scope beyond the "inference pipeline" theme; the rule-engine content overlaps heavily with `global/full-spec.md` Chapter 14's parameter specs.

### Decision: Product-behaviour constraints inherited from Logic Pro Session Players criticism

**Chosen:** Three product-behaviour rules are lifted from research's Logic Pro critique section and pinned at the pipeline layer so the consumer features cannot violate them:

1. **Conservative default complexity.** The research cites user feedback that Logic Pro's default complexity is too high ("the very first thing I do is pull complexity way down"). Every R9 contract's `SessionPlayerParams` / `ChordTrackParams` / `MelodizeParams` type must define a `complexity` field whose default deserialisation value is ≤ 0.5 on a 0–1 scale. The pipeline refuses to execute with `complexity > 0.8` unless the caller passed an explicit non-default value.
2. **Non-destructive MIDI.** Logic Pro loses regeneration when Session Player regions are converted to MIDI. Sourdaw's provenance-preserving ghost-clip integration (R7) already guards against this — the spec now calls it out explicitly: a committed ghost clip MUST retain its full provenance tuple after accept, so re-generation with the same seed + same inputs is always possible. Clip-conversion pipelines elsewhere in the app must not strip `aiProvenance`.
3. **Chord-tone constraint at high complexity.** Research cites Logic Pro's keyboard player producing "more wrong notes at higher complexity." At `complexity > 0.7`, the AMT decoding step MUST post-filter sampled pitches against the active chord's chord-tone set (root, third, fifth, and — for 7th/extended chords — the seventh and relevant extensions), re-sampling any pitch that is not a chord tone up to N times (default 3) before falling through to the original pitch. AC-R9.1 gains a sub-criterion: at `complexity = 0.9`, ≥ 95 % of generated pitches on beats 1 and 3 must be chord tones (measured over the fixture suite).

**Considered and rejected:**

- **Trusting the model to self-constrain** — rejected because the AMT has no explicit chord-tone loss during training; its chord conditioning is implicit via control events. Post-filtering is cheap (O(1) per pitch) and the research's "wrong notes at high complexity" failure mode is well-documented.

### Decision: Channel streaming over request-response

**Chosen:** Streaming via typed `tauri-specta` Channel with token-level chunks.

**Considered and rejected:**

- **One-shot request-response** — rejected because the research shows first notes can appear in 50–200 ms via REMI's incremental decoding, and the UX payoff (ghost clips populating live) is significant.
- **Tauri event-bus (`emit` / `listen`)** — rejected: the audio-generation-browser-pipeline spec and the Tauri docs document it as slow for large payloads (~200 ms for 3 MB). Not appropriate for token-level streaming.

### Decision: First-use download, not bundled weights

**Chosen:** Models download on first use into `~/.local/share/com.sourdaw.app/models/midi/`.

**Considered and rejected:**

- **Bundling weights into the installer** — rejected on installer-size grounds (AMT-small at INT8 is ≈ 70 MB; bundling multiple models and voicebanks inflates the installer dramatically). Users without MIDI-generation interest should not pay for MIDI weights.
- **Downloading at install time** — rejected because it requires network at install, blocking offline installs.

---

## Acceptance criteria (release gate)

- [ ] All of `AC-R1.*` through `AC-R10.*` above pass (integration + unit).
- [ ] Every R9.1–R9.4 contract has a working Tauri command, a typed TS request / response, and a fixture-backed integration test.
- [ ] The AMT-small and GrooVAE-small model registry entries are present with pinned HuggingFace commit SHAs and SHA256 checksums for every file.
- [ ] Cold-start inference + first-note latency budget (per R4.2) is met on the Apple M3 / Intel i9 CPU baseline.
- [ ] Concurrent inference + UI IPC calls remain responsive (P99 IPC latency < 10 ms during active inference) — R5.1.
- [ ] No MIDI inference runs on the CPAL audio thread (R5.4 audio-thread assertion).
- [ ] `pnpm deps:validate` passes with zero architectural violations.
- [ ] `pnpm typecheck` passes with zero errors.
- [ ] The ghost-clip integration produces a valid ghost MIDI clip for every R9.* contract, with provenance correctly copied onto a committed clip on accept (R7).
- [ ] No model with an incompatible license (GPL, CC-BY-NC*, unclear) is reachable via the registry.
- [ ] Deterministic mode (R10) passes identical-seed-identical-output for every contract.

---

## Implementation notes

- **Reuse the audio-generation pipeline infrastructure.** `audio-generation.md` already establishes the `ort` + `tokio::spawn_blocking` + typed Tauri Channel pattern. This spec's Rust services should depend on the same shared `ai-runtime` crate (or equivalent) rather than fork new inference plumbing.
- **Prototype Tier 1 and Tier 3 in parallel.** Research recommends prototyping the rule engine (Tier 1) and the AMT ONNX path (Tier 3) in parallel because they are architecturally independent and together validate the full pipeline from chord track to generated MIDI. Tier 2 (GrooVAE humanization) can slot in once both validate.
- **Canonical MIDI I/O.** Prefer `midly` for in-Rust MIDI file I/O in tests and fixtures (used by the research's recommended tokenizer stack; also used by Symusic, the Rust backend under MidiTok).
- **Tokenizer parity (reference).** MidiTok implements REMI, REMI+, Compound Word, and 8+ other schemes with Symusic as its Rust-based MIDI I/O backend. Our Rust port follows the MidiTok decoder semantics; Symusic is a useful parity reference even though it is not a direct dependency.
- **Tokenizer lives in Rust.** Port the decoder paths from MidiTok; keep encoder paths only as needed for prompt construction. Treat tokenizer versions as part of the cache key.
- **Cache identity:** hash of `{model_id, tokenizer_version, temperature, seed, prompt_tokens}` → generation output. Store cached outputs in a size-capped on-disk LRU (e.g., `cacache` or equivalent).
- **Model shipping:** quantized (Q4/Q8) weights ship out of band (downloader, not bundled). Provide a "Download AI pack" UX in settings; models load lazily on first use.
- **Channel framing:** each streamed chunk is `{ run_id, seq, tokens, is_final }` — callers reconstruct the note sequence incrementally; consumers treat out-of-order chunks as protocol violations.
- **Determinism:** When seed is supplied, pin thread counts and runtime options (`ort` execution providers) — nondeterministic ORT paths are disallowed.
- **Never block the audio thread.** All inference happens on `tokio::spawn_blocking` or a dedicated thread pool; nothing allocates on the audio callback.

### Parameter-to-conditioning mapping (from research)

Every Session Player / Melodize / Chord Track UI parameter maps to an inference conditioning strategy. The pipeline does not own the UI-layer parameter labels (those live in `workflow-ui.md`), but it must accept and correctly apply the following mappings:

| UI parameter | Conditioning strategy                                                                                       | Applied at                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Complexity   | Maps to note-density target bin (0.0 → sparse, 1.0 → dense). Also activates chord-tone post-filter at > 0.7 | Sampling-time bias + post-filter              |
| Intensity    | Maps to velocity-range bias (lower bins for low intensity) and density multiplier                           | Sampling-time bias                            |
| Swing        | Post-processing only: `upbeat_shift = swing × triplet_offset`. Not fed into the model                       | Post-decode pass                              |
| Genre/Style  | Model / checkpoint selection (when genre-specific fine-tunes are registered) or prefix attribute tokens     | Registry lookup + prompt prefix               |
| Temperature  | Pure sampling-time parameter. 0.7 = conservative, 1.2 = creative variation                                  | Sampling                                      |
| Seed         | ChaCha20Rng seed per request (R10)                                                                          | RNG initialisation                            |

The FIGARO model's bar-level conditioning vocabulary (per-bar instrument set, chord, density, mean pitch, mean velocity, mean duration) is the upper-bound reference for this surface. R9 contracts currently use a simpler per-request parameter bag; widening to bar-level conditioning is an explicit future direction (see O9).

### Alternative model prototyping paths

Two emergency / future paths exist if the AMT export or licensing hits a wall:

- **SkyTNT MIDI model (~250M params, Apache-2.0)** — per research, ONNX already exported with KV-cache support in HuggingFace. **Lowest-friction path to a working ONNX prototype.** Does not natively accept symbolic chord labels (similar to AMT), so it reuses the chord-to-voicing adapter. Not in v1; listed here so a future branch can swap it in without re-architecting R2/R4.
- **MIDI-RWKV (RWKV-7 linear-complexity transformer)** — per research, O(n) vs O(n²) scaling makes it attractive for long-context generation on resource-constrained hardware. Uses MIDI-GPT's Bar-Fill representation. Future upgrade path for lower-end devices once a quantised ONNX export is available. Tracked under O8.
- **MIDI-GPT / GigaMIDI backbone (research reference)** — MIDI-GPT, trained on the GigaMIDI dataset (2.1M+ unique files), is cited as an alternative accompaniment backbone with commercial integrations (Calliope). Not a v1 dependency; included here so a future swap has precedent.
- **AMT-large (780M)** — the largest published Anticipatory Music Transformer checkpoint exists (`music-large-800k`). Not in v1 because of RAM/latency; kept as an upgrade path behind the same R2 contract.

## Test plan

- **Unit — REMI round-trip** — `MIDI → tokens → MIDI` bit-identity over a fixture corpus of ≥ 20 multi-track MIDI files (chord tracks, drum kits, polyphonic keys, time-signature changes). AC-R1.1.
- **Unit — Arrival-time round-trip** — same corpus, AC-R1.2.
- **Unit — Chord vocabulary round-trip** — all 168 canonical entries + a representative set of custom extensions, AC-R1.3.
- **Unit — Tokenizer fuzz** — 10k random token streams, no panic, AC-R1.4.
- **Unit — Seeded RNG** — R10.1 / R10.2 / R10.3 verified per contract.
- **Unit — Swing post-processing** — `swing = 0` is a no-op to within ±1 µs.
- **Integration — AMT infill fixture** — `melody.mid` + `chords.mid` → continuation with ≥ 85 % chord-tone onsets (AC-R2.1).
- **Integration — GrooVAE humanize fixture** — `straight_fourfloor.mid` → matches `groovae_fourfloor_swing0.5.mid` reference within tolerances (AC-R3.1).
- **Integration — Per-feature commands** — one fixture per R9.1–R9.4, each invoking the Tauri command via the test harness and asserting typed-channel event order (`Started → Tokens → Notes → Completed`) against the generated TS contract.
- **Integration — Cancellation** — submit a Session Player render, cancel mid-stream, verify `Cancelled` emitted exactly once within 200 ms (AC-R5.2, AC-R6.4).
- **Integration — Concurrent inference + IPC** — AMT in-flight + 1k `get_transport_state` calls, P99 < 10 ms (AC-R5.1).
- **Integration — Model download + SHA256** — download AMT-small from the pinned SHA, verify checksum, corrupt the file, verify re-download, corrupt twice, verify error surfaced (AC-R8.3).
- **Integration — Ghost-clip provenance** — full-pipeline render produces a ghost MIDI clip with complete provenance; accept → committed clip's `aiProvenance` matches byte-for-byte (AC-R7.3).
- **Benchmark — Latency** — CI job that records P50 / P99 latency per R9 contract on CPU and on the CI runner's accelerator, and fails if P50 exceeds the budget in AC-R4.2.
- **Benchmark — KV cache** — AMT with and without KV cache, verify ≥ 10× speedup with cache (AC-R2.4).
- **Architectural — Channel contract typing** — `pnpm typecheck` across the frontend consumer, asserting no `any` at the `MidiGenerationEvent` boundary (AC-R6.1 / AC-R6.2).
- **Architectural — Audio-thread isolation** — debug-build assertion panics if any `ort::Session::run` is entered on the CPAL audio thread (AC-R5.4).
- **Architectural — Project-model isolation** — automated check that `src/modules/MidiGeneration/` does not import project-model mutators (AC-R7.4).
- **License audit** — automated scan of `midi_model_registry.json` asserting every entry's `license` is in the whitelist `{ "Apache-2.0", "MIT", "CC-BY-4.0" }`.

---

## Open questions

- [ ] **O1 [CRITICAL] — Model licensing (AMT weights).** The Anticipatory Music Transformer paper and code are Apache-2.0, and the MLC-quantized HuggingFace mirrors claim the same license. **Action:** legal-signoff confirmation that the MLC-quantized AMT weights on HuggingFace are shippable under Apache-2.0 for a commercial desktop DAW, and that no training-data clause (e.g. Lakh MIDI provenance) restricts commercial inference. Until this is signed off, R2 cannot be implemented against AMT. Fallback if AMT licensing fails: Composer's Assistant v2 (per research, open-source + permissive MIDI training data), which requires a separate tokenizer adapter (not in scope for v1).

- [ ] **O2 [CRITICAL] — Memory footprint on 8 GB systems.** AMT-small at INT8 is ≈ 70 MB of weights + ≈ 50–200 MB of KV cache (per research) — fine on 8 GB. AMT-medium (360M) at FP16 is ≈ 720 MB of weights + ≈ 500 MB of KV cache for long contexts, which may collide with OS + browser + audio-engine working set on an 8 GB machine. **Action:** measure real residency on Apple M1 8 GB and Intel 8 GB baselines with AMT-medium + DiffSinger acoustic + a typical session. Decide whether AMT-medium is "optional download" (R8) or entirely gated behind a minimum-RAM check. Until this is measured, R4.3's single-heavy-model rule is the only mitigation.

- [ ] **O3 [MAJOR] — Per-feature CPU / GPU inference routing.** R4.2 budgets differ sharply CPU vs GPU. For short-context humanize (GrooVAE, < 100 ms CPU), routing to GPU is unnecessary and creates host-device transfer overhead. For AMT continuations, GPU is a ≈ 5–10× speedup. **Action:** define a routing table per-feature × per-platform (CoreML / DirectML / CUDA / CPU) once AC-R4.2 benchmarks land. Until then, the router uses the global-default execution provider for all MIDI inference, with a per-feature override registered in the registry entry.

- [ ] **O4 [MINOR] — GrooVAE swing post-processing formula.** The research gives `upbeat_shift = swing_pct × triplet_offset` as the formula. Whether that formula matches GrooVAE's training distribution or is a DAW-side correction is unclear. **Action:** compare a GrooVAE + post-processing output to commercial DAW swing output at `swing = 0.33` and `0.5`; if there's a perceptual gap, adjust the formula or move swing into GrooVAE's latent input (if the model supports it).

- [ ] **O5 [MINOR] — AMT chord-to-voicing rules.** R9.1 and R9.3 expand chord symbols to control voicings before feeding AMT. Voicing choice (root position vs drop-2 vs close voicing) affects generation quality. **Action:** pick a default voicing scheme (close voicing in octave 3 is a reasonable starting point) and expose it as a hidden parameter; revisit once the user-facing Session Player parameter surface is implemented.

- [ ] **O6 [MINOR] — AMT-medium as optional download.** If O2 resolves favourably, AMT-medium ships as an optional high-quality upgrade. If not, AMT-medium is dropped from v1 entirely. R8 treats it as optional for now.

- [ ] **O7 [MINOR] — Tap2Drum variant of GrooVAE.** R3 notes Tap2Drum is gated behind a feature flag for v1. **Action:** decide in the workflow-ui follow-up whether Tap2Drum is worth a UX surface in v1 or deferred to a later phase.

- [ ] **O8 [MINOR] — MIDI-RWKV edge-device upgrade.** Research flags RWKV-7's linear-complexity attention as a future option for lower-end devices. **Action:** monitor the MIDI-RWKV repo for a quantised ONNX export; if one lands and our Apple M1 / Intel i5 latency benchmarks (AC-R4.2) leave headroom, evaluate as an additional registry entry gated by `min_ram_bytes`.

- [ ] **O9 [MINOR] — Bar-level conditioning surface (FIGARO-style).** Current R9 contracts take a per-request parameter bag. FIGARO's per-bar vocabulary (instrument set, chord, density, mean pitch, mean velocity, mean duration per bar) is richer. **Action:** once R9.1–R9.4 are validated, design a wider per-bar conditioning request type in a follow-up spec; do not bolt it onto v1.

---

## Tradeoffs and risks

1. **AMT licensing risk (HIGH, per O1).** If the weights turn out to be non-shippable, the v1 Session Player neural tier collapses back to rule-engine-only. The fallback plan (Composer's Assistant v2) is viable but requires a second tokenizer adapter and has not been benchmarked in our harness.

2. **Memory risk on 8 GB systems (HIGH, per O2).** A worst-case configuration (AMT-medium + DiffSinger acoustic + browser + session) may exceed RAM budget on entry-level hardware. Mitigation: R4.3's single-heavy-model rule, AMT-medium as optional download, aggressive session unload on memory pressure.

3. **ONNX export fidelity.** AMT's anticipation mechanism is encoded in its tokenizer and control-event interleaving, not in the model architecture itself — the ONNX export is a standard GPT-2-style decoder. The interleaving logic lives in the Rust tokenizer, so the ONNX export is low-risk, but the Rust re-implementation of the interleaving must match the reference Python implementation's output exactly. The AC-R2.5 test guards against drift.

4. **KV-cache correctness.** A bug in KV-cache management silently produces lower-quality output (not a crash, not a type error). AC-R2.4 mitigates by comparing with-cache vs without-cache output; they must be identical up to numerical precision.

5. **Tokenizer version drift.** If MidiTok releases a new REMI+ chord vocabulary or changes the default encoding, our Rust port can silently diverge. Pin the MidiTok version that the Rust port mirrors, and record it in `midi_model_registry.json` at the module level.

6. **Cross-feature model contention.** R5.3 says AMT is serialized per-model via a semaphore; if the user triggers four Session Players in parallel, three wait. For v1 this is acceptable; a future improvement is per-model-instance multi-session hosting (one ONNX session per worker), but that inflates memory.

7. **Provenance-regen drift.** R10.3 promises that re-submitting a provenance seed regenerates the same MIDI. This holds only as long as the model weights, tokenizer, and post-processing behaviour are identical — so version-pinning (R8.4) is load-bearing. If a user re-generates after a model upgrade, the output may differ; provenance metadata records `modelVersion` so the UI can warn.

8. **Rule-engine content gap.** This spec explicitly scopes rule-engine content out. If the content spec lags, Tier 1 is empty and the pipeline becomes ML-only — contradicting the research's architectural advice. Track the content spec as a dependency in the task file.
