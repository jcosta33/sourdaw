import { createHandler } from '#/utils/createHandler';

import { toggleSoloSafe } from '../../useCases/toggleTrackState/toggleSoloSafe';

export const handleToggleSoloSafe = createHandler<'toggleSoloSafe'>({
    execute: (action) => {
        toggleSoloSafe(action.payload.trackId);
    },
    describe: () => ({ label: 'Toggle solo safe' }),
    undoable: true,
});
