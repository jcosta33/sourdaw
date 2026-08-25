# Fermenter module — Agent Guidelines

Flagship multi-engine synthesizer instrument (wavetable, virtual analog, FM, Karplus-Strong, granular, additive, and sample oscillators with multi-model filters, modulation matrix, unison, and macro morphing); does not own track sequencing or MIDI routing (Arrangement/MIDI).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `applyFermenterRuntimeParam`, `setFermenterDependencies`, `getFermenterFactoryPresets`, `mapFermenterParamToDspParam`, `FERMENTER_PARAMS`, `setFermenterMappedParam`.
- **Stores** (`stores/index.ts`): `fermenterStore`, `setFermenterTelemetry`.
- **Views** (`presentations/views/index.ts`): `FermenterPanel`.
- **Events** (`events/index.ts`): No public events.

## Key Subsystems

- **Patch Model** (`models/FermenterPatch.ts`): Patch state spanning 7 oscillator engines, 6 filter models (SVF, Moog, Diode, Formant, MS-20, SEM), modulation matrix routings, envelopes, LFOs, and per-voice FX.
- **Param Bridge** (`useCases/fermenterParamBridge/`): Descriptor-to-DSP parameter name mapping (`mapFermenterParamToDspParam`) and audio engine patch push (`loadFermenterPatchWithAudio`).
- **Preset Morphing** (`useCases/presetMorph/`): Bilinear and linear interpolation (`lerpPatch`, `bilinearPatch`) for XY morph pads.
- **User Patches** (`useCases/user-patches/`, `repositories/user-patches/`): Local storage persistence for user-defined sound designs.

## Invariants & Traps

- `mapFermenterParamToDspParam` is the single source of truth for translating TypeScript parameter descriptors to Rust DSP engine wire names; never hardcode divergent names on the call site.
- Parameter automation ordinals must align exactly with the Rust `daw-dsp::fermenter` parameter map.
- Real-time safety: wavetables, impulse responses, and PCM samples must be fully loaded before voice allocation.

## Verification

- `pnpm vitest run src/modules/Fermenter`
- `cargo test --package daw-dsp -- fermenter`
- `pnpm deps:validate`
