# Bacteria module — Agent Guidelines

Multiband creative multi-effects framework (crossover filtering, multi-model distortion, dynamic filtering, granular synthesis, spectral processing, Lorenz chaotic modulation, LFOs, and XY morph pad); does not own audio track routing or playback scheduling (AudioEngine/Arrangement).

## Public Contract Surface

- **Stores** (`stores/index.ts`): `bacteriaStore`, `updateBacteriaMeters`.
- **Views** (`presentations/views/index.ts`): `BacteriaPanel`.
- **Events** (`events/index.ts`): No public events.
- **Use Cases** (`useCases/index.ts`): No public cross-module use cases; internal parameter bridge and preset loaders consume state within the module.

## Key Subsystems

- **Patch Model** (`models/BacteriaPatch.ts`): Up to 6 processing bands with crossover configurations (`lr4` or `linear-phase`), distortion engines (`soft-clip`, `hard-clip`, `foldback`, `wavefold`, `bitcrush`, `tube`, `breakdown`, `smudge`), granular windows (`hann`, `gaussian`), spectral blur/freeze, and Lorenz modulation (`sigma`, `rho`, `beta`, `speed`).
- **Parameter Bridge** (`useCases/bacteriaParamBridge/`): Bridges UI and project patch parameters to AudioEngine device parameters (`setBacteriaParamWithAudio`, `setBacteriaBandParamWithAudio`, `loadBacteriaPatchWithAudio`, `createFlushParam`).
- **Preset Catalog** (`useCases/bacteriaPresets.ts`): Factory presets and patch templates.
- **Meters & Telemetry** (`stores/bacteriaStore.ts`): Real-time input, band, and output level meter subscriptions.

## Invariants & Traps

- `modAssignments` and `snapshots` are UI and persistence metadata only. They are deliberately excluded from scalar engine parameter pushes in `loadBacteriaPatchWithAudio` because the engine bridge only transmits scalar `(paramId, value)` pairs.
- Crossover slope is index-encoded (0=12 dB/oct, 1=24 dB/oct, 2=36 dB/oct, 3=48 dB/oct).
- DSP engine lives in `crates/daw-dsp/src/bacteria/` compiled to WASM; render path is strictly non-allocating.

## Verification

- `pnpm vitest run src/modules/Bacteria`
- `cargo test --package daw-dsp -- bacteria`
- `pnpm deps:validate`
