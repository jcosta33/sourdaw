# SessionLauncher module — Agent Guidelines

Owns clip launcher matrix scenes, pad triggers, and live loop-station multi-layer recording state machines (ADR-0011 W4 dual aggregates); does not own linear timeline arrangement (Arrangement) or transport clock generation (Transport).

## Public Contract Surface

- `stores/`: `sessionLaunchStore` (`SessionLaunchState`), `loopStationStore` (`LoopSlot`, `LoopSlotState`, `LoopLayer`, `LoopStationState`).
- `useCases/`: Session launch (`launchSessionScene`, `stopAllSessionSlots`, `toggleSessionSlot`), loop station (`toggleRecord`, `triggerPad`, `triggerScene`, `triggerSlot`, `stopAllSlots`), `getSessionLauncherHandlers`.
- `events/`: No public domain event payloads exported.
- `presentations/views/`: `SessionView`, `LoopStationPanel`.
- Handlers: `getSessionLauncherHandlers()`.

## Key Subsystems

- **Dual Aggregate Model (ADR-0011 W4):**
    - `sessionLaunchStore`: Non-linear clip matrix triggering (`activeSlots`) for grid-based live performance.
    - `loopStationStore`: Multi-slot, multi-layer live looper state machine managing overdub layers, fixed loop lengths, and slot arming.
- **Quantized Launching:** Coordinates scene and slot launch requests to fire on musical bar/beat boundaries.
- **Performance Views:** `SessionView` renders the grid matrix UI; `LoopStationPanel` provides the live multi-pad looper interface.

## Invariants & Traps

- **Dual Aggregate Invariant:** Never unify `sessionLaunchStore` and `loopStationStore`; their separate lifecycles and models are an explicit ADR-0011 W4 architecture decision.
- **Quantized Trigger Queuing:** Scene and slot triggers must queue and wait for the quantizer tick before activating playback.
- **Non-Destructive Overdub:** Overdubbing looper layers must append new `LoopLayer` entries rather than mutating existing audio buffers.

## Verification

```bash
pnpm vitest run src/modules/SessionLauncher
pnpm deps:validate
```
