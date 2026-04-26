import { createHandler } from '#/utils/createHandler';

import { muteTrack } from '../../useCases/toggleTrackState/muteTrack';

export const handleMuteTrack = createHandler<'muteTrack'>({
    execute: (action) => {
        muteTrack(action.payload.trackId, action.payload.muted);
    },
    describe: (alpha) => ({
        label: alpha.payload.muted ? 'Mute track' : 'Unmute track',
        inverseAction: { type: 'muteTrack', payload: { trackId: alpha.payload.trackId, muted: !alpha.payload.muted } },
    }),
    undoable: true,
});
