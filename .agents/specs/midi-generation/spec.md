---
type: spec
id: SPEC-midi-generation
title: Local symbolic-MIDI inference pipeline
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Local symbolic-MIDI inference pipeline

## Intent

Provide a local, offline, privacy-preserving symbolic-MIDI inference pipeline in Rust
that turns DAW MIDI state plus per-feature parameters into generated MIDI, streamed to a
ghost-clip preview surface. It is the producer behind Session Player continuation, Chord
Track progression, Melodize, and Humanize.

## Non-goals

- Cloud or hybrid inference — every model in this pipeline runs locally.
- UI surfaces (panels, parameter labels, XY pads) and the ghost-clip preview UI itself.
- Rule-engine pattern content (walking-bass tables, drum-grid templates, voicing libraries).
- Audio-domain MIDI transcription, singing synthesis, and voice conversion.
- Fine-tuning, training, user-supplied weights, and copyleft / non-commercial weights.
- WebGPU in-browser inference and any browser-tier MIDI inference (consumer only).

## Requirements

### AC-001 — Tokenizer round-trip fidelity

For every fixture, `MIDI → REMI+ tokens → MIDI` and `MIDI → arrival-time tokens → MIDI`
must reproduce the same note events (onset/duration within 1 ms, pitch and instrument exact).

Verify with: `pnpm cargo:test -- -p daw-engine midi_tokenizer_roundtrip`

### AC-002 — Deterministic output

Given identical structured input and seed, every inference contract must produce
byte-identical MIDI output across two successive runs.

Verify with: `pnpm cargo:test -- -p daw-engine midi_determinism`

### AC-003 — No inference on the audio thread

No ONNX `Session::run` must execute on the CPAL audio thread.

Verify with: `pnpm cargo:test -- -p daw-engine audio_thread_isolation`

### AC-004 — Cancellable blocking inference

Every inference entry point must run on the blocking task pool and exit with a `Cancelled`
result within 200 ms of a cancel request.

Verify with: `pnpm cargo:test -- -p daw-engine inference_cancellation`

### AC-005 — Typed channel boundary

The generated `MidiGenerationEvent` channel payloads must type-check on the frontend with
no `any` at the boundary.

Verify with: `pnpm typecheck`

### AC-006 — Provenance survives accept

Accepting a generated ghost MIDI clip must copy the full provenance tuple
(model id/version, input hash, seed, tokenizer, feature) onto the committed clip.

Verify with: `pnpm test:run -- MidiGeneration`

### AC-007 — Producer isolation

The `MidiGeneration` module must not import project-model mutators; it only emits channel
events the frontend converts into ghost-clip state.

Verify with: `pnpm deps:validate`

### AC-008 — License allowlist enforced

The model registry loader must reject any weight whose declared license is outside the
commercial-safe allowlist (Apache-2.0, MIT, CC-BY-4.0).

Verify with: `pnpm cargo:test -- -p daw-engine model_registry_license`

### AC-009 — Chord-tone constraint at high complexity

At `complexity > 0.7`, sampled pitches on strong beats must be post-filtered to the active
chord's chord-tone set.

Verify with: `pnpm cargo:test -- -p daw-engine chord_tone_filter`

### AC-010 — Model-load latency budgets

Cold model loads must meet their budgets (AMT-small < 3 s, AMT-medium < 8 s, GrooVAE-small
< 500 ms); the gate fails when a budget is exceeded.

Verify with: `pnpm cargo:bench -- -p daw-engine midi_inference_latency`

### AC-011 — IPC stays responsive during inference

While an AMT inference is in-flight, unrelated Tauri IPC calls (e.g. `get_transport_state`,
`list_models`) must return within 10 ms at P99.

Verify with: `pnpm cargo:test -- -p daw-engine ipc_responsiveness_under_inference`

### AC-012 — Conservative default complexity

Every per-feature parameter type must default `complexity` to ≤ 0.5 on the 0–1 scale.

