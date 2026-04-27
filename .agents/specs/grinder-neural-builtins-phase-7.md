# Grinder Neural Built-Ins Phase 7

## Context

Grinder's Neural tab is no longer visually duplicated, but the model browser is still mostly decorative. The UI stores `neuralModelId`, `neuralModelName`, and `neuralModelFamily`, yet the audio bridge never turns that selection into a DSP parameter and the Rust neural engine has no model-selection path.

The current build already contains a bounded built-in model library in the UI and a placeholder neural engine in Rust. This phase makes those pieces meet in the middle: selecting a library voice must load a distinct built-in capture profile in the DSP.

## Goal

The Neural model browser becomes audibly real. Selecting a built-in neural voice changes the live capture response instead of only updating patch metadata.

## User-visible behavior

Picking a Neural library entry changes the active capture voice in the live rig. The Neural panel should stop claiming that library entries are metadata-only in this build.

## Scope

**In scope:**

- Define a shared built-in Grinder neural library surface.
- Map `neuralModelId` to a real numeric/audio model-selection param.
- Add built-in neural model loading inside `crates/daw-dsp/src/grinder/neural.rs`.
- Ensure different built-in neural models produce different rendered output.
- Update the Neural panel copy/tests so it reflects the now-real behavior.
- Update the Grinder audit/task trail to reflect the resolved Neural browser behavior.

**Out of scope:**

- External NAM/A1 file import.
- User model management.
- Routing-mode completion.
- Cabinet-selection completion.
- A new Neural UI redesign.

## Requirements

1. **Model browser loads real DSP variants**
   Selecting a built-in neural library entry must change the neural DSP configuration instead of only changing patch metadata.

2. **Built-in models sound distinct**
   At least two built-in neural models must produce measurably different output for the same input stimulus.

3. **Model selection is bridged end-to-end**
   `loadGrinderPatchWithAudio()` / patch sync must send a real model-selection param to the device when a built-in model is selected.

4. **Neural panel copy is honest**
   The Neural panel must stop stating that library entries do not swap DSP assets once the model browser becomes real.

5. **RT safety is preserved**
   Model selection and processing must remain allocation-free in the audio callback path.

6. **Regression coverage exists**
   Tests must prove both bridge sync and DSP distinctness.

## Constraints

- Reuse the existing built-in UI library concept rather than inventing external model management.
- Keep model profiles preallocated inside `NeuralCapture`.
- Favor a bounded built-in model system over speculative plugin-style loading.

## Design decisions

### Decision: ship built-in neural profiles before external capture loading

**Chosen:** make the existing built-in library actually work first.

**Rejected:**

- Waiting for full external NAM/A1 model import before making the Neural tab real.
  Rejected because the current browser is already user-facing and should stop being decorative now.

## Acceptance criteria

- [x] A Grinder bridge test proves a selected neural model syncs a real DSP model-selection param.
- [x] A Grinder DSP test proves different built-in neural models produce different output.
- [x] The Neural panel test reflects real built-in model loading instead of metadata-only copy.
- [x] `cargo test -p daw-dsp grinder::` passes.
- [x] `pnpm test:run src/modules/Grinder` passes.
- [x] `pnpm typecheck` passes.

## Implementation notes

- A bounded numeric `neuralModelSlot` param is enough for this phase.
- Built-in models can differ through distinct convolution weights, recurrent weights, and output shaping.
- If no built-in model is selected, the neural path should behave transparently rather than pretending a hidden voice was loaded.

## Test plan

- [x] Add a failing Grinder bridge test for neural model slot sync.
- [x] Add a failing Grinder DSP test for built-in model distinctness.
- [x] Update the Neural panel test for honest copy.
- [x] Run targeted Grinder DSP and Vitest files first.
- [x] Run full Grinder validation for the module.

## Open questions

- [ ] **[MINOR]** Should the next Neural phase focus on external capture import or on richer built-in voice authoring?

## Tradeoffs and risks

- Built-in model variants make the browser real, but they are not a replacement for full external capture loading.
- If the built-in variants are too subtle, the feature will still feel fake; if too exaggerated, it will feel gimmicky.
