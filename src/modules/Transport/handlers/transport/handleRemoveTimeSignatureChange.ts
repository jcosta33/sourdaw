import { createHandler } from '#/utils/createHandler';

import { removeTimeSignatureChange } from '../../useCases/timeSignatureChanges/removeTimeSignatureChange';

export const handleRemoveTimeSignatureChange = createHandler<'removeTimeSignatureChange'>({
    execute: (alpha) => {
        removeTimeSignatureChange(alpha.payload.beat);
    },
    describe: (alpha) => ({ label: `Remove time signature change at beat ${alpha.payload.beat}` }),
    undoable: true,
});
