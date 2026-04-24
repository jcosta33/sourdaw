# Grinder Control Deck Audit

## Scope

This audit covers the current Grinder plugin implementation from the perspective of a guitar-amp workflow: the Control Deck UI, Neural tab, preset browser, state/bridge wiring, and the audible DSP stages behind the amp, pedals, gate, cabinet, and neural sections.

It explicitly excludes a deep investigation of timeline clip-alignment precision. The user-reported "move clips side to side" problem appears to belong to Arrangement/editing behavior rather than the Grinder module and should be audited separately unless a later trace ties it back to this plugin.

## Goal

Grinder should behave like a trustworthy guitar-amp product: controls stay visually in sync with the sound, the gain structure is usable rather than chaotic, visible controls map to audible DSP changes, the Neural tab is informative without duplicated filler, and preset/test coverage reflects real guitar workflows such as metal/high-gain use.

## Relevant code paths

- `src/modules/Grinder/presentations/views/GrinderPanel.tsx`
- `src/modules/Grinder/stores/grinderStore.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderPedalParamWithAudio.ts`
- `src/modules/Grinder/useCases/grinderPresets.ts`
- `src/modules/Grinder/models/GrinderPatch.ts`
- `src/modules/AudioEngine/services/grinderProcessor.ts`
- `crates/daw-dsp/src/grinder/engine.rs`
- `crates/daw-dsp/src/grinder/input.rs`
- `crates/daw-dsp/src/grinder/pedals.rs`
- `crates/daw-dsp/src/grinder/triode.rs`
- `crates/daw-dsp/src/grinder/power_amp.rs`
- `crates/daw-dsp/src/grinder/cabinet.rs`
- `src/modules/Grinder/presentations/views/__tests__/GrinderPanel.spec.tsx`
- `src/modules/Grinder/useCases/grinderParamBridge/__tests__/setGrinderPedalParamWithAudio.spec.ts`

## Current behavior

- Grinder is implemented as a real stage-based chain. The DSP runs input conditioning, noise gate, pre pedals, triode preamp, tone stack, power amp, transformer, cabinet convolution, speaker model, optional post pedals, neural blend, and output limiting in `crates/daw-dsp/src/grinder/engine.rs`.
- The Control Deck changes shape by `uiSection`. `drive` now renders both the front-end chain-order strip and the four pedal cards, `neural` renders Engine Mode / Capture Role / Model Browser, and `lab` includes an explicit gate enable toggle plus advanced amp controls in `src/modules/Grinder/presentations/views/GrinderPanel.tsx`.
- The Neural hero area now renders signal-path/status information instead of a second duplicated Engine Mode card deck, but model-library selection still only updates patch metadata in `src/modules/Grinder/presentations/views/GrinderPanel.tsx` and `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts`.
- Preset browsing is derived directly from `GRINDER_PRESETS`, whose categories now include `Metal` alongside `Clean`, `Crunch`, `High Gain`, `Lead`, `Pedal`, and `Performance` in `src/modules/Grinder/useCases/grinderPresets.ts`.
- Patch-to-audio synchronization is still selective, but it now includes explicit supported pedal-order params through `syncGrinderPatchToAudio()` plus snapshot-triggered patch resync in `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts`, `moveGrinderPedalInChainWithAudio.ts`, and `recallGrinderSnapshotWithAudio.ts`.
- Snapshots are now real recallable rig scenes. Grinder store keeps a hidden stable `basePatch`, the Browser rail exposes snapshot buttons when a patch contains them, and recalling a snapshot updates both `activeSnapshot` and the live audio path in `src/modules/Grinder/stores/grinderStore.ts` and `src/modules/Grinder/presentations/views/GrinderPanel.tsx`.
- Several visible or stored concepts remain metadata-only or partially wired. `neuralModelId`, `neuralModelName`, and `neuralModelFamily` are stored in the patch and updated by the Model Browser, but they still do not reach Rust DSP as distinct model-loading behavior.

## Findings

