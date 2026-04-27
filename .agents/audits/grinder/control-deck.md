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
- The Neural hero area renders signal-path/status information instead of a second duplicated Engine Mode card deck, and built-in model-library selection now loads distinct neural profiles through the bridge into `crates/daw-dsp/src/grinder/neural.rs`.
- Preset browsing is derived directly from `GRINDER_PRESETS`, whose categories now include `Metal` alongside `Clean`, `Crunch`, `High Gain`, `Lead`, `Pedal`, and `Performance` in `src/modules/Grinder/useCases/grinderPresets.ts`.
- Patch-to-audio synchronization is still selective, but it now includes explicit supported pedal-order params through `syncGrinderPatchToAudio()` plus snapshot-triggered patch resync in `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts`, `moveGrinderPedalInChainWithAudio.ts`, and `recallGrinderSnapshotWithAudio.ts`.
- Snapshots are now real recallable rig scenes. Grinder store keeps a hidden stable `basePatch`, the Browser rail exposes snapshot buttons when a patch contains them, and recalling a snapshot updates both `activeSnapshot` and the live audio path in `src/modules/Grinder/stores/grinderStore.ts` and `src/modules/Grinder/presentations/views/GrinderPanel.tsx`.
- Distortion and fuzz are materially more controlled than before. Their pedal cores now use input conditioning plus a bounded 2x-oversampled nonlinear stage, moderate settings stay within tested loudness bounds, and fuzz settles near silence instead of emitting a residual signal bed on silence input in `crates/daw-dsp/src/grinder/pedals.rs`.
- The later amp path is incrementally more honest than before. High-gain preamp/power-amp sample-rate guardrails now exist, `powerAmpBias` in `crates/daw-dsp/src/grinder/power_amp.rs` now changes crossover width, asymmetry, and effective headroom enough to be audible, and phase 10 adds bounded internal 2x substep updates in both `triode.rs` and `power_amp.rs` so the later stages are less brittle under hard drive.
- Later-stage expert controls are less entangled than before. `gridConduction` now changes grid-current intensity and immediate attack loading, `couplingCapCharge` remains the blocking/recovery-memory control, and `rectifierType` now survives the normal patch sync order instead of being mostly erased once `sagRecovery` is applied afterward.
- Built-in neural model selection is now materially real. `neuralModelId` maps to a `neuralModelSlot` bridge param, and the Rust neural engine now loads distinct built-in profiles that produce measurably different output for the same stimulus.
- Several visible or stored concepts remain partially wired. Neural built-ins, documented NAM imports, and fixed-chain routing/cabinet presets are now real, but later-stage amp voicing and a few remaining data-model promises still lag behind what the product implies.

## Findings

