import { duplicateTrack } from '../../useCases/duplicateTrack';
import { createHandler } from '#/utils/createHandler';

export const handleDuplicateTrack = createHandler<'duplicateTrack'>({
    execute: (action) => {
        duplicateTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Duplicate track' }),
    undoable: true,
});
