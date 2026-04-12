import { createHandler } from '#/utils/createHandler';
import { ungroupTracks } from '#/modules/Arrangement/useCases/toggleTrackState/ungroupTracks';

export const handleUngroupTracks = createHandler<'ungroupTracks'>({
    execute: (action) => {
        ungroupTracks(action.payload.groupId);
    },
    describe: () => ({ label: 'Ungroup tracks' }),
    undoable: true,
});
