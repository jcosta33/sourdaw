---
type: spec
id: SPEC-webgpu-automation-rendering
title: WebGPU unified timeline rendering
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# WebGPU unified timeline rendering

## Intent

Replace per-lane Canvas 2D automation drawing with a single WebGPU canvas that overlays the whole
timeline and renders every automation curve, fill, and node, decoupled from React's render cycle
and reading from a vanilla store. The existing `GlutenCurve`/Canvas 2D path remains the graceful
fallback when WebGPU is unavailable.

## Non-goals

- The spectrum analyzer / spectrogram pipeline (`../spectrum-spectrogram/spec.md`).
- Modulation halos (`../modulation-system/spec.md`).
- Automation power features (`../automation-power-features/spec.md`).

## Requirements

### AC-001 — One WebGPU canvas renders all automation

A single WebGPU canvas overlaying the timeline must render all curves, fills, and nodes, extending
`createWebGpuRenderer.ts` with a minimum `MAX_RECTS = 32768` per frame.

Verify with: `manual` — confirm a single canvas draws all lanes' curves/fills/nodes

### AC-002 — The renderer is decoupled from React

The renderer must read from a vanilla store with zero React re-renders during a sustained playhead
sweep, while DOM lane headers virtualize.

Verify with: `manual` — profile a playhead sweep and confirm zero React commits in the automation subtree

### AC-003 — Curves tessellate with MSAA 4x

Bezier/curved segments must subdivide on the CPU and expand into screen-aligned quads on the GPU
with MSAA 4x.

Verify with: `pnpm test:run -- Arrangement curveTessellation`

### AC-004 — Rendering sustains 58 fps under stress

With 50 lanes × 500 breakpoints, the canvas must sustain ≥58 fps over 10 s while DOM controls stay
interactive (<50 ms click latency).

Verify with: `manual` — run the 50×500 stress project and confirm ≥58 fps with responsive headers

### AC-005 — Canvas 2D remains the graceful fallback

Disabling WebGPU must fall back to `GlutenCurve`/Canvas 2D and still render all lanes.

Verify with: `manual` — disable WebGPU via flag and confirm all lanes render in Canvas 2D

## Open questions

- [ ] (non-blocking) Should the fallback path share the vanilla-store read model? Proposed: yes.

## Affected areas

- `createWebGpuRenderer.ts` (Arrangement module) — WGSL shaders, batch rendering
- automation lane rendering; vanilla store for renderer reads

## Dropped from sources

- Removing the Canvas 2D renderer — it is retained as fallback, not deleted.
