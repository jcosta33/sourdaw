# Synth module — Agent Guidelines

Built-in polyphonic synthesizer voice scheduling (analog-modeled subtractive synth, MPE expression, Faust pro synth instrument registration, and drum synth voice generation); does not own track sequencing, MIDI clip storage, or audio graph hosting (Arrangement/AudioEngine).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `scheduleNote`, `getSynthParamsFromDevices`, `scheduleNoteOffline`, `scheduleKitNote`, `getDrumKitDefByIndex`, `scheduleDrumKitNote`, `registerProSynthInstruments`.
- **Events** (`events/index.ts`): No public events.

## Key Subsystems

- **Voice Schedulers** (`engine/`): Polyphonic oscillator/envelope/filter voice allocation and scheduling (`scheduleBuiltinSynthNote`, `scheduleBuiltinSynthNoteOffline`) with MPE slide and pitch bend handling.
- **Drum Synth Engine** (`engine/drumSynthVoices.ts`, `useCases/drumKitSynth.ts`, `useCases/drumSynthEngine/`): Analog drum voice models (kick, snare, clap, hihats, toms, cymbals, perc) and drum kit index mapping.
- **Pro Synth Registration** (`useCases/proSynthInstruments.ts`): Faust DSP instrument compilation and registration (supersaw unison, morphing synth, physical model string, additive synth).
- **Device Parameter Mapping** (`useCases/getSynthParamsFromDevices.ts`): Maps track device parameter maps into typed `BuiltinSynthParams`.

## Invariants & Traps

- MPE pitch bend requires caller-resolved `pitchBendRangeSemitones`; no internal default constant exists to prevent drift between live playback and offline render.
- Offline note scheduling (`scheduleNoteOffline`) must render against `OfflineAudioContext` without live audio clock dependencies.
- Faust instruments are registered across both Synth and PluginHost; changes to instrument definitions must be synchronized.

## Verification

- `pnpm vitest run src/modules/Synth`
- `pnpm deps:validate`
