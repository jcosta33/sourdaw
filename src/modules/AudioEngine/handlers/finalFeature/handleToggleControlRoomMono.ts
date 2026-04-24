import { createHandler } from '#/utils/createHandler';

import { toggleMono } from '../../useCases/controlRoom/toggleMono';

export const handleToggleControlRoomMono = createHandler<'toggleControlRoomMono'>({
    execute: () => {
        toggleMono();
    },
    describe: () => ({ label: 'Toggle Mono Monitoring' }),
    undoable: false,
});
