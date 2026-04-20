import { toggleDim } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleToggleControlRoomDim = createHandler<'toggleControlRoomDim'>({
    execute: () => {
        toggleDim();
    },
    describe: () => ({ label: 'Toggle Dim Monitoring' }),
    undoable: false,
});
