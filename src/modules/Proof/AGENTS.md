# Proof module — Agent Guidelines

Mastering and spectral shaping suite (parametric EQ, dynamic EQ, multiband dynamics, harmonic exciter, stereo imager, true-peak limiter, and tonal balance/loudness metering); does not own track mixer channel strips or master fader hardware routing (MixerConsole/AudioEngine).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `prepareOfflineProof`, `registerProofDevice`, `unregisterProofDevice`, `syncFullPatch`.
- **Stores** (`stores/index.ts`): `proofStore`, `updateProofMeters`, `clearProofMeters`.
- **Views** (`presentations/views/index.ts`): `ProofPanel`.
- **Events** (`events/index.ts`): No public events.

## Key Subsystems

- **Patch Model** (`models/ProofPatch.ts`): Modular processing chain definitions (EQ, Dynamic EQ, Exciter, Imager, Limiter), module reordering, filter band specifications, and target curve presets.
- **Param Bridge** (`useCases/proofParamBridge/`): Fine-grained DSP parameter synchronization (`syncEqBands`, `syncDynBands`, `syncExciter`, `syncImager`, `setProofTarget`, `syncFullPatch`) and offline rendering preparation (`prepareOfflineProof`).
- **Chain & Target Validation** (`services/`): Module chain ordering rules (`isValidProofChainOrder`), dynamic crossover frequency constraints (`isValidDynCrossoverFreqs`), and dither conversions (`ditherModeToInt`).
- **Loudness & Metering** (`stores/proofLoudnessHistory.ts`, `stores/proofStore.ts`): Short-term/integrated LUFS, true peak, and spectral balance history ring buffers.

## Invariants & Traps

- Modular chain reordering must be verified by `isValidProofChainOrder` before pushing to the audio DSP node to prevent invalid processing graphs.
- Dynamic EQ crossover frequencies must maintain strictly ascending frequency values (`isValidDynCrossoverFreqs`).
- High-rate loudness and spectral metering write to dedicated history stores to avoid triggering full UI panel re-renders.

## Verification

- `pnpm vitest run src/modules/Proof`
- `cargo test --package daw-dsp -- proof`
- `pnpm deps:validate`
