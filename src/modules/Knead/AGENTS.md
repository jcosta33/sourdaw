# Knead module — Agent Guidelines

Audio clip pitch analysis, graphical pitch editing (pitch contours, note blobs, drift/vibrato correction), and pitch commit flow; does not own arrangement timeline clip positioning or track audio playback (Arrangement/AudioEngine).

## Public Contract Surface

Public surface: `useCases/index.ts`, `stores/index.ts`.

## Key Subsystems

- **Pitch Detection DSP** (`useCases/dspAnalysis.ts`): Pitch detection analyzing raw audio buffers into pitch contours and note segmentation blobs.
- **Commit Flow** (`useCases/pitch/commitPitchEdit.ts`, `handlers/pitch/`): Bounces pitch-edited audio clips to new audio assets and updates track clip references.
- **State Hydration** (`useCases/hydrateKneadFromTrackStore.ts`): Synchronizes pitch edit data between track state and local editing stores.

## Invariants & Traps

- `commitPitchEdit` modifies track clip audio references atomically via injected pitch handlers (`getPitchHandlers`) to maintain DDD boundaries without cyclic imports.
- Note blob pitch shifts and formant preservation calculations must clamp within valid frequency and sample index bounds.
- Analyzed pitch contours are cached per clip audio asset to prevent redundant pitch analysis passes.
- `getPitchHandlers` exposes `commitPitchEdit` and `restoreClipFileId` across aggregate boundaries without direct circular dependencies (ADR 0011).

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

- `pnpm guard --profile focused -- pnpm test:run <changed-spec>`
- PR CI checks module boundaries; inspect that result after cross-module changes.
