// Transport/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { playheadPositionRef } from './playheadPositionRef';
export { tempoProjectRevisionStore } from './tempoProjectRevisionStore';

export { captureGestureBeat } from './captureGestureBeat';
export { setGestureClockSource, type GestureClockSource } from './gestureClockSource';

export type { TempoMapStoreState } from './tempoMapStore';
export { tempoMapStore } from './tempoMapStore';

export type { TimeSignatureMapStoreState } from './timeSignatureMapStore';
export { timeSignatureMapStore } from './timeSignatureMapStore';

export { transportStore, defaultTransportState, DEFAULT_TEMPO_BPM, MIN_TEMPO, MAX_TEMPO } from './transportStore';
export type { TransportState } from './transportStore';

export { readTempoAtBeat } from './readTempoAtBeat';
export { readSecondsAtBeat } from './readSecondsAtBeat';
export { readBeatAtSamples } from './readBeatAtSamples';
