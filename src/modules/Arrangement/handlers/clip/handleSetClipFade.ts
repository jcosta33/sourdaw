import { createHandler } from '#/utils/createHandler';
import { setClipFade } from '../../useCases/clipEditing/setClipFade';

export const handleSetClipFade = createHandler<'setClipFade'>({
    execute: (a) => {
        setClipFade(a.payload.clipId, a.payload.fadeInBeats, a.payload.fadeOutBeats);
    },
    describe: () => ({ label: 'Set clip fade' }),
    undoable: true,
});
