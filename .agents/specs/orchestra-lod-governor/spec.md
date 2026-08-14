---
type: spec
id: SPEC-orchestra-lod-governor
title: Orchestra memory and quality governor
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra memory and quality governor

## Intent

Keep Orchestra inside its memory and CPU budget on every backend: stream samples
from disk on native (preloaded attack + background tail), preload with hard caps
on web, and run a quality governor that sheds load by level-of-detail (mics,
velocity layers, round robins, interval transitions) as the deadline approaches.

## Non-goals

- The core voice/zone engine and hot-path lookup — owned by `SPEC-orchestra`.
- The convolution reverb engine — owned by `SPEC-orchestra-convolution-reverb`.
- Mic mixing behavior — owned by `SPEC-orchestra-mic-mixing` (this spec only
  loads/unloads mic data under the budget).

## Requirements

### AC-001 — Native streams samples without disk I/O on the audio thread

When a note triggers on native, the engine must play from a preloaded attack
buffer while a background thread streams the remainder, performing no disk I/O on
the audio thread.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::lod::native_streaming_no_io`

### AC-002 — Web preloads within a hard memory cap

When running on the web/WASM backend, the engine must load samples into memory
within the configured cap and never attempt disk streaming.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::lod::wasm_within_cap`

### AC-003 — The quality governor sheds detail in a defined order

When the processing budget is exceeded, the governor must disable detail in the
defined LOD order (ambient mics → velocity layers → round robins → interval
transitions) rather than glitching.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::lod::shed_order`

### AC-004 — Shedding and restoring detail is glitch-free

When the governor changes LOD level mid-performance, it must transition without a
discontinuity in the output.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::lod::transition_glitch_free`

### AC-005 — Per-archetype voice budgets are enforced

When voices for a patch archetype reach its budget, the engine must hold within
that budget by stealing or shedding rather than exceeding it.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::lod::voice_budget_enforced`

## Open questions

- [ ] (blocking) The numeric budgets per backend (WASM memory cap, native/WASM
  max voices, per-archetype voice counts) must be fixed before build — the source
  gives only example ranges.
- [ ] (non-blocking) Should the governor key off a measured per-block deadline or
  a predicted cost model, and is the level user-overridable?

## Affected areas

- `crates/daw-dsp/src/levain/lod/` (quality governor, LOD strategy, voice
  budgets)
- the native background streaming thread and the web preload/decoder path

## Dropped from sources

- Progressive web loading (fetch-and-decode incrementally) as an alternative to
  preload — recorded as an option behind AC-002, not a separate requirement.
- The `creek`/`rubato` crate choices and SSD throughput assumptions — design
  rationale behind AC-001.
