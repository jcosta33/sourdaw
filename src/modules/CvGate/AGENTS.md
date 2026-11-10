# CvGate module — Agent Guidelines

Control Voltage (CV) and Gate output configuration, calibration, and conversion for analog/modular synthesizers (1V/oct, Hz/V, pitch, velocity, gate, trigger, and clock); does not own MIDI hardware device management or audio output routing (MIDI/Routing). Physical CV/Gate delivery is not implemented.

## Public Contract Surface

Public surface: `useCases/index.ts`, `stores/index.ts`.

## Key Subsystems

- **CV Conversion** (`useCases/cvConversion/`): Pitch-to-voltage conversion (`midiNoteToCv`) supporting `1v-per-octave` (1/12 V per semitone) and `hz-per-volt` standards.
- **Output Management** (`useCases/cvOutputOperations/`): Output channel configuration, normalized values, clock division, trigger pulse width (`triggerPulseMs`), and gate threshold configuration.
- **Command handlers** (`handlers/cvOutput/`): `addCvOutput` and its undo inverse `removeCvOutput`, registered with Command through `getCvGateHandlers`. An add the use case refuses (duplicate channel, unknown type) records no undo entry.
- **Persistence** (`stores/cvGate.ts`): Automerge CRDT document storage for persistent CV/Gate output configuration and calibration.

## Invariants & Traps

- `setCvValue` bounds the configured normalized value to `[0, 1]`; it does not emit voltage.
- A future physical output must respect each channel's `minVoltage` and `maxVoltage` and schedule clock divisions and trigger pulses (`triggerPulseMs`) on audio frames.
- Hydration from CRDT project state uses strict shape validation (`hydrateCvGateState`).

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

- `pnpm guard --profile focused -- pnpm test:run <changed-spec>`
- PR CI checks module boundaries; inspect that result after cross-module changes.
