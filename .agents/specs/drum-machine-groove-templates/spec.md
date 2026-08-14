---
type: spec
id: SPEC-drum-machine-groove-templates
title: Drum machine groove templates
status: in-progress
owner: The Sourdaw team
sources:
  - ../drum-machine/spec.md
  - ../workflow-ui/research.md
  - ../ai-ghost-surfaces/spec.md
---

# Drum machine groove templates

## Intent

Extract the groove (swing, micro-timing, velocity curve, ghost-hit pattern) from a source pattern
into a reusable `GrooveTemplate` and re-apply it to a different kit or note content — the MPC /
SP-1200 / TR-808-shuffle "feel transfer" workflow. Application preserves step activation, emits a
single `PatternDelta`, and goes through preview-and-commit. A curated template library ships built
in.

## Non-goals

- Pattern generation (`../drum-machine-text-to-pattern/spec.md`) or quality scoring
  (`../drum-machine-groove-classifier/spec.md`).
- Pad identities, sample references, or synth parameters in templates — timing and dynamics only.

## Requirements

### AC-001 — Extract a timing-and-dynamics-only template

Extraction must compute a `GrooveTemplate` (resolution, swing, per-step micro-timing at 960 PPQN,
velocity curve, ghost mask) carrying no pad identities, samples, or synth parameters.

Verify with: `pnpm cargo:test -- -p daw-dsp groove_template_extract`

### AC-002 — Apply preserves activation and reshapes feel

Applying a template must leave step activation unchanged while overwriting micro-timing,
multiplying velocity by the curve, and setting global swing.

Verify with: `pnpm cargo:test -- -p daw-dsp groove_template_apply`

### AC-003 — Re-applied timing matches the source within tolerance

Extracting from a known 808 pattern and re-applying to another kit must keep per-step timing within
±5 ticks at 960 PPQN and velocity-ratio standard deviation ≤0.05 across the reference suite.

Verify with: `pnpm cargo:test -- -p daw-dsp groove_template_fidelity`

### AC-004 — Round-trip on the same pattern is idempotent

Extracting a template from pattern A and applying it back to A must yield a bit-identical pattern.

Verify with: `pnpm cargo:test -- -p daw-dsp groove_template_roundtrip`

### AC-005 — Applying to an empty pattern is a no-op

Applying a template to a pattern with no active steps must change nothing.

Verify with: `pnpm cargo:test -- -p daw-dsp groove_template_empty_noop`

### AC-006 — Application previews and commits once

The groove-apply operation must emit a single `PatternDelta` routed through preview-and-commit,
mutating the slot only on Accept.

Verify with: `pnpm test:run -- DrumMachine grooveTemplatePreviewCommit`

### AC-007 — A curated template library ships built in

The feature must ship at least the curated set (TR-808 shuffle, TR-909 swing 58%, MPC swing 54%,
MPC swing 62%, SP-1200 straight, J-Dilla late-snare), each passing the round-trip test.

Verify with: `pnpm cargo:test -- -p daw-dsp groove_template_library`

## Open questions

- [ ] (non-blocking) Onset-to-microtiming quantization tolerance for audio-loop extraction (Level 5,
  MIDI-source extraction ships first).

## Affected areas

- `GrooveTemplate` extract/apply in `crates/daw-dsp/`
- curated library JSON in app resources; swing/groove control area (Level 3+)
- `PatternDelta` commit path

## Dropped from sources

- Groove extraction from reference audio — gated behind Level 5; MIDI-source ships first.
