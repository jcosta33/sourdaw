---
type: spec
id: SPEC-fermenter-granular
title: Fermenter granular engine
status: done
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter granular engine

## Intent

Fermenter's granular engine sprays overlapping windowed grains from a source
buffer, scheduling them by density with randomized position, pitch, and pan for
clouds and textures. The grain pool and scheduler ship today.

## Non-goals

- The sample-zone / keymap loading that feeds the source buffer
  (`../fermenter-sampler/spec.md`).
- The shared parameter and block contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — Grains spawn at the requested density

When density is set to `D` grains per second, the scheduler must spawn grains at
a mean inter-onset interval of `sample_rate / D`.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::granular_density`

### AC-002 — Each grain is amplitude-windowed over its lifetime

When a grain plays, its amplitude must follow the selected window (Hann,
Gaussian, Tukey, or triangle) from zero at onset through its duration.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::granular_window`

### AC-003 — Spray randomizes grain source position

When spray is non-zero, each grain's read position must be offset from the base
read position by a bounded random amount.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::granular_spray`

### AC-004 — Pitch spread detunes individual grains

When pitch spread is non-zero, each grain's playback speed must be detuned by a
bounded random cents offset around the base pitch ratio.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::granular_pitch_spread`

### AC-005 — The active grain count is bounded

When grain demand exceeds the pool, the engine must cap active grains at the
fixed pool size without allocating.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::granular_pool_bound`

### AC-006 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) Should freeze (stop advancing the base read position while
  still spawning) be a parameter or a momentary performance control?

## Affected areas

- `crates/daw-dsp/src/fermenter/granular.rs`
- `src/modules/Fermenter/` (granular parameter bridge)

## Dropped from sources

- Cubic per-grain interpolation — grains use linear interpolation; cubic is a
  later quality option.
