import { createHandler } from '#/utils/createHandler';

import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';

export const handleSelectTrack = createHandler<'selectTrack'>({
    execute: (action) => {
        selectTrack(action.payload.trackId);
    },
    describe: () => ({ label: 'Select track' }),
    undoable: false,
});
