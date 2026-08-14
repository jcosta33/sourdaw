---
type: spec
id: SPEC-fermenter-modulation
title: Fermenter modulation system
status: in-progress
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter modulation system

## Intent

Fermenter's internal modulation matrix routes per-voice and global sources
(envelopes, LFOs, step sequencers, random modulators, performance inputs, XY pad)
to destinations (generator, filter, envelope, LFO, and FX parameters) with
amount and polarity. Basic routing ships; audio-rate modulation, meta-modulation
ordering, and the unified Modulation Dock are the remaining work.

## Non-goals

- The project-wide procedural modulation system with halos
  (`../modulation-system/spec.md`).
- The shared parameter and block contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — A slot routes a source to a destination with amount and polarity

When a modulation slot is enabled, the matrix must add the source value scaled by
the slot amount and polarity to the destination's accumulated modulation.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::mod_slot_routing`

### AC-002 — Multiple slots to one destination sum

When several enabled slots target the same destination, their contributions must
sum before the destination's final value is computed.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::mod_destination_sum`

### AC-003 — A modulated value stays within its parameter range

When modulation is applied, the destination's final value must be clamped to its
parameter range.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::mod_range_clamp`

### AC-004 — Audio-rate sources update per sample

When a source is in audio-rate mode, the matrix must compute its value per
sample; control-rate sources update once per block with an optional ramp.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::mod_audio_rate`

### AC-005 — Meta-modulation routes are topologically ordered

When a source modulates another source's depth, the matrix must evaluate sources
in dependency order resolved at patch-compile time.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::mod_meta_ordering`

### AC-006 — Hover preview routing applies at a block boundary

When the UI previews a routing, the audio thread must apply the preview slot at a
block boundary and remove it on cancel, never mutated mid-block.

Verify with: `pnpm test:run -- fermenterModPreview`

### AC-007 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] Should meta-modulation cycles be broken by a one-block delay or disallowed
  in the UI? Blocks `status: ready` until decided (research Q-002).

## Affected areas

- `crates/daw-dsp/src/fermenter/modulation/`
- `src/modules/Fermenter/` (modulation dock, routing bridge)

## Dropped from sources

- Lorenz-attractor and Perlin-noise modulator sources — deferred to a later
  modulation-depth wave; the core sources land first.
