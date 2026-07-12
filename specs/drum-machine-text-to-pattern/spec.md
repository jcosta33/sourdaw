---
type: spec
id: SPEC-drum-machine-text-to-pattern
title: Drum machine text-to-pattern generation
status: in-progress
owner: The Sourdaw team
sources:
  - ../drum-machine/spec.md
  - intake/research-ai.md
---

# Drum machine text-to-pattern generation

## Intent

Let a user type a short prompt (e.g. "slow boom-bap with ghost snares on 3e") and receive a
candidate drum pattern as strict structured JSON, converted to a `PatternDelta`, previewed on the
step grid, and committed only on explicit Accept through the same mutator path as a manual edit.
Inference runs off the audio thread via a small local LLM (`ort` native / ONNX Runtime Web) or an
opt-in cloud endpoint, both emitting the same JSON shape.

## Non-goals

- Scoring patterns (`../drum-machine-groove-classifier/spec.md`) or groove transfer
  (`../drum-machine-groove-templates/spec.md`).
- AI audio synthesis; real-time "complete this phrase live" adaptation; training pipelines.

## Requirements

### AC-001 — Prompt produces a strict-schema pattern proposal

The model must emit JSON matching the fixed pattern schema (bars, resolution, swing, steps,
kit_deltas), converted to a `PatternDelta` against the selected slot.

Verify with: `pnpm test:run -- DrumMachine textToPatternSchema`

### AC-002 — Invalid output is rejected without corrupting the pattern

Invalid JSON, out-of-range velocities, or unknown pads must be rejected with a non-technical
user-visible error and 0% silent pattern corruption across the adversarial prompt suite.

Verify with: `pnpm test:run -- DrumMachine textToPatternRejection`

### AC-003 — Proposals preview and never auto-commit

A proposal must render in a distinct preview overlay and play without overwriting the slot until
the user presses Accept, which routes through the undoable manual-edit mutator.

Verify with: `pnpm test:run -- DrumMachine textToPatternPreviewCommit`

### AC-004 — Generated patterns adhere to the prompt

Over the fixed prompt suite (20 trials each), "slow boom-bap" must yield kick density ≥70% on
beats 1 and 3 with snares on 2 and 4 in ≥90% of trials.

Verify with: `manual` — run the canonical prompt suite and confirm the per-prompt adherence thresholds

### AC-005 — Generation runs off the audio thread within budget

Inference must run in the Rust/Web worker (never the audio thread) and reach preview within 3 s on
the native target (6 s on web), with cancellable progress beyond that.

Verify with: `manual` — time prompt-to-preview on the reference native target and confirm ≤3 s, audio thread untouched

### AC-006 — Four-on-the-floor prompt places kick on every downbeat

Over the fixed prompt suite (20 trials each), "four-on-the-floor house" must place kick on every
downbeat in ≥95% of trials.

Verify with: `manual` — run the canonical prompt suite and confirm the per-prompt adherence thresholds

## Open questions

- [ ] (blocking) Model choice for local inference (Phi-3-mini / Llama-3.2-1B / Qwen2.5-0.5B) that
  meets the latency and prompt-adherence bars under a commercial-distribution-compatible license.
- [ ] (non-blocking) Bundle vs first-use download of model weights.

## Affected areas

- Rust `ort` worker / ONNX Runtime Web worker; optional cloud endpoint adapter
- sequencer prompt field (Level 3+); `PatternDelta` commit path
- `resources/ai-models/` with license/provenance metadata

## Dropped from sources

- Specific model selection — the spec fixes the interface, not the model.
