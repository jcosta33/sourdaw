import { createHandler } from '#/utils/createHandler';

import { togglePreRoll } from '../../useCases/transportControls/togglePreRoll';

export const handleTogglePreRoll = createHandler<'togglePreRoll'>({
    execute: () => {
        togglePreRoll();
    },
    describe: () => ({ label: 'Toggle pre-roll' }),
    undoable: true,
});
