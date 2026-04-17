# Spec: Levain Multi-Instance Architecture

## Context
The Levain plugin currently uses a singleton pattern for its UI state (`levainStore`) and its engine bridge (`levainBridge`). This prevents users from adding multiple Levain instruments to different tracks, as they overwrite each other's parameters, share the same UI state, and cross-talk to the wrong AudioWorklet.

## Goal
Enable true multi-instance support for the Levain plugin. Each Levain device in the project must have its own isolated UI state, parameter map, and bridge connection to its corresponding Rust AudioWorkletNode.

## Requirements
1. **Device-Scoped Stores:** The global `levainStore` must be replaced by a mechanism that provides an isolated store per `deviceId`.
2. **Device-Scoped Bridge:** The `levainBridge` must manage a registry of active Levain devices and their `MessagePort`s keyed by `deviceId`.
3. **No Domain Leakage:** The plugin code must not import `getAllTracks` from the Arrangement domain to discover its own ID. The DAW shell must pass the `deviceId` to the plugin panel or bridge upon initialization.
4. **Independent Loading States:** The `LevainLoadingSpinner` must only show loading progress for its specific `deviceId`, not a global progress.
5. **No regressions:** Single-instance usage must continue to work flawlessly, including parameter persistence, macros, sample loading, and DSP processing.

## Out of Scope
- Fixing the missing DSP macro parameters (Tone, Attack, Release) or legato transitions (covered in the audit but deferred for a separate task).
- Refactoring `LevainPatch` to be entirely hosted in the project state instead of the UI store (we will isolate the UI store first, then consider a deeper project state migration later if needed).

## Open Questions
- `[CRITICAL]` How does the DAW framework initialize device panels and bridges? Does it pass the `deviceId` and `MessagePort` cleanly, or do we need to alter the plugin registration lifecycle?

## Acceptance Criteria
- `pnpm deps:validate` passes with zero violations (especially ensuring `levainBridgeDependencies.ts` no longer imports `getAllTracks`).
- `LevainPanel` accepts or retrieves a `deviceId` and correctly reflects the state of *only* that device.
- `LevainLoadingSpinner` only spins for the specific device that is currently loading samples.
- Modifying a parameter on Levain Device A does not affect the audio or UI of Levain Device B.
