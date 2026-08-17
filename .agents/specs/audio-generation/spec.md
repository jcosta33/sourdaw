---
type: spec
id: SPEC-audio-generation
title: Native singing synthesis
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Native singing synthesis

## Intent

Blocked until a complete native model chain passes admission.

Generate singing-voice audio from MIDI notes plus lyrics using a DiffSinger ONNX pipeline
that runs natively in Rust (phonemize → variance → acoustic → vocoder), with optional RVC
voice conversion through a separately admitted Python sidecar. Output is a 44.1 kHz WAV clip the
audio engine plays back like any other clip. A new `SingingVoice` frontend module owns the
voice registry, render queue, and progress state.

## Non-goals

- Real-time streaming synthesis — all rendering is offline (interactive preview, not sub-20 ms).
- Browser/WASM inference — Tauri-native only (see `../audio-generation-browser/spec.md`).
- Full-song generation, instrument synthesis, and zero-shot voice models (prototype tier).
- Training custom voicebanks or vocoders.
- Companion vocal-editor UX (retake tray, locks, change overlays, pronunciation editor) and the
  first-run setup wizard UI — separate specs.

## Requirements

### AC-001 — Render a singing phrase end to end

Given MIDI notes, lyrics, a voice model id, and a quality mode, `render_singing_phrase` must
run phonemize → variance → acoustic → vocoder and return a path to a 44.1 kHz WAV.

Verify with: `pnpm cargo:test -- -p src-tauri singing_pipeline`

### AC-002 — Inference never touches the audio thread

The pipeline must run on Tokio async tasks only; no ONNX inference, allocation, or blocking
runs on the CPAL audio thread.

Verify with: `pnpm cargo:test -- -p daw-engine rt_safety`

### AC-003 — Model router dispatches by declared runtime

The router must send `onnx-native` models to in-process `ort`. It may send `python-sidecar`
models to a sidecar only after the complete model stack passes admission, selected from each
model's `runtime` field.

Verify with: `pnpm cargo:test -- -p src-tauri model_router`

### AC-004 — Model registry downloads with SHA256 verification

Voicebanks and vocoders must download through the existing `model_download` path with
per-file SHA256 verification, persisting to the model cache across restarts.

Verify with: `pnpm cargo:test -- -p src-tauri model_registry`

### AC-005 — Preview and final quality modes use distinct vocoders

Preview renders must use Vocos with reduced diffusion depth.

Verify with: `pnpm test:run -- renderPhrase`

### AC-006 — Identical inputs hit the cache without re-inference

Re-rendering a phrase whose MIDI, lyrics, voice, quality, steps, and seed are unchanged must
return the cached WAV without running inference.

Verify with: `pnpm cargo:test -- -p src-tauri render_cache`

### AC-007 — Edited phrases are marked stale

Editing MIDI notes or lyrics in a rendered phrase must transition its render status to `stale`
without auto-re-rendering.

Verify with: `pnpm test:run -- SingingVoice staleDetection`

### AC-008 — Render queue orders and cancels by priority

The queue must process phrases in `immediate` → `audible` → `background` order and support
cancel-by-id within 2 seconds.

Verify with: `pnpm test:run -- renderQueue`

### AC-009 — RVC degrades gracefully when the sidecar is absent

When the Python sidecar is not installed, an RVC request must fail fast with a single
user-visible error and must not degrade DiffSinger-only rendering.

Verify with: `pnpm cargo:test -- -p src-tauri rvc_sidecar_missing`

### AC-010 — No non-commercial weights are bundled or auto-downloaded

The default registry must never bundle or auto-download CC-BY-NC-SA (or other non-commercial)
weights; only MIT/Apache-2.0 voicebanks and vocoders ship.

Verify with: `manual` — inspect the default registry and confirm every entry's license is MIT or Apache-2.0

### AC-011 — GPU execution provider is selected per platform

Startup must select CoreML (macOS), DirectML (Windows, including non-CUDA DX12 GPUs), or CUDA
(Linux), with CPU only as last resort, and report the choice as a capability.

Verify with: `manual` — launch on each platform and confirm the capability report names the expected execution provider

### AC-012 — Module boundaries hold

The `SingingVoice` module must respect domain-driven boundaries with no deep cross-module
imports.

Verify with: `pnpm deps:validate`

### AC-013 — Render status surfaces are accessible

Render progress, stale badges, queue state, and provenance chips must be keyboard-navigable,
screen-reader-labeled, and communicate state through shape/text rather than color alone.

