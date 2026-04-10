import { createHandler } from '#/helpers/createHandler';
import { setClipLoopLength } from '../../useCases/clipLoop';

export const handleSetClipLoopLength = createHandler<'setClipLoopLength'>({
    execute: (a) => {
        setClipLoopLength(a.payload.clipId, a.payload.loopLength);
    },
    describe: () => ({ label: 'Set clip loop length' }),
    undoable: true,
});
