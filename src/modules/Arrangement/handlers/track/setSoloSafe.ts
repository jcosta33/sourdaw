import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setSoloSafe } from '../../useCases/toggleTrackState/setSoloSafe';

import { toSoloStateExecutionResult } from './toSoloStateExecutionResult';

export const handleSetSoloSafe = createHandler<'setSoloSafe'>({
    execute: (action) => {
        return toSoloStateExecutionResult(
            setSoloSafe({
                trackId: action.payload.trackId,
                soloSafe: action.payload.soloSafe,
                deferRuntimeEffect: true,
            })
        );
    },
    describe: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return {
            label: action.payload.soloSafe ? 'Enable solo safe' : 'Disable solo safe',
            inverseAction: track
                ? {
                      type: 'restoreSoloSafe',
                      payload: {
                          trackId: track.id,
                          expected: action.payload.soloSafe,
                          replacement: track.soloSafe,
                      },
                  }
                : null,
            redoAction: track
                ? {
                      type: 'restoreSoloSafe',
                      payload: {
                          trackId: track.id,
                          expected: track.soloSafe,
                          replacement: action.payload.soloSafe,
                      },
                  }
                : action,
        };
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.soloSafe ===
        action.payload.soloSafe,
    undoable: true,
});
