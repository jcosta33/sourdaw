# Tuner module — Agent Guidelines

Tuner device panel UI and real-time pitch telemetry ingestion (detected note, cents offset, frequency, clarity, display mode) keyed by deviceId; does not own the pitch-detection DSP engine (AudioEngine WASM worklet) or concert-A reference parameter storage (Device parameter values).

## Public Contract Surface

- `stores`: `tunerStore`, `updateTunerTelemetry`.
- `presentations/views`: `TunerPanel`.

## Key Subsystems

- **Multi-Instance Store**: `stores/tunerStore.ts` stores telemetry keyed by `deviceId`, utilizing a frozen `FALLBACK_TUNER_STATE` reference to maintain selector caching identity across device updates.
- **Telemetry Ingestion Pipeline**: `updateTunerTelemetry` accepts high-frequency telemetry frames directly from AudioEngine without touching undo history.
- **Concert-A Reference Policy**: Concert-A frequency tuning (`a4`) is a DSP parameter stored on `Device.parameterValues` (`models/A4Reference.ts`), not in UI panel store state.

## Invariants & Traps

- Telemetry pushes are high-frequency real-time signals — never route tuner telemetry through undo/redo stacks or CRDT document sync.
- Concert-A calibration must be written through device parameter mutation use cases, never stored as local panel state in `tunerStore`.

## Verification

```bash
pnpm vitest run src/modules/Tuner
```
