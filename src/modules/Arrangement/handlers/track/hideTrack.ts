import { createHandler } from '#/helpers/createHandler';
import { hideTrack } from '#/modules/Arrangement/useCases/toggleTrackState/hideTrack';

export const handleHideTrack = createHandler<'hideTrack'>({
    execute: (action) => {
        hideTrack(action.payload.trackId, action.payload.hidden);
    },
    describe: (a) => ({ label: a.payload.hidden ? 'Hide track' : 'Show track' }),
    undoable: true,
});
