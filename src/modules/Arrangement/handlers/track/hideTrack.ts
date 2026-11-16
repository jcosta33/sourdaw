import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { hideTrack } from '../../useCases/toggleTrackState/hideTrack';

import { describeMissingTrack, readPlannedDisplayTrack } from './readPlannedDisplayTrack';

type HideTrackAction = Extract<AppAction, { type: 'hideTrack' }>;

function findRefusal(action: HideTrackAction, context: HandlerValidationContext): string | null {
    const { trackId, expectedHidden } = action.payload;
    const track = readPlannedDisplayTrack(trackId, context);
    if (track === null) {
        return describeMissingTrack(trackId);
    }
    return expectedHidden === undefined || track.hidden === expectedHidden
        ? null
        : `Track "${trackId}" was shown or hidden after the edit this restores`;
}

function readLiveHidden(trackId: string): boolean | undefined {
    return getTrackStoreState()?.tracks.find((track) => track.id === trackId)?.hidden;
}

export const handleHideTrack = createHandler<'hideTrack'>({
    // Only a restore guarded by the state it expects can be replayed after divergence.
    canReapplyAfterDivergence: (action) => action.payload.expectedHidden !== undefined,
    validate: (action, context) => findRefusal(action, context) === null,
    validationRefusalReason: findRefusal,
    isNoop: (action) => {
        const hidden = readLiveHidden(action.payload.trackId);
        return hidden === action.payload.hidden && (action.payload.expectedHidden ?? hidden) === hidden;
    },
    execute: (action) => {
        const { trackId, hidden, expectedHidden } = action.payload;
        if (expectedHidden !== undefined && readLiveHidden(trackId) !== expectedHidden) {
            return { status: 'conflict' };
        }
        hideTrack(trackId, hidden);
        return { status: 'written' };
    },
    describe: (alpha, context) => {
        // Re-hiding an already-hidden track is a forward no-op, so the inverse restores the
        // state this action finds, as earlier actions of its batch leave it, instead of
        // negating the payload. Both legs name the state they expect, so a later edit conflicts.
        const { trackId, hidden } = alpha.payload;
        const prev = readPlannedDisplayTrack(trackId, context);
        return {
            label: hidden ? 'Hide track' : 'Show track',
            inverseAction: prev
                ? { type: 'hideTrack', payload: { trackId: prev.id, hidden: prev.hidden, expectedHidden: hidden } }
                : null,
            redoAction: prev
                ? { type: 'hideTrack', payload: { trackId: prev.id, hidden, expectedHidden: prev.hidden } }
                : undefined,
        };
    },
    undoable: true,
});
