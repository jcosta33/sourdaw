---
type: spec
id: SPEC-automation-power-features
title: Automation power features
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# Automation power features

## Intent

Add three automation power tools on top of the existing automation system: automation comping
(reusing the take-lane/comp-region infrastructure on automation lanes), AI-assisted volume riding
(emitting suggestions into the ghost-automation surface), and cross-track automation linking
(mathematical relationships between parameters on different tracks).

## Non-goals

- The WebGPU automation canvas (`../webgpu-automation-rendering/spec.md`).
- The ghost-automation preview surface itself (`../ai-ghost-surfaces/spec.md`) — this only emits suggestions.
- Procedural modulators (`../modulation-system/spec.md`).

## Requirements

### AC-001 — Automation comping reuses take lanes

Multiple automation passes must record into the existing `TakeLane`/`CompRegion` infrastructure
applied to automation lanes, then comp the best sections.

Verify with: `pnpm test:run -- Automation automationComping`

### AC-002 — AI volume riding suggests loudness automation

Analyzing audio dynamics via the `AudioAnalysis` module must produce a volume-riding curve emitted
as a ghost-automation suggestion targeting a perceived-loudness goal.

Verify with: `pnpm test:run -- Automation volumeRidingSuggestion`

### AC-003 — Cross-track linking propagates relationships

A mathematical relationship (offset, scale, invert, or expression) between parameters on different
tracks must update the linked target whenever the source changes.

Verify with: `pnpm test:run -- Automation crossTrackLinking`

## Open questions

- [ ] (non-blocking) Should the volume-riding analyzer run Web or Rust tier? Proposed: Mixed (project-size dependent).

## Affected areas

- `TakeLane`/`CompRegion`/`groupComping` (extended to automation lanes)
- `AudioAnalysis` module (volume-riding analyzer)
- cross-track link relationships in the automation model

## Dropped from sources

- The ghost-automation rendering details — owned by `../ai-ghost-surfaces/spec.md`.
