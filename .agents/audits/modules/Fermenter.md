# Fermenter module audit

## Scope

This audit covers `src/modules/Fermenter/` and `crates/daw-dsp/src/fermenter/`.
It includes the TypeScript patch model, store, use cases, UI components, Rust
DSP engines, and test coverage. It excludes the generic AudioEngine device host
except where Fermenter calls it through `updateDeviceParam` /
`updateDevicePatch`.

Related spec/research:

- `.agents/specs/implemented/fermenter.md`
- `.agents/research/factory/fermenter.md`

External reference baselines checked on 2026-04-28:

- Kilohearts Phase Plant docs/product pages (`https://kilohearts.com/docs/phase_plant`,
  `https://kilohearts.com/products/phase_plant`): semi-modular generators, effect lanes,
  open-ended modulation, audio-rate modulation, generator groups, unison.
- Arturia Pigments product page (`https://www.arturia.com/products/analog-classics/pigments/overview`):
  multi-engine architecture, dual filters,
  advanced modulation, sequencing, FX buses.
- Spectrasonics Omnisphere product page (`https://www.spectrasonics.net/products/omnisphere/`):
  four-layer architecture, granular,
  morphing wavetables, FM/ring modulation, extensive LFO/envelope system,
  performance layer modes.
- u-he Zebra 3 / Zebralette 3 product pages (`https://u-he.com/products/synths/zebra3/`,
  `https://u-he.com/products/freeware/zebralette/`): spline/wavetable/additive oscillators,
  oscillator effects, modal/comb physical modeling, modulation math, MPE /
  microtuning.

## Goal

Fermenter should be a credible flagship synth rather than a UI shell around a
collection of partially connected controls:

- Patch parameter names, UI controls, persisted device params, and Rust DSP
  names must align one-to-one.
- Each engine advertised in the patch model should produce audible,
  tested output with meaningful controls.
- Layering should behave like layered synthesis, not just a UI edit target.
- Modulation and macros should affect sound, persist correctly, and be testable.
- DSP code should be real-time safe and have Fermenter-specific regressions.
- The UI should expose the actual synth contract without overclaiming features
  that are only metadata or weak approximations.

## Current State

Fermenter is structurally broad. The TypeScript patch model exposes seven
engines (`Wavetable`, `Analog`, `FM`, `String`, `Granular`, `Additive`,
`Sampler`), unison, spectral warp, audio-rate modulation, envelopes, LFO,
MSEG, step sequencer, global FX, chaos, macros, and four layers. The UI has
sections for oscillator, filter, envelopes, modulation, FX, layer stack,
signal flow, scopes, meters, preset browser, macros, and a transform pad.

The Rust DSP side has modules for additive, chaos, effects, envelopes,
filters, FM, granular, layer, LFO, modulation, MSEG, noise, oscillator,
physical modeling, sampler, spectral warp, step sequencing, synth, and voice.
`MasterSynth` owns four `Layer`s and global FX. `Voice` owns multiple engine
objects and renders one selected engine per active voice.

Tests exist heavily on the TS presentation/use-case side. Rust now has a small
Fermenter-specific regression base: `cargo test -p daw-dsp fermenter::` runs
four tests covering mapped layer params, mapped global params, and finite
non-silent note rendering.

## Findings

1. **The TS-to-Rust parameter contract is now explicit at the Fermenter audio bridge.**
   The TS model still exposes camelCase IDs (`oscEngine`, `filterCutoff`,
   `oscDrift`, `portamentoTime`, etc.), while the Rust `set_param` paths are
   snake_case (`engine`, `cutoff`, `drift`, `portamento`, etc.). The Fermenter
   param bridge now maps param and patch updates to declared DSP IDs before
   calling `updateDeviceParam` / `updateDevicePatch`, while persistence keeps
   the original patch keys. Tests assert every public `FERMENTER_PARAMS` ID maps
   to a declared DSP parameter ID.

2. **`FERMENTER_PARAMS` now exposes the full engine range.** `oscEngine.max`
   was corrected from `1` to `6`, matching the seven engines in `ENGINE_NAMES`.
   A metadata regression test now asserts that the generic parameter range
   stays aligned with the engine list.

3. **Layering now behaves as a playable active stack.** `activeLayer` remains
   the edit target for per-layer parameter changes, while `note_on()` triggers
   every active layer that is playable under mute/solo rules and `note_off()`
   releases the note across active layers. Rust regressions cover two-layer
   triggering, mute/solo filtering, and stacked note release.

