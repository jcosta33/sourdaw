# Yeast module — Agent Guidelines

Generative MIDI processor rack and real-time transformation pipeline (arpeggiator, chord memory, harmonizer, scale quantizer, Markov chain, note repeater, euclidean generator, humanizer, CC generator, mutation engine, and groove extraction); does not own MIDI hardware I/O or instrument sound generation (MIDI/AudioEngine).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `processRealtimeMidiInput`, `processYeastMidi`, `readYeastPreviewSnapshot`, `setYeastPreviewCaptureEnabled`, `yeastPanic`, `configureYeastRuntime`, `setYeastGrooveTemplate`, `hydrateYeastState`, `hydrateYeastCrdtProjection`, `sendYeastProcessorCommand`, `teardownYeastRuntime`, `getYeastSchedulingLookahead`, `createOfflineYeastMidiProcessor`, `subscribeYeastPreview`, `reorderYeastProcessor`.
- **Stores** (`stores/index.ts`): `getPinnedYeastDevice`, `readAllYeastRacks`, `readYeastRack`, `readYeastRackForTrack`, `setActiveYeastDevice`, `yeastDeviceIdsInProjectOrder`, `yeastStore`, `LEGACY_SHARED_RACK_DEVICE_ID`, `setYeastEventBus`, `YeastState`, `YeastProcessorInfo`, `YeastProcessorType`.
- **Events** (`events/index.ts`): `YeastNoteOffIdentity`, `YeastNotesOffPayload`.
- **Views** (`presentations/views/index.ts`): `YeastPanel`.

## Key Subsystems

- **Worker Concurrency** (`workers/yeastWorker.ts`, `engine/YeastWorkerClient.ts`): Off-main-thread MIDI processing worker hosting `MidiRack`, `MidiProcessor`, and `YeastPreviewSidecar`.
- **Generative Processors** (`workers/processors/`): Arpeggiator, ChordGenerator, ChordMemory, EuclideanGenerator, GrooveModule, Harmonizer, Humanizer, MarkovChain, MutationEngine, NoteFilter, NoteRepeater, ScaleQuantizer, Transposer, VelocityProcessor, CCGenerator.
- **Scheduling Bridge** (`useCases/yeastSchedulingBridge/`): Bridges timeline playback and live MIDI input with worker scheduling queues and lookahead windows.
- **CRDT Persistence** (`stores/yeastAutomergeStorage.ts`): Multi-rack document state persistence and project synchronization.
- **Hanging Note Guard** (`events/YeastNotesOffPayload.ts`): Emits `yeast.notesOff` to clear stuck notes when processors are removed or bypassed mid-stream.

## Invariants & Traps

- Removing or bypassing a processor mid-playback emits explicit channel-complete Note Off identities via `yeast.notesOff` to prevent hanging synthesizer voices downstream.
- Live MIDI processing runs asynchronously in `yeastWorker.ts`; offline audio rendering creates a synchronous offline processor (`createOfflineYeastMidiProcessor`).
- Randomization in arpeggiation and pattern mutation uses seed-deterministic linear congruential generators (`lcgRandom.ts`).

## Verification

- `pnpm vitest run src/modules/Yeast`
- `pnpm deps:validate`
