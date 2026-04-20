import { createHandler } from '#/utils/createHandler';

import { removeTimeSignatureChange } from '../../useCases/timeSignatureChanges/removeTimeSignatureChange';

export const handleRemoveTimeSignatureChange = createHandler<'removeTimeSignatureChange'>({
    execute: (a) => {
        removeTimeSignatureChange(a.payload.beat);
    },
    describe: (a) => ({ label: `Remove time signature change at beat ${a.payload.beat}` }),
    undoable: true,
});
