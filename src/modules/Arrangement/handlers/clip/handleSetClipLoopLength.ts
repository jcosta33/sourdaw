import { createHandler } from '#/utils/createHandler';

import { setClipLoopLength } from '../../useCases/clipLoop/setClipLoopLength';

export const handleSetClipLoopLength = createHandler<'setClipLoopLength'>({
    execute: (alpha) => {
        setClipLoopLength(alpha.payload.clipId, alpha.payload.loopLength);
    },
    describe: () => ({ label: 'Set clip loop length' }),
    undoable: true,
});
