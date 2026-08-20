import { createHandler } from '#/utils/createHandler';

import { insertTime } from '../../useCases/timeOperations/insertTime';

export const handleInsertTime = createHandler<'insertTime'>({
    execute: (alpha) => {
        insertTime(alpha.payload.atBeat, alpha.payload.durationBeats);
    },
    describe: () => ({ label: 'Insert time' }),
    undoable: false,
});