Verify with: `pnpm test:run -- SingingVoice accessibility`

### AC-014 — Preview latency targets and honest stage labels

The preview pipeline must reach ≤1 s perceived start (queue acknowledgment + first progress
frame) and ≤5 s to first audible output on Apple M1 / equivalent GPU.

Verify with: `pnpm test:run -- renderProgress stageLabels`

### AC-015 — Provenance metadata is stored and retrievable per phrase

Each rendered phrase must store voice name, language, seed, render quality (preview/final),
diffusion steps, model version, and render timestamp, retrievable from the frontend inspector.

Verify with: `pnpm cargo:test -- -p src-tauri provenance_metadata`

### AC-016 — RVC sidecar crash does not crash the app and re-spawns

If the Python sidecar exits mid-job, the RVC job must fail with a user-visible error and the
app must not crash.

Verify with: `pnpm cargo:test -- -p src-tauri rvc_sidecar_crash`

### AC-017 — Rendered WAV plays back on all three platforms unchanged

Playback of a rendered WAV must work on Windows (WASAPI), macOS (CoreAudio), and Linux
(ALSA/PulseAudio) without per-platform adjustments from the singing-voice code path; this is a
release-gate regression check on the existing audio engine.

Verify with: `manual` — play a rendered WAV on Windows, macOS, and Linux and confirm playback succeeds with no singing-voice-specific platform code path

### AC-018 — Final renders use BigVGAN v2 at full depth

Final renders must use BigVGAN v2 with full depth.

Verify with: `pnpm test:run -- renderPhrase`

### AC-019 — Progress stages use the exact honest labels

Progress stages must use the exact labels "queued", "preparing", "synthesizing expression",
"rendering audio", "ready", "stale" — generic spinners and "almost done" language are
disallowed.

Verify with: `pnpm test:run -- renderProgress stageLabels`

### AC-020 — A new RVC request after a crash re-spawns the sidecar

A new RVC request after a crash must re-spawn the sidecar with a single immediate retry (no
exponential backoff in v1).

Verify with: `pnpm cargo:test -- -p src-tauri rvc_sidecar_crash`

### AC-021 — A single `invokeLlm` use case owns all LLM dispatch

All LLM calls — schema-constrained, tool-calling, and freeform chat — must funnel through one
`invokeLlm` use case (`src/modules/AiRuntime/useCases/llm/invokeLlm.ts`) that resolves the
backend chain via `getBackendChain()`, iterates backends with a shared fallback policy across
the three modes (`'chat' | 'tools' | 'schema'`), owns `llmStatusStore` transitions
(`loading` → `ready`/`generating` → `ready` or `error`), honours an `abortSignal`, and throws a
single `LlmInvocationError` carrying the chain of underlying messages when every backend fails.
For `mode: 'schema'` it must attempt schema-constrained generation first and retry the same
backend without `response_format` if the constrained call throws.

Verify with: `pnpm test:run -- invokeLlm`

### AC-023 — The DiffSinger Rust port matches OpenUtau reference output

