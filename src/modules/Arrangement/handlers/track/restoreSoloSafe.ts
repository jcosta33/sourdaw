import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setSoloSafe } from '../../useCases/toggleTrackState/setSoloSafe';

import { toSoloStateExecutionResult } from './toSoloStateExecutionResult';

export const handleRestoreSoloSafe = createHandler<'restoreSoloSafe'>({
    execute: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (!track || track.soloSafe !== action.payload.expected) {
            return { status: 'conflict' };
        }
        return toSoloStateExecutionResult(
            setSoloSafe({
                trackId: track.id,
                soloSafe: action.payload.replacement,
                deferRuntimeEffect: true,
            })
        );
    },
    describe: () => ({ label: 'Restore solo-safe state', inverseAction: null }),
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.soloSafe ===
        action.payload.replacement,
    undoable: false,
});
