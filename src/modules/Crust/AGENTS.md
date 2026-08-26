# Crust module — Agent Guidelines

Mastering limiter, saturator, and multiband dynamic peak controller (brickwall limiting, multi-algorithm saturation, true-peak inter-sample detection, stereo/mid-side processing, and dither); does not own track mixing or master bus routing (MixerConsole/Arrangement).

## Public Contract Surface

- **Stores** (`stores/index.ts`): `crustStore`, `defaultCrustState`, `updateCrustMeters`, `resetCrustMeters`.
- **Views** (`presentations/views/index.ts`): `CrustPanel`.
- **Use Cases** (`useCases/`): Internal parameter bridge (`loadCrustPatchWithAudio`, `setCrustParamWithAudio`, `createFlushHandlers`), presets (`crustPresets`), and metering controls (`resetCrustPanelMeters`, `resetCrustTruePeakIndicator`, `setCrustPanelUiLevel`).
- **Events**: No public events.

## Key Subsystems

- **Patch Model** (`models/CrustPatch.ts`): Patch definitions covering limiter algorithms (`transparent`, `punchy`, `dynamic`, `allround`, `aggressive`, `bus`, `safe`, `wall`), saturation modes (`soft`, `hard`, `tape`, `tube`, `fold`), multiband crossovers, dither (`tpdf16`, `tpdf24`, `powr1..3`), and oversampling factors (`CRUST_OVERSAMPLE_FACTORS`: `[1, 2, 4, 8, 16, 32]`).
- **Parameter Bridge** (`useCases/crustParamBridge/`): Streams audio parameter updates to the AudioEngine node and synchronizes patch changes.
- **Meters & True Peak** (`stores/crustStore.ts`): High-frequency telemetry for gain reduction, RMS/peak, and true-peak clipping indicators.

## Invariants & Traps

- Oversampling factor is strictly limited to `[1, 2, 4, 8, 16, 32]`; `asCrustOversampleFactor` narrows values without silent fallbacks. The Arrangement descriptor (`PluginDescriptors/CrustDescriptor.ts`) declares the same legal set, guarded by `CrustPatch.spec.ts`.
- Real-time gain reduction and true-peak telemetry update store state directly without triggering expensive component tree re-renders.
- Audio DSP in `crates/daw-dsp/src/crust/` executes with zero allocations and zero locks on the render thread.

## Verification

- `pnpm vitest run src/modules/Crust`
- `cargo test --package daw-dsp -- crust`
- `pnpm deps:validate`
