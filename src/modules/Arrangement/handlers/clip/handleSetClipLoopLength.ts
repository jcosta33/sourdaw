import { createHandler } from '#/utils/createHandler';
import { setClipLoopLength } from '../../useCases/clipLoop/setClipLoopLength';

export const handleSetClipLoopLength = createHandler<'setClipLoopLength'>({
    execute: (a) => {
        setClipLoopLength(a.payload.clipId, a.payload.loopLength);
    },
    describe: () => ({ label: 'Set clip loop length' }),
    undoable: true,
});
