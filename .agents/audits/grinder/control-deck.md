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
- The Cab section now exposes a direct `Room` control in the control deck, and the cabinet DSP uses `mic1Distance`, `mic2Distance`, and `roomAmount` to produce audibly different output in `src/modules/Grinder/presentations/views/GrinderPanel.tsx` and `crates/daw-dsp/src/grinder/cabinet.rs`.
- The Neural hero area now renders signal-path/status information instead of a second duplicated Engine Mode card deck, but model-library selection still only updates patch metadata in `src/modules/Grinder/presentations/views/GrinderPanel.tsx` and `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts`.
- Preset browsing is derived directly from `GRINDER_PRESETS`, whose categories now include `Metal` alongside `Clean`, `Crunch`, `High Gain`, `Lead`, `Pedal`, and `Performance` in `src/modules/Grinder/useCases/grinderPresets.ts`.
- Patch-to-audio synchronization is still selective, but it now includes explicit supported pedal-order params through `syncGrinderPatchToAudio()` plus snapshot-triggered patch resync in `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts`, `moveGrinderPedalInChainWithAudio.ts`, and `recallGrinderSnapshotWithAudio.ts`.
- Snapshots are now real recallable rig scenes. Grinder store keeps a hidden stable `basePatch`, the Browser rail exposes snapshot buttons when a patch contains them, and recalling a snapshot updates both `activeSnapshot` and the live audio path in `src/modules/Grinder/stores/grinderStore.ts` and `src/modules/Grinder/presentations/views/GrinderPanel.tsx`.
- Distortion and fuzz are materially more controlled than before. Their pedal cores now use input conditioning plus a bounded 2x-oversampled nonlinear stage, moderate settings stay within tested loudness bounds, and fuzz settles near silence instead of emitting a residual signal bed on silence input in `crates/daw-dsp/src/grinder/pedals.rs`.
- The later amp path is incrementally more honest than before. High-gain preamp/power-amp sample-rate guardrails now exist, and `powerAmpBias` in `crates/daw-dsp/src/grinder/power_amp.rs` now changes crossover width, asymmetry, and effective headroom enough to be audible instead of reading as a dead control.
- Several visible or stored concepts remain metadata-only or partially wired. `neuralModelId`, `neuralModelName`, and `neuralModelFamily` are stored in the patch and updated by the Model Browser, but they still do not reach Rust DSP as distinct model-loading behavior.

## Findings

- Grinder has real DSP ambition, but it is not yet an expert-grade guitar-amp product. The panel presents several controls as if they were production-ready while the underlying behavior ranges from desynced UI state to placeholder metadata to incomplete cabinet/neural feature wiring.
- The remaining high-impact user-facing problems are now mostly broader sonic-completeness issues rather than raw UI-state lies. Phase 1 fixed pedal-state truth and gate operability; phase 2 reduced the worst overdrive loudness explosion, deepened/faster-closed the gate, removed the duplicated Neural hero cards, and added metal coverage plus regression tests.
- Phase 3 closed two more workflow-truth gaps: supported pre-pedal order is now audible and user-visible instead of decorative array metadata, and stored snapshots now recall against a stable base rig instead of sitting dead in the patch model.
- Overdrive is materially more usable than before. A new DSP regression test now proves moderate settings stay in a sane loudness range relative to bypass instead of jumping to roughly `6.2x` bypass loudness as the old implementation did.
- The gate now behaves more like a real high-gain gate once enabled. It closes to a much deeper floor and snaps shut decisively after the hold/release logic has decided the note is gone, though the default init patch still keeps the gate disabled.
- The Neural tab is more honest than before, but not yet fully honest. The duplicated Mode guide is gone, yet the model browser is still metadata-first because no real model-loading path exists in the DSP bridge.
- Snapshots and supported chain order are no longer fake fields. The remaining fake/decorative areas are now concentrated in Neural/Cab/routing and in broader tone completeness, not in the just-implemented live-rig basics.
- Cabinet spatial controls are materially more honest than before. `mic1Distance`, `mic2Distance`, and `roomAmount` now change the rendered cabinet output via direct-level/top-end shaping plus lightweight room reflections, though this is still a bounded realism pass rather than a full room/capture system.
- Phase 5 removed the most obvious front-end high-gain breakage. Distortion no longer jumps to roughly `7.5x` bypass loudness at moderate settings, fuzz no longer jumps to roughly `13.7x`, and fuzz no longer produces a steady non-zero output on silence in the pedal unit tests.
- Phase 6 found that the clearest later-stage miss was not sample-rate stability but control truth: the new failing test showed `powerAmpBias` changing the response by only about `0.00079` on average before the fix, which is effectively decorative.
- Targeted coverage is materially better than before. DSP tests now cover overdrive/distortion/fuzz loudness sanity, fuzz silence behavior, gate closure depth, supported pedal order, cabinet distance/room audibility, later-stage sample-rate stability, and power-amp bias audibility, while UI/preset tests cover Neural non-duplication, metal taxonomy, snapshot UI, chain order, and the new room control. Real Neural model loading still lacks regression coverage.