4. **Macros now have default performance mappings, but no assignable macro matrix.**
   `setMacro` maps the eight macro labels to concrete patch parameters and
   sends the updated patch through `loadFermenterPatchWithAudio`, so the
   right-rail macro rig and XY pad can affect audio and persistence. Fermenter
   still lacks user-assignable macro targets, depths, curves, and per-preset
   macro routing.

5. **Transform interpolation now keeps discrete selectors discrete.**
   `lerpPatch` interpolates continuous numeric fields, but selector fields such
   as `oscEngine`, `filterModel`, `warpMode`, `reverbType`, `samplerMode`,
   `activeLayer`, and `numLayers` choose the nearest source patch value. Tests
   cover both linear and bilinear morphing so TransformPad no longer emits
   fractional selector states.

6. **MIDI note-on offsets are honored inside the DSP block.** `process_block`
   now renders sub-blocks between MIDI event offsets, so a note at sample 64
   leaves samples before 64 silent and starts rendering at the requested
   offset. Broader note-off and dense-event timing still need musical
   regressions.

7. **Warp is now labeled as time-domain, while true spectral morphing remains missing.**
   The UI-facing label and implementation comments now describe the current
   Sync/Quantize/Squeeze/Bend/Formant/Fold modes as time-domain warp
   processing. The existing research still calls out missing true spectral
   modes such as vocoding, harmonic stretch, smear, spectral filtering, phase
   disperse, and spectral-time skew.

8. **Rust Fermenter has only initial targeted regression tests.** The command
   `cargo test -p daw-dsp fermenter::` now runs eight tests for mapped params,
   basic note rendering, note-on offsets, and layer triggering. This is no
   longer zero coverage, but it is still far below the release gate requiring
   integration tests for every part / section.

9. **Several DSP internals expose dead or incomplete implementation clues.**
   Rust warnings identify `FdnReverb.sample_rate`, `Granular::Grain.position`,
   and `SamplerEngine.crossfade` as unread. These are not automatically bugs,
   but in an audit of a flagship synth they correlate with incomplete granular,
   sampler, and reverb promises.

10. **Parameter mutation is rAF-batched for audio updates.** This is good for UI
    churn, but it is not a sample-accurate or automation-grade path. If the same
    use case is used for automation or performance gestures, high-rate changes
    are collapsed to one per animation frame.

## Priorities

1. Expand Fermenter-specific Rust DSP tests for engine selection and per-engine
   audible behavior.
2. Expand macro handling from default mappings into a real assignable macro matrix.
3. Specify and implement true spectral-domain morph modes from the existing
   research.

## Open Issues

### 1. Rust DSP still lacks parameter behavior regressions

**Status:** TypeScript bridge contract resolved by `09006370b`; Rust behavior
tests still missing.

**Problem:** The Fermenter TS bridge now maps every public `FERMENTER_PARAMS`
ID to a declared DSP ID, and patch updates sent to the audio engine use those
DSP IDs. The Rust side still accepts unknown names silently and has no
Fermenter-targeted tests proving mapped IDs change the intended synth state or
rendered output.

**Representative files:**

- `src/modules/Fermenter/useCases/fermenterParamBridge/setFermenterParamWithAudio.ts:24`
- `src/modules/Fermenter/useCases/fermenterParamBridge/loadFermenterPatchWithAudio.ts:17`
- `src/modules/Fermenter/useCases/fermenterParamBridge/mapFermenterParamToDspParam.ts:11`
- `src/modules/Fermenter/models/FermenterDspParam.ts:1`
- `crates/daw-dsp/src/fermenter/synth.rs:351`
- `crates/daw-dsp/src/fermenter/layer.rs:421`

**Needed:** Add Rust tests or a Rust-side handled-param registry proving each
declared DSP ID is accepted and behaviorally effective where applicable. Do not
rely on silent `_ => {}` in Rust as a contract.

### 2. Generic parameter metadata blocks most oscillator engines

**Status:** Resolved by `318f38638`.

**Previous problem:** `FERMENTER_PARAMS` defined `oscEngine` as `min: 0, max:
1`, but the patch model and `ENGINE_NAMES` define seven engines. Generic
mapped parameter flows could clamp or render only two engine choices.

**Representative files:**

- `src/modules/Fermenter/models/FermenterPatch.ts:336`
- `src/modules/Fermenter/models/FermenterPatch.ts:595`

**Resolution:** `oscEngine.max` is now `6`, and
`FERMENTER_PARAMS.spec.ts` asserts the engine metadata range matches
`ENGINE_NAMES.length - 1`.

### 3. Multiple active layers do not receive note-on events

**Status:** Resolved by `57ac2cceb`.

