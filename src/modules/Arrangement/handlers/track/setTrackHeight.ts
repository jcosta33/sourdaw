import { createHandler } from '#/utils/createHandler';

import { setTrackHeight } from '../../useCases/toggleTrackState/setTrackHeight';

export const handleSetTrackHeight = createHandler<'setTrackHeight'>({
    execute: (action) => {
        setTrackHeight(action.payload.trackId, action.payload.height);
    },
    describe: () => ({ label: 'Set track height' }),
    undoable: true,
});
