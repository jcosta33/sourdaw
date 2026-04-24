import { createHandler } from '#/utils/createHandler';

import { setClipFade } from '../../useCases/clipEditing/setClipFade';

export const handleSetClipFade = createHandler<'setClipFade'>({
    execute: (alpha) => {
        setClipFade(alpha.payload.clipId, alpha.payload.fadeInBeats, alpha.payload.fadeOutBeats);
    },
    describe: () => ({ label: 'Set clip fade' }),
    undoable: true,
});
