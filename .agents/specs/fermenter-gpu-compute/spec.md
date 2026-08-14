---
type: spec
id: SPEC-fermenter-gpu-compute
title: Fermenter GPU compute and visualization
status: draft
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/spec-of-the-gaps.md
---

# Fermenter GPU compute and visualization

## Intent

Offload Fermenter's heaviest analysis, synthesis, and rendering to the GPU via
`wgpu`/WebGPU — FFT spectrum analysis, high-partial-count additive synthesis,
partitioned convolution tails, and the visualization shaders — without ever
making the audio thread wait on the GPU. None of this is built yet.

## Non-goals

- The CPU additive engine (`../fermenter-additive/spec.md`).
- The CPU effects (`../fermenter-effects/spec.md`).
- Replacing CPU paths — GPU is an optional, quality-gated accelerator.

## Requirements

### AC-001 — The audio thread never blocks on the GPU

When GPU work is in flight, the audio thread must only write analysis taps to an
SPSC ring buffer and must never wait on a GPU result.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::gpu_audio_nonblocking`

### AC-002 — Every GPU path falls back to CPU when WebGPU is absent

When `navigator.gpu` / a GPU device is unavailable, each accelerated feature must
fall back to its CPU path and still produce output.

Verify with: `pnpm test:run -- fermenterGpuFallback`

### AC-003 — GPU FFT spectrum analysis matches the CPU FFT

When the GPU FFT path runs, its magnitude spectrum must match the CPU FFT within
tolerance for the same input window.

Verify with: `manual` — run the spectrum analyzer on a known tone and confirm GPU and CPU bins agree

### AC-004 — GPU additive synthesis matches the CPU partial bank

When the GPU additive path renders, its output must match the CPU partial bank
within tolerance for the same partials.

Verify with: `manual` — A/B a 512-partial patch on GPU vs CPU and confirm null below the tolerance

### AC-005 — Visualizations degrade gracefully on a missed frame

When the render thread misses a GPU frame, the visualization must drop that frame
rather than stall.

Verify with: `pnpm test:run -- fermenterVisualizationDrop`

### AC-006 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] Does GPU FFT earn its transfer overhead at Fermenter's FFT sizes, or only
  additive at high partial counts (research Q-003)? Blocks `status: ready`.
- [ ] (non-blocking) What partition size best balances convolution latency
  against GPU throughput for the reverb tail?

## Affected areas

- `crates/daw-engine/` (wgpu device, compute submission, ring-buffer taps)
- `src/modules/Fermenter/` (visualization surfaces, WebGPU capability check)

## Dropped from sources

- Specific WGSL shader listings — implementation detail; this spec states the
  contracts (non-blocking, fallback, parity), not the shader code.
