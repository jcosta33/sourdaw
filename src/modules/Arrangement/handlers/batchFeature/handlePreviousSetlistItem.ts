import { createHandler } from '#/helpers/createHandler';
import { previousItem } from '#/modules/Transport';

export const handlePreviousSetlistItem = createHandler<'previousSetlistItem'>({
    execute: () => {
        previousItem();
    },
    describe: () => ({ label: 'Previous Setlist Item' }),
    undoable: false,
});
