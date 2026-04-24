// Arrangement/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { markerStore } from './markerStore';
export type { MarkerStoreState } from './markerStore';

export { scratchPadStore } from './scratchPadStore';
export type { ScratchPadStoreState } from './scratchPadStore';

export { takeLaneStore } from './takeLaneStore';
export type { TakeLaneStoreState } from './takeLaneStore';

export {
    timelineViewStore,
    zoomTimeline,
    scrollTimeline,
    setScrollX,
    setAutoScroll,
    toggleAutoScroll,
    setScrollY,
} from './timelineViewStore';
export type { TimelineViewState } from './timelineViewStore';

export { trackStore, defaultTrackState } from './trackStore';
export type { TrackStoreState, Track } from './trackStore';
export { persistDeviceParam } from './persistDeviceParam';
export { updateClipInStore } from './updateClipInStore';
export { appendClipToTrack } from './appendClipToTrack';
export { appendTrack } from './appendTrack';

export type { AdjustmentEffectType } from './adjustmentLayer';

export { vcaGroupStore, defaultVcaGroupState } from './vcaGroupStore';
export type { VcaGroupState } from './vcaGroupStore';

export { gainEnvelopeStore, defaultGainEnvelopeStoreState } from './gainEnvelopeStore';
export type { GainEnvelopeStoreState, ClipGainEnvelope, GainEnvelopePoint } from './gainEnvelopeStore';
