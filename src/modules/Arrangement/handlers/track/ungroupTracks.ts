import { createHandler } from '#/utils/createHandler';

import { ungroupTracks } from '../../useCases/toggleTrackState/ungroupTracks';

export const handleUngroupTracks = createHandler<'ungroupTracks'>({
    execute: (action) => {
        ungroupTracks(action.payload.groupId);
    },
    describe: () => ({ label: 'Ungroup tracks' }),
    undoable: false,
});
