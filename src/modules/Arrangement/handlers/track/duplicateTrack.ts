import { duplicateTrack } from '../../useCases/duplicateTrack';
import { createHandler } from '#/helpers/createHandler';

export const handleDuplicateTrack = createHandler<'duplicateTrack'>({
    execute: (action) => {
        duplicateTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Duplicate track' }),
    undoable: true,
});