Verify with: `pnpm cargo:test -- -p daw-engine default_complexity_and_ceiling`

### AC-013 — Committed ghost clip retains provenance after accept

A committed ghost clip must retain its full provenance tuple after accept, so re-generation
with the same seed and inputs always remains possible.

Verify with: `pnpm test:run -- MidiGeneration.provenance`

### AC-014 — Model registry schema

Each registry entry must record `hf_revision` (a commit SHA, not a tag), per-file `sha256`,
`size_bytes`, `min_ram_bytes`, `min_vram_bytes`, and `tokenizer_id`.

Verify with: `pnpm cargo:test -- -p daw-engine model_registry_schema_and_verification`

### AC-015 — KV-cache mandatory

KV-cache must be enabled (disabling it via the diagnostic flag yields identical output but
≥ 10× slower latency).

Verify with: `pnpm cargo:test -- -p daw-engine kv_cache_and_semaphore`

### AC-016 — Typed streaming channel variants

The `MidiGenerationEvent` channel must carry the typed variants `Started`, `Tokens`, `Notes`,
`Completed`, `Failed`, and `Cancelled`.

Verify with: `pnpm cargo:test -- -p daw-engine midi_channel_event_ordering`

### AC-017 — Per-feature inference contract shapes

Each of the four features must expose its own typed request/response: Session Player
continuation, Chord Track progression (whose output is `ChordSpan[]` symbolic entries, NOT
MIDI notes), Melodize, and Humanize (routing GrooVAE for drums versus a deterministic
humanizer for non-drum input).

Verify with: `pnpm cargo:test -- -p daw-engine per_feature_inference_contracts`

### AC-018 — Parameter-to-conditioning mapping applied

The pipeline must accept and correctly apply the parameter-to-conditioning mapping for
Complexity, Intensity, Swing, Genre/Style, Temperature, and Seed, with each parameter routed
to its conditioning strategy and apply point (Complexity → density bin + chord-tone
post-filter; Intensity → velocity-range bias; Swing → post-decode `upbeat_shift = swing ×
triplet_offset`; Genre/Style → registry/prefix selection; Temperature → sampling; Seed → RNG
init).

Verify with: `pnpm cargo:test -- -p daw-engine parameter_conditioning_mapping`

### AC-019 — Chord-vocabulary round-trip

Chord tokens in REMI+ must round-trip without loss across the full 168-entry vocabulary.

Verify with: `pnpm cargo:test -- -p daw-engine chord_vocab_roundtrip`

### AC-020 — Tokenizer never panics on malformed input

Tokenizer errors (invalid token sequences, out-of-vocabulary tokens, invalid timing) must
return typed errors and never panic, asserted over 10k random token streams.

Verify with: `pnpm cargo:test -- -p daw-engine tokenizer_fuzz_no_panic`

### AC-021 — Control-event interleaving honours delta

Control-event interleaving must honour δ: with δ = 0, a control note at time `t` must appear
in the prefix of every generated-event position at or before `t`.

Verify with: `pnpm cargo:test -- -p daw-engine control_event_delta_interleaving`

### AC-022 — Swing post-processing is a no-op at zero

Swing post-processing with `swing = 0` must leave upbeats unchanged (within ±1 µs).

Verify with: `pnpm cargo:test -- -p daw-engine swing_zero_noop`

### AC-023 — Per-feature inference latency budgets

Each feature's P50 inference must stay within its per-platform budget (Session Player
< 500 ms GPU / < 4 s CPU; Chord Track < 1 s GPU / < 8 s CPU; Melodize < 500 ms GPU / < 4 s
CPU; Humanize < 100 ms CPU); the gate fails when a budget is exceeded.

Verify with: `pnpm cargo:bench -- -p daw-engine midi_inference_latency`

### AC-024 — Complexity refused above the ceiling

The pipeline must refuse to execute with `complexity > 0.8` unless the caller passed an
explicit non-default value.

