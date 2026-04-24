# Grinder Stabilization Phase 1

## Context

The new audit at `.agents/audits/grinder/control-deck.md` found two high-confidence correctness problems that block meaningful listening on Grinder today:

1. Drive-pedal enable state can diverge between UI and DSP.
2. The noise gate is effectively non-operable from the default UI path.

This phase addresses those correctness issues first so later tone-voicing work can be judged against truthful controls. It is grounded in the existing Grinder research/spec context in `.agents/research/factory/effects-mastering.md` and `.agents/specs/missing/effects-mastering-ui.md`, but it deliberately narrows scope to stabilization rather than the missing future UI system described there.

---

## Goal

Grinder's Drive and gate controls tell the truth: when a pedal or gate is enabled, the UI remains visibly enabled, the stored patch reflects that state correctly, and the user has an actual gate enable control in the panel.

---

## User-visible behavior

When the user turns on Overdrive, Distortion, Fuzz, or Compressor in Grinder's Drive section, the control remains visibly active and keeps matching the sound they hear. In the Lab section, the user can explicitly enable or disable the gate instead of only turning threshold/attack/release knobs on an inactive gate.

---

## Scope

**In scope:**

- Fix the Grinder pedal store/update path so pedal enable state is stored on `pedal.enabled`, not hidden inside `pedal.params.enabled`.
- Add a real `gateEnabled` control to the Grinder panel in the existing UI language.
- Add tests that reproduce the current state-truth bug and verify the corrected behavior.

**Non-goals (explicitly out of scope):**

- Revoicing overdrive, distortion, fuzz, preamp, or power-amp tone.
- Reworking the Neural tab, model browser, or cabinet placeholders.
- Changing the DSP gate floor / expander behavior. This phase only makes the gate operable from UI.
- Investigating the unrelated clip-alignment precision complaint.

---

## Requirements

1. **Pedal enable state stays truthful** — toggling any supported Grinder pre-pedal updates the patch's top-level `enabled` flag for that pedal and does not create or rely on `params.enabled`.
2. **Drive Control Deck reflects active state** — the Drive section renders pedal toggles from the same truth that is written into the store, so a clicked pedal remains visibly active after the update.
3. **Gate has an explicit UI enable control** — Grinder exposes a dedicated `gateEnabled` toggle in the existing panel so the user can intentionally turn the gate on and off.
4. **Existing gate knobs remain functional** — gate threshold, attack, and release controls continue to operate exactly as before once the gate is enabled.
5. **Regression tests are behavior-level** — new tests must fail against the old behavior and assert the corrected store/component semantics directly.

---

## Constraints

- Must follow the Grinder module boundaries in `AGENTS.md`.
- Must not introduce cross-module internal imports.
- Must keep tests under `__tests__/` folders per `docs/06-testing.md`.
- Must not change Grinder DSP voicing in this phase unless required for the gate toggle wiring itself.
- Must preserve the existing `DawPluginToggle` / `DawPluginChip` UI language rather than introducing a new toggle primitive.

---

## Design decisions

### Decision: Fix state truth before tone voicing

**Chosen:** implement pedal/gate correctness first and defer overdrive retuning.

**Considered and rejected:**

- Retune overdrive in the same batch — rejected because the user's listening feedback is currently polluted by false UI state and an unusable gate, so tonal changes would be harder to judge and harder to verify.
- Attempt a broader "Grinder cleanup" batch — rejected because the audit found several unrelated issues and this repo requires a precise, testable scope before implementation.

### Decision: Add the gate enable in the existing panel instead of inventing a new control surface

**Chosen:** place a `DawPluginToggle` in the current Grinder panel so the gate becomes operable without a broader layout refactor.

**Considered and rejected:**

- Hide gate enable inside presets only — rejected because it keeps the gate non-discoverable and does not solve the reported bug.
- Wait for the larger future UI refactor from `effects-mastering-ui.md` — rejected because the bug is current and high-confidence.

---

## Acceptance criteria

- [ ] A new store-level test proves `setGrinderPedalParam(..., 'enabled', ...)` updates `pedal.enabled` and does not write `params.enabled`.
- [ ] A Grinder panel test proves the gate enable control is rendered and can reflect enabled state from the store.
- [ ] A Grinder panel or store test proves an enabled drive pedal remains visibly active after the update path runs.
- [ ] No existing Grinder preset loses its pedal enabled state or gate enabled state when loaded through the current patch migration/store path.
- [ ] `pnpm deps:validate` passes with zero violations.

---

## Implementation notes

- Reuse the existing `DawPluginToggle` and current Grinder panel sections; avoid layout churn.
- Add a dedicated store test under `src/modules/Grinder/stores/__tests__/`.
- Expand the existing panel test rather than keeping it as smoke-only if that is the smallest path to asserting the visible behavior.
- The current `replacePatch` flow already handles whole-patch updates for gate-related booleans; prefer using that existing path over inventing a second gate mutation mechanism.

---

## Test plan

- [ ] Automated: add a store test for pedal enabled-state persistence.
- [ ] Automated: add a Grinder panel test that renders a patch with `gateEnabled: true` and asserts the gate toggle shows the pressed/on state.
- [ ] Automated: run the relevant Grinder test files after implementation.
- [ ] Manual: open Grinder, enable a drive pedal, confirm the button stays visually active.
- [ ] Manual: open Grinder Lab, toggle Gate on, then adjust Gate/Attack/Release and confirm the state remains visible.

---

## Open questions

- [ ] **[MINOR]** Should the gate enable toggle live in `Lab`, `Drive`, or both? This does not block implementation as long as Grinder exposes one explicit gate on/off control in the current UI.

---

## Tradeoffs and risks

- Fixing state truth without retuning the pedal voicing will make Grinder more honest, but it will not by itself solve the broader "artifacty/weird" tone complaints.
- Adding a gate toggle in the current layout is intentionally incremental; it may move later if Grinder gets a broader UI overhaul.
- Expanding the existing weak panel tests increases coverage, but these tests still will not validate the full DSP sound of Grinder.
