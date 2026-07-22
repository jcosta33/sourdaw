import { createHandler } from '#/utils/createHandler';

import { glueClips } from '../../useCases/clipEditing/glueClips';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleGlueClips = createHandler<'glueClips'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(glueClips(alpha.payload.clipIds));
    },
    describe: () => ({ label: 'Glue clips' }),
    undoable: true,
});
