import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';
import { MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT } from '#/utils/trackHeightLimits';

import { clampTrackHeight } from '../../useCases/clampTrackHeight';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackHeight } from '../../useCases/toggleTrackState/setTrackHeight';

import { describeMissingTrack, readPlannedDisplayTrack } from './readPlannedDisplayTrack';

type SetTrackHeightAction = Extract<AppAction, { type: 'setTrackHeight' }>;

function findRefusal(action: SetTrackHeightAction, context: HandlerValidationContext): string | null {
    const { trackId, height, expectedHeight } = action.payload;
    const track = readPlannedDisplayTrack(trackId, context);
    if (track === null) {
        return describeMissingTrack(trackId);
    }
    if (expectedHeight !== undefined) {
        return track.height === expectedHeight ? null : `Track "${trackId}" was resized after the edit this restores`;
    }
    // The writer would clamp this, silently landing on a height the request never named.
    return Number.isFinite(height) && height >= MIN_TRACK_HEIGHT && height <= MAX_TRACK_HEIGHT
        ? null
        : `Track height ${height} is outside ${MIN_TRACK_HEIGHT} to ${MAX_TRACK_HEIGHT}`;
}

function readLiveHeight(trackId: string): number | undefined {
    return getTrackStoreState()?.tracks.find((track) => track.id === trackId)?.height;
}

export const handleSetTrackHeight = createHandler<'setTrackHeight'>({
    // Only a restore guarded by the height it expects can be replayed after divergence.
    canReapplyAfterDivergence: (action) => action.payload.expectedHeight !== undefined,
    validate: (action, context) => findRefusal(action, context) === null,
    validationRefusalReason: findRefusal,
    isNoop: (action) => {
        const height = readLiveHeight(action.payload.trackId);
        return height === clampTrackHeight(action.payload.height, 0) && (action.payload.expectedHeight ?? height) === height;
    },
    execute: (action) => {
        const { trackId, height, expectedHeight } = action.payload;
        if (expectedHeight !== undefined && readLiveHeight(trackId) !== expectedHeight) {
            return { status: 'conflict' };
        }
        setTrackHeight(trackId, height);
        return { status: 'written' };
    },
    describe: (alpha, context) => {
        // The forward setter clamps height, so each leg expects the height as the writer stores it:
        // the inverse restores the height this action finds, as earlier actions of its batch leave
        // it, and a later resize conflicts with either leg.
        const prev = readPlannedDisplayTrack(alpha.payload.trackId, context);
        // A batch describes every action before executing any, so a missing track is refused here with its reason.
        if (!prev && context) {
            throw new Error(describeMissingTrack(alpha.payload.trackId));
        }
        if (!prev) {
            return { label: 'Set track height', inverseAction: null };
        }
        const written = clampTrackHeight(alpha.payload.height, 0);
        const stored = clampTrackHeight(prev.height, 0);
        return {
            label: 'Set track height',
            inverseAction: {
                type: 'setTrackHeight',
                payload: { trackId: prev.id, height: prev.height, expectedHeight: written },
            },
            redoAction: {
                type: 'setTrackHeight',
                payload: { trackId: prev.id, height: written, expectedHeight: stored },
            },
        };
    },
    undoable: true,
});
