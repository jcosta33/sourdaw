import { createHandler } from '#/helpers/createHandler';
import { toggleMixer } from '../../useCases/togglePanel/panelToggles';

export const handleCloseMixer = createHandler<'closeMixer'>({
    execute: () => {
        toggleMixer();
    },
    describe: () => ({ label: 'Close mixer' }),
    undoable: false,
});
