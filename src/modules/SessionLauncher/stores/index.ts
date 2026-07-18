// SessionLauncher/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.
//
// One bounded context, two aggregates (ADR-0011 W4). These stores are NOT unified:
//   • sessionLaunchStore — bare UI slot map (activeSlots), unwired to playback.
//   • loopStationStore   — full live-looper state machine (layers/overdub/scenes).
// Merging them would require inventing semantics; the ADR residual-risk fallback
// mandates one module owning two aggregates instead.

export { sessionLaunchStore } from './sessionLaunchStore';
export type { SessionLaunchState } from './sessionLaunchStore';

export { loopStationStore } from './loopStationStore';
export type { LoopSlot, LoopSlotState, LoopLayer, LoopStationState } from './loopStationStore';
