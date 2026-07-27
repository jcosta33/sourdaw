import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { renameTrack } from '../../useCases/renameTrack';

export const handleRenameTrack = createHandler<'renameTrack'>({
    execute: (action) => {
        renameTrack(action.payload.trackId, action.payload.name);
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.name === action.payload.name,
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return {
            label: `Rename track to "${alpha.payload.name}"`,
            inverseAction: prev ? { type: 'renameTrack', payload: { trackId: prev.id, name: prev.name } } : null,
        };
    },
    undoable: true,
});
