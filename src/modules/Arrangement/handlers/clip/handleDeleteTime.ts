import { createHandler } from '#/utils/createHandler';

import { deleteTime } from '../../useCases/timeOperations/deleteTime';

export const handleDeleteTime = createHandler<'deleteTime'>({
    execute: (a) => {
        deleteTime(a.payload.startBeat, a.payload.endBeat);
    },
    describe: () => ({ label: 'Delete time' }),
    undoable: true,
});
