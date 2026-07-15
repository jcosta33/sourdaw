---
type: spec
id: SPEC-spectrum-spectrogram
title: WebGPU spectrum analyzer and spectrogram
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# WebGPU spectrum analyzer and spectrogram

## Intent

Provide a single shared WebGPU-backed spectrum analyzer (FabFilter Pro-Q style) and spectrogram
(iZotope RX waterfall style) that share one GPU pipeline, replacing the three existing
`SpectrumAnalyzer` implementations. The analyzer offers configurable resolution, perceptual tilt,
adjustable release, spectrum-grab freeze, and cross-track collision highlighting at 60 fps,
reusing the existing `spectrumMath.ts` FFT utilities.

## Non-goals

- The modulation halos and procedural modulators (`../modulation-system/spec.md`).
- WebGPU automation rendering (`../webgpu-automation-rendering/spec.md`).

## Requirements

### AC-001 — Spectrum analyzer renders FFT at 60 fps via WebGPU

The analyzer must render a real-time FFT with configurable resolution, perceptual tilt, and
adjustable release, sustaining ≥58 fps over 10 s with 4 tracks playing.

Verify with: `manual` — play 4 tracks and confirm ≥58 fps via rAF timestamps on the reference machine

### AC-002 — FFT data uploads as a GPU storage buffer each frame

Each frame must upload the FFT magnitudes as a `Float32Array` to a GPU storage buffer without an
intermediate copy.

Verify with: `pnpm test:run -- Visualization spectrumGpuUpload`

### AC-003 — Spectrum Grab freezes the current curve

Hovering must freeze the displayed spectrum within 16 ms for inspection.

Verify with: `manual` — hover the analyzer and confirm the curve freezes for inspection

### AC-004 — Collision detection highlights overlapping ranges

Overlapping frequency ranges across two or more concurrently playing tracks must be visually
highlighted.

Verify with: `manual` — play two overlapping tracks and confirm the shared band is highlighted

### AC-005 — One shared component replaces the three implementations

The Fermenter, Workspace, and Bacteria `SpectrumAnalyzer` implementations must be replaced by a
single shared WebGPU-backed component reusing `spectrumMath.ts`.

Verify with: `manual` — search the repo and confirm exactly one SpectrumAnalyzer implementation file remains

### AC-006 — Spectrogram renders a waterfall sharing the GPU pipeline

The spectrogram must render a frequency/time/amplitude heatmap on the same GPU pipeline, with a
waveform-overlay composite mode and continuous 60 fps scroll.

Verify with: `manual` — open the spectrogram with the 4-track workload and confirm continuous 60 fps scroll plus overlay mode

## Open questions

- [ ] (non-blocking) Default FFT window size and tilt curve? Resolve during implementation.

## Known risks

Present-state hazards in the Bacteria copy being replaced (AC-005), carried so the shared
component does not reinherit them:

- `BacteriaPanel.tsx:150-192` — the `K` rotary-knob's inline fallback
  `(onChangeFn ?? ((key, value) => setGlobalParam(deviceId, key as keyof BacteriaPatch, value as never)))`
  allocates a fresh arrow on every render of every `K` (~80 per panel render): nullish-coalesce only
  short-circuits the lhs, not the rhs, and the rhs reads `deviceId` from closure at every call. (The
  inventory recorded the routing risk of this fallback firing, not the allocation/closure hazard.)
- `helpers.ts:73-91` — `encodePatchValue`'s switch-by-key hard-codes five string-enum keys
  (`distortionMode`, `filterMode`, `grainWindow`, `crossoverMode`, `globalRouting | routingMode`).
  Any new string-enum field requires editing this file and extending the parallel index map; nothing
  enforces coverage.

## Affected areas

- new shared `SpectrumAnalyzer` WebGPU component (replaces Fermenter/Workspace/Bacteria copies)
- reuses `spectrumMath.ts`; extends `createWebGpuRenderer.ts`

## Dropped from sources

- Per-lane separate canvases — single shared GPU pipeline instead.
