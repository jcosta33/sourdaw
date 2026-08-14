// Arrangement/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { clipSelectionStore, defaultClipSelectionState } from './clipSelectionStore';
export type { ClipSelectionState, MarqueeSelection } from './clipSelectionStore';
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
    setTimelineViewportHeight,
} from './timelineViewStore';
export type { TimelineViewState } from './timelineViewStore';

export { trackStore, defaultTrackState, sanitizeTrackSnapshot } from './trackStore';
export type { TrackStoreState, Track, Device, DeviceStateChunk, DeviceStateValue, Clip } from './trackStore';
export { persistDeviceParam } from './persistDeviceParam';
export { clampDeviceParamWrite } from './clampDeviceParamWrite';
export { resolveEligibleDeviceWriteTarget } from './resolveEligibleDeviceWriteTarget';
export type { DeviceWriteTargetResolution } from './resolveEligibleDeviceWriteTarget';
export { resolveEligibleClipWriteTarget } from './resolveEligibleClipWriteTarget';
export type { ClipWriteTargetResolution } from './resolveEligibleClipWriteTarget';
export { updateClipInStore } from './updateClipInStore';
export { appendClipToTrack } from './appendClipToTrack';
export { appendTrack } from './appendTrack';
export { getTrackEligibility, shouldCreateLiveTrackStrip } from './trackEligibility';

// Effective-audibility read model (mute ∪ solo): projects the authoritative live
// solo planner into a per-track audibility map the offline exporter consumes,
// closing the store-vs-engine solo split without duplicating the math (OE-4).
export { deriveEffectiveAudibility, hasActiveSolo } from './effectiveAudibility';
export type { EffectiveAudibility, EffectiveAudibilityInput } from './effectiveAudibility';

export { adjustmentLayerStore, EFFECT_PRESETS, LAYER_COLORS } from './adjustmentLayer';
export type {
    AdjustmentEffectType,
    AdjustmentLayer,
    AdjustmentLayerState,
    AdjustmentParameter,
    AdjustmentRegion,
} from './adjustmentLayer';

export { vcaGroupStore, defaultVcaGroupState, deriveVcaMultiplier, getVcaGroupsState } from './vcaGroupStore';
export type { VcaGroupState } from './vcaGroupStore';

export { grooveStore } from './grooveStore';
export type { GrooveState, GrooveTemplate } from './grooveStore';

export { gainEnvelopeStore, defaultGainEnvelopeStoreState } from './gainEnvelopeStore';
export type { GainEnvelopeStoreState, ClipGainEnvelope, GainEnvelopePoint } from './gainEnvelopeStore';

export { warpStates, getWarpState, addWarpMarker } from './warpStates';

export { mixerSnapshotStore } from './mixerSnapshotStore';
export type { MixerSnapshotState } from './mixerSnapshotStore';
