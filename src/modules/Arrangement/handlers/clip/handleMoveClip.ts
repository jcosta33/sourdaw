import { createHandler } from '#/utils/createHandler';
import { moveClip } from '../../useCases/clip/moveClip';

export const handleMoveClip = createHandler<'moveClip'>({
    execute: (a) => {
        moveClip(a.payload.clipId, a.payload.trackId, a.payload.startBeat);
    },
    describe: () => ({ label: 'Move clip' }),
    undoable: true,
});