- Grinder has real DSP ambition, but it is not yet an expert-grade guitar-amp product. The panel presents several controls as if they were production-ready while the underlying behavior ranges from desynced UI state to placeholder metadata to incomplete cabinet/neural feature wiring.
- The remaining high-impact user-facing problems are now mostly broader sonic-completeness issues rather than raw UI-state lies. Phase 1 fixed pedal-state truth and gate operability; phase 2 reduced the worst overdrive loudness explosion, deepened/faster-closed the gate, removed the duplicated Neural hero cards, and added metal coverage plus regression tests.
- Phase 3 closed two more workflow-truth gaps: supported pre-pedal order is now audible and user-visible instead of decorative array metadata, and stored snapshots now recall against a stable base rig instead of sitting dead in the patch model.
- Overdrive is materially more usable than before. A new DSP regression test now proves moderate settings stay in a sane loudness range relative to bypass instead of jumping to roughly `6.2x` bypass loudness as the old implementation did.
- The gate now behaves more like a real high-gain gate once enabled. It closes to a much deeper floor and snaps shut decisively after the hold/release logic has decided the note is gone, though the default init patch still keeps the gate disabled.
- The Neural tab is more honest than before. The duplicated Mode guide is gone, and the built-in model browser now swaps distinct neural profiles in the live DSP path.
- Phase 8 closes the next major Neural honesty gap. The modal can now import documented NAM `.nam` files, persist reusable imported captures locally, and send the selected imported profile into the live DSP path as a structured custom profile instead of stopping at built-in slots.
- Snapshots and supported chain order are no longer fake fields. The remaining fake/decorative areas are now concentrated in Neural/Cab/routing and in broader tone completeness, not in the just-implemented live-rig basics.
- Cabinet spatial controls are materially more honest than before. `mic1Distance`, `mic2Distance`, and `roomAmount` now change the rendered cabinet output via direct-level/top-end shaping plus lightweight room reflections, though this is still a bounded realism pass rather than a full room/capture system.
- Phase 9 closes the next Control Deck contract gap. `cabType` now selects IR-only vs parametric-speaker-only vs combined cabinet rendering, `cabIrId` now selects a real built-in cabinet voice, and `routingMode` now selects bounded fixed-chain routing presets that audibly differ in the live engine.
- Phase 5 removed the most obvious front-end high-gain breakage. Distortion no longer jumps to roughly `7.5x` bypass loudness at moderate settings, fuzz no longer jumps to roughly `13.7x`, and fuzz no longer produces a steady non-zero output on silence in the pedal unit tests.
- Phase 6 found that the clearest later-stage miss was not sample-rate stability but control truth: the new failing test showed `powerAmpBias` changing the response by only about `0.00079` on average before the fix, which is effectively decorative.
- Phase 10 closes two more later-stage truth gaps. The new failing tests showed `gridConduction` changing hard-attack clamping by exactly `0` before the fix and `rectifierType` collapsing to the same sag envelope under normal patch-sync ordering (`tube_sag=0.99852294`, `solid_sag=0.99852294`).
- After the phase 10 retune, Grinder now has explicit regression coverage for hard-attack grid-conduction behavior, coupling-cap recovery behavior, and rectifier burst-sag differentiation in addition to the earlier later-stage bias and sample-rate tests.
- Phase 7 removed the most obvious remaining Neural honesty gap. Built-in library entries now sync a real `neuralModelSlot`, different built-in profiles produce different DSP output, and the Neural panel copy no longer claims the browser is metadata-only.
- Imported Neural selections are now project-portable instead of depending on hidden local state. The selected imported profile is embedded into the patch and also persisted in a reusable local library, which avoids wrong-sound playback when the modal library has not hydrated yet.
- Targeted coverage is materially better than before. DSP tests now cover overdrive/distortion/fuzz loudness sanity, fuzz silence behavior, gate closure depth, supported pedal order, cabinet distance/room audibility, cabinet voice selection, cabinet mode selection, routing preset audibility, later-stage sample-rate stability, power-amp bias audibility, built-in neural model distinctness, and imported neural profile distinctness, while UI/preset tests cover Neural non-duplication, built-in/imported Neural honesty, metal taxonomy, snapshot UI, chain order, room control, and the new cab voice/mode/routing selectors.

## Priorities

1. `I-06` Continue the later amp-stage pass beyond control truth into broader reference voicing, especially deeper triode/preamp and power-amp tone shaping.
2. `I-07` Make the remaining stored patch concepts audibly real end-to-end instead of metadata-only.
3. `I-05` Extend external Neural delivery beyond NAM-first compact-profile import into fuller model/runtime coverage and management.

## Open issues

1. **The later amp stages are still the main remaining tone risk even after phases 6 and 10.**
   Problem: phase 5 stabilized the front-end distortion/fuzz pedals, phase 6 made `powerAmpBias` materially real, and phase 10 split later-stage control behaviors more honestly, but the broader triode/preamp and power-amp voicing still remains the highest-risk area for "artifacty and weird" amp tone when those stages are doing most of the work.
   Representative files: `crates/daw-dsp/src/grinder/triode.rs`, `crates/daw-dsp/src/grinder/power_amp.rs`.
   Needed: continue retuning the later amp stages around reference amp behavior now that bounded alias-mitigation and control separation are in place.

2. **The external Neural path is now real, but it is still a bounded compact-profile implementation rather than full third-party runtime parity.**
   Problem: phase 8 delivers documented NAM import, reusable local library state, patch-portable imported profiles, and live DSP application, but it still derives a compact Grinder profile rather than loading the original external model architecture at full fidelity. There is still no AIDA-X import, no raw-source retention/export path, and no richer asset management beyond import/list/select.
   Representative files: `src/modules/Grinder/services/parseGrinderNamFile.ts`, `src/modules/Grinder/repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary.ts`, `crates/daw-dsp/src/grinder/neural.rs`.
   Needed: decide whether the next Neural phase should pursue higher-fidelity NAM runtime behavior, broader format support, or richer imported-model lifecycle operations.

