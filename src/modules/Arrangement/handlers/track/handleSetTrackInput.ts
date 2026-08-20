import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackInput } from '../../useCases/setTrackInput';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetTrackInput = createHandler<'setTrackInput'>({
    execute: (action) => {
        return toHandlerExecutionResult(setTrackInput(action.payload.trackId, action.payload.inputId));
    },
    describe: (action) => {
        const prev = getTrackStoreState()?.tracks.find((t) => t.id === action.payload.trackId);
        return {
            label: 'Set track input',
            inverseAction: prev
                ? {
                      type: 'setTrackInput',
                      payload: {
                          trackId: action.payload.trackId,
                          inputId: prev.inputId ?? null,
                      },
                  }
                : null,
            redoAction: action,
        };
    },
    undoable: true,
});
