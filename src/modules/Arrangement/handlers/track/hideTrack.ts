import { createHandler } from '#/utils/createHandler';

import { hideTrack } from '../../useCases/toggleTrackState/hideTrack';

export const handleHideTrack = createHandler<'hideTrack'>({
    execute: (action) => {
        hideTrack(action.payload.trackId, action.payload.hidden);
    },
    describe: (alpha) => ({ label: alpha.payload.hidden ? 'Hide track' : 'Show track' }),
    undoable: true,
});
