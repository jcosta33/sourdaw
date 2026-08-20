import { createHandler } from '#/utils/createHandler';

import { duplicateTimeRange } from '../../useCases/timeOperations/duplicateTimeRange';

export const handleDuplicateTimeRange = createHandler<'duplicateTimeRange'>({
    execute: (alpha) => {
        duplicateTimeRange(alpha.payload.startBeat, alpha.payload.endBeat);
    },
    describe: () => ({ label: 'Duplicate time range' }),
    undoable: false,
});
