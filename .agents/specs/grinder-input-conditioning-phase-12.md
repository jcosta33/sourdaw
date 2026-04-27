# Grinder Input Conditioning Phase 12

## Context

Phase 11 made Grinder's named preamp and power-tube families more truthful. The next obvious contract gap is earlier in the chain:

- `src/modules/Grinder/models/GrinderPatch.ts` stores `inputMode`
- the bridge syncs `inputMode` through `setGrinderParamWithAudio.ts` and `syncGrinderPatchToAudio.ts`
- `crates/daw-dsp/src/grinder/engine.rs` forwards `inputMode` into `InputConditioner`
- `crates/daw-dsp/src/grinder/input.rs` currently ignores it

That leaves a stored source-conditioning choice that does not affect live audio.

## Goal

`inputMode` becomes a real, audible input-conditioning choice instead of decorative patch metadata.

## User-visible behavior

Switching `inputMode` should sound like choosing a different source path into the amp:

- `instrument` should preserve more direct pick attack and top-end openness
- `line` should feel flatter and more padded than `instrument`
- `reamp` should feel more source-conditioned and slightly less sharp than `instrument`

The result should stay subtle enough to remain believable as front-end conditioning rather than sounding like a fake extra pedal.

## Scope

**In scope:**

- Make `inputMode` affect `InputConditioner` in `crates/daw-dsp/src/grinder/input.rs`
- Add DSP regressions for input-mode distinctness and ordering
- Update the Grinder audit/task trail to reflect that `inputMode` is no longer a patch-contract lie

**Out of scope:**

- new Neural work
- UI redesign
- broader later-stage amp retuning
- full pickup/cable/circuit simulation

## Requirements

1. **`inputMode` is audibly real**
   The conditioner must respond to `inputMode` with measurably different output for the same guitar-like stimulus.

2. **`instrument` stays more open than `reamp`**
   Under the same bright pick stimulus, `instrument` must preserve more attack/edge than `reamp`.

3. **`line` stays flatter and more padded than `instrument`**
   Under the same stimulus, `line` must not collapse to the same calibrated response as `instrument`.

4. **Behavior stays bounded**
   Input-mode changes must remain in the category of front-end conditioning, not obvious fake EQ gimmicks.

5. **RT safety is preserved**
   `InputConditioner::process_sample()` must remain allocation-free and lock-free.

6. **Regression coverage exists**
   Tests must prove mode distinctness and the intended ordering.

## Constraints

- Reuse the existing `InputConditioner`.
- Keep all state preallocated inside the conditioner struct.
- Do not expand scope into new patch fields.

## Acceptance criteria

- [x] A DSP test proves `inputMode` changes the rendered output on the same stimulus.
- [x] A DSP test proves `instrument` preserves more pick attack than `reamp`.
- [x] A DSP test proves `line` does not collapse to the same response as `instrument`.
- [x] `cargo test -p daw-dsp grinder::` passes.
- [x] `pnpm test:run src/modules/Grinder` passes.
- [x] `pnpm typecheck` passes.

## Test plan

- [x] Add a failing DSP test for input-mode distinctness.
- [x] Add a failing DSP test for `instrument` vs `reamp` attack ordering.
- [x] Add a failing DSP test for `line` vs `instrument` response separation.
- [x] Run full Grinder DSP tests.
- [x] Run Grinder UI tests to catch accidental module regressions.

## Open questions

- [x] Should a later phase expose `inputMode` more explicitly in the Grinder UI, or is patch/preset-level support sufficient for now?
      Answer: patch/preset-level support is sufficient for this phase because the user-facing lie was the dead DSP contract, not a missing UI affordance. Explicit UI exposure can be evaluated later as a discoverability improvement.

## Tradeoffs and risks

- Too much input-mode shaping would feel fake because this is still only front-end conditioning, not a full pickup/cable/reamp-box model.
- Too little shaping would technically "wire" the feature while still leaving it functionally decorative.
