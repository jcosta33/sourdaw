import { createHandler } from '#/utils/createHandler';
import { addTimeSignatureChange } from '../../useCases/timeSignatureChanges/addTimeSignatureChange';

export const handleAddTimeSignatureChange = createHandler<'addTimeSignatureChange'>({
    execute: (a) => {
        addTimeSignatureChange(a.payload.beat, a.payload.numerator, a.payload.denominator);
    },
    describe: (a) => ({
        label: `Set time signature ${a.payload.numerator}/${a.payload.denominator} at beat ${a.payload.beat}`,
    }),
    undoable: true,
});
