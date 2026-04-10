import { createHandler } from '#/helpers/createHandler';
import { togglePlayback } from '../../useCases/transportControls/togglePlayback';

export const handleTogglePlayback = createHandler<'togglePlayback'>({
    execute: () => {
        togglePlayback();
    },
    describe: () => ({ label: 'Toggle playback' }),
    undoable: false,
});
