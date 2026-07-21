import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { reorderTrack } from '../../useCases/toggleTrackState/reorderTrack';

export const handleReorderTrack = createHandler<'reorderTrack'>({
    execute: (action) => {
        reorderTrack(action.payload.trackId, action.payload.newIndex);
    },
    describe: (alpha) => {
        // The forward reorder clamps newIndex into range, so the inverse restores
        // the captured pre-move index rather than deriving one from the payload.
        const tracks = getTrackStoreState()?.tracks;
        const currentIndex = tracks?.findIndex((time) => time.id === alpha.payload.trackId) ?? -1;
        return {
            label: 'Reorder track',
            inverseAction:
                currentIndex >= 0
                    ? { type: 'reorderTrack', payload: { trackId: alpha.payload.trackId, newIndex: currentIndex } }
                    : null,
        };
    },
    undoable: true,
});