Verify with: `pnpm cargo:test -- -p daw-engine default_complexity_and_ceiling`

### AC-025 — Clip conversion preserves provenance

Clip-conversion pipelines elsewhere in the app must not strip `aiProvenance`, so re-generation
with the same seed and inputs always remains possible.

Verify with: `pnpm test:run -- MidiGeneration.provenance`

### AC-026 — SHA256 verification on download

SHA256 must be verified on every downloaded file with exactly one automatic re-download on
mismatch before surfacing an error.

Verify with: `pnpm cargo:test -- -p daw-engine model_registry_schema_and_verification`

### AC-027 — Model upgrade by SHA pinning

A model must be upgraded only by pointing the entry at a different commit SHA.

Verify with: `pnpm cargo:test -- -p daw-engine model_registry_schema_and_verification`

### AC-028 — Per-model serialization

Two parallel AMT requests must serialize on a per-model semaphore so the second starts within
20 ms of the first completing, with no deadlock or starvation.

Verify with: `pnpm cargo:test -- -p daw-engine kv_cache_and_semaphore`

### AC-029 — Strict streaming-event ordering

A 4-bar render must emit `Started → Tokens (≥1) → Notes (≥1) → Completed` in strict order
with token-level streaming for live preview.

Verify with: `pnpm cargo:test -- -p daw-engine midi_channel_event_ordering`

### AC-030 — Cancel emits exactly one terminal event

Cancelling mid-stream must emit `Cancelled` exactly once, after which no further events are
emitted for that `request_id`.

Verify with: `pnpm cargo:test -- -p daw-engine midi_channel_event_ordering`

### AC-031 — Emitted events carry the matching feature field

Each per-feature contract's emitted events must carry the matching `feature` field.

Verify with: `pnpm cargo:test -- -p daw-engine per_feature_inference_contracts`

### AC-032 — Custom chord entries round-trip

Custom chord entries added at startup must serialize with their symbolic name and restore
identically.

Verify with: `pnpm cargo:test -- -p daw-engine chord_vocab_roundtrip`

### AC-033 — First notes stream via incremental REMI decode

The streaming decoder must emit the first notes within 200 ms of the first token chunk by
decoding REMI tokens incrementally — a note is emitted on receipt of its `Duration` token,
not held until generation completes. A typical 4-bar render produces ≈ 200–600 REMI tokens
depending on note density.

Verify with: `pnpm cargo:test -- -p daw-engine incremental_remi_decode_first_note`

### AC-034 — Per-platform 4-bar generation latency table

A 4-bar continuation (≤ 32-note context) must meet its per-execution-provider P50 budget:
CPU (Apple M3 Max / Intel i9) 2–8 s; CUDA (RTX 3060+) 0.3–1.5 s; CoreML (M-series) 0.5–2 s;
the gate fails when a provider's budget is exceeded. (WebGPU 1–5 s is browser-tier and out of
scope per Non-goals.)

Verify with: `pnpm cargo:bench -- -p daw-engine midi_inference_latency`

### AC-035 — Arrival-time encoding internals

The arrival-time tokenizer must encode each note as `note = 128 × instrument + pitch` at 10 ms
resolution, and must double the base AMT vocabulary (~27,512 tokens) to ~55,000 so generated
events are distinguishable from control events.

Verify with: `pnpm cargo:test -- -p daw-engine arrival_time_encoding`

### AC-036 — Humanize routes drums through GrooVAE

The Humanize contract must route quantized drum input through GrooVAE-small (the Magenta
humanization model trained on the Groove MIDI Dataset, CC-BY-4.0) and non-drum input through
the deterministic humanizer. The expanded path "rule-generated pattern → GrooVAE humanization"
must be reachable from the Tier-1 call site.

Verify with: `pnpm cargo:test -- -p daw-engine per_feature_inference_contracts`

### AC-037 — Generation cache identity key

