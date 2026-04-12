import { createHandler } from '#/utils/createHandler';
import { disableTrack } from '../../useCases/toggleTrackState/disableTrack';

export const handleDisableTrack = createHandler<'disableTrack'>({
    execute: (action) => {
        disableTrack(action.payload.trackId, action.payload.disabled);
    },
    describe: (a) => ({ label: a.payload.disabled ? 'Disable track' : 'Enable track' }),
    undoable: true,
});
