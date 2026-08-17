---
type: spec
id: SPEC-browser-diffsinger-svs
title: Browser DiffSinger singing synthesis
status: draft
owner: The Sourdaw team
sources:
  - ../audio-generation-browser/research.md
---

# Browser DiffSinger singing synthesis

## Intent

Blocked until a complete browser model chain passes admission.

Run the full DiffSinger singing-synthesis pipeline (JS phonemizer → variance → acoustic →
vocoder) entirely in the browser via ONNX Runtime Web on WebGPU — an industry-first browser SVS —
producing recognizable sung audio from MIDI + lyrics at preview quality. This is Phase 3, the
highest-impact and highest-risk feature, building on the `BrowserAi` infrastructure. Final-quality
output is delegated to the native renderer where available.

## Non-goals

- AceStudio- or native-parity quality — browser output is the preview tier.
- The shared inference infrastructure (see `../audio-generation-browser/spec.md`).
- Consistency distillation and dual vocoders — single shared vocoder only.

## Requirements

### AC-001 — Phonemize lyrics in JavaScript

A pure-JS phonemizer must convert English lyrics to integer phoneme token ids matching the
voicebank inventory (CMU dict + rule fallback), inserting `SP`/`AP` at phrase boundaries.

Verify with: `pnpm test:run -- BrowserAi phonemizer`

### AC-002 — Predict variance contours

The linguistic/pitch/variance ONNX models must produce plausible F0, energy, and breathiness
contours from MIDI + phoneme tensors at ~86 fps.

Verify with: `pnpm test:run -- BrowserAi diffSingerVariance`

### AC-003 — Generate a mel-spectrogram via shallow diffusion

The acoustic model must produce a 128-bin mel via shallow diffusion, with step count driven by
the `steps` input tensor.

Verify with: `pnpm test:run -- BrowserAi diffSingerAcoustic`

### AC-004 — Vocode mel to audible waveform

The shared vocoder must convert the mel-spectrogram to an audible waveform.

Verify with: `pnpm test:run -- BrowserAi diffSingerVocoder`

### AC-005 — Render a recognizable sung phrase end to end

The full pipeline must render a 4-note English phrase to audio recognizable as singing matching
the input melody and lyrics.

Verify with: `pnpm test:run -- BrowserAi renderDiffSingerPhrase`

### AC-006 — Render Quality control maps to diffusion steps

A Render Quality control must select Low (3) / Standard (5) / High (10) / Maximum (20) steps,
mapped directly to the `steps` tensor, defaulting to Standard.

Verify with: `pnpm test:run -- BrowserAi renderQuality`

### AC-007 — Degrade gracefully to the native renderer

When the Tauri-native pipeline is available, the UI must offer "Render natively" as the
higher-quality alternative.

Verify with: `manual` — in Tauri on Windows, confirm a "Render natively" action appears and dispatches to the native pipeline

### AC-008 — Render within the browser time budget

A phrase must render in under 30 seconds on Chrome + WebGPU.

Verify with: `manual` — render a 4-note phrase on Chrome+WebGPU and confirm completion under 30 s

### AC-009 — Blend multi-speaker voices

For multi-speaker voicebanks, a blend control must compute a weighted sum of `.emb` vectors
expanded to the `spk_embed` tensor.

Verify with: `pnpm test:run -- BrowserAi speakerBlend`

## Open questions

- [ ] (blocking) Admit a browser vocoder only after its license, provenance, tensor contract,
  output quality, and runtime cost are verified. Singing synthesis stays unavailable until then.
- [ ] (blocking) Which DiffSinger voicebank ships first, and is there a viable English voicebank
  under a compatible license? A verified per-voicebank shortlist must exist before implementation.

## Affected areas

- `src/modules/BrowserAi/useCases/renderDiffSingerPhrase`
- `src/modules/BrowserAi/workers/onnxInferenceWorker.ts`
- JS phonemizer + tensor preparation (porting OpenUtau `DiffSinger*.cs` logic)

## Dropped from sources

- Consistency distillation and codec-token backends — forward-compatible hooks only.
- Dual vocoder (Vocos + BigVGAN) — one admitted compatible vocoder in browser.
- Checkpoint/resume of in-flight diffusion — future; MVP re-queues lost renders.
