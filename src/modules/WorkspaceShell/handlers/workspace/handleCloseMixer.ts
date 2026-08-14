import { createHandler } from '#/utils/createHandler';

import { closeMixer } from '../../useCases/togglePanel/panelToggles/closeMixer';

export const handleCloseMixer = createHandler<'closeMixer'>({
    execute: () => {
        closeMixer();
    },
    describe: () => ({ label: 'Close mixer' }),
    undoable: false,
});
