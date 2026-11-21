import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type TrackHeightSnapshot } from '../../events/arrangementTrackAppActions';
import { DEFAULT_TRACK_HEIGHT } from '../../useCases/clampTrackHeight';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackStoreState } from '../../useCases/setTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';

// Track height is collaboration-live: another editor, or a later step by the same user,
// can resize a track between `describe()` capturing the prior heights and this handler
// applying them. Every named track must still hold the height it held at capture time,
// or the whole restore is refused rather than partially applied.
function heightsMatch(heights: readonly TrackHeightSnapshot[]): boolean {
    const tracks = getTrackStoreState()?.tracks;
    if (!tracks) {
        return false;
    }
    return heights.every((entry) => {
        const track = tracks.find((candidate) => candidate.id === entry.trackId);
        return track !== undefined && (track.height ?? DEFAULT_TRACK_HEIGHT) === entry.height;
    });
}

/** The same guard as `heightsMatch`, read against the heights the earlier actions of the batch leave. */
function plannedHeightsMatch(heights: readonly TrackHeightSnapshot[], context: HandlerValidationContext): boolean {
    return heights.every((entry) => {
        const track = getPlannedTrackState(context, entry.trackId);
        return track !== null && (track.height ?? DEFAULT_TRACK_HEIGHT) === entry.height;
    });
}

export const handleRestoreTrackHeights = createHandler<'restoreTrackHeights'>({
    // Every restore is guarded by the heights it expects, so it may be replayed after divergence.
    canReapplyAfterDivergence: () => true,
    validate: (action, context) => plannedHeightsMatch(action.payload.expected, context),
    validationRefusalReason: (action, context) =>
        plannedHeightsMatch(action.payload.expected, context)
            ? null
            : 'Track heights changed after the zoom or resize this restores',
    execute: (action) => {
        const state = getTrackStoreState();
        if (!state || !heightsMatch(action.payload.expected)) {
            return { status: 'conflict' };
        }
        const replacementByTrackId = new Map(
            action.payload.replacement.map((entry) => [entry.trackId, entry] as const)
        );
        setTrackStoreState({
            ...state,
            tracks: state.tracks.map((track) => {
                const replacement = replacementByTrackId.get(track.id);
                return replacement ? { ...track, height: replacement.height } : track;
            }),
        });
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore track heights', inverseAction: null }),
    isNoop: (action) => heightsMatch(action.payload.replacement),
    undoable: false,
});
