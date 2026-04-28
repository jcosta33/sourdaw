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

Tests exist heavily on the TS presentation/use-case side: `pnpm test:run
src/modules/Fermenter` reports 36 files and 52 tests passing. Rust
Fermenter-specific test targeting is effectively absent: `cargo test -p
daw-dsp fermenter::` runs zero tests.

## Findings

1. **The public TS parameter IDs do not match the Rust DSP names.** The TS
   model exposes camelCase IDs (`oscEngine`, `filterCutoff`, `oscDrift`,
   `portamentoTime`, etc.), while the Rust `set_param` paths are snake_case
   (`engine`, `cutoff`, `drift`, `portamento`, etc.). `setFermenterParamWithAudio`
   forwards the TS key unchanged. This means many UI controls update the store
   and persisted patch but are silently ignored by DSP.

2. **`FERMENTER_PARAMS` has an engine range bug.** `oscEngine` is defined with
   `max: 1`, but the patch and UI support engines `0..6`. Any generic mapped
   parameter UI or automation surface using `FERMENTER_PARAMS` can only address
   Wavetable/Analog even though the panel exposes FM/String/Granular/Additive/
   Sampler.

3. **Layering is not real layering for notes.** `MasterSynth::note_on` sends MIDI
   only to `active_layer`; active layers are rendered only if they already have
   active voices. Setting `num_layers > 1` does not make a note trigger every
   layer, so the layer stack is mostly an edit target and mixer for stale voice
   state, not an Omnisphere/Phase Plant/Pigments-style stack.

4. **Macros are UI-local and silent.** `setMacro` updates the Fermenter store
   with `loadFermenterPatch` only. It does not call `loadFermenterPatchWithAudio`,
   does not persist, and there is no macro mapping table. The right-rail
   "Macro rig" and XY pad look like performance controls but do not change DSP.

5. **Modulation and transform interpolation can create invalid discrete states.**
   `lerpPatch` linearly interpolates every numeric field, including discrete
   selectors such as `oscEngine`, `filterModel`, `warpMode`, `reverbType`,
   `samplerMode`, and `activeLayer`. Those fractional values are then sent
   through the same patch path and get truncated/rounded later depending on the
   consumer. The UI may show one state while DSP uses another.

6. **Sample-accurate MIDI offsets are ignored.** `MidiEvent` carries `offset`,
   but `process_block` handles all note on/off events before rendering the
   block. A note at sample 127 starts at sample 0. That is audible for tight
   sequenced synth lines and violates the spec's block-processing contract.

7. **Spectral warp is explicitly time-domain but marketed as spectral.**
   `spectral.rs` says it is "Inspired by Vital's spectral morph system" but
   implements sync, quantize, squeeze, bend, formant, and fold as time-domain
   or simple waveshaping operations. The existing research already calls out
   missing true spectral modes. The current UI name "Spectral warp" therefore
   overstates the engine.

8. **Rust Fermenter has no targeted regression tests.** The command
   `cargo test -p daw-dsp fermenter::` compiles and runs zero tests. Given the
   release gate requires integration tests for every part/section, current DSP
   changes can regress without a Fermenter test failing.

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

1. Fix the TS-to-Rust parameter contract mismatch.
2. Add Fermenter-specific Rust DSP tests for engine selection, parameter mapping,
   MIDI offsets, and layer triggering.
3. Decide and implement the actual layer note-triggering model.
4. Make macros either real mapped performance controls or clearly UI-only.
5. Rename/retune "Spectral warp" claims or implement true spectral-domain
   modes from the existing research.
6. Harden transform-pad interpolation for discrete parameters.

## Open Issues

### 1. TS patch keys are forwarded unchanged but Rust expects different names

**Problem:** `setFermenterParamWithAudio` calls `updateDeviceParam` with
camelCase keys. Rust `Layer::set_param` and `MasterSynth::set_param` mostly
match snake_case names. Examples:

- TS `oscEngine` vs Rust `engine`
- TS `filterCutoff` vs Rust `cutoff`
- TS `filterResonance` vs Rust `resonance`
- TS `oscDrift` vs Rust `drift`
- TS `portamentoTime` vs Rust `portamento`
- TS `masterGain` vs Rust `master_gain`

**Representative files:**

- `src/modules/Fermenter/useCases/fermenterParamBridge/setFermenterParamWithAudio.ts:24`
- `src/modules/Fermenter/models/FermenterPatch.ts:334`
- `crates/daw-dsp/src/fermenter/synth.rs:351`
- `crates/daw-dsp/src/fermenter/layer.rs:421`

**Needed:** Introduce a single explicit mapping table from
`keyof FermenterPatch` to Rust/audio param IDs, use it in param updates and
patch loads, and test every `FERMENTER_PARAMS` ID maps to a handled DSP param.
Do not rely on silent `_ => {}` in Rust as a contract.

### 2. Generic parameter metadata blocks most oscillator engines

**Problem:** `FERMENTER_PARAMS` defines `oscEngine` as `min: 0, max: 1`, but the
patch model and `ENGINE_NAMES` define seven engines. Generic mapped parameter
flows will clamp or render only two engine choices.

**Representative files:**

- `src/modules/Fermenter/models/FermenterPatch.ts:336`
- `src/modules/Fermenter/models/FermenterPatch.ts:595`

**Needed:** Set `oscEngine.max` to `6`, then add a metadata test that verifies
every discrete param range matches its corresponding enum/name list.

### 3. Multiple active layers do not receive note-on events

