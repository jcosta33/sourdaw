---
type: spec
id: SPEC-fermenter-noise
title: Fermenter noise generator
status: done
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter noise generator

## Intent

Fermenter's noise generator supplies white, pink, and brown noise as a generator
source — for transient "air," percussion, and texture layering. The three noise
colors ship today.

## Non-goals

- Filtering or shaping the noise (`../fermenter-filters/spec.md`).
- The shared parameter and block contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — White noise is uniform and full-band

When white noise is selected, the generator must output samples uniformly
distributed in `[-1, 1]` from a fast PRNG with a flat spectrum.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::noise_white`

### AC-002 — Pink noise rolls off at roughly 3 dB per octave

When pink noise is selected, the generator must apply the Kellet pinking filter
so the spectrum falls at approximately 3 dB per octave.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::noise_pink`

### AC-003 — Brown noise rolls off at roughly 6 dB per octave

When brown noise is selected, the generator must integrate white noise with a
leak so the spectrum falls at approximately 6 dB per octave.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::noise_brown`

### AC-004 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) Is the single-seed PRNG per voice sufficient, or should the
  noise source carry a per-voice seed like the drift generators?

## Affected areas

- `crates/daw-dsp/src/fermenter/noise.rs`
- `src/modules/Fermenter/` (noise parameter bridge)

## Dropped from sources

- The Voss-McCartney octave-source pink generator — the Kellet IIR cascade is
  the shipped path; the alternative is recorded only for reference.
