# Grinder Routing And Cabinet Contract Phase 9

## Context

Phase 8 made Grinder's Neural modal materially real, but the next audit gap is still in the fixed rig path itself: `routingMode`, `cabType`, and `cabIrId` exist in the patch contract yet do not currently produce corresponding routing or cabinet-selection behavior in the live DSP path.

Grounding from the current implementation:

- `src/modules/Grinder/models/GrinderPatch.ts` exposes `routingMode`, `cabType`, and `cabIrId`.
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts` already syncs `routingMode`, but not `cabType` or `cabIrId`.
- `crates/daw-dsp/src/grinder/engine.rs` still runs a single fixed cabinet/speaker path and ignores `routingMode`, `cabType`, and `cabIrId`.
- `crates/daw-dsp/src/grinder/cabinet.rs` already supports multiple built-in cabinet IR voices; they are just not patch-addressable yet.

This phase makes those existing patch fields audible and visible inside the current Grinder architecture without expanding into the separate modular graph roadmap.

## Goal

`routingMode`, `cabType`, and `cabIrId` become real current-rig controls: changing them updates the live signal path, built-in cabinet voices can be selected intentionally, and the Cab UI reflects those choices instead of only exposing lower-level resonance and mic controls.

## User-visible behavior

Users can choose a cabinet voicing, choose whether the rig uses IR, parametric speaker shaping, or both, and choose a bounded routing preset. Those selections update the live Grinder sound immediately and persist in the patch. The Cab UI shows the active cab voice, cab mode, and route preset instead of leaving those fields invisible.

## Scope

**In scope:**

- Make `cabType` audible in the DSP path.
- Make `cabIrId` select a real built-in cabinet voice.
- Make `routingMode` select a real bounded routing preset in the DSP path.
- Expose cabinet voice, cabinet mode, and routing preset selection in the Cab UI.
- Extend the Grinder bridge/tests so those fields reach the live audio path.
- Update the audit/task trail to reflect the new routing/cab truth.

**Out of scope:**

- Arbitrary graph routing or split/merge editing.
- User-imported IR asset management.
- Full dual-amp authoring with separate per-branch amp settings.
- Broader later-stage amp retuning.
- AIDA-X or deeper Neural runtime work.

## Requirements

1. **Cabinet mode is real**
   `cabType = 'ir' | 'parametric' | 'both'` must change which cabinet stages are rendered in the live DSP path.

2. **Cabinet voice is real**
   `cabIrId` must select a real built-in cabinet IR voice rather than sitting unused in the patch model.

3. **Routing preset is real**
   `routingMode = 'serial' | 'parallel' | 'wet-dry-wet' | 'dual-amp'` must select distinct bounded signal-path behaviors inside the current Grinder engine.

4. **Patch-to-audio sync is complete for this slice**
   Full patch loads must sync `cabType`, `cabIrId`, and `routingMode` to the live engine.

5. **Cab UI reflects the contract**
   The Cab section must expose user-facing controls for cabinet voice, cabinet mode, and route preset.

6. **Regression coverage exists**
   Tests must prove cabinet voice changes the output, cabinet mode changes the output, routing mode changes the output, and the bridge/UI wire those selections correctly.

## Constraints

- Keep the implementation inside Grinder, `daw-dsp`, and the existing Grinder audio-engine surface.
- Stay within the fixed rig architecture; this phase implements bounded routing presets, not a free router.
- Do not introduce user IR file loading in this phase.
- Preserve the existing cabinet mic/room behavior added in phase 4.

## Design decisions

### Decision: treat routing modes as bounded rig presets inside the fixed chain

**Chosen:** make `routingMode` select a small number of explicit signal-path variants implemented directly in `engine.rs`.

**Why:** this makes the existing patch field honest now without pretending Grinder already has the graph editor defined in `grinder-modular-rig-graph.md`.

**Rejected:**

- Leaving `routingMode` as metadata until the graph project exists.
  Rejected because the user explicitly asked for delivery instead of placeholder marking.
- Expanding straight into the graph implementation here.
  Rejected because it is a much larger architecture project than this bounded control-truth slice.

### Decision: make `cabIrId` select built-in voices first

**Chosen:** map `cabIrId` to a documented built-in cabinet library.

**Why:** `CabinetConvolver` already has multiple built-in voices, so this is the lowest-risk way to make the field real immediately.

**Rejected:**

- User IR asset loading in this phase.
  Rejected because it expands into file management, persistence, validation, and asset lifecycle concerns.

## Acceptance criteria

- [x] A bridge test proves `cabType`, `cabIrId`, and `routingMode` sync to the audio engine on patch load.
- [x] A Grinder panel test proves the Cab section renders cabinet voice, cabinet mode, and route preset controls.
- [x] A DSP test proves different `cabIrId` selections produce different output.
- [x] A DSP test proves different `cabType` selections produce different output.
- [x] A DSP test proves at least two non-serial routing presets produce different output than `serial`.
- [x] `cargo test -p daw-dsp grinder::` passes.
- [x] `pnpm test:run src/modules/Grinder` passes.
- [x] `pnpm typecheck` passes.

## Implementation notes

- Cabinet voice selection can stay built-in and string-mapped in phase 9; the important point is that `cabIrId` reaches the DSP and changes the sound.
- The four routing presets should be explicit and documented in code/UI copy so the current bounded meaning is clear.
- Keep the Cab UI additions lightweight and consistent with the current Control Deck style.

## Test plan

- [x] Add a failing bridge test for routing/cabinet sync.
- [x] Add a failing Cab UI test for the new route/cab selectors.
- [x] Add failing DSP tests for cabinet voice selection, cabinet mode selection, and routing preset audibility.
- [x] Run targeted Vitest and Grinder DSP tests first.
- [x] Run full Grinder validation and `pnpm typecheck`.

## Open questions

- [ ] **[MINOR]** Should a later phase rename `routingMode` to something more explicitly “preset-like” if the graph project stays deferred for a long time?

## Tradeoffs and risks

- This phase makes the current patch contract honest, but it does not provide arbitrary user-defined routing.
- `dual-amp` in a fixed architecture will necessarily be a derived second lane rather than a fully independent editable amp branch.
- If the routing presets are too subtle, the control will still feel fake; if they are too aggressive, they may feel gimmicky. The regressions should guard against “no audible difference” first.
