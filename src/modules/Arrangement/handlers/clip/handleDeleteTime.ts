import { createHandler } from '#/helpers/createHandler';
import { deleteTime } from '../../useCases/timeOperations';

export const handleDeleteTime = createHandler<'deleteTime'>({
    execute: (a) => {
        deleteTime(a.payload.startBeat, a.payload.endBeat);
    },
    describe: () => ({ label: 'Delete time' }),
    undoable: true,
});
