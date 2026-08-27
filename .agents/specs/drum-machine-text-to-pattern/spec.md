---
type: spec
id: SPEC-drum-machine-text-to-pattern
title: Drum machine text-to-pattern generation
status: in-progress
owner: The Sourdaw team
sources:
    - ../drum-machine/spec.md
    - ../midi-generation/research.md
    - ../ai-ghost-surfaces/spec.md
---

# Drum machine text-to-pattern generation

## Intent

Let a user type a short prompt (e.g. "slow boom-bap with ghost snares on 3e") and receive a
candidate drum pattern as strict structured JSON, converted to a `PatternDelta`, previewed on the
step grid, and committed only on explicit Accept through the same mutator path as a manual edit.
Inference runs off the audio thread through the shared AI provider contract: browser-local WebLLM
or an explicitly configured hosted provider, both emitting the same JSON shape. The desktop build
uses WebLLM in its renderer over WebGPU; there is no native local language-model route.

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

Inference must never run on the audio thread and must reach preview within 6 s on the reference
WebLLM target, with cancellable progress beyond that.

Verify with: `manual` — time prompt-to-preview on browser and desktop WebLLM and confirm ≤6 s, audio thread untouched

### AC-006 — Four-on-the-floor prompt places kick on every downbeat

Over the fixed prompt suite (20 trials each), "four-on-the-floor house" must place kick on every
downbeat in ≥95% of trials.

Verify with: `manual` — run the canonical prompt suite and confirm the per-prompt adherence thresholds

## Open questions

- [ ] (blocking) Which admitted WebLLM model meets the latency and prompt-adherence bars?
- [ ] (non-blocking) Whether the existing first-use WebLLM artifact admission is sufficient for
      this feature's prompt suite.

## Affected areas

- shared WebLLM and hosted-provider adapters
- sequencer prompt field (Level 3+); `PatternDelta` commit path
- existing WebLLM license/provenance metadata

## Dropped from sources

- Specific model selection — the spec fixes the interface, not the model.
