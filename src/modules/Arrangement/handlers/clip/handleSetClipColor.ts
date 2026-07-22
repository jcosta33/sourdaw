import { createHandler } from '#/utils/createHandler';

import { setClipColor } from '../../useCases/clipEditing/setClipColor';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetClipColor = createHandler<'setClipColor'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(setClipColor(alpha.payload.clipId, alpha.payload.color));
    },
    describe: () => ({ label: 'Set clip color' }),
    undoable: true,
});
