import { createHandler } from '#/utils/createHandler';

import { addClip } from '../../useCases/clip/addClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleAddClip = createHandler<'addClip'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(addClip(alpha.payload) !== null);
    },
    describe: (alpha) => ({ label: `Add clip "${alpha.payload.name}"` }),
    undoable: true,
});
