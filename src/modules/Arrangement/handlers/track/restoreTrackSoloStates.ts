import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { restoreTrackSoloStates } from '../../useCases/toggleTrackState/restoreTrackSoloStates';

import { toSoloStateExecutionResult } from './toSoloStateExecutionResult';

type TrackSoloState = { trackId: string; soloed: boolean };

function statesMatch(states: readonly TrackSoloState[]): boolean {
    const tracks = getTrackStoreState()?.tracks;
    return Boolean(
        tracks &&
        states.length > 0 &&
        new Set(states.map((state) => state.trackId)).size === states.length &&
        states.every((state) => tracks.find((track) => track.id === state.trackId)?.soloed === state.soloed)
    );
}

function haveSameTrackIds(left: readonly TrackSoloState[], right: readonly TrackSoloState[]): boolean {
    const leftIds = new Set(left.map((state) => state.trackId));
    const rightIds = new Set(right.map((state) => state.trackId));
    if (leftIds.size !== left.length || rightIds.size !== right.length || leftIds.size !== rightIds.size) {
        return false;
    }
    return [...leftIds].every((trackId) => rightIds.has(trackId));
}

export const handleRestoreTrackSoloStates = createHandler<'restoreTrackSoloStates'>({
    execute: (action) => {
        if (
            !haveSameTrackIds(action.payload.expected, action.payload.replacement) ||
            !statesMatch(action.payload.expected)
        ) {
            return { status: 'conflict' };
        }
        return toSoloStateExecutionResult(
            restoreTrackSoloStates({ states: action.payload.replacement, deferRuntimeEffect: true })
        );
    },
    describe: () => ({ label: 'Restore track solo states', inverseAction: null }),
    isNoop: (action) =>
        haveSameTrackIds(action.payload.expected, action.payload.replacement) &&
        statesMatch(action.payload.replacement),
    undoable: false,
});
