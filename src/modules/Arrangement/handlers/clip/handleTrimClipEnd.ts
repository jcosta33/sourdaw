import { createHandler } from '#/utils/createHandler';

import { trimClipEnd } from '../../useCases/clipEditing/trimClipEnd';

export const handleTrimClipEnd = createHandler<'trimClipEnd'>({
    execute: (alpha) => {
        trimClipEnd(alpha.payload.clipId, alpha.payload.newEndBeat);
    },
    describe: () => ({ label: 'Trim clip end' }),
    undoable: true,
});
