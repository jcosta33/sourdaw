# CvGate module — Agent Guidelines

Control Voltage (CV) and Gate output routing and conversion for analog/modular synthesizers via DC-coupled audio interfaces (1V/oct, Hz/V, pitch, velocity, gate, trigger, and clock pulses); does not own MIDI hardware device management or audio output routing (MIDI/Routing).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `addCvOutput`, `removeCvOutput`, `setCvValue`, `setVoltageStandard`, `setClockDivision`, `hydrateCvGateState`.
- **Stores** (`stores/index.ts`): `cvGateStore`, `defaultCvGateState`, `CvGateState`, `CvOutputChannel`.

## Key Subsystems

- **CV Conversion** (`useCases/cvConversion/`): Pitch-to-voltage conversion (`midiNoteToCv`) supporting `1v-per-octave` (1/12 V per semitone) and `hz-per-volt` standards.
- **Output Management** (`useCases/cvOutputOperations/`): Physical output channel mapping, clock division, trigger pulse width (`triggerPulseMs`), and gate threshold configuration.
- **Persistence** (`stores/cvGate.ts`): Automerge CRDT document storage for persistent CV/Gate output routing and calibration.

## Invariants & Traps

- Output voltages are strictly bounded by `minVoltage` and `maxVoltage` per channel configuration to protect external modular hardware.
- Clock divisions and trigger pulses (`triggerPulseMs`) must align with audio buffer render boundaries.
- Hydration from CRDT project state uses strict shape validation (`hydrateCvGateState`).

## Verification

- `pnpm vitest run src/modules/CvGate`
- `pnpm deps:validate`
