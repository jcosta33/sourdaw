import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { foldTrack } from '../../useCases/toggleTrackState/foldTrack';

import { describeMissingTrack, readPlannedDisplayTrack } from './readPlannedDisplayTrack';

type FoldTrackAction = Extract<AppAction, { type: 'foldTrack' }>;

function findRefusal(action: FoldTrackAction, context: HandlerValidationContext): string | null {
    const { trackId, expectedFolded } = action.payload;
    const track = readPlannedDisplayTrack(trackId, context);
    if (track === null) {
        return describeMissingTrack(trackId);
    }
    if (track.kind !== 'folder') {
        return `Track "${trackId}" is not a folder, so it has nothing to fold`;
    }
    return expectedFolded === undefined || track.collapsed === expectedFolded
        ? null
        : `Track "${trackId}" was folded or unfolded after the edit this restores`;
}

// The store field is `collapsed`; the action payload calls it `folded`.
function readLiveFolded(trackId: string): boolean | undefined {
    return getTrackStoreState()?.tracks.find((track) => track.id === trackId)?.collapsed;
}

export const handleFoldTrack = createHandler<'foldTrack'>({
    // Only a restore guarded by the state it expects can be replayed after divergence.
    canReapplyAfterDivergence: (action) => action.payload.expectedFolded !== undefined,
    validate: (action, context) => findRefusal(action, context) === null,
    validationRefusalReason: findRefusal,
    isNoop: (action) => {
        const folded = readLiveFolded(action.payload.trackId);
        return folded === action.payload.folded && (action.payload.expectedFolded ?? folded) === folded;
    },
    execute: (action) => {
        const { trackId, folded, expectedFolded } = action.payload;
        if (expectedFolded !== undefined && readLiveFolded(trackId) !== expectedFolded) {
            return { status: 'conflict' };
        }
        foldTrack(trackId, folded);
        return { status: 'written' };
    },
    describe: (alpha, context) => {
        // Re-folding an already-folded track is a forward no-op, so the inverse restores the
        // state this action finds, as earlier actions of its batch leave it, instead of
        // negating the payload. Both legs name the state they expect, so a later edit conflicts.
        const { trackId, folded } = alpha.payload;
        const prev = readPlannedDisplayTrack(trackId, context);
        // A batch describes every action before executing any, so a missing track is refused here with its reason.
        if (!prev && context) {
            throw new Error(describeMissingTrack(trackId));
        }
        const label = folded ? 'Fold track' : 'Unfold track';
        if (!prev) {
            return { label, inverseAction: null };
        }
        return {
            label,
            inverseAction: {
                type: 'foldTrack',
                payload: { trackId: prev.id, folded: prev.collapsed, expectedFolded: folded },
            },
            redoAction: { type: 'foldTrack', payload: { trackId: prev.id, folded, expectedFolded: prev.collapsed } },
        };
    },
    undoable: true,
});
