---
type: spec
id: SPEC-modulation-system
title: Procedural modulation with visual halos
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# Procedural modulation with visual halos

## Intent

Add a Bitwig-style procedural modulation system — LFO, envelope, and step-sequencer modulators as
first-class, persisted, undoable project objects connectable to any automatable parameter — and
visualize their effect with modulation halos: colored conic-gradient arcs around knobs that
animate the live modulation range, with hover-to-audition before a connection is committed.

## Non-goals

- WebGPU automation rendering (`../webgpu-automation-rendering/spec.md`).
- Automation comping / volume riding / cross-track linking (`../automation-power-features/spec.md`).
- Visual color tokens (deferred to the design system).

## Requirements

### AC-001 — Modulators are first-class project objects

LFO, envelope, and step-sequencer modulators must be persisted, undoable project-model objects
connectable to any automatable parameter.

Verify with: `pnpm test:run -- Modulation modulatorObjects`

### AC-002 — Modulator output drives a connected parameter

A connected modulator must modulate its target parameter over time through the existing 3-layer
automation architecture.

Verify with: `pnpm test:run -- Modulation modulatorRouting`

### AC-003 — Knobs render a modulation halo at 30 fps

A knob with an active modulation source must render a conic-gradient arc driven by `--mod-amount`,
sustaining ≥30 fps (dropped frames <10% over 5 s) during a sweep.

Verify with: `manual` — sweep a modulator and confirm the halo updates at ≥30 fps in a DevTools trace

### AC-004 — Halo color derives from the source identity

The arc color must be determined by the modulation source's identity via the oklch color system.

Verify with: `manual` — connect two sources to one target and confirm distinct arc colors

### AC-005 — Halos composite via CSS, not Canvas/WebGPU

Halos must render through CSS `conic-gradient` custom properties, not Canvas or WebGPU.

Verify with: `manual` — inspect a halo element and confirm it is a CSS conic-gradient with no canvas backing

### AC-006 — Hovering a source auditions the range live

Hovering a modulation source over an unconnected target must preview the modulation range before
the connection is committed.

Verify with: `manual` — hover a source over an unconnected knob and confirm a preview arc appears without committing

## Open questions

- [ ] (non-blocking) Curated initial set of automatable targets, expanded incrementally? Proposed: yes.

## Affected areas

- new `Modulation` module (modulator objects, routing) following `ModulationLFO.tsx` / `CCGenerator.ts`
- knob components (CSS halo primitive, `--mod-amount`), `colorPresets.ts`

## Dropped from sources

- "Connect anything to anything" full surface — start curated.
