---
type: spec
id: SPEC-grinder-neural-builtins-phase-7
title: Grinder neural built-ins — phase 7 (audible built-in model browser)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
  - research.md
---

# Grinder neural built-ins — phase 7 (audible built-in model browser)

## Intent

Make Grinder's Neural model browser audibly real: selecting a built-in neural voice
loads a distinct built-in capture profile in the DSP and changes the live capture
response, instead of only updating patch metadata.

## Non-goals

- External NAM/A1 file import.
- User model management.
- Routing-mode completion.
- Cabinet-selection completion.
- A new Neural UI redesign.

## Requirements

### AC-001 — Model browser loads real DSP variants

When a built-in neural library entry is selected, it must change the neural DSP
configuration rather than only changing patch metadata.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-002 — Built-in models sound distinct

At least two built-in neural models must produce measurably different output for the same
input stimulus.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-003 — Model selection is bridged end-to-end

When a built-in model is selected, patch sync (`loadGrinderPatchWithAudio()`) must send a
real model-selection param to the device.

Verify with: `pnpm test:run -- grinderParamBridge`

### AC-004 — Neural panel copy is honest

Once the model browser is real, the Neural panel must stop stating that library entries
do not swap DSP assets.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-005 — RT safety is preserved

Model selection and processing must remain allocation-free in the audio callback path,
with profiles preallocated inside `NeuralCapture`.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-006 — Regression coverage exists for both bridge sync and DSP distinctness

Automated tests must explicitly prove both that the selected built-in model bridge-syncs a
real DSP model-selection param and that two built-in models render distinct output, so
neither half can regress silently.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::` and `pnpm test:run -- grinderParamBridge`

## Open questions

- [ ] (non-blocking) Should the next Neural phase focus on external capture import or on
  richer built-in voice authoring?

## Affected areas

- `crates/daw-dsp/src/grinder/neural.rs`
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx`

## Tradeoffs and risks

- Built-in model variants make the browser real, but they are not a replacement for full
  external capture loading.
- **Calibration risk:** "If the built-in variants are too subtle, the feature will still
  feel fake; if too exaggerated, it will feel gimmicky." The variant strength carried by
  AC-002 must be tuned to feel real but not gimmicky; this calibration risk had no home in
  the migrated spec and is restored here from `specs/grinder-neural-builtins-phase-7.md`.

## Dropped from sources

- External NAM/A1 model import — deferred to phase 8; this phase ships the built-in
  library first because the browser is already user-facing.
- A hidden default voice — rejected; with no built-in model selected the neural path
  behaves transparently rather than pretending a voice was loaded.
- Mechanism hint (implementation note, kept out of requirements per the architect stance):
  the original spec noted "Built-in models can differ through distinct convolution weights,
  recurrent weights, and output shaping." This is the specific lever set by which variants
  are made distinct; AC-002 requires the distinctness outcome without prescribing the
  mechanism. Restored from `specs/grinder-neural-builtins-phase-7.md`.
- Test-plan ordering (process guidance, not a verifiable requirement): the original test
  plan called to "Run targeted Grinder DSP and Vitest files first" then "Run full Grinder
  validation for the module." The per-AC `Verify with:` lines name individual test
  commands; the explicit targeted-before-full ordering is recorded here from
  `specs/grinder-neural-builtins-phase-7.md`.
