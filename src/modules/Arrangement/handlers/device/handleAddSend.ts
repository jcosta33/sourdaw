import { createHandler } from '#/utils/createHandler';

import { setSend } from '../../useCases/device/sendManagement/setSend';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleAddSend = createHandler<'addSend'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(setSend(alpha.payload.trackId, alpha.payload.busId, alpha.payload.level));
    },
    describe: () => ({ label: 'Add send' }),
    undoable: true,
});
