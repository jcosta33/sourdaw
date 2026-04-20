import { createHandler } from '#/utils/createHandler';

import { togglePunchEnabled } from '../../useCases/transportControls/togglePunchEnabled';

export const handleTogglePunch = createHandler<'togglePunch'>({
    execute: () => {
        togglePunchEnabled();
    },
    describe: () => ({ label: 'Toggle punch in/out' }),
    undoable: true,
});
