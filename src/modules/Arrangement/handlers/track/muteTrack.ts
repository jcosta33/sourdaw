import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { muteTrack } from '../../useCases/toggleTrackState/muteTrack';

export const handleMuteTrack = createHandler<'muteTrack'>({
    execute: (action) => {
        muteTrack(action.payload.trackId, action.payload.muted);
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.muted ===
        action.payload.muted,
    describe: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return {
            label: action.payload.muted ? 'Mute track' : 'Unmute track',
            inverseAction: track ? { type: 'muteTrack', payload: { trackId: track.id, muted: track.muted } } : null,
        };
    },
    undoable: true,
});