The on-disk generation cache must key each entry on the hash of
`{model_id, tokenizer_version, temperature, seed, prompt_tokens}` → output, stored in a
size-capped LRU; a key collision across differing inputs must not occur, and a hit must return
the cached output without re-running inference.

Verify with: `pnpm cargo:test -- -p daw-engine generation_cache_identity`

### AC-038 — Streamed chunk framing protocol

Each streamed chunk must carry the fields `{run_id, seq, tokens, is_final}`; a consumer must
treat an out-of-order `seq` for a given `run_id` as a protocol violation (typed error, not
silent reorder).

Verify with: `pnpm cargo:test -- -p daw-engine chunk_framing_protocol`

### AC-039 — Determinism pins runtime nondeterminism

When a seed is supplied, the runtime must pin thread counts and `ort` execution-provider
options, and nondeterministic ORT execution paths must be disallowed, so byte-identical output
(AC-002) is reproducible.

Verify with: `pnpm cargo:test -- -p daw-engine midi_determinism`

## Open questions

- [ ] Q-001 — Are the quantized AMT weights shippable under Apache-2.0 for a commercial DAW
  (training-data provenance)? Blocks the neural tier; fallback is Composer's Assistant v2.
- [ ] Q-002 — AMT-medium memory residency on 8 GB machines: optional download or RAM-gated?
- [ ] Q-003 — Per-feature CPU/GPU execution-provider routing table once benchmarks land.
- [ ] Q-004 — ONNX export & tokenizer-port mechanics (restored detail): convert the AMT
  HuggingFace checkpoint via `optimum-cli export onnx` with KV-cache support enabled; port
  MidiTok's REMI decoder to Rust as a ~300-line token-to-MIDI state machine. Pin the exact
  optimum/MidiTok versions the Rust port mirrors before implementation.
- [ ] Q-005 — In-Rust MIDI I/O tooling (restored detail): prefer the `midly` crate (202K
  downloads) for MIDI file I/O in tests/fixtures; use Symusic (the Rust backend under MidiTok)
  as a parity reference for the decoder port even though it is not a direct dependency.
- [ ] Q-006 — Tier-2 variation models (restored detail): whether to add MusicVAE's small
  drum/bass models for variation generation and latent-space interpolation alongside GrooVAE,
  run via `ort` on CPU in < 100 ms per 2-bar pattern. Deferred — GrooVAE humanization is the
  only Tier-2 model in v1.

## Affected areas

- `src/modules/MidiGeneration/` (frontend producer; consumes typed channels)
- the Rust inference services (`ort`, tokenizers, spawn_blocking harness)
- the model registry resource (`midi_model_registry.json`) and `model_download` path
- `src/modules/Arrangement/` ghost-clip accept/dismiss use cases (consumer)

## Dropped from sources

- Cloud and hybrid inference — local-first positioning; a future workstream, not this spec.
- AMT-medium (360M) — optional later download, gated on the memory question (Q-002).
- Tap2Drum GrooVAE variant ("tapped rhythm → full drum beat") — behind a feature flag; deferred
  to the UI follow-up. (Informative: GrooVAE's training corpus is the Groove MIDI Dataset —
  13.6 hours / 22,000+ measures / 10 professional drummers, CC-BY-4.0.)
- WebGPU in-browser MIDI inference — deliberately scoped out (Non-goals exclude browser-tier
  MIDI). Research basis: 19× speedup over WASM for encoder models, FP16 since Chrome 121, full
  on Windows WebView2, expected late-2025 on macOS, unavailable on Linux WebKitGTK.
- Bar-level (FIGARO-style) conditioning — a wider request type for a follow-up spec.
- Rule-engine pattern content — product content owned by a separate spec, not the pipeline.

### Tradeoffs and risks (from `specs/missing/midi-generation.md`, analytical — no requirement)

These eight analytical risks were carried in the source spec's "Tradeoffs and risks"
section. They are analysis, not requirements, and have no audit.md home in this group, so
they are recorded here verbatim from `git show bb84b0e:specs/missing/midi-generation.md`:

