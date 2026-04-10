import { createHandler } from '#/helpers/createHandler';
import { toggleDim } from '#/modules/AudioEngine';

export const handleToggleControlRoomDim = createHandler<'toggleControlRoomDim'>({
    execute: () => {
        toggleDim();
    },
    describe: () => ({ label: 'Toggle Dim Monitoring' }),
    undoable: false,
});
