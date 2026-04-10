import { createHandler } from '#/helpers/createHandler';
import { duplicateTimeRange } from '../../useCases/timeOperations';

export const handleDuplicateTimeRange = createHandler<'duplicateTimeRange'>({
    execute: (a) => {
        duplicateTimeRange(a.payload.startBeat, a.payload.endBeat);
    },
    describe: () => ({ label: 'Duplicate time range' }),
    undoable: true,
});
