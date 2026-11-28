// Transport/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { playheadPositionRef } from './playheadPositionRef';
export { playheadClockRef } from './playheadClockRef';
export { playheadWrapCountRef } from './playheadWrapCountRef';
export { tempoProjectRevisionStore } from './tempoProjectRevisionStore';

export { captureGestureBeat, captureGestureClock } from './captureGestureBeat';
export { setGestureClockSource, type GestureClockSource } from './gestureClockSource';

export type { TempoMapStoreState } from './tempoMapStore';
export { sanitize_tempo_map_state, tempoMapStore } from './tempoMapStore';

export type { TimeSignatureMapStoreState } from './timeSignatureMapStore';
export { timeSignatureMapStore } from './timeSignatureMapStore';

export {
    transportStore,
    sanitize_transport_snapshot,
    defaultTransportState,
    DEFAULT_TEMPO_BPM,
    MIN_TEMPO,
    MAX_TEMPO,
} from './transportStore';
export type { TransportState } from './transportStore';

export { readRecordingEngaged } from './readRecordingEngaged';
export { recordingStartStore } from './recordingStartStore';

export { readTempoAtBeat } from './readTempoAtBeat';
export { readSecondsAtBeat } from './readSecondsAtBeat';
export { readBeatAtSamples } from './readBeatAtSamples';
export { readBarStartBeat } from './readBarStartBeat';
export { readBarAtBeat } from './readBarAtBeat';
export { readNextPhysicalBarBoundary } from './readNextPhysicalBarBoundary';
export { readTempoMapEditTargets } from './readTempoMapEditTargets';

export type { DeferredTempoRecordingSources } from './deferredTempoRecordingSources';
export { withoutDeferredTempoRecordingSources } from './deferredTempoRecordingSources';
export { getTempoAudioSourceRequirements, tempoAudioSourceCoverageMatches } from './tempoAudioSourceCoverage';
export type {
    TempoScalarTransition,
    TempoSourceClock,
    TempoSourceClockPath,
    TempoSourceOwner,
    TempoSourceOwnerWitness,
} from './tempoAudioSourcePromotion';
export {
    captureTempoSourceOwnerValue,
    isTempoAudioSourcePromotion,
    normalizeTempoSourceClockContext,
    normalizeTempoSourceOwnerContext,
    projectTempoSourceClock,
    readTempoSourceClockValue,
    readTempoSourceOwner,
    tempoSourceOwnerWitnessMatches,
    tempoSourcePromotionsEqual,
} from './tempoAudioSourcePromotion';