**Previous problem:** `num_layers` controlled how many layers were rendered,
but `note_on()` only triggered the active layer. A patch with four active layers
did not play four layers unless those other layers already had active voices
from earlier active-layer edits.

**Representative files:**

- `crates/daw-dsp/src/fermenter/synth.rs:375`
- `crates/daw-dsp/src/fermenter/synth.rs:387`
- `src/modules/Fermenter/presentations/components/LayerStack.tsx`

**Resolution:** Product semantics are now "Layer stack means playable stack."
`activeLayer` is the edit target. `num_layers` selects playable layers.
`note_on()` triggers all active layers that are not muted and satisfy solo
rules. `note_off()` releases the note across active layers. Rust tests assert
two-layer triggering, muted/solo filtering, and note release across stacked
voices.

### 4. Macro rig and XY pad use fixed mappings only

**Status:** Partially resolved by `15bb9a393`.

**Problem:** Macros now map to concrete patch parameters and use
`loadFermenterPatchWithAudio`, so they can affect audio and persistence.
However, the mapping is fixed in code. There is still no user-facing macro
matrix for assigning targets, setting depth/curves, or storing per-preset macro
routing.

**Representative files:**

- `src/modules/Fermenter/presentations/views/FermenterPanel.tsx:493`
- `src/modules/Fermenter/useCases/applyFermenterMacroMapping.ts:14`
- `src/modules/Fermenter/useCases/__tests__/applyFermenterMacroMapping.spec.ts:6`

**Needed:** Add a macro assignment model (`macro -> targets + bipolar depth +
curve`) and persist it per patch. Tests should assert both the default mappings
and user-defined mappings update the intended parameters.

### 5. Transform pad interpolates discrete selectors as fractional values

**Status:** Resolved by `ae365b35a`.

**Previous problem:** `lerpPatch` interpolated all numeric fields. Discrete
selectors like `oscEngine`, `filterModel`, `filterMode`, `warpMode`,
`reverbType`, `samplerMode`, `activeLayer`, and `numLayers` are not
interpolable continuous parameters. Fractional states created UI/DSP
disagreement and could land on different integer values depending on whether a
path floored, cast, or rounded.

**Representative files:**

- `src/modules/Fermenter/useCases/presetMorph/bilinearPatch.ts:12`
- `src/modules/Fermenter/presentations/views/TransformPad.tsx`

**Resolution:** Fermenter morphing now has a local discrete-key set.
Continuous numeric values still interpolate, while discrete selectors choose
the nearest source patch value. Regression tests assert `lerpPatch` and
`bilinearPatch` keep selector values integer and corner-derived.

### 6. MIDI event offsets are ignored

**Status:** Resolved for note-on offsets by `b2b91fead`.

**Previous problem:** `MidiEvent.offset` existed but was unused.
`process_block` processed every event before rendering, so all events happened
at the start of the block.

**Representative files:**

- `crates/daw-dsp/src/fermenter/synth.rs:11`
- `crates/daw-dsp/src/fermenter/synth.rs:375`

**Resolution:** `process_block` renders layer sub-blocks up to each event
offset, applies the event, then continues rendering. A Rust regression asserts
that note-on at offset 64 leaves samples before 64 silent and produces output
after the offset.

### 7. "Spectral warp" is not spectral-domain synthesis

**Status:** UI/product overclaim resolved by `037b7b45c`; true spectral-domain
morphing remains future work.

**Problem:** Current warp modes are time-domain transformations. This can sound
useful, and the UI now labels them honestly as "Time-Domain Warp". Fermenter
still does not implement Vital-style spectral morphing, which includes
harmonic-domain operations such as vocoding, harmonic stretch, smear, spectral
filtering, phase disperse, and spectral-time skew.

**Representative files:**

- `crates/daw-dsp/src/fermenter/spectral.rs:1`
- `.agents/research/factory/fermenter.md:1`
- `.agents/specs/implemented/fermenter.md:1`

**Needed:** Treat actual harmonic / wavetable-frame spectral morphing as a
separate spec-driven implementation with spectral assertions, not waveform
snapshots. The current time-domain warp can remain as its own feature.

### 8. DSP has only starter Fermenter-targeted tests

**Status:** Partially resolved by `474e514cc`.

**Problem:** `cargo test -p daw-dsp fermenter::` now runs eight tests, covering
mapped layer parameter IDs, mapped master/global IDs, finite non-silent note
rendering, note-on offsets, and layer-stack triggering. The TS tests still
mostly verify component rendering and use-case paths. There are still no Rust
tests for every engine, unison spread, dense MIDI timing, macro-derived sonic
behavior, or per-effect output differences.

