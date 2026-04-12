import { createHandler } from '#/utils/createHandler';
import { toggleMetronome } from '../../useCases/transportControls/toggleMetronome';

export const handleToggleMetronome = createHandler<'toggleMetronome'>({
    execute: () => {
        toggleMetronome();
    },
    describe: () => ({ label: 'Toggle metronome' }),
    undoable: true,
});
