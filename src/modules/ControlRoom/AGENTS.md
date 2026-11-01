# ControlRoom module — Agent Guidelines

Monitoring environment controller: manages studio monitor speaker selection, calibration offsets, listening room utilities (dim, mono, mute, reference), talkback, and cue headphone mixes.

## Domain Ownership

Owns studio monitor output selection, monitor speaker calibration offsets, listening room controls (dim, mono fold-down, mute, reference bypass), talkback routing, and headphone cue mixes. Does not own master bus audio rendering or track channel DSP (AudioEngine), or physical hardware output device enumeration (AudioEngine / Preferences).

## Public Contract Surface

Public surface: `useCases/index.ts`, `stores/index.ts`. The module exports no events or views, and most of its use cases are internal.

## Key Subsystems

- **`stores/controlRoom.ts`**: Reactive state machine holding monitor speaker configurations, active monitor ID, monitoring volume (dB), dim attenuation level/active flag, mono monitoring status, reference audition toggle, cue mix definitions, and talkback level.
- **`useCases/controlRoom/`**: State manipulation use cases and effective volume computation (`getEffectiveVolume = monitorVolume + (dimActive ? dimLevel : 0) + activeMonitor.gainDb + activeMonitor.calibrationDb`).
- **`handlers/`**: Production command handlers translating UI/agent commands to control room state modifications.

## Invariants & Traps

- **Monitoring path isolation**: Control room gain, dim, speaker calibration offsets, and mono fold-down apply strictly to the control room listening feed; they must NEVER affect export mixdowns or offline rendering.
- **Atomic volume calculation**: Effective volume calculation incorporates monitor volume, speaker calibration offset, and dim attenuation in a single atomic calculation.
- **Single active monitor**: Exactly one speaker output profile is active at any given moment.

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

- **Focused unit tests**: `pnpm guard --profile focused -- pnpm test:run <changed-spec>`
- PR CI checks module boundaries; inspect that result after cross-module changes.
