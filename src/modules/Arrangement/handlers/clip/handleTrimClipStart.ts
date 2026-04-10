import { createHandler } from '#/helpers/createHandler';
import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    execute: (a) => {
        trimClipStart(a.payload.clipId, a.payload.newStartBeat);
    },
    describe: () => ({ label: 'Trim clip start' }),
    undoable: true,
});
