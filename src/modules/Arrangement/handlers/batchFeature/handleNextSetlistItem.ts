import { createHandler } from '#/helpers/createHandler';
import { nextItem } from '#/modules/Transport';

export const handleNextSetlistItem = createHandler<'nextSetlistItem'>({
    execute: () => {
        nextItem();
    },
    describe: () => ({ label: 'Next Setlist Item' }),
    undoable: false,
});
