import { createHandler } from '#/utils/createHandler';

import { duplicateTrack } from '../../useCases/duplicateTrack';

export const handleDuplicateTrack = createHandler<'duplicateTrack'>({
    execute: (action) => {
        duplicateTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Duplicate track' }),
    undoable: true,
});