1. **AMT licensing risk (HIGH, per O1).** If the weights turn out to be non-shippable, the v1 Session Player neural tier collapses back to rule-engine-only. The fallback plan (Composer's Assistant v2) is viable but requires a second tokenizer adapter and has not been benchmarked in our harness.
2. **Memory risk on 8 GB systems (HIGH, per O2).** A worst-case configuration (AMT-medium + DiffSinger acoustic + browser + session) may exceed RAM budget on entry-level hardware. Mitigation: R4.3's single-heavy-model rule, AMT-medium as optional download, aggressive session unload on memory pressure.
3. **ONNX export fidelity.** AMT's anticipation mechanism is encoded in its tokenizer and control-event interleaving, not in the model architecture itself — the ONNX export is a standard GPT-2-style decoder. The interleaving logic lives in the Rust tokenizer, so the ONNX export is low-risk, but the Rust re-implementation of the interleaving must match the reference Python implementation's output exactly. The AC-R2.5 test guards against drift.
4. **KV-cache correctness.** A bug in KV-cache management silently produces lower-quality output (not a crash, not a type error). AC-R2.4 mitigates by comparing with-cache vs without-cache output; they must be identical up to numerical precision.
5. **Tokenizer version drift.** If MidiTok releases a new REMI+ chord vocabulary or changes the default encoding, our Rust port can silently diverge. Pin the MidiTok version that the Rust port mirrors, and record it in `midi_model_registry.json` at the module level.
6. **Cross-feature model contention.** R5.3 says AMT is serialized per-model via a semaphore; if the user triggers four Session Players in parallel, three wait. For v1 this is acceptable; a future improvement is per-model-instance multi-session hosting (one ONNX session per worker), but that inflates memory.
7. **Provenance-regen drift.** R10.3 promises that re-submitting a provenance seed regenerates the same MIDI. This holds only as long as the model weights, tokenizer, and post-processing behaviour are identical — so version-pinning (R8.4) is load-bearing. If a user re-generates after a model upgrade, the output may differ; provenance metadata records `modelVersion` so the UI can warn.
8. **Rule-engine content gap.** This spec explicitly scopes rule-engine content out. If the content spec lags, Tier 1 is empty and the pipeline becomes ML-only — contradicting the research's architectural advice. Track the content spec as a dependency in the task file.

### Alternative / future model prototyping paths (from `specs/missing/midi-generation.md`, not v1)

Recorded verbatim from the source spec; these are future / emergency paths, not v1
requirements:

- **SkyTNT MIDI model (~250M params, Apache-2.0)** — per research, ONNX already exported with KV-cache support in HuggingFace. **Lowest-friction path to a working ONNX prototype.** Does not natively accept symbolic chord labels (similar to AMT), so it reuses the chord-to-voicing adapter. Not in v1; listed here so a future branch can swap it in without re-architecting R2/R4.
- **MIDI-RWKV (RWKV-7 linear-complexity transformer)** — per research, O(n) vs O(n²) scaling makes it attractive for long-context generation on resource-constrained hardware. Uses MIDI-GPT's Bar-Fill representation. Future upgrade path for lower-end devices once a quantised ONNX export is available. Tracked under O8.
- **MIDI-GPT / GigaMIDI backbone (research reference)** — MIDI-GPT, trained on the GigaMIDI dataset (2.1M+ unique files), is cited as an alternative accompaniment backbone with commercial integrations (Calliope). Not a v1 dependency; included here so a future swap has precedent.
- **AMT-large (780M)** — the largest published Anticipatory Music Transformer checkpoint exists (`music-large-800k`). Not in v1 because of RAM/latency; kept as an upgrade path behind the same R2 contract.
- **Composer's Assistant v2** — survives as the named fallback if AMT licensing fails (already noted in Q-001); a future addition, not v1.
