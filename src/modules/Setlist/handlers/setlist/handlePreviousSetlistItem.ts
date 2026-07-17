import { createHandler } from '#/utils/createHandler';

import { previousItem } from '../../useCases/setlist/previousItem';

export const handlePreviousSetlistItem = createHandler<'previousSetlistItem'>({
    execute: () => {
        previousItem();
    },
    describe: () => ({ label: 'Previous Setlist Item' }),
    undoable: false,
});
