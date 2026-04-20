import { previousItem } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';

export const handlePreviousSetlistItem = createHandler<'previousSetlistItem'>({
    execute: () => {
        previousItem();
    },
    describe: () => ({ label: 'Previous Setlist Item' }),
    undoable: false,
});
