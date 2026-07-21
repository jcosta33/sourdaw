import { createHandler } from '#/utils/createHandler';

import { setTrackInput } from '../../useCases/setTrackInput';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetTrackInput = createHandler<'setTrackInput'>({
    execute: (action) => {
        return toHandlerExecutionResult(setTrackInput(action.payload.trackId, action.payload.inputId));
    },
    describe: () => ({ label: 'Set track input' }),
    undoable: true,
});