3. **Some patch concepts are still stale or fake at the data-model layer.**
   Problem: `inputMode` is passed from the engine to `InputConditioner`, but `InputConditioner::set_param()` ignores it. Phase 3 removed `snapshots` and `activeSnapshot` from this bucket by making them real recall features, phase 8 did the same for imported neural selection state, and phase 9 did the same for `cabType`, `cabIrId`, and `routingMode`.
   Representative files: `src/modules/Grinder/models/GrinderPatch.ts`, `crates/daw-dsp/src/grinder/engine.rs`, `crates/daw-dsp/src/grinder/input.rs`.
   Needed: make the remaining stored fields audibly real so the patch contract matches what the runtime can actually do.

## Open questions

- Is the separate user report about clip side-to-side movement precision an Arrangement/editor snapping issue, or is there a hidden Grinder/cab mic interaction the user is describing imprecisely? This audit did not find a Grinder code path that matches "line up audio clips perfectly."
- Does product want Grinder to emulate real, referenceable amp/pedal behavior, or is it allowed to be a stylized "weird" amp effect? The current UI language and preset naming imply realism, but several DSP/UX choices behave more like an experimental effect.
- Should the gate behave like a traditional high-gain guitar gate (very deep attenuation, fast clamp) or like a softer expander? Current DSP and UI copy do not make that choice explicit.

## Risks

- The remaining later amp stages can still sound fizzy or artifact-prone even after the front-end pedal fixes and phase 10 control-separation work, which keeps the core "is this a credible amp?" question open.
- The new routing presets are honest within the fixed chain, but they are still bounded presets rather than arbitrary user-authored split/merge routing.
- The external Neural path is now covered, but the compact imported-profile derivation can still collapse too much source-model nuance if later comparison listening shows imports feeling overly interchangeable.
- Broader gain-stage coverage is still weaker than the newer Neural/cabinet regressions, so sonic regressions can still slip through in later amp-stage work.

## Suggested approaches

- Continue from the control-truth fixes into deeper later amp voicing: preamp/triode and power amp are still the highest-value tone work.
- Revisit external Neural fidelity after routing truth: raw model retention, richer asset management, and broader format support are the next logical Neural expansions.
- Make the remaining data-model lies like `inputMode` real so the patch contract keeps shrinking toward what the DSP actually does.
- Keep expanding expert-oriented regression tests: pedal enable semantics, gate attenuation behavior, cabinet distance/room audibility, neural model loading, and later gain-stage behavior.

## Recommendation

Phase 10 reduces the later-stage control-truth gap, but the next move should still be `I-06`: continue retuning the later amp stages in `triode.rs` and `power_amp.rs` so Grinder sounds more like a credible guitar amp and less like a brittle artifact machine. After that, the cleanest remaining contract-cleanup target is `inputMode`.

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
- ~~The Neural model browser only changed metadata and did not load distinct DSP voices.~~ — resolved in `main` on `2026-04-25` by bridging `neuralModelId` into a real `neuralModelSlot`, loading distinct built-in profiles inside `NeuralCapture`, and covering both bridge sync and DSP distinctness with regressions.
- ~~The Neural modal stopped at built-in voices and could not import or persist external captures.~~ — resolved in `main` on `2026-04-26` by importing documented NAM `.nam` files into a reusable local library, embedding selected imported profiles into the patch, and applying them through structured worklet-to-Rust custom-profile sync.
- ~~`routingMode`, `cabType`, and `cabIrId` existed in the patch contract without changing the live cabinet/routing path.~~ — resolved in `main` on `2026-04-26` by syncing cabinet mode and built-in cab voice selection through the bridge, exposing those controls in the Cab UI, and implementing bounded routing presets plus cabinet mode/voice selection inside `GrinderEngine`.
- ~~`gridConduction` did not behave like a real independent later-stage control, and `rectifierType` lost most of its identity once normal sag params were synced afterward.~~ — resolved in `main` on `2026-04-27` by separating grid-current intensity from coupling-cap recovery behavior in `TriodeStage`, adding bounded internal 2x substep updates to the later amp stages, and deriving rectifier sag behavior from persistent base sag settings so tube / solid-state / variac modes now diverge under burst load.
