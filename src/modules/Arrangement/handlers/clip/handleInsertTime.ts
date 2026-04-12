import { createHandler } from '#/utils/createHandler';
import { insertTime } from '../../useCases/timeOperations/duplicateTimeRange';

export const handleInsertTime = createHandler<'insertTime'>({
    execute: (a) => {
        insertTime(a.payload.atBeat, a.payload.durationBeats);
    },
    describe: () => ({ label: 'Insert time' }),
    undoable: true,
});
