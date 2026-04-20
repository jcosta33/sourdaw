import { nextItem } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleNextSetlistItem = createHandler<'nextSetlistItem'>({
    execute: () => {
        nextItem();
    },
    describe: () => ({ label: 'Next Setlist Item' }),
    undoable: false,
});
