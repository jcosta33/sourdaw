import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { createHandler } from '#/utils/createHandler';

export const handleSelectTrack = createHandler<'selectTrack'>({
    execute: (action) => {
        selectTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Select track' }),
    undoable: false,
});
