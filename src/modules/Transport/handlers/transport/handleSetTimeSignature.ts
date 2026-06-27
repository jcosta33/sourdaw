import { createHandler } from '#/utils/createHandler';

import { setTimeSignature } from '../../useCases/setTimeSignature';

export const handleSetTimeSignature = createHandler<'setTimeSignature'>({
    execute: (action) => {
        setTimeSignature(action.payload.numerator, action.payload.denominator);
    },
    describe: (action) => ({
        label: `Set time signature ${action.payload.numerator}/${action.payload.denominator}`,
    }),
    undoable: true,
});
