import { createHandler } from '#/utils/createHandler';

import { moveClip } from '../../useCases/clip/moveClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleMoveClip = createHandler<'moveClip'>({
    execute: (alpha) => {
        moveClip(alpha.payload.clipId, alpha.payload.trackId, alpha.payload.startBeat);
    },
    describe: (alpha) => {
        const state = getTrackStoreState();
        const track = state?.tracks.find((time) => time.clips.some((context) => context.id === alpha.payload.clipId));
        const clip = track?.clips.find((context) => context.id === alpha.payload.clipId);
        return {
            label: 'Move clip',
            inverseAction:
                track && clip
                    ? {
                          type: 'moveClip',
                          payload: { clipId: clip.id, trackId: track.id, startBeat: clip.startBeat },
                      }
                    : null,
        };
    },
    undoable: true,
});