- Grinder has real DSP ambition, but it is not yet an expert-grade guitar-amp product. The panel presents several controls as if they were production-ready while the underlying behavior ranges from desynced UI state to placeholder metadata to incomplete cabinet/neural feature wiring.
- The remaining high-impact user-facing problems are now mostly broader sonic-completeness issues rather than raw UI-state lies. Phase 1 fixed pedal-state truth and gate operability; phase 2 reduced the worst overdrive loudness explosion, deepened/faster-closed the gate, removed the duplicated Neural hero cards, and added metal coverage plus regression tests.
- Phase 3 closed two more workflow-truth gaps: supported pre-pedal order is now audible and user-visible instead of decorative array metadata, and stored snapshots now recall against a stable base rig instead of sitting dead in the patch model.
- Overdrive is materially more usable than before. A new DSP regression test now proves moderate settings stay in a sane loudness range relative to bypass instead of jumping to roughly `6.2x` bypass loudness as the old implementation did.
- The gate now behaves more like a real high-gain gate once enabled. It closes to a much deeper floor and snaps shut decisively after the hold/release logic has decided the note is gone, though the default init patch still keeps the gate disabled.
- The Neural tab is more honest than before, but not yet fully honest. The duplicated Mode guide is gone, yet the model browser is still metadata-first because no real model-loading path exists in the DSP bridge.
- Snapshots and supported chain order are no longer fake fields. The remaining fake/decorative areas are now concentrated in Neural/Cab/routing and in broader tone completeness, not in the just-implemented live-rig basics.
- Cabinet/mic controls are also only partially real. `mic1Distance`, `mic2Distance`, and `roomAmount` are accepted and stored, but the cabinet processor never reads them inside `process_sample()`.
- Targeted coverage is materially better than before. DSP tests now cover overdrive loudness sanity and gate closure depth, while UI/preset tests cover Neural non-duplication and metal taxonomy. Cabinet audibility and real Neural model loading still lack regression coverage.

## Priorities

1. `I-04` Remove fake or decorative Neural/Cab controls, or wire them to real DSP behavior.
2. `I-06` Audit the remaining nonlinear drive stages beyond overdrive, especially distortion/fuzz and later amp stages, for artifact-prone behavior.
3. `I-07` Reduce the patch/model contract to what is actually real today.

## Open issues

1. **The broader drive stack is still artifact-prone beyond the overdrive fix.**
   Problem: overdrive has been recalibrated, but distortion, fuzz, preamp, and power-amp nonlinearities still run directly at the sample rate with no visible oversampling or anti-alias stage in these paths. Under high-gain settings the product can still drift into fizzy, brittle behavior even though the most explosive overdrive loudness bug is now gone.
   Representative files: `crates/daw-dsp/src/grinder/pedals.rs`, `crates/daw-dsp/src/grinder/triode.rs`, `crates/daw-dsp/src/grinder/power_amp.rs`.
   Needed: audit and retune the remaining nonlinear stages around reference amp/pedal behavior and decide whether an anti-alias strategy is required for Grinder to be credible as a guitar amp.

2. **The Neural tab is no longer duplicated, but the model browser is still mostly decorative.**
   Problem: the hero-side Mode guide duplication is fixed, but model selection still only changes patch metadata plus placement. `neuralModelId`, `neuralModelName`, and `neuralModelFamily` are not part of the audio-sync path, and the Rust neural engine still has no model-loading API in this flow. The UI is less misleading than before, but the browser still does not load distinct capture content.
   Representative files: `src/modules/Grinder/presentations/views/GrinderPanel.tsx`, `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts`, `crates/daw-dsp/src/grinder/neural.rs`.
   Needed: either add a real model-loading path or downgrade/remove the browser interaction so it no longer behaves like a full model selector.

3. **Several cabinet and routing-style controls are placeholders or only partially wired.**
   Problem: the bridge syncs `routingMode`, `micBlend`, `roomAmount`, and mic distances, but `engine.rs` has no `routingMode` case at all, and `CabinetConvolver::process_sample()` never reads `mic_1_distance`, `mic_2_distance`, or `room_amount`. The cabinet UI therefore suggests spatial mic-room behavior that does not exist in the current DSP implementation.
   Representative files: `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts:22-77,217-228`, `crates/daw-dsp/src/grinder/engine.rs:95-149`, `crates/daw-dsp/src/grinder/cabinet.rs:16-30,147-205`.
   Needed: remove or disable placeholder controls until they are real, or finish the DSP implementation so distance, room, and routing have audible consequences that match the UI.

