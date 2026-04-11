import { createHandler } from '#/helpers/createHandler';
import { toggleMixer } from '../../useCases/togglePanel/panelToggles/toggleMixer';

export const handleOpenMixer = createHandler<'openMixer'>({
    execute: () => {
        toggleMixer();
    },
    describe: () => ({ label: 'Open mixer' }),
    undoable: false,
});
