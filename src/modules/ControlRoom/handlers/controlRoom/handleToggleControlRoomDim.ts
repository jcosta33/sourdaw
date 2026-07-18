import { createHandler } from '#/utils/createHandler';

import { toggleDim } from '../../useCases/controlRoom/toggleDim';

export const handleToggleControlRoomDim = createHandler<'toggleControlRoomDim'>({
    execute: () => {
        toggleDim();
    },
    describe: () => ({ label: 'Toggle Dim Monitoring' }),
    undoable: false,
});
