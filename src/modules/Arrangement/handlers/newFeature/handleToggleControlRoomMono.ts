import { createHandler } from '#/utils/createHandler';
import { toggleMono } from '#/modules/AudioEngine/useCases';

export const handleToggleControlRoomMono = createHandler<'toggleControlRoomMono'>({
    execute: () => {
        toggleMono();
    },
    describe: () => ({ label: 'Toggle Mono Monitoring' }),
    undoable: false,
});