## Priorities

1. `I-06` Continue the later amp-stage pass beyond bias truth, especially deeper triode/preamp and power-amp voicing.
2. `I-04` Deliver real Neural model loading and routing behavior behind the remaining decorative controls.
3. `I-07` Make the remaining stored patch concepts audibly real end-to-end instead of metadata-only.

## Open issues

1. **The later amp stages are still the main remaining tone risk even after the bias fix.**
   Problem: phase 5 stabilized the front-end distortion/fuzz pedals and phase 6 made `powerAmpBias` materially real, but the broader triode/preamp and power-amp voicing still remains the highest-risk area for "artifacty and weird" amp tone when those stages are doing most of the work.
   Representative files: `crates/daw-dsp/src/grinder/triode.rs`, `crates/daw-dsp/src/grinder/power_amp.rs`.
   Needed: audit and retune the later amp stages around reference amp behavior and decide whether those stages need their own explicit alias-mitigation strategy.

2. **The Neural tab is no longer duplicated, but the model browser is still mostly decorative.**
   Problem: the hero-side Mode guide duplication is fixed, but model selection still only changes patch metadata plus placement. `neuralModelId`, `neuralModelName`, and `neuralModelFamily` are not part of the audio-sync path, and the Rust neural engine still has no model-loading API in this flow. The UI is less misleading than before, but the browser still does not load distinct capture content.
   Representative files: `src/modules/Grinder/presentations/views/GrinderPanel.tsx`, `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts`, `crates/daw-dsp/src/grinder/neural.rs`.
   Needed: add a real model-loading path from browser selection through the bridge into distinct neural capture behavior.

3. **Routing-style controls and broader cabinet contracts are still incomplete.**
   Problem: phase 4 made mic distances and room amount real, but `routingMode` still reaches the bridge without any routing implementation in `engine.rs`, and `cabType` / `cabIrId` still imply cabinet-selection behaviors that this path does not complete. The cabinet UI is more honest now, but the patch contract still advertises more cabinet/routing flexibility than the current engine supports.
   Representative files: `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts`, `crates/daw-dsp/src/grinder/engine.rs`, `src/modules/Grinder/models/GrinderPatch.ts`.
   Needed: complete the routing and cabinet-selection behaviors implied by `routingMode`, `cabType`, and `cabIrId` so those controls change the live signal path.

4. **Some patch concepts are still stale or fake at the data-model layer.**
   Problem: `inputMode` is passed from the engine to `InputConditioner`, but `InputConditioner::set_param()` ignores it. `neuralModelId/name/family`, `cabType`, `cabIrId`, and `routingMode` still make the patch shape look more complete than the current audible implementation really is. Phase 3 removed `snapshots` and `activeSnapshot` from this bucket by making them real recall features.
   Representative files: `src/modules/Grinder/models/GrinderPatch.ts`, `crates/daw-dsp/src/grinder/engine.rs`, `crates/daw-dsp/src/grinder/input.rs`.
   Needed: make the remaining stored fields audibly real so the patch contract matches what the runtime can actually do.

## Open questions

