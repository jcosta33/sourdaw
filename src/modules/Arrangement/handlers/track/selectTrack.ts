import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { createHandler } from '#/helpers/createHandler';

export const handleSelectTrack = createHandler<'selectTrack'>({
    execute: (action) => {
        selectTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Select track' }),
    undoable: false,
});
