---
type: spec
id: SPEC-orchestra-gpu-visualization
title: Orchestra GPU compute and visualization
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra GPU compute and visualization

## Intent

Use the GPU for Orchestra's heavy visual and offline-compute work —
spectrograms, waveform overviews, phase meters, and IR partition preparation —
while keeping all real-time audio generation on the CPU, because GPU readback
jitter is unsafe for the audio hot path.

## Non-goals

- Generating real-time audio on the GPU (explicitly excluded — CPU only).
- The convolution audio path itself — owned by
  `SPEC-orchestra-convolution-reverb`.
- The surrounding inspector/visual UI layout — owned by
  `SPEC-orchestra-progressive-disclosure-ux`.

## Requirements

### AC-001 — The audio thread never blocks on the GPU

When GPU work is scheduled, the audio thread must only write analysis taps into
an SPSC buffer and must never wait on a GPU result.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::gpu::audio_never_blocks`

### AC-002 — Spectrogram is computed by GPU FFT

When the spectrogram view is active, the engine must compute its FFT magnitudes
on the GPU and present them as a magnitude texture.

Verify with: `manual` — open the spectrogram with GPU available; bins update live and match a CPU FFT reference frame

### AC-003 — Waveform overview downsamples per pixel column on the GPU

When rendering a waveform overview, the engine must compute per-pixel-column
min/max via GPU compute.

Verify with: `manual` — zoom a long sample; the overview min/max envelope matches the audio with no missed peaks

### AC-004 — IR partition FFTs are precomputed offline

When an IR is loaded for convolution, its per-partition FFTs must be precomputed
off the audio thread (GPU where available) and reused on the render path.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::gpu::ir_partition_precompute`

### AC-005 — GPU absence falls back to CPU

When no compatible GPU is present, every visualization must still render via a
CPU path.

Verify with: `manual` — disable GPU; spectrogram, waveform, and phase meter still render

## Open questions

- [ ] (non-blocking) Phase-correlation/coherence meter between mic streams —
  compute on CPU or GPU?
- [ ] (non-blocking) Minimum WebGPU feature set required before the GPU path is
  offered (workgroup size, storage-buffer limits).

## Affected areas

- `crates/daw-dsp/src/levain/gpu/` (WGSL compute shaders, tap buffers, CPU
  fallback)
- the render/UI thread that consumes analysis taps and schedules GPU work

## Dropped from sources

- WGSL Stockham FFT shader pseudocode — implementation detail behind AC-002.
- Heavy resynthesis previews on GPU — folded into
  `SPEC-orchestra-spectral-modeling` as an optional acceleration, not a separate
  requirement here.
