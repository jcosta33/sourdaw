import { createHandler } from '#/utils/createHandler';
import { toggleMixer } from '../../useCases/togglePanel/panelToggles/toggleMixer';

export const handleCloseMixer = createHandler<'closeMixer'>({
    execute: () => {
        toggleMixer();
    },
    describe: () => ({ label: 'Close mixer' }),
    undoable: false,
});
