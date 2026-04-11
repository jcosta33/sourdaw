import { createHandler } from '#/helpers/createHandler';
import { nextItem } from '#/modules/Transport/useCases';

export const handleNextSetlistItem = createHandler<'nextSetlistItem'>({
    execute: () => {
        nextItem();
    },
    describe: () => ({ label: 'Next Setlist Item' }),
    undoable: false,
});
