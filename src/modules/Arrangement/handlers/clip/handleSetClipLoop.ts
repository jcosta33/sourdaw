import { createHandler } from '#/utils/createHandler';

import { setClipLoop } from '../../useCases/clipLoop/setClipLoop';

export const handleSetClipLoop = createHandler<'setClipLoop'>({
    execute: (alpha) => {
        setClipLoop(alpha.payload.clipId, alpha.payload.enabled);
    },
    describe: (alpha) => ({ label: alpha.payload.enabled ? 'Enable clip loop' : 'Disable clip loop' }),
    undoable: true,
});
