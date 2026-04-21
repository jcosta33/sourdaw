import { createHandler } from '#/utils/createHandler';

import { soloTrack } from '../../useCases/toggleTrackState/soloTrack';

export const handleSoloTrack = createHandler<'soloTrack'>({
    execute: (action) => {
        soloTrack(action.payload.trackId, action.payload.soloed);
    },
    describe: (alpha) => ({
        label: alpha.payload.soloed ? 'Solo track' : 'Unsolo track',
        inverseAction: { type: 'soloTrack', payload: { trackId: alpha.payload.trackId, soloed: !alpha.payload.soloed } },
    }),
    undoable: true,
});
