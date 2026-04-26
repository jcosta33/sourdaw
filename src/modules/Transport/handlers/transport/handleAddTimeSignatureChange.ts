import { createHandler } from '#/utils/createHandler';

import { addTimeSignatureChange } from '../../useCases/timeSignatureChanges/addTimeSignatureChange';

export const handleAddTimeSignatureChange = createHandler<'addTimeSignatureChange'>({
    execute: (alpha) => {
        addTimeSignatureChange(alpha.payload.beat, alpha.payload.numerator, alpha.payload.denominator);
    },
    describe: (alpha) => ({
        label: `Set time signature ${alpha.payload.numerator}/${alpha.payload.denominator} at beat ${alpha.payload.beat}`,
    }),
    undoable: true,
});
