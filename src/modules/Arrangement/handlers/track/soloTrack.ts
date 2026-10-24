import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { soloTrack } from '../../useCases/toggleTrackState/soloTrack';
import { getPlannedTrackState } from '../getPlannedTrackState';

function liveSoloed(trackId: string): boolean | undefined {
    return getTrackStoreState()?.tracks.find((track) => track.id === trackId)?.soloed;
}

export const handleSoloTrack = createHandler<'soloTrack'>({
    canReapplyAfterDivergence: (action) => action.payload.expectedSoloed !== undefined,
    validate: (action, context) => {
        const currentSoloed = getPlannedTrackState(context, action.payload.trackId)?.soloed;
        return action.payload.expectedSoloed === undefined || currentSoloed === action.payload.expectedSoloed;
    },
    execute: (action) => {
        if (
            action.payload.expectedSoloed !== undefined &&
            liveSoloed(action.payload.trackId) !== action.payload.expectedSoloed
        ) {
            return { status: 'conflict' };
        }
        soloTrack(action.payload.trackId, action.payload.soloed);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const currentSoloed = liveSoloed(action.payload.trackId);
        return (
            (action.payload.expectedSoloed === undefined || currentSoloed === action.payload.expectedSoloed) &&
            currentSoloed === action.payload.soloed
        );
    },
    describe: (action, context) => {
        // `describe` runs for every action in a batch before any `execute`, so a
        // second `soloTrack` on the same track must predict from what the first
        // leaves it at, or its inverse would expect a state the batch never
        // produces.
        const track = context
            ? getPlannedTrackState(context, action.payload.trackId)
            : getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        // The inverse expects the solo state this action writes, so undo refuses
        // rather than overwriting a solo someone changed afterwards.
        return {
            label: action.payload.soloed ? 'Solo track' : 'Unsolo track',
            inverseAction: track
                ? {
                      type: 'soloTrack',
                      payload: { trackId: track.id, soloed: track.soloed, expectedSoloed: action.payload.soloed },
                  }
                : null,
            redoAction: track
                ? {
                      type: 'soloTrack',
                      payload: { trackId: track.id, soloed: action.payload.soloed, expectedSoloed: track.soloed },
                  }
                : undefined,
        };
    },
    undoable: true,
});
