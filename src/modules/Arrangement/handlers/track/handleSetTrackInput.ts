import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackInput } from '../../useCases/setTrackInput';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetTrackInput = createHandler<'setTrackInput'>({
    execute: (action) => {
        return toHandlerExecutionResult(setTrackInput(action.payload.trackId, action.payload.inputId));
    },
    describe: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return {
            label: 'Set track input',
            inverseAction: track
                ? {
                      type: 'restoreTrackInput',
                      payload: {
                          trackId: track.id,
                          expected: action.payload.inputId,
                          replacement: track.inputId,
                      },
                  }
                : null,
            redoAction: track
                ? {
                      type: 'restoreTrackInput',
                      payload: {
                          trackId: track.id,
                          expected: track.inputId,
                          replacement: action.payload.inputId,
                      },
                  }
                : action,
        };
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.inputId ===
        action.payload.inputId,
    undoable: true,
});
