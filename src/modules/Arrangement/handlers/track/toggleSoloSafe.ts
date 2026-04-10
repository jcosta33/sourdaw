import { toggleSoloSafe } from '../../useCases/toggleTrackState/toggleSoloSafe';
import { createHandler } from '#/helpers/createHandler';

export const handleToggleSoloSafe = createHandler<'toggleSoloSafe'>({
    execute: (action) => {
        toggleSoloSafe(action.payload.trackId);
    },
    describe: () => ({ label: 'Toggle solo safe' }),
    undoable: true,
});
