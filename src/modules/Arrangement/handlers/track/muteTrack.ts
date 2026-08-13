import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { muteTrack } from '../../useCases/toggleTrackState/muteTrack';
import { getPlannedTrackState } from '../getPlannedTrackState';

export const handleMuteTrack = createHandler<'muteTrack'>({
    validate: (action, context) => {
        const currentMuted = getPlannedTrackState(context, action.payload.trackId)?.muted;
        return currentMuted === action.payload.expectedMuted;
    },
    execute: (action) => {
        const currentMuted = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.muted;
        if (currentMuted !== action.payload.expectedMuted) {
            return { status: 'conflict' };
        }
        muteTrack(action.payload.trackId, action.payload.muted);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const currentMuted = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.muted;
        return currentMuted === action.payload.expectedMuted && currentMuted === action.payload.muted;
    },
    describe: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return {
            label: action.payload.muted ? 'Mute track' : 'Unmute track',
            inverseAction: track
                ? {
                      type: 'muteTrack',
                      payload: { trackId: track.id, muted: track.muted, expectedMuted: action.payload.muted },
                  }
                : null,
            redoAction: track
                ? {
                      type: 'muteTrack',
                      payload: { trackId: track.id, muted: action.payload.muted, expectedMuted: track.muted },
                  }
                : undefined,
        };
    },
    undoable: true,
});
