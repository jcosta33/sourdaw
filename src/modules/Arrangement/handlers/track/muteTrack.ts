import { muteTrack } from '../../useCases/toggleTrackState/muteTrack';
import { createHandler } from '#/helpers/createHandler';

export const handleMuteTrack = createHandler<'muteTrack'>({
    execute: (action) => {
        muteTrack(action.payload.trackId, action.payload.muted);
    },
    describe: (a) => ({
        label: a.payload.muted ? 'Mute track' : 'Unmute track',
        inverseAction: { type: 'muteTrack', payload: { trackId: a.payload.trackId, muted: !a.payload.muted } },
    }),
    undoable: true,
});
