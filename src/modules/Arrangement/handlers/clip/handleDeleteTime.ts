import { createHandler } from '#/utils/createHandler';

import { deleteTime } from '../../useCases/timeOperations/deleteTime';

export const handleDeleteTime = createHandler<'deleteTime'>({
    execute: (alpha) => {
        deleteTime(alpha.payload.startBeat, alpha.payload.endBeat);
    },
    describe: () => ({ label: 'Delete time' }),
    undoable: false,
});
