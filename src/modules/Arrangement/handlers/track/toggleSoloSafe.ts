import { createHandler } from '#/utils/createHandler';

import { toggleSoloSafe } from '../../useCases/toggleTrackState/toggleSoloSafe';

export const handleToggleSoloSafe = createHandler<'toggleSoloSafe'>({
    execute: (action) => {
        toggleSoloSafe(action.payload.trackId);
    },
    describe: (action) => ({
        label: 'Toggle solo safe',
        inverseAction: {
            type: 'toggleSoloSafe',
            payload: { trackId: action.payload.trackId },
        },
        redoAction: action,
    }),
    undoable: true,
});
