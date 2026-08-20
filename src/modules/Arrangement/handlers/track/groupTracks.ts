import { createHandler } from '#/utils/createHandler';

import { groupTracks } from '../../useCases/toggleTrackState/groupTracks';

export const handleGroupTracks = createHandler<'groupTracks'>({
    execute: (action) => {
        groupTracks(action.payload.trackIds, action.payload.name);
    },
    describe: (alpha) => ({ label: `Group tracks: "${alpha.payload.name}"` }),
    undoable: false,
});
