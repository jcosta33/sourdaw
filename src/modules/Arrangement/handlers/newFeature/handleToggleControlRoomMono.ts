import { toggleMono } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleToggleControlRoomMono = createHandler<'toggleControlRoomMono'>({
    execute: () => {
        toggleMono();
    },
    describe: () => ({ label: 'Toggle Mono Monitoring' }),
    undoable: false,
});