**Representative files:**

- `crates/daw-dsp/src/fermenter/*.rs`
- `src/modules/Fermenter/presentations/components/__tests__/*.spec.tsx`

**Needed:** Add Rust tests for:

- each engine produces finite, non-silent output for a note
- dense MIDI timing
- unison stereo spread
- macro mapping once implemented
- sample/granular/additive parameters having audible effect

### 9. Rust warning hotspots suggest incomplete granular/sampler/reverb behavior

**Problem:** The Fermenter-specific Rust warnings from `cargo test -p daw-dsp
fermenter::` include unread `FdnReverb.sample_rate`, `Grain.position`, and
`SamplerEngine.crossfade`. These are in areas the product claims as high-value
features.

**Representative files:**

- `crates/daw-dsp/src/fermenter/effects.rs:402`
- `crates/daw-dsp/src/fermenter/granular.rs:18`
- `crates/daw-dsp/src/fermenter/sampler.rs:33`

**Needed:** Audit each field:

- remove if dead
- wire if intended behavior is missing
- add a regression test if the behavior is product-relevant

### 10. UI update path is not automation-grade

**Problem:** `setFermenterParamWithAudio` rAF-batches param updates. This is
reasonable for dragging UI controls, but it collapses high-rate changes and
should not be reused for automation playback or sample-accurate modulation.

**Representative files:**

- `src/modules/Fermenter/useCases/fermenterParamBridge/setFermenterParamWithAudio.ts:11`

**Needed:** Keep rAF batching for presentation gestures, but add/confirm a
separate automation path that schedules Fermenter params through the audio
engine with sample/block timing. Document which path is for UI vs playback.

## Risks

- **User-facing overclaim:** Fermenter is positioned as a flagship synth, but
  several flagship controls are currently silent, approximated, or untested.
- **Preset trust risk:** Factory/user presets now use a tested TS bridge mapping,
  but Rust still silently ignores unknown parameter names.
- **Performance-control risk:** Macros and XY controls now have default audio
  mappings, but users cannot assign targets, depth, or curves like a flagship
  synth macro system.
- **Timing risk:** Basic note-on offsets are now honored, but complex note-off
  and dense-event musical timing still need broader regressions.
- **Regression risk:** Starter Rust DSP tests now exist, but most synth engines
  and timing behaviors can still regress while all TS tests stay green.

## Suggested Approaches

1. **Add DSP regression tests before sonic retuning.** Use simple note renders
   and energy/spectral assertions. Do not tune by UI snapshots.
2. **Expand macros after the fixed-mapping slice.** Default mappings now exist;
   the next step is a patch-owned macro matrix with target depth and curves.
3. **Treat true spectral morphing as a separate spec.** The current time-domain
   warp can stay useful, but Vital/Zebra/Pigments-style claims need an actual
   spectral/harmonic implementation and tests.

## Resolved

- **Generic engine metadata range:** `oscEngine.max` now covers all seven
  engines and has a regression test against `ENGINE_NAMES`.
- **Silent macro rig:** The panel now applies fixed macro mappings through
  `loadFermenterPatchWithAudio`, with use-case tests proving mapped parameter
  changes. Remaining macro-matrix work is tracked in Open Issue 4.
- **TS bridge parameter mapping:** Fermenter now declares DSP parameter IDs,
  maps param and patch updates before sending them to AudioEngine, keeps
  persisted patches in the TS patch shape, and tests every public
  `FERMENTER_PARAMS` ID against the declared DSP contract.
- **Initial Rust DSP regressions:** `cargo test -p daw-dsp fermenter::` now runs
  eight Fermenter-targeted tests covering mapped layer params, mapped global
  params, finite non-silent note rendering, note-on offsets, and playable layer
  stack behavior. Remaining DSP coverage is tracked in Open Issue 8.
- **Playable layer stack:** `note_on()` now triggers all active playable layers,
  `note_off()` releases active layers, and `activeLayer` is retained as the edit
  target. Rust regressions cover two-layer triggering, mute/solo filtering, and
  stacked note release.
- **TransformPad discrete selectors:** `lerpPatch` and `bilinearPatch` now keep
  selector values on nearest source patch values instead of interpolating them
  into fractional states.
- **MIDI note-on offsets:** `process_block` now renders sub-blocks between MIDI
  event offsets and has a regression proving a note-on at sample 64 does not
  sound at sample 0.
- **Warp overclaim:** Fermenter's UI and implementation comments now label the
  current warp modes as time-domain processing. True spectral-domain morphing
  remains future spec-driven work.
