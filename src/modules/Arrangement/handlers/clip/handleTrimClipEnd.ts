import { createHandler } from '#/utils/createHandler';

import { trimClipEnd } from '../../useCases/clipEditing/trimClipEnd';

export const handleTrimClipEnd = createHandler<'trimClipEnd'>({
    execute: (a) => {
        trimClipEnd(a.payload.clipId, a.payload.newEndBeat);
    },
    describe: () => ({ label: 'Trim clip end' }),
    undoable: true,
});
