---
type: spec
id: SPEC-orchestra-convolution-reverb
title: Orchestra convolution reverb
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra convolution reverb

## Intent

Give Orchestra a real hall sound with a partitioned convolution engine that runs
multi-second impulse responses without adding input-output latency, shares the
expensive reverb tail across a section's voices, and falls back to a tunable
algorithmic reverb when IRs are disabled.

## Non-goals

- Mic-position blending and distance simulation — owned by
  `SPEC-orchestra-mic-mixing`.
- Generating room IRs (asset/offline tooling).
- The reverb-controls UI — owned by `SPEC-orchestra-progressive-disclosure-ux`.

## Requirements

### AC-001 — Partitioned convolution adds no input-output latency

When a multi-second IR is loaded, the engine must process it with a head/tail
partitioned convolver so the output has zero added input-output delay.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::reverb::zero_latency_head`

### AC-002 — Convolution output matches a reference direct convolution

When a known input is convolved with a known IR, the partitioned engine's output
must match a direct (reference) convolution within tolerance.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::reverb::matches_direct_convolution`

### AC-003 — The reverb tail is shared per section

When several voices in a section are active, the engine must apply one shared
convolution tail across them rather than one tail per voice.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::reverb::shared_section_tail`

### AC-004 — An algorithmic reverb covers the IR-disabled path

When convolution is disabled, the engine must provide a stable FDN-based reverb
so a room sound is still available.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::reverb::fdn_fallback_stable`

### AC-005 — Convolution processing is allocation- and lock-free

When processing a block through the convolver, the engine must not allocate or
take a lock on the audio thread.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::reverb::rt_safe`

## Open questions

- [ ] (non-blocking) Partition size policy — a single uniform size, or a
  non-uniform head/tail partitioning tuned per IR length?
- [ ] (non-blocking) Is per-voice early-reflection convolution in scope for
  native, or only the shared per-section tail?

## Affected areas

- `crates/daw-dsp/src/levain/reverb/` (partitioned convolver, FDN fallback)
- `crates/daw-dsp/src/` (shared FFT / overlap-add primitives, IR partition prep)

## Dropped from sources

- IR FFT partition precomputation on GPU — moved to
  `SPEC-orchestra-gpu-visualization` (offline/preview compute).
- IR content / hall library curation — asset work.
