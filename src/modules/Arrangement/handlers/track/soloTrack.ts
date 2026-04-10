import { soloTrack } from '../../useCases/toggleTrackState/soloTrack';
import { createHandler } from '#/helpers/createHandler';

export const handleSoloTrack = createHandler<'soloTrack'>({
    execute: (action) => {
        soloTrack(action.payload.trackId, action.payload.soloed);
    },
    describe: (a) => ({
        label: a.payload.soloed ? 'Solo track' : 'Unsolo track',
        inverseAction: { type: 'soloTrack', payload: { trackId: a.payload.trackId, soloed: !a.payload.soloed } },
    }),
    undoable: true,
});
