import { createHandler } from '#/helpers/createHandler';
import { toggleMono } from '#/modules/AudioEngine/useCases';

export const handleToggleControlRoomMono = createHandler<'toggleControlRoomMono'>({
    execute: () => {
        toggleMono();
    },
    describe: () => ({ label: 'Toggle Mono Monitoring' }),
    undoable: false,
});
