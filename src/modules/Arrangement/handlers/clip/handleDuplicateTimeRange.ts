import { createHandler } from '#/utils/createHandler';

import { duplicateTimeRange } from '../../useCases/timeOperations/duplicateTimeRange';

export const handleDuplicateTimeRange = createHandler<'duplicateTimeRange'>({
    execute: (a) => {
        duplicateTimeRange(a.payload.startBeat, a.payload.endBeat);
    },
    describe: () => ({ label: 'Duplicate time range' }),
    undoable: true,
});
