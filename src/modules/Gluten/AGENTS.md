# Gluten module — Agent Guidelines

Multi-topology compressor audio effect (VCA, Opto, FET, Diode models with Thrust frequency weighting, auto-makeup, auto-release, sidechain HPF, and saturation); does not own track strip mixer routing or gain automation (MixerConsole/Arrangement).

## Public Contract Surface

- **Stores** (`stores/index.ts`): `glutenStore`, `glutenMeterStore`, `updateGlutenMeters`, `deleteGlutenMeters`, `GlutenMeterValues`.
- **Views** (`presentations/views/index.ts`): `GlutenPanel`.
- **Use Cases** (`useCases/index.ts`): No public cross-module use cases; internal param bridge and presets are consumed locally by `GlutenPanel`.
- **Events** (`events/index.ts`): No public events.

## Key Subsystems

- **Patch Model** (`models/GlutenPatch.ts`): Compressor patch definitions, topology models (`vca`, `opto`, `fet`, `diode`), styles (`glue`, `punch`, `smooth`, `pump`), and oversampling enforcement (`clampOversampling`).
- **Topology Gating** (`models/GlutenTopologyGating.ts`): UI and DSP parameter availability rules per active topology (e.g., Diode recovery hints, fixed FET ratio steps).
- **Param Bridge** (`useCases/glutenParamBridge/`): Streams audio parameter updates to AudioEngine and hydrates patch states from project data.
- **Meters & Telemetry** (`stores/glutenStore.ts`): Decoupled gain reduction history and peak meters (`glutenMeterStore`).

## Invariants & Traps

- Oversampling factor is strictly limited to 1×, 2×, or 4× (`clampOversampling` floors 3 to 2); the engine and Arrangement descriptor (`GlutenDescriptor.ts`) mirror this law and are validated by `DeviceLegalParameterValues.json`.
- Gain reduction telemetry uses a decoupled store to avoid triggering React component re-renders during high-rate audio metering updates.
- Audio DSP in `crates/daw-dsp/src/gluten/` executes with zero allocations and zero locks on the real-time render thread.

## Verification

- `pnpm vitest run src/modules/Gluten`
- `cargo test --package daw-dsp -- gluten`
- `pnpm deps:validate`