The Rust DiffSinger pipeline (ported from OpenUtau's C# `DiffSingerRenderer`) must be
validated against OpenUtau's output for the same inputs using reference test cases: subtle
floating-point, tensor-padding, or phoneme-handling differences between the C# and Rust
implementations must not produce divergent audio beyond a documented tolerance.

Verify with: `pnpm cargo:test -- -p src-tauri diffsinger_openutau_parity`

### AC-022 — AI undo snapshots only the documents the edit touched

An AI edit that mutates one document (e.g. one MIDI note) must record undo data sized to that
document only and must not call a whole-project/whole-bundle `saveSnapshot()`. `executeDsoEdit.commitDsos`
must capture `Automerge.getHeads(doc)` for each touched doc before and after mutation and store
`{ docId, headsBefore, headsAfter }` per touched doc, leaving untouched documents unrecorded; undo
replays the inverse to restore each touched doc to `headsBefore`.

Verify with: `pnpm test:run -- executeDsoEdit`

## Open questions

- [ ] (blocking) Is BigVGAN v2 directly compatible with DiffSinger's 128-bin mel output, or is a
  mel adapter / fine-tune required? Must validate before implementation.
- [ ] (blocking) Which default English voicebank has fully MIT/Apache-2.0 acoustic weights?
- [ ] (blocking) Confirm exact ONNX tensor format (opset, dynamic axes, optional speaker
  embedding) against real exported DiffSinger files.
- [ ] (non-blocking) Seed strategy default — random-per-render with a visible, copyable seed.
- [ ] (non-blocking) Cache eviction policy — LRU at a 5 GB default budget. (restored detail)
  Considered-and-rejected alternatives: no caching (wastes 2–10 s per phrase re-rendering
  unchanged input) and timestamp-based keys (never produce a cache hit). The chosen scheme is
  content-addressable — cache key = SHA256(MIDI + lyrics + voice id + quality + diffusion steps
  + seed) — growing until the budget, then LRU-evicting oldest entries.
- [ ] (non-blocking) (restored detail — ONNX graduation gate, research Risk 9/10) A prototype-tier
  model (SoulX-Singer, ACE-Step, TokenSynth, …) may graduate from the Python sidecar to native
  `ort`/ONNX only after: fixture-WAV parity against the PyTorch reference, a pinned ONNX opset,
  a license check, and a documented regression budget. The Python sidecar must NOT be removed on
  the strength of one successful export — "the sidecar is a bridge, not a permanent home." Open:
  where the per-model graduation status and graduation criteria are tracked (registry field vs
  separate doc), given multi-runtime maintenance is a "Medium / Certain" research risk.
- [ ] (non-blocking) (restored detail — next-generation engine to monitor, research §7/§10)
  SoulX-Singer (Apache-2.0 code + weights, 42,000-hour training set, zero-shot cloning across
  Chinese/English/Cantonese, ~75–85% AceStudio parity estimated) is the recommended engine to
  monitor and evaluate as a primary-engine replacement once an ONNX export exists — Apache-2.0
  plus zero-shot would eliminate per-voice training. Open: the trigger/criteria for promoting it
  from "monitor only" to a sidecar prototype.
- [ ] (non-blocking) (restored detail — product positioning, research Risk 8) Open-source
  DiffSinger reaches ~70–80% of AceStudio's naturalness for straightforward singing and falls
  short on emotional range, cross-lingual pronunciation, and complex melisma; the missing
  AceStudio pillars are its 140+ voices across 8 languages and style modes (Power/Soft/Breathy/
  Chest/Rap/Opera, which need per-voice style training); DiffSinger has only ~16 community
  voicebanks (mostly Chinese, some English/Japanese), so the v1 voice library is a fraction of
  AceStudio's variety even before the style-mode gap. Prescription to confirm before release:
  position the feature as "AI-assisted", not "AI-replaces-singer"; the UI must communicate
  preview-vs-final quality honestly; release notes / marketing must not overclaim; RVC
  post-processing is the primary in-MVP quality lever.
- [ ] (non-blocking) (restored detail — rejected design alternatives) The chosen architecture
  rejected, with reasons worth preserving: candle / Rust-native ML (DiffSinger is trained in
  PyTorch and exported to ONNX — reimplementing in candle is high-effort with no quality gain;
  `ort` is the standard path and already integrated for native inference); a single vocoder (the
  quality/speed gap is real — Vocos ~6,700× RT for preview, BigVGAN v2 ~45–135× RT for final);
  reference community vocoder (CC-BY-NC-SA 4.0, blocks commercial use); a DDSP vocoder (monophonic,
  needs per-instrument training); a pure-Python sidecar for DiffSinger (~2.6 GB packaging +
  2–5 s startup, loses in-process latency); and an external ComfyUI-style service (two separate
  installs, worst UX). GPU detection at first-run uses `system_profiler` (macOS) / `nvidia-smi`
  (NVIDIA); the Python runtime for the optional RVC path installs via `uv` (standalone Python
  build) per the research "Transformer Lab" approach. On Apple Silicon, MLX is the research-named
  acceleration option alongside the CoreML EP (relevant to the AC-011 per-platform EP choice).
  The research's hybrid transport (research §4 Option C) named shared-memory ring buffers —
  `shmem-ipc` (Linux) / `ipmpsc` (cross-platform) — for zero-copy audio; the MVP deliberately
  drops that transport for the existing stdin-JSON, file-in/file-out sidecar (see "Dropped from
  sources"), so these names are recorded as the rejected transport evidence, not a requirement.
- [ ] (non-blocking) (restored detail — architecture trade-off matrix, research §4) R-004's
  "hybrid beats pure approaches" prose was condensed from a six-factor star-rating comparison of
  the four candidates (A: pure Python sidecar, B: ONNX native, C: Hybrid [chosen], D: external
  decoupled service). The quantitative matrix that justified choosing Hybrid (★ = worse, ★★★★★ =
  best):

  | Factor | A: Python sidecar | B: ONNX native | C: Hybrid | D: External |
  | --- | --- | --- | --- | --- |
  | Model compatibility | ★★★★★ | ★★★ | ★★★★★ | ★★★★★ |
  | Installer size | ★★ (2–5 GB) | ★★★★★ (50–100 MB) | ★★★ | ★★ |
  | Audio transfer efficiency | ★★★ (IPC) | ★★★★★ (in-process) | ★★★★ (shared mem) | ★★ (network) |
  | Crash isolation | ★★★★★ | ★★ | ★★★★★ | ★★★★★ |
  | Cross-platform complexity | ★★ | ★★★★ | ★★★ | ★★ |
  | Development velocity | ★★★★★ | ★★★ | ★★★★ | ★★★★ |

  Hybrid wins because it inherits B's in-process latency/installer-size for proven ONNX models
  while keeping A's model-compatibility and crash-isolation for experimental PyTorch models; the
  cost is two runtimes (cross-platform complexity ★★★). This is comparative evidence behind the
  decision, not a new requirement.
- [ ] (non-blocking) (deferred-gap from intake/audit-deferred-fixes.md, Group C — AI runtime
  / `invokeLlm` dispatch) The three current LLM dispatch sites — `sendChatMessage`,
  `executeDsoEdit.invokeLlm` (a private helper to be deleted), and `inference.generateToolCalls`
  — must be rewritten to call the single `invokeLlm` use case (AC-021) with the appropriate
  `mode` and pass-through `schema`/`tools`/`onToken`, so none of them iterate the backend chain
  themselves. Open sub-question: for `mode: 'tools'`, do all backends (native, cloud, webllm)
  accept a uniform `ToolDefinition[]` shape, or do their `generate*ToolCalls` functions use
  divergent schemas requiring a per-backend adapter step inside `invokeLlm`? Inspect the three
  existing `generate*ToolCalls` for shape compatibility before unifying. Considered-and-rejected
  alternatives: three thin façades over the same chain (drift was the failure mode the audit
  flagged) and a strategy pattern with one class per backend (backends are functions, not
  stateful objects). Snapshot fallback (AC-022): if the Automerge version in use does not expose
  a clean inverse-replay primitive, store per-doc binary patches via `Automerge.save` over a
  clone limited to the touched docs — implementation choice is open within the
  touched-doc-only-undo-data constraint.

## Affected areas

- `src/modules/SingingVoice/` (new module: stores, repositories, useCases, views, events)
- `src-tauri/src/commands/` (`render_singing_phrase`, `cancel_singing_render`, `get_render_queue`,
  `list_voice_models`, `download_voice_model`, `remove_voice_model`, `get_gpu_capabilities`,
  `apply_rvc_conversion`)
- `src-tauri/src/commands/model_download.rs` (registry extension)
- `src-tauri/sidecar/rvc.py` after complete RVC stack admission (`rvc_load`, `rvc_convert`)
- reuses `crates/daw-io/src/audio_decode.rs` and `audio_postprocess.rs` for playback/crossfade

## Dropped from sources

- ACE-Step full-song generation, SoulX-Singer, TokenSynth/MIDI-DDSP instruments — prototype/wait tier.
- Capability-matrix alternatives surveyed and not chosen (research §2, comparative reference only —
  no shippable requirement): NNSVS (MIT, parametric, 50–60% parity), VISinger2 (research,
  end-to-end VITS+DDSP, 60–70%), TCSinger 2 (research, no pretrained weights), Seed-VC (~400 ms
  with TensorRT, beats RVC v2 on benchmarks), so-vits-svc 4.0 (AGPL-3.0, archived), DDSP-Piano
  (24 kHz, near-RT, piano-only), YuE (24 GB+ VRAM, minutes per song), DiffRhythm 2 (below
  ACE-Step), and the codec/vocoder field beyond the two chosen (DAC, EnCodec, SNAC, HiFi-GAN V1).
- Japanese voicebanks — deferred until phonemizer and licensing are specified.
- HTTP + shared-memory sidecar transport (research Option C) — MVP standardizes on stdin-JSON,
  file-in/file-out RVC.
- Companion vocal-editor UX (pronunciation editor, pitch drawing, parameter lanes, retake tray,
  locks, change overlays, A/B compare) and first-run wizard UI — separate specs.