**Problem:** `num_layers` controls how many layers are rendered, but
`note_on()` only triggers the active layer. A patch with four active layers
does not play four layers unless those other layers already have active voices
from earlier active-layer edits.

**Representative files:**

- `crates/daw-dsp/src/fermenter/synth.rs:375`
- `crates/daw-dsp/src/fermenter/synth.rs:387`
- `src/modules/Fermenter/presentations/components/LayerStack.tsx`

**Needed:** Decide the product semantics:

- "Active layer only" means rename the UI to an editor target and remove
  multi-layer performance implications.
- "Layer stack" means route note events to all unmuted active layers and make
  per-layer engine/patch state real.

Add a Rust test for a two-layer patch producing output from both layers.

### 4. Macro rig and XY pad do not affect audio or persistence

**Problem:** Macros are stored as eight numbers and shown as performance
controls, but no mapping table connects them to params. `setMacro` calls
`loadFermenterPatch` instead of `loadFermenterPatchWithAudio`, so even the
macro values themselves are not persisted or sent to the audio engine.

**Representative files:**

- `src/modules/Fermenter/presentations/views/FermenterPanel.tsx:493`
- `src/modules/Fermenter/presentations/views/FermenterPanel.tsx:713`
- `src/modules/Fermenter/models/FermenterPatch.ts:176`

**Needed:** Either implement macro mappings (macro -> one or more target params
with bipolar depth/curve) and persist/update via the audio bridge, or relabel
the current UI as placeholder/non-audio metadata. Tests should assert that
moving Macro A changes at least one mapped parameter.

### 5. Transform pad interpolates discrete selectors as fractional values

**Problem:** `lerpPatch` interpolates all numeric fields. Discrete selectors
like `oscEngine`, `filterModel`, `filterMode`, `warpMode`, `reverbType`,
`samplerMode`, `activeLayer`, and `numLayers` are not interpolable continuous
parameters. Fractional states create UI/DSP disagreement and can land on
different integer values depending on whether a path floors, casts, or rounds.

**Representative files:**

- `src/modules/Fermenter/useCases/presetMorph/bilinearPatch.ts:12`
- `src/modules/Fermenter/presentations/views/TransformPad.tsx`

**Needed:** Split param metadata into continuous vs discrete. Interpolate only
continuous params. For discrete params, choose nearest corner, crossfade between
rendered audio, or define an explicit morph strategy per selector.

### 6. MIDI event offsets are ignored

**Problem:** `MidiEvent.offset` exists but is unused. `process_block` processes
every event before rendering, so all events happen at the start of the block.

**Representative files:**

- `crates/daw-dsp/src/fermenter/synth.rs:11`
- `crates/daw-dsp/src/fermenter/synth.rs:375`

**Needed:** Sort/group events by offset and render sub-blocks between event
boundaries, or apply note starts/stops inside the sample loop. Add a Rust test
where a note-on at offset 64 leaves samples before 64 silent.

### 7. "Spectral warp" is not spectral-domain synthesis

**Problem:** Current warp modes are time-domain transformations. This can sound
useful, but the label and research/spec compare Fermenter to Vital-style
spectral morphing, which includes harmonic-domain operations such as vocoding,
harmonic stretch, smear, spectral filtering, phase disperse, and spectral-time
skew.

**Representative files:**

- `crates/daw-dsp/src/fermenter/spectral.rs:1`
- `.agents/research/factory/fermenter.md:1`
- `.agents/specs/implemented/fermenter.md:1`

**Needed:** Either rename the current feature to "Warp" / "Waveshaping warp"
and mark true spectral modes as missing, or implement an actual harmonic /
wavetable-frame spectral path. The latter should be spec-driven and tested with
spectral assertions, not just waveform snapshots.

### 8. DSP has no Fermenter-targeted tests

**Problem:** `cargo test -p daw-dsp fermenter::` runs zero tests. The TS tests
mostly verify component rendering and use-case smoke paths, not oscillator,
filter, modulation, layer, or effect correctness.

**Representative files:**

- `crates/daw-dsp/src/fermenter/*.rs`
- `src/modules/Fermenter/presentations/components/__tests__/*.spec.tsx`

**Needed:** Add Rust tests for:

- each engine produces finite, non-silent output for a note
- changing mapped params changes output
- layer note routing
- MIDI offsets
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
- **Preset trust risk:** Factory/user presets may persist values that do not
  reach DSP, especially camelCase patch keys.
- **Performance-control risk:** Macros and XY controls look playable but are not
  audio controls. This will frustrate users quickly.
- **Timing risk:** Ignored MIDI offsets make tight synth sequencing less precise.
- **Regression risk:** Without Rust DSP tests, core synth behavior can regress
  while all TS tests stay green.

## Suggested Approaches

1. **Start with the parameter contract.** Build and test the TS -> audio param
   mapping table. This unlocks every other Fermenter fix.
2. **Add DSP regression tests before sonic retuning.** Use simple note renders
   and energy/spectral assertions. Do not tune by UI snapshots.
3. **Resolve layer semantics before adding more UI.** A flagship synth can have
   active edit layers or playable layer stacks, but the UI must not imply one
   while DSP implements the other.
4. **Make macros real in a small slice.** Map Macro A to cutoff and Macro B to
   motion/depth for a few factory presets, then expand.
5. **Treat true spectral morphing as a separate spec.** The current time-domain
   warp can stay useful, but Vital/Zebra/Pigments-style claims need an actual
   spectral/harmonic implementation and tests.

## Resolved

No Fermenter audit issues resolved in this audit pass.
