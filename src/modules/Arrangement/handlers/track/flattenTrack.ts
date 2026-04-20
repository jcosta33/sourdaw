import { createHandler } from '#/utils/createHandler';
import { flattenTrack } from '../../useCases/freezeBounce/flattenTrack';

export const handleFlattenTrack = createHandler<'flattenTrack'>({
    execute: (action) => {
        flattenTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Flatten track' }),
    undoable: true,
});
