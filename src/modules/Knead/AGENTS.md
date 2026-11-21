# Knead module — Agent Guidelines

Audio clip pitch analysis, graphical pitch editing (pitch contours, note blobs, drift/vibrato correction), and pitch commit flow; does not own arrangement timeline clip positioning or track audio playback (Arrangement/AudioEngine).

## Public Contract Surface

Public surface: `useCases/index.ts`, `stores/index.ts`.

## Key Subsystems

- **Pitch Detection DSP** (`useCases/dspAnalysis.ts`): Pitch detection analyzing raw audio buffers into pitch contours and note segmentation blobs.
- **Commit Flow** (`useCases/pitch/commitPitchEdit.ts`, `handlers/pitch/`): Bounces pitch-edited audio clips to new audio assets and updates track clip references.
- **State Hydration** (`useCases/hydrateKneadFromTrackStore.ts`): Synchronizes pitch edit data between track state and local editing stores.

## Invariants & Traps

- `commitPitchEdit` renders through AudioEngine's `commitPitchEdit`, imported from the AudioEngine `useCases` barrel (no injection), and writes the clip's `fileId` and `audioBufferId` together inside the action's transaction scope. Its undo inverse restores both, including the absence of a buffer id.
- Note blob pitch shifts and formant preservation calculations must clamp within valid frequency and sample index bounds.
- Analyzed pitch contours are cached per clip audio asset to prevent redundant pitch analysis passes.
- `getPitchHandlers` is the Knead-owned handler map for `commitPitchEdit` and its `restoreClipFileId` inverse; the composition root registers both together, and Command never imports them (ADR 0011).

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

- `pnpm guard --profile focused -- pnpm test:run <changed-spec>`
- PR CI checks module boundaries; inspect that result after cross-module changes.
