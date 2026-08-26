# PunchRecording module — Agent Guidelines

Owns punch-in / punch-out recording boundaries, pre-roll / post-roll intervals, and background audio capture buffers for retrospective punch recording; does not own transport playback clock generation (Transport) or track arming / audio clip creation (Arrangement).

## Public Contract Surface

- `stores/`: `punchRecordingStore` (`PunchRecordingState`, `PunchRegion`, `BackgroundCapture`).
- `useCases/`: `definePunchRegion`, `commitPunchRegion`, `discardCapture`, `setPreRoll`, `setPostRoll`, `startBackgroundCapture`, `stopBackgroundCapture`, `togglePunchRecording`, `updateCapturePosition`, `getPunchRecordingHandlers`.
- `events/`: No public domain event payloads exported.
- `presentations/views/`: `PunchRecordingControls`.
- Handlers: `getPunchRecordingHandlers()`.

## Key Subsystems

- **Punch Store & State Machine:** `punchRecordingStore` manages punch region boundaries (in/out beats), pre-roll/post-roll values, and active recording mode.
- **Background Capture Engine:** Retrospective audio capture buffers allowing recovery and committing of audio before/after explicit punch marks.
- **Transport Synchronization:** Coordinates with Transport timeline playhead to automate record arming at exact musical boundaries.
- **Punch Controls Presentation:** `PunchRecordingControls` widget for setting locator bounds and toggling punch mode.

## Invariants & Traps

- **Boundary Invariant:** `punchIn` beat must always be strictly less than `punchOut` beat; pre-roll and post-roll values must be non-negative.
- **Buffer Teardown:** Committing or discarding background captures must cleanly release audio buffer memory references to prevent leaks.
- **Deterministic Triggering:** Punch state transitions must evaluate on exact beat boundaries without clock drift.

## Verification

```bash
pnpm vitest run src/modules/PunchRecording
pnpm deps:validate
```