- Is the separate user report about clip side-to-side movement precision an Arrangement/editor snapping issue, or is there a hidden Grinder/cab mic interaction the user is describing imprecisely? This audit did not find a Grinder code path that matches "line up audio clips perfectly."
- Does product want Grinder to emulate real, referenceable amp/pedal behavior, or is it allowed to be a stylized "weird" amp effect? The current UI language and preset naming imply realism, but several DSP/UX choices behave more like an experimental effect.
- Should the gate behave like a traditional high-gain guitar gate (very deep attenuation, fast clamp) or like a softer expander? Current DSP and UI copy do not make that choice explicit.

## Risks

- The remaining later amp stages can still sound fizzy or artifact-prone even after the front-end pedal fixes, which keeps the core "is this a credible amp?" question open.
- The cabinet controls are more trustworthy now, but users may still infer richer routing/cabinet-model behavior than actually exists if the remaining placeholder fields stay exposed.
- Weak coverage still exists around real Neural model loading and broader gain-stage behavior, so regressions can still slip through outside the narrowed areas already fixed.

## Suggested approaches

- Continue from the pedal fixes into the later amp stages: preamp/triode and power amp are now the highest-value tone work.
- Complete the remaining Neural/routing features end-to-end rather than leaving metadata-only controls in place.
- Keep expanding expert-oriented regression tests: pedal enable semantics, gate attenuation behavior, cabinet distance/room audibility, neural model loading, and later gain-stage behavior.

## Recommendation

Phase 5 stabilized the front-end high-gain pedals. The next move should still be `I-06`, but now focused on the later amp stages: retune the preamp/triode and power-amp nonlinear path so Grinder sounds more like a credible guitar amp and less like a brittle artifact machine.

## Resolved

- ~~Control Deck pedal toggles did not persist as active in UI state.~~ — resolved in `main` on `2026-04-23` by storing pedal enable state on `pedal.enabled` and covering it with a store-level regression test.
- ~~The Lab section had no explicit gate enable control.~~ — resolved in `main` on `2026-04-23` by adding a visible `Gate On` / `Gate Off` toggle to the Grinder Control Deck.
- ~~Moderate overdrive settings exploded in loudness and behaved more like a broken gain jump than a controllable pedal.~~ — resolved in `main` on `2026-04-23` by recalibrating the overdrive pedal's input gain, clipping, and output compensation and adding a DSP regression test for sane loudness ratio.
- ~~The enabled gate closed too weakly to feel like a real guitar gate.~~ — resolved in `main` on `2026-04-23` by deepening the gate floor and making the closed state clamp decisively once the hold/release logic shuts the gate.
- ~~The Neural hero area duplicated the same Engine Mode cards shown in the Control Deck.~~ — resolved in `main` on `2026-04-23` by replacing the duplicated Mode guide with signal-path/status content and explicit implementation-honesty copy.
- ~~The preset browser had no dedicated metal entry.~~ — resolved in `main` on `2026-04-23` by adding a `Metal` factory preset and regression coverage for metal-category expectations.
- ~~Supported front-end pedal order existed only as patch-array metadata while the DSP path stayed hardcoded.~~ — resolved in `main` on `2026-04-24` by surfacing chain order in the Drive deck, syncing explicit order params through the bridge, and rebuilding supported pedal execution order in the Rust engine.
- ~~`snapshots` and `activeSnapshot` were stored in the patch model but not usable as real rig scenes.~~ — resolved in `main` on `2026-04-24` by introducing `basePatch`-backed snapshot recall in Grinder state plus Browser-rail snapshot controls that resync the live audio patch.
- ~~Cab mic distance and room controls were stored/synced but ignored by the cabinet DSP.~~ — resolved in `main` on `2026-04-24` by adding audibly real distance shaping plus lightweight room reflections in `CabinetConvolver`, exposing a direct `Room` control in the cab deck, and covering both behaviors with regression tests.
- ~~Moderate distortion and fuzz settings produced runaway loudness, and fuzz emitted non-zero output on silence.~~ — resolved in `main` on `2026-04-24` by restructuring both pedals around conditioned, bounded 2x-oversampled nonlinear cores with output compensation and by adding regressions for distortion loudness, fuzz loudness, and fuzz silence behavior.
- ~~`powerAmpBias` barely changed the live power-stage response and behaved like a decorative expert control.~~ — resolved in `main` on `2026-04-24` by rebuilding the bias effect around crossover width, asymmetry, and effective headroom and by adding a regression that proves hot vs cold bias now changes the response audibly.
