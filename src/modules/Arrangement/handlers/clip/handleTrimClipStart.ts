import { createHandler } from '#/utils/createHandler';

import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    execute: (alpha) => {
        trimClipStart(alpha.payload.clipId, alpha.payload.newStartBeat);
    },
    describe: () => ({ label: 'Trim clip start' }),
    undoable: true,
});
