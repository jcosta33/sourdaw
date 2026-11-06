import { createHandler } from '#/utils/createHandler';

import { previousItem } from '../../useCases/setlist/previousItem';

export const handlePreviousSetlistItem = createHandler<'previousSetlistItem'>({
    execute: async () => {
        await previousItem();
    },
    describe: () => ({ label: 'Previous Setlist Item' }),
    undoable: false,
    executionKind: 'runtime',
});
