import { createHandler } from '#/utils/createHandler';
import { setClipLoop } from '../../useCases/clipLoop/setClipLoop';

export const handleSetClipLoop = createHandler<'setClipLoop'>({
    execute: (a) => {
        setClipLoop(a.payload.clipId, a.payload.enabled);
    },
    describe: (a) => ({ label: a.payload.enabled ? 'Enable clip loop' : 'Disable clip loop' }),
    undoable: true,
});
