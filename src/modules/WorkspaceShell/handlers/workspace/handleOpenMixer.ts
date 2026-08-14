import { createHandler } from '#/utils/createHandler';

import { openMixer } from '../../useCases/togglePanel/panelToggles/openMixer';

export const handleOpenMixer = createHandler<'openMixer'>({
    execute: () => {
        openMixer();
    },
    describe: () => ({ label: 'Open mixer' }),
    undoable: false,
});
