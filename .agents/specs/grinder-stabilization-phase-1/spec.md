---
type: spec
id: SPEC-grinder-stabilization-phase-1
title: Grinder stabilization — phase 1 (pedal and gate control truth)
status: done
owner: The Sourdaw team
sources:
  - audit.md
  - intake/full-spec.md
---

# Grinder stabilization — phase 1 (pedal and gate control truth)

## Intent

Make Grinder's Drive and gate controls tell the truth: an enabled pedal or gate
stays visibly enabled, the stored patch reflects that state, and the user has an
explicit gate on/off control — so later tone-voicing work is judged against
controls that match what is heard.

## Non-goals

- Revoicing overdrive, distortion, fuzz, preamp, or power-amp tone (later phases).
- Reworking the Neural tab, model browser, or cabinet placeholders.
- Changing DSP gate floor / expander behavior — this phase only makes the gate
  operable from the UI.
- Investigating the unrelated clip-alignment precision complaint.

## Requirements

### AC-001 — Pedal enable state is stored truthfully

When any supported Grinder pre-pedal is toggled, the store must write the patch's
top-level `pedal.enabled` flag for that pedal and must not create or read
`pedal.params.enabled`.

Verify with: `pnpm test:run -- setGrinderPedalParamWithAudio`

### AC-002 — The Drive deck reflects active pedal state

When a drive pedal is enabled, the Drive section must render its toggle from the
same store value that was written, so a clicked pedal remains visibly active
after the update path runs.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-003 — The gate has an explicit UI enable control

Grinder must expose a dedicated `gateEnabled` toggle in the existing Control Deck
so the user can intentionally turn the gate on and off.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-004 — Gate knobs keep working once enabled

When the gate is enabled, its threshold, attack, and release controls must
continue to operate as before.

Verify with: `manual` — open Grinder Lab, enable Gate, adjust threshold/attack/release and confirm audible change

### AC-005 — Presets preserve enabled state on load

When any existing Grinder preset is loaded through the patch migration/store path,
it must not lose its pedal-enabled or gate-enabled state.

Verify with: `pnpm test:run -- grinderPresets`

### AC-006 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-007 — Existing toggle UI language is preserved

The gate enable control and pedal toggles must reuse the existing
`DawPluginToggle` / `DawPluginChip` UI language and must not introduce a new
toggle primitive.

Verify with: `grep -rn "DawPluginToggle\|DawPluginChip" src/modules/Grinder/presentations/views/GrinderPanel.tsx` shows the gate/pedal toggles use these primitives and no new toggle component is added.

### AC-008 — Tests live under `__tests__/` folders

New Grinder tests for this phase must be placed under `__tests__/` folders per
`docs/06-testing.md`.

Verify with: `find src/modules/Grinder -name '*.test.*' -o -path '*__tests__*'` confirms the new test files sit under `__tests__/` directories.

### AC-009 — Regression tests are behavior-level (red before, green after)

The new regression tests must fail against the old behavior and assert the
corrected store/component semantics directly, not internal implementation
details.

Verify with: stash the source fix and run `pnpm test:run -- setGrinderPedalParamWithAudio GrinderPanel` — the new tests fail; restore the fix and they pass.

### AC-010 — No incidental Grinder DSP voicing change

This phase must not change Grinder DSP voicing except where required for the gate
toggle wiring itself.

Verify with: `git diff crates/daw-dsp/src/grinder/` shows no voicing changes beyond gate-toggle wiring.

## Open questions

- [ ] (non-blocking) Should the gate enable toggle live in `Lab`, `Drive`, or
  both? Does not block: one explicit gate on/off control in the current UI
  satisfies the requirement.

## Affected areas

- `src/modules/Grinder/stores/grinderStore.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderPedalParamWithAudio.ts`
- `src/modules/Grinder/useCases/grinderPresets.ts`
- `src/modules/Grinder/models/GrinderPatch.ts`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx`

## Dropped from sources

- Overdrive/pedal tone revoicing — deferred to phase 5 so listening feedback is
  not polluted by false UI state while tone is judged.
- The broader future Grinder UI system from `effects-mastering-ui` — out of scope;
  this phase is an incremental fix in the existing panel.
