import { createHandler } from '#/utils/createHandler';

import { nextItem } from '../../useCases/setlist/nextItem';

export const handleNextSetlistItem = createHandler<'nextSetlistItem'>({
    execute: () => {
        nextItem();
    },
    describe: () => ({ label: 'Next Setlist Item' }),
    undoable: false,
});
