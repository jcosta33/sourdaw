import { createHandler } from '#/helpers/createHandler';
import { removeTimeSignatureChange } from '../../useCases/timeSignatureChanges';

export const handleRemoveTimeSignatureChange = createHandler<'removeTimeSignatureChange'>({
    execute: (a) => {
        removeTimeSignatureChange(a.payload.beat);
    },
    describe: (a) => ({ label: `Remove time signature change at beat ${a.payload.beat}` }),
    undoable: true,
});