4. **Some patch concepts are still stale or fake at the data-model layer.**
   Problem: `inputMode` is passed from the engine to `InputConditioner`, but `InputConditioner::set_param()` ignores it. `neuralModelId/name/family`, `cabType`, `cabIrId`, and `routingMode` still make the patch shape look more complete than the current audible implementation really is. Phase 3 removed `snapshots` and `activeSnapshot` from this bucket by making them real recall features.
   Representative files: `src/modules/Grinder/models/GrinderPatch.ts`, `crates/daw-dsp/src/grinder/engine.rs`, `crates/daw-dsp/src/grinder/input.rs`.
   Needed: reduce the contract to what is real today or explicitly mark placeholder fields/features so future work does not keep shipping decorative controls.

## Open questions

- Is the separate user report about clip side-to-side movement precision an Arrangement/editor snapping issue, or is there a hidden Grinder/cab mic interaction the user is describing imprecisely? This audit did not find a Grinder code path that matches "line up audio clips perfectly."
- Does product want Grinder to emulate real, referenceable amp/pedal behavior, or is it allowed to be a stylized "weird" amp effect? The current UI language and preset naming imply realism, but several DSP/UX choices behave more like an experimental effect.
- Should the gate behave like a traditional high-gain guitar gate (very deep attenuation, fast clamp) or like a softer expander? Current DSP and UI copy do not make that choice explicit.

## Risks

- The remaining high-gain stack can still sound fizzy or artifact-prone even after the overdrive fix, which keeps the core "is this a credible amp?" question open.
- Decorative Neural/Cab/routing controls still create reputational risk because the UI suggests features that are not actually implemented.
- Weak coverage still exists around cabinet audibility, real model loading, and broader gain-stage behavior, so regressions can still slip through outside the narrowed areas already fixed.

## Suggested approaches

- Fix the state contract first: UI state must tell the truth about whether pedals and gate are active.
- Decide which Grinder features are real today versus aspirational, then either wire them end-to-end or remove/disable them from the UI.
- Revoice the gain structure using reference amp/pedal targets and add anti-alias strategy before spending time on cosmetic preset shuffling.
- Rebuild the Neural page around what the engine can actually do today; add real model loading later under a separate spec if needed.
- Add expert-oriented regression tests: pedal enable semantics, gate attenuation behavior, cabinet distance/room audibility, and preset-category expectations.

## Recommendation

Phase 3 made the current live rig materially more honest and usable without overbuilding. The next move should be `I-04`: either wire the remaining Neural/Cab controls to real DSP behavior or stop presenting them like finished product features.

## Resolved

- ~~Control Deck pedal toggles did not persist as active in UI state.~~ — resolved in `main` on `2026-04-23` by storing pedal enable state on `pedal.enabled` and covering it with a store-level regression test.
- ~~The Lab section had no explicit gate enable control.~~ — resolved in `main` on `2026-04-23` by adding a visible `Gate On` / `Gate Off` toggle to the Grinder Control Deck.
- ~~Moderate overdrive settings exploded in loudness and behaved more like a broken gain jump than a controllable pedal.~~ — resolved in `main` on `2026-04-23` by recalibrating the overdrive pedal's input gain, clipping, and output compensation and adding a DSP regression test for sane loudness ratio.
- ~~The enabled gate closed too weakly to feel like a real guitar gate.~~ — resolved in `main` on `2026-04-23` by deepening the gate floor and making the closed state clamp decisively once the hold/release logic shuts the gate.
- ~~The Neural hero area duplicated the same Engine Mode cards shown in the Control Deck.~~ — resolved in `main` on `2026-04-23` by replacing the duplicated Mode guide with signal-path/status content and explicit implementation-honesty copy.
- ~~The preset browser had no dedicated metal entry.~~ — resolved in `main` on `2026-04-23` by adding a `Metal` factory preset and regression coverage for metal-category expectations.
- ~~Supported front-end pedal order existed only as patch-array metadata while the DSP path stayed hardcoded.~~ — resolved in `main` on `2026-04-24` by surfacing chain order in the Drive deck, syncing explicit order params through the bridge, and rebuilding supported pedal execution order in the Rust engine.
- ~~`snapshots` and `activeSnapshot` were stored in the patch model but not usable as real rig scenes.~~ — resolved in `main` on `2026-04-24` by introducing `basePatch`-backed snapshot recall in Grinder state plus Browser-rail snapshot controls that resync the live audio patch.
