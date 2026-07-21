import { createHandler } from '#/utils/createHandler';

import { setTrackOutput } from '../../useCases/toggleTrackState/setTrackOutput';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetTrackOutput = createHandler<'setTrackOutput'>({
    execute: (action) => {
        return toHandlerExecutionResult(setTrackOutput(action.payload.trackId, action.payload.outputId));
    },
    describe: () => ({ label: 'Set track output' }),
    undoable: true,
});
