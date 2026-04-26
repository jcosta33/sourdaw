import { createHandler } from '#/utils/createHandler';

import { moveClip } from '../../useCases/clip/moveClip';

export const handleMoveClip = createHandler<'moveClip'>({
    execute: (alpha) => {
        moveClip(alpha.payload.clipId, alpha.payload.trackId, alpha.payload.startBeat);
    },
    describe: () => ({ label: 'Move clip' }),
    undoable: true,
});
