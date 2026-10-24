import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { soloTrack } from '../../useCases/toggleTrackState/soloTrack';
import { getPlannedTrackState } from '../getPlannedTrackState';

function liveSoloed(trackId: string): boolean | undefined {
    return getTrackStoreState()?.tracks.find((track) => track.id === trackId)?.soloed;
}

export const handleSoloTrack = createHandler<'soloTrack'>({
    canReapplyAfterDivergence: (action) => action.payload.expectedSoloed !== undefined,
    // Conflicts when `expectedSoloed` no longer matches the live track, as muteTrack
    // does; undo step-over (#2881) relies on it, because a plain-click exclusive
    // solo rewrites solo flags without an undo entry.
    canReportConflict: true,
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
        // A guarded change gets a guarded inverse and redo, so an agent group's
        // undo refuses rather than overwriting a solo someone changed afterwards.
        // A manual solo stays unguarded: a plain-click exclusive solo rewrites
        // every solo flag without an undo entry, and a guarded inverse would then
        // refuse every undo and redo of the solos recorded before it.
        const guarded = action.payload.expectedSoloed !== undefined;
        return {
            label: action.payload.soloed ? 'Solo track' : 'Unsolo track',
            inverseAction: track
                ? {
                      type: 'soloTrack',
                      payload: guarded
                          ? { trackId: track.id, soloed: track.soloed, expectedSoloed: action.payload.soloed }
                          : { trackId: track.id, soloed: track.soloed },
                  }
                : null,
            redoAction: track
                ? {
                      type: 'soloTrack',
                      payload: guarded
                          ? { trackId: track.id, soloed: action.payload.soloed, expectedSoloed: track.soloed }
                          : { trackId: track.id, soloed: action.payload.soloed },
                  }
                : undefined,
        };
    },
    undoable: true,
});
