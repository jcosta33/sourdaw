---
type: spec
id: SPEC-fermenter-ui
title: Fermenter unified interface
status: in-progress
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../../intake/full-spec.md
---

# Fermenter unified interface

## Intent

Fermenter's UI is selection-driven, not page-driven: a small set of unified
blocks revealed by progressive disclosure, a stable center context inspector for
the selected object, guided empty-state flows, and per-layer bounce/freeze for a
CPU-heavy synth. The MacroStrip and LayerStack ship; the inspector, disclosure
levels, guided starts, and bounce/freeze are the remaining work.

## Non-goals

- The DSP behind any control (the engine, filter, modulation, and effects specs).
- The preset browser surface (`../fermenter-presets/spec.md`).

## Requirements

### AC-001 — Progressive disclosure reveals blocks without changing the patch

When the disclosure level changes (Play, Shape, Build, Route, Lab), the visible
blocks must change while the underlying patch format stays identical.

Verify with: `pnpm test:run -- fermenterDisclosureLevels`

### AC-002 — The context inspector shows the selected object's controls

When an object (generator, filter, FX lane) is selected, the center inspector
must show that object's controls and no others.

Verify with: `pnpm test:run -- fermenterContextInspector`

### AC-003 — A modulated control shows arc segments per source

When a control has modulation routed to it, it must render an arc segment per
source with hover state, rather than a bare knob.

Verify with: `pnpm test:run -- fermenterModArcs`

### AC-004 — Empty states offer guided start flows

When a layer or generator slot is empty, the UI must offer guided start actions
(e.g. "Start with Analog", "Drag in Audio") instead of a dead shell.

Verify with: `pnpm test:run -- fermenterEmptyStateFlows`

### AC-005 — Each layer offers bounce/freeze

When a layer row is shown, it must offer a bounce/freeze action (instrument-only
or full-output) to render the layer to audio.

Verify with: `pnpm test:run -- fermenterLayerBounce`

### AC-006 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) Should the disclosure level persist per preset, per project,
  or per user?

## Affected areas

- `src/modules/Fermenter/presentations/` (unified blocks, context inspector,
  empty-state flows, layer bounce controls)

## Dropped from sources

- The GPU-rendered modulation rings — arc rendering may start on the DOM/canvas
  path; GPU instancing is tracked in `../fermenter-gpu-compute/spec.md`.
