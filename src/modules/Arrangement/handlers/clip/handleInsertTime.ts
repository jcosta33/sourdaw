import { createHandler } from '#/helpers/createHandler';
import { insertTime } from '../../useCases/timeOperations';

export const handleInsertTime = createHandler<'insertTime'>({
    execute: (a) => {
        insertTime(a.payload.atBeat, a.payload.durationBeats);
    },
    describe: () => ({ label: 'Insert time' }),
    undoable: true,
});
