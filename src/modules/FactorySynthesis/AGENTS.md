# FactorySynthesis module — Agent Guidelines

Procedural offline audio synthesis and preset sound generator for factory sample packs (808/909 drum machines, acoustic drums, lo-fi percussion, basses, keys, risers, impacts); does not own sample library indexing or disk storage (SampleLibrary).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `generateFactorySamples`, `FACTORY_LIBRARY_ROOT_ID`, `FACTORY_SEED_FLAG_KEY`.

## Key Subsystems

- **DSP Building Blocks** (`services/`): Mathematical oscillators, envelopes, filters, dynamics, distortion, delay, reverb, and buffer mixing primitives.
- **Pack Generators** (`useCases/`): Programmatic instrument and kit generators (`drums808`, `drums909`, `drumsAcoustic`, `drumsLofi`, `percWorld`, `percElectronic`, `bass`, `keys`, `generateRisersPack`, `generateImpactsPack`).
- **Generation Pipeline** (`useCases/generateFactorySamples.ts`): Batch orchestrator generating AudioBuffers into factory sample categories.

## Invariants & Traps

- Pure offline DSP: executes in standard JS/TS runtime environments without depending on AudioContext hardware threads or DOM state.
- Deterministic seeding: procedural generator logic must produce identical sample buffers across runs given the same seed parameters.

## Verification

- `pnpm vitest run src/modules/FactorySynthesis`
- `pnpm deps:validate`
